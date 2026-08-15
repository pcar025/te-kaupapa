import { describe, expect, it } from 'vitest'

import { conversationGuidanceProjection, conversationRuntimeDynamicVariables, POU_DISPLAY_NAMES, pouReviewProjection, WHAKAPAPA_ORGANISATION_POU_V01_DRAFT } from './domain.js'
import { PHASE_5D_DRAFT_POU_SPECIFICATIONS } from './phase5d-specifications.js'
import { PHASE_5D_DRAFT_SAFETY_SPECIFICATIONS } from '../safety-assessments/phase5d-specifications.js'
import { providerProjection, validateProviderAssessmentSet } from '../safety-assessments/domain.js'
import { validateReviewCriterionAssessments } from '../review-drafts/domain.js'

const approval = { approvedForPilotBy: '11111111-1111-4111-8111-111111111111', approvedForPilotAt: '2026-08-14T00:00:00.000Z' }
const ALL_SEVEN_POU_SPECIFICATIONS = [WHAKAPAPA_ORGANISATION_POU_V01_DRAFT, ...PHASE_5D_DRAFT_POU_SPECIFICATIONS] as const

describe('Phase 5D draft-derived Te Waharoa Pou specifications', () => {
  it('covers the six remaining Pou once, with source provenance and no invented safety rules', () => {
    expect(PHASE_5D_DRAFT_POU_SPECIFICATIONS.map((specification) => specification.pouId)).toEqual([
      'manaakitanga', 'tikanga', 'kaitiakitanga', 'puukenga', 'haepapa', 'oranga',
    ])
    expect(PHASE_5D_DRAFT_POU_SPECIFICATIONS.every((specification) => specification.approvalStatus === 'draft_derived' && specification.sourceDocumentStatus === 'draft' && specification.sourceDocumentHash.length === 64)).toBe(true)
    expect(PHASE_5D_DRAFT_POU_SPECIFICATIONS.every((specification) => specification.safetyRuleReferences.length === 0)).toBe(true)
    expect(PHASE_5D_DRAFT_SAFETY_SPECIFICATIONS.every((specification) => specification.rules.length === 0)).toBe(true)
  })

  it.each(PHASE_5D_DRAFT_POU_SPECIFICATIONS)('$pouId derives current-conversation-only guidance and review criteria after explicit approval', (draft) => {
    const specification = { ...draft, approvalStatus: 'approved_for_pilot' as const, ...approval }
    const guidance = conversationGuidanceProjection(specification, { projectionCode: `${draft.pouId}-guidance`, projectionVersion: '1' })
    const review = pouReviewProjection(specification, { projectionCode: `${draft.pouId}-review`, projectionVersion: '1' })
    expect(guidance.pouId).toBe(draft.pouId)
    expect(conversationRuntimeDynamicVariables(guidance).pou_name).toBe(POU_DISPLAY_NAMES[draft.pouId])
    expect(guidance.explorationAreas.length).toBeGreaterThan(0)
    expect(review.criteria.length).toBeGreaterThan(0)
    expect(review.criteria.every((criterion) => criterion.evidenceScope === 'current_conversation')).toBe(true)
    expect(draft.evidenceCriteria.flatMap((criterion) => criterion.sourceItemReferences).every((reference) => reference.startsWith(`pou-${PHASE_5D_DRAFT_POU_SPECIFICATIONS.indexOf(draft) + 2}-`))).toBe(true)
  })

  it('does not permit a draft-derived template to drive the live guidance or transcript review', () => {
    for (const draft of PHASE_5D_DRAFT_POU_SPECIFICATIONS) {
      expect(() => conversationGuidanceProjection(draft, { projectionCode: 'draft', projectionVersion: '1' })).toThrow('approved organisation Pou specification')
      expect(() => pouReviewProjection(draft, { projectionCode: 'draft', projectionVersion: '1' })).toThrow('approved organisation Pou specification')
    }
  })

  it.each(PHASE_5D_DRAFT_POU_SPECIFICATIONS)('$pouId preserves well-explored, not-explored, ambiguous, and review/safety-separation semantics', (draft) => {
    const specification = { ...draft, approvalStatus: 'approved_for_pilot' as const, ...approval }
    const review = pouReviewProjection(specification, { projectionCode: `${draft.pouId}-review`, projectionVersion: '1' })
    const turnId = '11111111-1111-4111-8111-111111111111'
    const first = review.criteria[0]!
    const wellExplored = review.criteria.map((criterion) => ({
      criterionCode: criterion.criterionCode,
      status: 'evidenced' as const,
      evidenceTurnIds: [turnId],
      missingInformationCodes: [],
    }))
    const notExplored = review.criteria.map((criterion) => ({
      criterionCode: criterion.criterionCode,
      status: 'not_explored' as const,
      evidenceTurnIds: [],
      missingInformationCodes: [criterion.missingInformationCodes[0]!],
    }))
    const ambiguous = review.criteria.map((criterion) => ({
      criterionCode: criterion.criterionCode,
      status: 'insufficient_information' as const,
      evidenceTurnIds: criterion.criterionCode === first.criterionCode ? [turnId] : [],
      missingInformationCodes: [criterion.missingInformationCodes[0]!],
    }))
    expect(validateReviewCriterionAssessments(review, wellExplored, new Set([turnId]))).toHaveLength(review.criteria.length)
    expect(validateReviewCriterionAssessments(review, notExplored, new Set([turnId]))).toHaveLength(review.criteria.length)
    expect(validateReviewCriterionAssessments(review, ambiguous, new Set([turnId]))).toHaveLength(review.criteria.length)
    expect(() => validateReviewCriterionAssessments(review, wellExplored.map((assessment) => assessment.criterionCode === first.criterionCode ? { ...assessment, evidenceTurnIds: [] } : assessment), new Set([turnId]))).toThrow('Evidenced requires')
    expect(() => validateReviewCriterionAssessments(review, wellExplored, new Set(['22222222-2222-4222-8222-222222222222']))).toThrow('outside the retained conversation transcript')

    const safety = PHASE_5D_DRAFT_SAFETY_SPECIFICATIONS.find((candidate) => candidate.pouId === draft.pouId)!
    const safetyProjection = providerProjection({ ...safety, approvalStatus: 'approved_for_pilot' as const, ...approval }, { projectionCode: `${draft.pouId}-safety`, projectionVersion: '1' })
    expect(validateProviderAssessmentSet(safetyProjection, [])).toEqual([])
    expect(safetyProjection.rules).toEqual([])
  })

  it('keeps all current-conversation criterion and rule identifiers isolated by Pou', () => {
    const criterionOwners = new Map<string, string>()
    for (const draft of ALL_SEVEN_POU_SPECIFICATIONS) {
      const specification = { ...draft, approvalStatus: 'approved_for_pilot' as const, ...approval }
      for (const criterion of pouReviewProjection(specification, { projectionCode: `${draft.pouId}-review`, projectionVersion: '1' }).criteria) {
        expect(criterionOwners.has(criterion.criterionCode)).toBe(false)
        criterionOwners.set(criterion.criterionCode, draft.pouId)
      }
    }
    expect(criterionOwners.size).toBeGreaterThan(ALL_SEVEN_POU_SPECIFICATIONS.length)
  })

  it('keeps the Whakapapa safety manifest distinct while the other six Pou accept only an empty assessment set', () => {
    for (const draft of ALL_SEVEN_POU_SPECIFICATIONS) {
      const safety = draft.pouId === 'whakapapa'
        ? undefined
        : PHASE_5D_DRAFT_SAFETY_SPECIFICATIONS.find((candidate) => candidate.pouId === draft.pouId)
      if (draft.pouId === 'whakapapa') {
        expect(draft.safetyRuleReferences).toHaveLength(3)
      } else {
        expect(safety?.rules).toEqual([])
        const projection = providerProjection({ ...safety!, approvalStatus: 'approved_for_pilot' as const, ...approval }, { projectionCode: `${draft.pouId}-safety`, projectionVersion: '1' })
        expect(validateProviderAssessmentSet(projection, [])).toEqual([])
      }
    }
  })
})
