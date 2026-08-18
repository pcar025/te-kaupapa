import { describe, expect, it } from 'vitest'

import { WHAKAPAPA_ORGANISATION_POU_V01_DRAFT, approvedWhakapapaOrganisationPouV01, conversationFirstMessage, conversationGuidanceProjection, conversationRuntimeDynamicVariables, isExactHistoricWhakapapaV01ProjectionPair, organisationPouSpecificationSchema, pouReviewProjection } from './domain.js'

const approved = approvedWhakapapaOrganisationPouV01({
  approvedForPilotBy: '11111111-1111-4111-8111-111111111111',
  approvedForPilotAt: '2026-08-13T00:00:00.000Z',
})

describe('Whakapapa organisation Pou specification projections', () => {
  it('keeps the provider greeting grammatical when historic v0.1 has no SME opening', () => {
    expect(conversationFirstMessage('Whakapapa', '')).toBe('Kia ora. We’re reflecting on Whakapapa.')
    expect(conversationFirstMessage('Manaakitanga & Duty of Care', 'What would be most helpful to begin with?')).toBe('Kia ora. We’re reflecting on Manaakitanga & Duty of Care. What would be most helpful to begin with?')
  })

  it('deterministically produces bounded runtime guidance from current-conversation concepts only', () => {
    const projection = conversationGuidanceProjection(approved, { projectionCode: 'whakapapa-guidance', projectionVersion: '1' })
    const variables = conversationRuntimeDynamicVariables(projection)

    expect(conversationRuntimeDynamicVariables(projection)).toEqual(variables)
    expect(variables).toMatchObject({ pou_name: 'Whakapapa' })
    expect(variables.pou_opening).toBe('')
    expect(variables.pou_guidance).toContain('PURPOSE')
    expect(variables.pou_guidance).toContain('AREAS TO EXPLORE')
    expect(variables.pou_guidance).toContain('FOLLOW-UP GUIDANCE')
    expect(variables.pou_guidance).toContain('CONVERSATION-SPECIFIC BOUNDARIES')
    expect(variables.pou_guidance).not.toContain('documentation appropriately')
    expect(variables.pou_guidance).not.toContain('over time')
    expect(variables.pou_guidance.length).toBeLessThanOrEqual(4_000)
  })

  it('keeps an SME-authored opening distinct from source-derived v0.1 content', () => {
    const withOpening = {
      ...approved,
      specificationVersion: '0.2',
      openingReflectionQuestion: 'What would be most helpful to begin with in this reflection?',
      openingReflectionQuestionProvenance: 'sme_authored' as const,
    }
    const projection = conversationGuidanceProjection(withOpening, { projectionCode: 'whakapapa-guidance', projectionVersion: '0.2' })
    expect(conversationRuntimeDynamicVariables(projection).pou_opening).toBe(withOpening.openingReflectionQuestion)
    expect(() => conversationGuidanceProjection({ ...withOpening, openingReflectionQuestionProvenance: undefined }, { projectionCode: 'invalid', projectionVersion: '0.2' })).toThrow('SME-authored provenance')
  })

  it('rejects whitespace-only SME openings before they can become active guidance', () => {
    expect(() => organisationPouSpecificationSchema.parse({
      ...approved,
      specificationVersion: '0.2',
      openingReflectionQuestion: '   ',
      openingReflectionQuestionProvenance: 'sme_authored',
    })).toThrow()
    expect(conversationFirstMessage('Whakapapa', '   ')).toBe('Kia ora. We’re reflecting on Whakapapa.')
  })

  it('keeps application-state and longitudinal criteria out of the transcript review projection', () => {
    const projection = pouReviewProjection(approved, { projectionCode: 'whakapapa-review', projectionVersion: '1' })
    expect(projection.criteria.map((criterion) => criterion.criterionCode)).toEqual([
      'WHAKAPAPA_IDENTITY_CONTEXT',
      'WHAKAPAPA_STRENGTHS_PROTECTION',
      'WHAKAPAPA_CULTURAL_CONNECTION',
    ])
    expect(projection.criteria.every((criterion) => criterion.evidenceScope === 'current_conversation')).toBe(true)
  })

  it('rejects draft-derived specifications before any runtime or review projection is created', () => {
    expect(() => conversationGuidanceProjection(WHAKAPAPA_ORGANISATION_POU_V01_DRAFT, { projectionCode: 'draft-guidance', projectionVersion: '1' })).toThrow('approved organisation Pou specification')
    expect(() => pouReviewProjection(WHAKAPAPA_ORGANISATION_POU_V01_DRAFT, { projectionCode: 'draft-review', projectionVersion: '1' })).toThrow('approved organisation Pou specification')
  })

  it('accepts only the exact immutable Whakapapa v0.1 projection pair that predates the redundant Pou identifier', () => {
    const guidance = conversationGuidanceProjection(approved, { projectionCode: 'TE_WAHAROA_WHAKAPAPA-conversation-guidance', projectionVersion: '0.1' })
    const review = pouReviewProjection(approved, { projectionCode: 'TE_WAHAROA_WHAKAPAPA-review', projectionVersion: '0.1' })
    const { pouId: _guidancePouId, ...historicGuidance } = guidance
    const { pouId: _reviewPouId, ...historicReview } = review

    expect(isExactHistoricWhakapapaV01ProjectionPair({ pouId: 'whakapapa', specification: approved, guidance: historicGuidance, review: historicReview })).toBe(true)
    expect(isExactHistoricWhakapapaV01ProjectionPair({ pouId: 'manaakitanga', specification: approved, guidance: historicGuidance, review: historicReview })).toBe(false)
    expect(isExactHistoricWhakapapaV01ProjectionPair({ pouId: 'whakapapa', specification: approved, guidance: { ...historicGuidance, purpose: 'forged' }, review: historicReview })).toBe(false)
    expect(isExactHistoricWhakapapaV01ProjectionPair({ pouId: 'whakapapa', specification: approved, guidance: { ...historicGuidance, forgedExtra: 'x' } as typeof historicGuidance, review: historicReview })).toBe(false)
    expect(isExactHistoricWhakapapaV01ProjectionPair({ pouId: 'whakapapa', specification: approved, guidance: historicGuidance, review: { ...historicReview, forgedExtra: 'x' } as typeof historicReview })).toBe(false)

    const differentWhakapapaVersion = {
      ...approved,
      specificationCode: 'TE_WAHAROA_WHAKAPAPA_VARIANT',
      specificationVersion: '0.2',
      openingReflectionQuestion: 'What would be most helpful to begin with in this reflection?',
      openingReflectionQuestionProvenance: 'sme_authored' as const,
    }
    const differentGuidance = conversationGuidanceProjection(differentWhakapapaVersion, { projectionCode: 'TE_WAHAROA_WHAKAPAPA-conversation-guidance', projectionVersion: '0.1' })
    const differentReview = pouReviewProjection(differentWhakapapaVersion, { projectionCode: 'TE_WAHAROA_WHAKAPAPA-review', projectionVersion: '0.1' })
    const { pouId: _differentGuidancePouId, ...historicDifferentGuidance } = differentGuidance
    const { pouId: _differentReviewPouId, ...historicDifferentReview } = differentReview
    expect(isExactHistoricWhakapapaV01ProjectionPair({ pouId: 'whakapapa', specification: differentWhakapapaVersion, guidance: historicDifferentGuidance, review: historicDifferentReview })).toBe(false)
  })
})
