import { describe, expect, it } from 'vitest'

import { OpenAIConversationReviewDraftProvider } from './provider.js'

const turns = [{ id: '11111111-1111-4111-8111-111111111111', ordinal: 1, speaker: 'kaimahi' as const, text: 'Synthetic strength and identity reflection.', providerSequence: 1, providerTimestamp: null }]
const projection: any = { specificationCode: 'TEST', specificationVersion: '1', specificationHash: 'a'.repeat(64), ruleManifestHash: 'b'.repeat(64), projectionCode: 'P', projectionVersion: '1', rules: [] }

describe('OpenAIConversationReviewDraftProvider', () => {
  it('accepts only bounded narrative content and exact transcript evidence references', async () => {
    const provider = new OpenAIConversationReviewDraftProvider({ apiKey: 'server-only-test-key', model: 'model-test' }, async (_url, init) => {
      expect(JSON.stringify(init)).toContain('store')
      return new Response(JSON.stringify({ output_text: JSON.stringify({ overallSummary: 'Identity context was explored.', strengthsSummary: 'Whānau connection was named.', areasForAttentionSummary: null, evidenceTurnIds: [turns[0]!.id] }) }), { status: 200 })
    })
    const result = await provider.generateWhakapapaReviewDraft({ transcriptTurns: turns, assessmentProjection: projection })
    expect(result).toMatchObject({ provider: 'openai', draft: { overallSummary: 'Identity context was explored.' } })
    expect(result.configurationHash).toHaveLength(64)
  })

  it('rejects invented source references and does not expose raw output', async () => {
    const provider = new OpenAIConversationReviewDraftProvider({ apiKey: 'key', model: 'model' }, async () => new Response(JSON.stringify({ output_text: JSON.stringify({ overallSummary: 'Unsafe', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: ['22222222-2222-4222-8222-222222222222'], rationale: 'MUST_NOT_PERSIST' }) }), { status: 200 }))
    await expect(provider.generateWhakapapaReviewDraft({ transcriptTurns: turns, assessmentProjection: projection })).rejects.toThrow('bounded contract')
  })
})
