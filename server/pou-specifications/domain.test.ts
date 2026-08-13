import { describe, expect, it } from 'vitest'

import { WHAKAPAPA_ORGANISATION_POU_V01_DRAFT, approvedWhakapapaOrganisationPouV01, conversationGuidanceProjection, conversationRuntimeDynamicVariables, pouReviewProjection } from './domain.js'

const approved = approvedWhakapapaOrganisationPouV01({
  approvedForPilotBy: '11111111-1111-4111-8111-111111111111',
  approvedForPilotAt: '2026-08-13T00:00:00.000Z',
})

describe('Whakapapa organisation Pou specification projections', () => {
  it('deterministically produces bounded runtime guidance from current-conversation concepts only', () => {
    const projection = conversationGuidanceProjection(approved, { projectionCode: 'whakapapa-guidance', projectionVersion: '1' })
    const variables = conversationRuntimeDynamicVariables(projection)

    expect(conversationRuntimeDynamicVariables(projection)).toEqual(variables)
    expect(variables).toMatchObject({ pou_name: 'Whakapapa' })
    expect(variables.pou_guidance).toContain('PURPOSE')
    expect(variables.pou_guidance).toContain('AREAS TO EXPLORE')
    expect(variables.pou_guidance).toContain('FOLLOW-UP GUIDANCE')
    expect(variables.pou_guidance).toContain('CONVERSATION-SPECIFIC BOUNDARIES')
    expect(variables.pou_guidance).not.toContain('documentation appropriately')
    expect(variables.pou_guidance).not.toContain('over time')
    expect(variables.pou_guidance.length).toBeLessThanOrEqual(4_000)
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
})
