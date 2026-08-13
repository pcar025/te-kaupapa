import { z } from 'zod'

import { contentHash, type ProviderAssessmentProjection } from '../safety-assessments/domain.js'
import { assessmentTranscriptInput, type TranscriptTurn } from '../transcripts/domain.js'
import { whakapapaReviewDraftContentSchema, type WhakapapaReviewDraftContent } from './domain.js'

export interface ConversationReviewDraftInput {
  transcriptTurns: TranscriptTurn[]
  assessmentProjection: ProviderAssessmentProjection
}
export interface ConversationReviewDraftResult {
  draft: WhakapapaReviewDraftContent
  provider: string
  model: string
  configurationHash: string
  schemaVersion: string
  generatedAt: Date
}
export interface ConversationReviewDraftProvider {
  generateWhakapapaReviewDraft(input: ConversationReviewDraftInput): Promise<ConversationReviewDraftResult>
}
export class ConversationReviewDraftProviderError extends Error {}

const REVIEW_PROMPT_TEMPLATE_VERSION = '1'

function outputSchema(turns: TranscriptTurn[]): Record<string, unknown> {
  const narrative = { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 1200 }] }
  return {
    type: 'object', additionalProperties: false,
    required: ['overallSummary', 'strengthsSummary', 'areasForAttentionSummary', 'evidenceTurnIds'],
    properties: {
      overallSummary: narrative,
      strengthsSummary: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 900 }] },
      areasForAttentionSummary: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 900 }] },
      evidenceTurnIds: { type: 'array', items: { type: 'string', enum: turns.map((turn) => turn.id) }, maxItems: 8 },
    },
  }
}

function prompt(projection: ProviderAssessmentProjection): string {
  return `Create a concise, practitioner-facing Whakapapa Pou review draft from only the supplied ordered transcript turns. This is a noncanonical narrative aid, not a safety assessment or a decision. Use neutral, nonjudgmental language and preserve uncertainty. Describe identity and whānau context only where explicit; distinguish strengths/protective factors from areas that may need attention or further exploration. Do not infer facts from silence. Do not include diagnosis, concern level, risk severity, action, referral, escalation, supervisor decision, safety clearance, recommendation presented as fact, quotation, rationale, or workflow decision. At least one field must be present, but use null where the source does not support that aspect. evidenceTurnIds must refer only to direct supplied support. The current approved Whakapapa assessment projection is context only, not output policy: ${JSON.stringify({ specificationCode: projection.specificationCode, specificationVersion: projection.specificationVersion, rules: projection.rules.map((rule) => ({ ruleCode: rule.ruleCode, title: rule.title, purpose: rule.purpose })) })}`
}

export class OpenAIConversationReviewDraftProvider implements ConversationReviewDraftProvider {
  constructor(private readonly configuration: { apiKey: string; model: string }, private readonly request: typeof fetch = fetch, private readonly now: () => Date = () => new Date()) {}

  async generateWhakapapaReviewDraft(input: ConversationReviewDraftInput): Promise<ConversationReviewDraftResult> {
    let response: Response
    try {
      response = await this.request('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { authorization: `Bearer ${this.configuration.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.configuration.model, store: false, background: false, input: [{ role: 'system', content: prompt(input.assessmentProjection) }, { role: 'user', content: assessmentTranscriptInput(input.transcriptTurns) }], text: { format: { type: 'json_schema', name: 'te_kaupapa_whakapapa_review_draft', strict: true, schema: outputSchema(input.transcriptTurns) } } }),
      })
    } catch { throw new ConversationReviewDraftProviderError('Review draft provider request failed.') }
    if (!response.ok) throw new ConversationReviewDraftProviderError(`Review draft provider rejected the request: HTTP ${response.status}.`)
    const body = await response.json() as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }> }
    const text = typeof body.output_text === 'string' ? body.output_text : body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text' && typeof item.text === 'string')?.text
    if (typeof text !== 'string') throw new ConversationReviewDraftProviderError('Review draft provider returned no structured output.')
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { throw new ConversationReviewDraftProviderError('Review draft provider output was not JSON.') }
    const draft = whakapapaReviewDraftContentSchema.safeParse(parsed)
    if (!draft.success) throw new ConversationReviewDraftProviderError('Review draft provider output did not match the bounded contract.')
    const turnIds = new Set(input.transcriptTurns.map((turn) => turn.id))
    if (draft.data.evidenceTurnIds.some((id) => !turnIds.has(id))) throw new ConversationReviewDraftProviderError('Review draft provider referenced a turn outside the transcript.')
    return { draft: draft.data, provider: 'openai', model: this.configuration.model, configurationHash: contentHash({ provider: 'openai', model: this.configuration.model, promptTemplateVersion: REVIEW_PROMPT_TEMPLATE_VERSION, prompt: prompt(input.assessmentProjection), structuredOutputSchema: outputSchema(input.transcriptTurns), schemaVersion: '1' }), schemaVersion: '1', generatedAt: this.now() }
  }
}
