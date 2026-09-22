import { z } from 'zod'

import { contentHash } from '../safety-assessments/domain.js'
import type { PouReviewProjection } from '../pou-specifications/domain.js'
import { assessmentTranscriptInput, type TranscriptTurn } from '../transcripts/domain.js'
import { validatePhq9ReviewEvidence, validateReviewCriterionAssessments, whakapapaReviewDraftContentSchema, type Phq9ReviewEvidence, type ReviewCriterionAssessment, type WhakapapaReviewDraftContent } from './domain.js'

export interface ConversationReviewDraftInput {
  transcriptTurns: TranscriptTurn[]
  reviewProjection: PouReviewProjection
}
export interface ConversationReviewDraftResult {
  draft: WhakapapaReviewDraftContent
  criterionAssessments: ReviewCriterionAssessment[]
  /** Present only for Kaitiakitanga provider output; historical/test adapters may omit it. */
  phq9Evidence?: Phq9ReviewEvidence
  provider: string
  model: string
  configurationHash: string
  schemaVersion: string
  generatedAt: Date
}
export interface ConversationReviewDraftProvider {
  generatePouReviewDraft(input: ConversationReviewDraftInput): Promise<ConversationReviewDraftResult>
}
export class ConversationReviewDraftProviderError extends Error {}

const REVIEW_PROMPT_TEMPLATE_VERSION = '3'

function outputSchema(turns: TranscriptTurn[], projection: PouReviewProjection): Record<string, unknown> {
  const narrative = { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 1200 }] }
  const schema: Record<string, unknown> = {
    type: 'object', additionalProperties: false,
    required: ['overallSummary', 'strengthsSummary', 'areasForAttentionSummary', 'evidenceTurnIds', 'criterionAssessments'],
    properties: {
      overallSummary: narrative,
      strengthsSummary: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 900 }] },
      areasForAttentionSummary: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 900 }] },
      evidenceTurnIds: { type: 'array', items: { type: 'string', enum: turns.map((turn) => turn.id) }, maxItems: 8 },
      criterionAssessments: { type: 'array', minItems: projection.criteria.length, maxItems: projection.criteria.length, items: { type: 'object', additionalProperties: false, required: ['criterionCode', 'status', 'evidenceTurnIds', 'missingInformationCodes'], properties: {
        criterionCode: { type: 'string', enum: projection.criteria.map((criterion) => criterion.criterionCode) }, status: { type: 'string', enum: projection.criterionStatusVocabulary }, evidenceTurnIds: { type: 'array', items: { type: 'string', enum: turns.map((turn) => turn.id) }, maxItems: 8 }, missingInformationCodes: { type: 'array', items: { type: 'string' }, maxItems: 12 },
      } } },
    },
  }
  if (projection.pouId !== 'kaitiakitanga') return schema
  const properties = schema.properties as Record<string, unknown>
  properties.phq9Evidence = { type: 'object', additionalProperties: false, required: ['indication', 'indicationEvidenceTurnIds', 'completion', 'completionEvidenceTurnIds', 'reportedTotalScore', 'reportedTotalScoreEvidenceTurnIds'], properties: {
    indication: { type: 'string', enum: ['indicated', 'not_indicated', 'insufficient_information'] },
    indicationEvidenceTurnIds: { type: 'array', items: { type: 'string', enum: turns.map((turn) => turn.id) }, maxItems: 8 },
    completion: { type: 'string', enum: ['completed', 'not_completed', 'insufficient_information'] },
    completionEvidenceTurnIds: { type: 'array', items: { type: 'string', enum: turns.map((turn) => turn.id) }, maxItems: 8 },
    reportedTotalScore: { anyOf: [{ type: 'null' }, { type: 'integer', minimum: 0, maximum: 27 }] },
    reportedTotalScoreEvidenceTurnIds: { type: 'array', items: { type: 'string', enum: turns.map((turn) => turn.id) }, maxItems: 8 },
  } }
  ;(schema.required as string[]).push('phq9Evidence')
  return schema
}

function prompt(projection: PouReviewProjection): string {
  const phq9Instructions = projection.pouId === 'kaitiakitanga'
    ? ' For phq9Evidence, surface only an explicit Kaimahi statement: never infer indication from distress, administer or score PHQ-9 items, calculate a total, diagnose, choose a concern level, or infer escalation. Use insufficient_information with empty evidence arrays for no or ambiguous PHQ-9 discussion. A reported total is allowed only with explicit completed and indicated evidence.'
    : ''
  return `Create a concise, practitioner-facing ${projection.pouId} Pou review draft from only the supplied ordered transcript turns. This is a noncanonical narrative aid, not a safety assessment or a decision. Use neutral, nonjudgmental language and preserve uncertainty. Do not infer facts from silence: an unmentioned criterion must be not_explored or insufficient_information, never evidence that a concern is absent. Do not include diagnosis, concern level, risk severity, action, referral, escalation, supervisor decision, safety clearance, quotation, rationale, or workflow decision. At least one narrative field must be present, but use null where the source does not support that aspect. Return exactly one structured assessment for every supplied current-conversation criterion. evidenceTurnIds must refer only to direct supplied support.${phq9Instructions} Review policy: ${JSON.stringify({ specificationCode: projection.specificationCode, specificationVersion: projection.specificationVersion, pouId: projection.pouId, criteria: projection.criteria, synthesisGuidance: projection.synthesisGuidance })}`
}

