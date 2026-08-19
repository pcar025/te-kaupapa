import { z } from 'zod'

import { contentHash } from '../safety-assessments/domain.js'
import { workflowSynthesisContentSchema, workflowSynthesisInputSchema, type ConfirmedWorkflowSynthesisInput, type WorkflowSynthesisContent } from './domain.js'

export interface WorkflowSynthesisResult {
  content: WorkflowSynthesisContent
  provider: string
  model: string
  configurationHash: string
  schemaVersion: string
  generatedAt: Date
}

export interface WorkflowSynthesisProvider {
  generateWorkflowSynthesis(input: ConfirmedWorkflowSynthesisInput): Promise<WorkflowSynthesisResult>
}

export class WorkflowSynthesisProviderError extends Error {}

const SYNTHESIS_PROMPT_TEMPLATE_VERSION = '1'

function outputSchema(): Record<string, unknown> {
  const optionalNarrative = { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 1_200 }] }
  return {
    type: 'object', additionalProperties: false,
    required: ['overallSummary', 'keyThemes', 'strengthsSummary', 'areasForAttentionSummary', 'informationStillToExploreSummary', 'confirmedSafetyConcernsSummary'],
    properties: {
      overallSummary: { type: 'string', minLength: 1, maxLength: 1_800 },
      keyThemes: optionalNarrative,
      strengthsSummary: optionalNarrative,
      areasForAttentionSummary: optionalNarrative,
      informationStillToExploreSummary: optionalNarrative,
      confirmedSafetyConcernsSummary: { type: 'string', minLength: 1, maxLength: 1_200 },
    },
  }
}

function prompt(): string {
  return 'Create a concise, practitioner-facing cross-Pou synthesis using only the supplied confirmed Te Kaupapa state. This is a generated draft, not a safety decision, action, referral, escalation, supervisor decision, or workflow transition. Identify themes across the engagement; do not concatenate seven mini-summaries or invent facts. Treat missing information as uncertainty. Confirmed safety concerns may include only the supplied human-confirmed safety state; ordinary attention items and unconfirmed candidate signals are not safety concerns. If none are supplied, say concisely that no human-confirmed safety concerns are recorded. Do not mention providers, prompts, confidence, technical identifiers, transcripts, or hidden reasoning.'
}

export class OpenAIWorkflowSynthesisProvider implements WorkflowSynthesisProvider {
  constructor(private readonly configuration: { apiKey: string; model: string }, private readonly request: typeof fetch = fetch, private readonly now: () => Date = () => new Date()) {}

  async generateWorkflowSynthesis(input: ConfirmedWorkflowSynthesisInput): Promise<WorkflowSynthesisResult> {
    const source = workflowSynthesisInputSchema.parse(input)
    const schema = outputSchema()
    let response: Response
    try {
      response = await this.request('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.configuration.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.configuration.model,
          store: false,
          background: false,
          input: [{ role: 'system', content: prompt() }, { role: 'user', content: JSON.stringify(source) }],
          text: { format: { type: 'json_schema', name: 'te_kaupapa_workflow_synthesis', strict: true, schema } },
        }),
      })
    } catch {
      throw new WorkflowSynthesisProviderError('Synthesis provider request failed.')
    }
    if (!response.ok) throw new WorkflowSynthesisProviderError(`Synthesis provider rejected the request: HTTP ${response.status}.`)
    const body = await response.json() as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }> }
    const outputText = typeof body.output_text === 'string'
      ? body.output_text
      : body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text' && typeof item.text === 'string')?.text
    if (typeof outputText !== 'string') throw new WorkflowSynthesisProviderError('Synthesis provider returned no structured output.')
    let parsed: unknown
    try { parsed = JSON.parse(outputText) } catch { throw new WorkflowSynthesisProviderError('Synthesis provider output was not JSON.') }
    const content = workflowSynthesisContentSchema.safeParse(parsed)
    if (!content.success) throw new WorkflowSynthesisProviderError('Synthesis provider output did not match the bounded contract.')
    return {
      content: content.data,
      provider: 'openai',
      model: this.configuration.model,
      configurationHash: contentHash({ provider: 'openai', model: this.configuration.model, promptTemplateVersion: SYNTHESIS_PROMPT_TEMPLATE_VERSION, prompt: prompt(), structuredOutputSchema: schema, schemaVersion: '1' }),
      schemaVersion: '1',
      generatedAt: this.now(),
    }
  }
}
