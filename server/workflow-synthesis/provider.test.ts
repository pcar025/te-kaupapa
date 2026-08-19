import { describe, expect, it } from 'vitest'

import { OpenAIWorkflowSynthesisProvider, WorkflowSynthesisProviderError } from './provider.js'

const input = {
  pouReviews: ['Whakapapa', 'Manaakitanga', 'Tikanga', 'Kaitiakitanga', 'Pūkenga', 'Haepapa', 'Oranga'].map((pouName) => ({ pouName, overallSummary: null, strengthsSummary: null, areasForAttentionSummary: null, stillToExplore: [] })),
  carryForwards: [], confirmedSafetyConcerns: [],
}
const content = { overallSummary: 'A bounded cross-Pou summary.', keyThemes: 'Shared themes.', strengthsSummary: 'Whānau strengths.', areasForAttentionSummary: 'One area for attention.', informationStillToExploreSummary: 'One item remains to explore.', confirmedSafetyConcernsSummary: 'No human-confirmed safety concerns are recorded.' }

describe('OpenAIWorkflowSynthesisProvider', () => {
  it('uses server-only strict structured output with store disabled and bounded Te Kaupapa state only', async () => {
    let request: RequestInit | undefined
    const provider = new OpenAIWorkflowSynthesisProvider({ apiKey: 'server-only-test-key', model: 'model-test' }, async (_url, init) => {
      request = init
      return new Response(JSON.stringify({ output_text: JSON.stringify(content), raw_payload: 'MUST_NOT_ESCAPE' }), { status: 200 })
    })
    const result = await provider.generateWorkflowSynthesis(input)
    expect(result.content).toEqual(content)
    const body = JSON.parse(String(request?.body))
    expect(body).toMatchObject({ model: 'model-test', store: false, background: false, text: { format: { type: 'json_schema', strict: true } } })
    expect(JSON.stringify(body)).not.toContain('server-only-test-key')
    expect(JSON.stringify(body)).not.toContain('MUST_NOT_ESCAPE')
    expect(String(body.input[1].content)).not.toMatch(/transcript|uuid|raw/i)
  })

  it('rejects malformed provider output without returning provider payloads', async () => {
    const provider = new OpenAIWorkflowSynthesisProvider({ apiKey: 'key', model: 'model' }, async () => new Response(JSON.stringify({ output_text: JSON.stringify({ ...content, unexpected: 'not allowed' }) }), { status: 200 }))
    await expect(provider.generateWorkflowSynthesis(input)).rejects.toBeInstanceOf(WorkflowSynthesisProviderError)
  })
})
