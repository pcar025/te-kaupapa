import { z } from 'zod'

import { contentHash, providerRuleAssessmentSchema, validateProviderAssessmentSet, type ProviderAssessmentProjection, type ProviderRuleAssessment } from './domain.js'
import { assessmentTranscriptInput, type TranscriptTurn } from '../transcripts/domain.js'

export interface StructuredPouAssessment { assessments: ProviderRuleAssessment[] }
export interface ConversationAssessmentInput { transcriptTurns: TranscriptTurn[]; assessmentProjection: ProviderAssessmentProjection }
/** Bounded provider/model provenance; the application contract itself is provider-neutral. */
export interface ConversationAssessmentResult { assessment: StructuredPouAssessment; provider: string; model: string; configurationHash: string; schemaVersion: string; assessmentStartedAt: Date; assessmentCompletedAt: Date }
export interface ConversationAssessmentProvider { assessPouConversation(input: ConversationAssessmentInput): Promise<ConversationAssessmentResult> }
export class ConversationAssessmentProviderError extends Error {}

const envelope = z.object({ assessments: z.array(providerRuleAssessmentSchema).min(1).max(50) }).strict()
const ASSESSMENT_PROMPT_TEMPLATE_VERSION = '1'

function outputSchema(projection: ProviderAssessmentProjection): Record<string, unknown> {
  const boundedCodes = (codes: string[]) => codes.length === 0
    ? { type: 'array', items: { type: 'string' }, maxItems: 0 }
    : { type: 'array', items: { type: 'string', enum: codes }, maxItems: 20 }
  const result = (rule: ProviderAssessmentProjection['rules'][number]) => ({
    type: 'object', additionalProperties: false, required: ['ruleCode', 'ruleVersion', 'outcome', 'candidateConcernLevel', 'matchedProtectiveIndicatorCodes', 'matchedConcernIndicatorCodes', 'missingInformationCodes', 'uncertaintyReasonCodes', 'applicabilityReasonCode', 'evidenceTurnIds'],
    properties: {
      ruleCode: { type: 'string', enum: [rule.ruleCode] }, ruleVersion: { type: 'integer', enum: [rule.ruleVersion] }, outcome: { type: 'string', enum: rule.allowedCandidateOutcomes }, candidateConcernLevel: { type: 'null' },
      matchedProtectiveIndicatorCodes: boundedCodes(rule.protectiveIndicators.map((item) => item.code)),
      matchedConcernIndicatorCodes: boundedCodes(rule.concernIndicators.map((item) => item.code)),
      missingInformationCodes: boundedCodes(rule.requiredInformation.map((item) => item.code)),
      uncertaintyReasonCodes: boundedCodes(rule.uncertaintyReasonCodes),
      applicabilityReasonCode: rule.applicabilityReasonCodes.length === 0 ? { type: 'null' } : { anyOf: [{ type: 'null' }, { type: 'string', enum: rule.applicabilityReasonCodes }] },
      evidenceTurnIds: { type: 'array', items: { type: 'string', enum: [] }, maxItems: 8 },
    },
  })
  return { type: 'object', additionalProperties: false, required: ['assessments'], properties: { assessments: { type: 'array', minItems: projection.rules.length, maxItems: projection.rules.length, items: { anyOf: projection.rules.map(result) } } } }
}

function outputSchemaForTurns(projection: ProviderAssessmentProjection, turns: TranscriptTurn[]): Record<string, unknown> {
  const schema = outputSchema(projection) as { properties: { assessments: { items: { anyOf: Array<{ properties: { evidenceTurnIds: Record<string, unknown> } }> } } } }
  for (const item of schema.properties.assessments.items.anyOf) item.properties.evidenceTurnIds = turns.length === 0
    ? { type: 'array', items: { type: 'string' }, maxItems: 0 }
    : { type: 'array', items: { type: 'string', enum: turns.map((turn) => turn.id) }, maxItems: 8 }
  return schema
}

