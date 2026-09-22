import { describe, expect, it } from 'vitest'

import { OpenAIConversationReviewDraftProvider } from './provider.js'
import { approvedOrganisationPouSpecification, approvedWhakapapaOrganisationPouV01, pouReviewProjection } from '../pou-specifications/domain.js'
import { PHASE_5D_DRAFT_POU_SPECIFICATIONS } from '../pou-specifications/phase5d-specifications.js'

const turns = [{ id: '11111111-1111-4111-8111-111111111111', ordinal: 1, speaker: 'kaimahi' as const, text: 'Synthetic strength and identity reflection.', providerSequence: 1, providerTimestamp: null }]
const projection = pouReviewProjection(approvedWhakapapaOrganisationPouV01({ approvedForPilotBy: '11111111-1111-4111-8111-111111111111', approvedForPilotAt: '2026-08-13T00:00:00.000Z' }), { projectionCode: 'P', projectionVersion: '1' })
const assessments = projection.criteria.map((criterion, index) => ({ criterionCode: criterion.criterionCode, status: index === 0 ? 'evidenced' : 'not_explored', evidenceTurnIds: index === 0 ? [turns[0]!.id] : [], missingInformationCodes: index === 0 ? [] : [criterion.missingInformationCodes[0]!] }))
const kaitiSpecification = PHASE_5D_DRAFT_POU_SPECIFICATIONS.find((specification) => specification.pouId === 'kaitiakitanga')
if (!kaitiSpecification) throw new Error('Expected Kaitiakitanga test specification.')
const kaitiProjection = pouReviewProjection(approvedOrganisationPouSpecification(kaitiSpecification, { approvedForPilotBy: '11111111-1111-4111-8111-111111111111', approvedForPilotAt: '2026-09-22T00:00:00.000Z' }), { projectionCode: 'K', projectionVersion: '1' })
const kaitiAssessments = kaitiProjection.criteria.map((criterion, index) => ({ criterionCode: criterion.criterionCode, status: index === 0 ? 'evidenced' : 'not_explored', evidenceTurnIds: index === 0 ? [turns[0]!.id] : [], missingInformationCodes: index === 0 ? [] : [criterion.missingInformationCodes[0]!] }))
const unknownPhq9 = { indication: 'insufficient_information', indicationEvidenceTurnIds: [], completion: 'insufficient_information', completionEvidenceTurnIds: [], reportedTotalScore: null, reportedTotalScoreEvidenceTurnIds: [] }

describe('OpenAIConversationReviewDraftProvider', () => {
  it('accepts only bounded narrative content and exact transcript evidence references', async () => {
    const provider = new OpenAIConversationReviewDraftProvider({ apiKey: 'server-only-test-key', model: 'model-test' }, async (_url, init) => {
      expect(JSON.stringify(init)).toContain('store')
      expect(JSON.stringify(init)).not.toContain('phq9Evidence')
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

  it.each([
    ['not indicated', { indication: 'not_indicated', indicationEvidenceTurnIds: [turns[0]!.id], completion: 'insufficient_information', completionEvidenceTurnIds: [], reportedTotalScore: null, reportedTotalScoreEvidenceTurnIds: [] }],
    ['completed score 11', { indication: 'indicated', indicationEvidenceTurnIds: [turns[0]!.id], completion: 'completed', completionEvidenceTurnIds: [turns[0]!.id], reportedTotalScore: 11, reportedTotalScoreEvidenceTurnIds: [turns[0]!.id] }],
    ['completed score 12', { indication: 'indicated', indicationEvidenceTurnIds: [turns[0]!.id], completion: 'completed', completionEvidenceTurnIds: [turns[0]!.id], reportedTotalScore: 12, reportedTotalScoreEvidenceTurnIds: [turns[0]!.id] }],
  ])('accepts explicit noncanonical PHQ-9 evidence for %s only when grounded', async (_label, phq9Evidence) => {
    const provider = new OpenAIConversationReviewDraftProvider({ apiKey: 'key', model: 'model' }, async (_url, init) => {
      expect(JSON.stringify(init)).toContain('phq9Evidence')
      return new Response(JSON.stringify({ output_text: JSON.stringify({ overallSummary: 'Bounded review.', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: [turns[0]!.id], criterionAssessments: kaitiAssessments, phq9Evidence }) }), { status: 200 })
    })
    await expect(provider.generatePouReviewDraft({ transcriptTurns: turns, reviewProjection: kaitiProjection })).resolves.toMatchObject({ phq9Evidence })
  })

  it('rejects an out-of-range or ungrounded PHQ-9 suggestion', async () => {
    const invalid = { indication: 'indicated', indicationEvidenceTurnIds: [turns[0]!.id], completion: 'completed', completionEvidenceTurnIds: [turns[0]!.id], reportedTotalScore: 28, reportedTotalScoreEvidenceTurnIds: [turns[0]!.id] }
    const provider = new OpenAIConversationReviewDraftProvider({ apiKey: 'key', model: 'model' }, async () => new Response(JSON.stringify({ output_text: JSON.stringify({ overallSummary: 'Bounded review.', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: [turns[0]!.id], criterionAssessments: kaitiAssessments, phq9Evidence: invalid }) }), { status: 200 }))
    await expect(provider.generatePouReviewDraft({ transcriptTurns: turns, reviewProjection: kaitiProjection })).rejects.toThrow('PHQ-9 evidence')
  })
})
