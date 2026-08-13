import { describe, expect, it } from 'vitest'

import { OpenAIConversationReviewDraftProvider } from './provider.js'
import { approvedWhakapapaOrganisationPouV01, pouReviewProjection } from '../pou-specifications/domain.js'

const turns = [{ id: '11111111-1111-4111-8111-111111111111', ordinal: 1, speaker: 'kaimahi' as const, text: 'Synthetic strength and identity reflection.', providerSequence: 1, providerTimestamp: null }]
const projection = pouReviewProjection(approvedWhakapapaOrganisationPouV01({ approvedForPilotBy: '11111111-1111-4111-8111-111111111111', approvedForPilotAt: '2026-08-13T00:00:00.000Z' }), { projectionCode: 'P', projectionVersion: '1' })
const assessments = projection.criteria.map((criterion, index) => ({ criterionCode: criterion.criterionCode, status: index === 0 ? 'evidenced' : 'not_explored', evidenceTurnIds: index === 0 ? [turns[0]!.id] : [], missingInformationCodes: index === 0 ? [] : [criterion.missingInformationCodes[0]!] }))

describe('OpenAIConversationReviewDraftProvider', () => {
  it('accepts only bounded narrative content and exact transcript evidence references', async () => {
    const provider = new OpenAIConversationReviewDraftProvider({ apiKey: 'server-only-test-key', model: 'model-test' }, async (_url, init) => {
      expect(JSON.stringify(init)).toContain('store')
      return new Response(JSON.stringify({ output_text: JSON.stringify({ overallSummary: 'Identity context was explored.', strengthsSummary: 'Whānau connection was named.', areasForAttentionSummary: null, evidenceTurnIds: [turns[0]!.id], criterionAssessments: assessments }) }), { status: 200 })
    })
    const result = await provider.generateWhakapapaReviewDraft({ transcriptTurns: turns, reviewProjection: projection })
    expect(result).toMatchObject({ provider: 'openai', draft: { overallSummary: 'Identity context was explored.' } })
    expect(result.configurationHash).toHaveLength(64)
  })

  it('rejects invented source references and does not expose raw output', async () => {
    const provider = new OpenAIConversationReviewDraftProvider({ apiKey: 'key', model: 'model' }, async () => new Response(JSON.stringify({ output_text: JSON.stringify({ overallSummary: 'Unsafe', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: ['22222222-2222-4222-8222-222222222222'], criterionAssessments: assessments, rationale: 'MUST_NOT_PERSIST' }) }), { status: 200 }))
    await expect(provider.generateWhakapapaReviewDraft({ transcriptTurns: turns, reviewProjection: projection })).rejects.toThrow('bounded contract')
  })
})