function prompt(projection: ProviderAssessmentProjection): string {
  const rules = projection.rules.map((rule) => ({ ruleCode: rule.ruleCode, ruleVersion: rule.ruleVersion, definition: rule.definition, allowedCandidateOutcomes: rule.allowedCandidateOutcomes, protectiveIndicatorCodes: rule.protectiveIndicators.map((item) => item.code), concernIndicatorCodes: rule.concernIndicators.map((item) => item.code), requiredInformationCodes: rule.requiredInformation.map((item) => item.code), applicabilityReasonCodes: rule.applicabilityReasonCodes, uncertaintyReasonCodes: rule.uncertaintyReasonCodes }))
  return `Assess only explicit current-conversation evidence using this immutable Te Kaupapa Whakapapa projection: ${JSON.stringify(rules)}. Return every rule exactly once. Do not infer from silence or identity. candidateConcernLevel is always null. A possible_concern requires at least one approved matchedConcernIndicatorCode, no missingInformationCodes, and null applicabilityReasonCode. insufficient_information requires at least one approved missingInformationCode and null applicabilityReasonCode. not_applicable requires an approved applicabilityReasonCode. no_candidate_concern has no concern code and null applicabilityReasonCode. evidenceTurnIds may contain only supplied stable turn IDs, no duplicates, and no more than eight IDs; use them for direct supporting source material only. Do not include rationale, transcript quotations, actions, referrals, consequences, severity, or workflow decisions.`
}

export class OpenAIConversationAssessmentProvider implements ConversationAssessmentProvider {
  constructor(private readonly configuration: { apiKey: string; model: string }, private readonly request: typeof fetch = fetch, private readonly now: () => Date = () => new Date()) {}
  async assessPouConversation(input: ConversationAssessmentInput): Promise<ConversationAssessmentResult> {
    const assessmentStartedAt = this.now()
    let response: Response
    try {
      const schema = outputSchemaForTurns(input.assessmentProjection, input.transcriptTurns)
      response = await this.request('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${this.configuration.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: this.configuration.model, store: false, background: false, input: [{ role: 'system', content: prompt(input.assessmentProjection) }, { role: 'user', content: assessmentTranscriptInput(input.transcriptTurns) }], text: { format: { type: 'json_schema', name: 'te_kaupapa_whakapapa_assessment', strict: true, schema } } }) })
    } catch { throw new ConversationAssessmentProviderError('Assessment provider request failed.') }
    if (!response.ok) {
      const rejected = await response.json().catch(() => undefined) as { error?: { code?: unknown; type?: unknown } } | undefined
      const code = typeof rejected?.error?.code === 'string' ? rejected.error.code.slice(0, 80) : typeof rejected?.error?.type === 'string' ? rejected.error.type.slice(0, 80) : 'unclassified'
      throw new ConversationAssessmentProviderError(`Assessment provider rejected the request: HTTP ${response.status} (${code}).`)
    }
    const body = await response.json() as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }> }
    const outputText = typeof body.output_text === 'string'
      ? body.output_text
      : body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text' && typeof item.text === 'string')?.text
    if (typeof outputText !== 'string') throw new ConversationAssessmentProviderError('Assessment provider returned no structured output.')
    let parsed: unknown
    try { parsed = JSON.parse(outputText) } catch { throw new ConversationAssessmentProviderError('Assessment provider output was not JSON.') }
    const assessment = envelope.parse(parsed)
    validateProviderAssessmentSet(input.assessmentProjection, assessment.assessments, new Set(input.transcriptTurns.map((turn) => turn.id)))
    return { assessment, provider: 'openai', model: this.configuration.model, configurationHash: contentHash({ provider: 'openai', model: this.configuration.model, promptTemplateVersion: ASSESSMENT_PROMPT_TEMPLATE_VERSION, prompt: prompt(input.assessmentProjection), structuredOutputSchema: outputSchemaForTurns(input.assessmentProjection, input.transcriptTurns), schemaVersion: '1' }), schemaVersion: '1', assessmentStartedAt, assessmentCompletedAt: this.now() }
  }
}