export class OpenAIConversationReviewDraftProvider implements ConversationReviewDraftProvider {
  constructor(private readonly configuration: { apiKey: string; model: string }, private readonly request: typeof fetch = fetch, private readonly now: () => Date = () => new Date()) {}

  async generatePouReviewDraft(input: ConversationReviewDraftInput): Promise<ConversationReviewDraftResult> {
    let response: Response
    try {
      response = await this.request('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { authorization: `Bearer ${this.configuration.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.configuration.model, store: false, background: false, input: [{ role: 'system', content: prompt(input.reviewProjection) }, { role: 'user', content: assessmentTranscriptInput(input.transcriptTurns) }], text: { format: { type: 'json_schema', name: 'te_kaupapa_pou_review_draft', strict: true, schema: outputSchema(input.transcriptTurns, input.reviewProjection) } } }),
      })
    } catch { throw new ConversationReviewDraftProviderError('Review draft provider request failed.') }
    if (!response.ok) throw new ConversationReviewDraftProviderError(`Review draft provider rejected the request: HTTP ${response.status}.`)
    const body = await response.json() as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }> }
    const text = typeof body.output_text === 'string' ? body.output_text : body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text' && typeof item.text === 'string')?.text
    if (typeof text !== 'string') throw new ConversationReviewDraftProviderError('Review draft provider returned no structured output.')
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { throw new ConversationReviewDraftProviderError('Review draft provider output was not JSON.') }
    const output = z.object({ overallSummary: z.string().nullable(), strengthsSummary: z.string().nullable(), areasForAttentionSummary: z.string().nullable(), evidenceTurnIds: z.array(z.string().uuid()), criterionAssessments: z.array(z.unknown()), phq9Evidence: z.unknown().optional() }).strict().safeParse(parsed)
    if (!output.success) throw new ConversationReviewDraftProviderError('Review draft provider output did not match the bounded contract.')
    const draft = whakapapaReviewDraftContentSchema.safeParse({ overallSummary: output.data.overallSummary, strengthsSummary: output.data.strengthsSummary, areasForAttentionSummary: output.data.areasForAttentionSummary, evidenceTurnIds: output.data.evidenceTurnIds })
    if (!draft.success) throw new ConversationReviewDraftProviderError('Review draft provider output did not match the bounded contract.')
    const turnIds = new Set(input.transcriptTurns.map((turn) => turn.id))
    if (draft.data.evidenceTurnIds.some((id) => !turnIds.has(id))) throw new ConversationReviewDraftProviderError('Review draft provider referenced a turn outside the transcript.')
    let criterionAssessments: ReviewCriterionAssessment[]
    try { criterionAssessments = validateReviewCriterionAssessments(input.reviewProjection, output.data.criterionAssessments as ReviewCriterionAssessment[], turnIds) } catch { throw new ConversationReviewDraftProviderError('Review draft provider evidence did not match the pinned criterion contract.') }
    let phq9Evidence: Phq9ReviewEvidence | undefined
    if (input.reviewProjection.pouId === 'kaitiakitanga') {
      try { phq9Evidence = validatePhq9ReviewEvidence(output.data.phq9Evidence, turnIds) } catch { throw new ConversationReviewDraftProviderError('Review draft PHQ-9 evidence did not match the bounded transcript contract.') }
    }
    return { draft: draft.data, criterionAssessments, phq9Evidence, provider: 'openai', model: this.configuration.model, configurationHash: contentHash({ provider: 'openai', model: this.configuration.model, promptTemplateVersion: REVIEW_PROMPT_TEMPLATE_VERSION, prompt: prompt(input.reviewProjection), structuredOutputSchema: outputSchema(input.transcriptTurns, input.reviewProjection), schemaVersion: '3' }), schemaVersion: '3', generatedAt: this.now() }
  }

  /** Backwards-compatible Phase 5C entry point. */
  generateWhakapapaReviewDraft(input: ConversationReviewDraftInput): Promise<ConversationReviewDraftResult> {
    return this.generatePouReviewDraft(input)
  }
}
