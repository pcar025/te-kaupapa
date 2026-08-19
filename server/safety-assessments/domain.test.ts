import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { approvedWhakapapaPilotV01, contentHash, providerProjection, validateProviderAssessmentSet, WHAKAPAPA_PILOT_V01_DRAFT } from './domain.js'
import { assertProvisionableSpecification } from './provisioning.js'

function approvedFixture() {
  return {
    ...approvedWhakapapaPilotV01({
      approvedForPilotBy: randomUUID(),
      approvedForPilotAt: '2026-08-12T00:00:00.000Z',
    }),
    specificationCode: 'fictional_whakapapa_safety',
    specificationVersion: '1.0',
  }
}

describe('versioned safety specification projection', () => {
  it('hashes canonical content stably and detects a changed field', () => {
    expect(contentHash({ b: [2, { a: 1 }], a: true })).toBe(contentHash({ a: true, b: [2, { a: 1 }] }))
    expect(contentHash({ a: true })).not.toBe(contentHash({ a: false }))
  })

  it('pins the declared draft-derived source file by its actual raw SHA-256', async () => {
    const source = await readFile('src/imports/pasted_text/te-waharoa-model-update.md')
    expect(WHAKAPAPA_PILOT_V01_DRAFT.sourceDocumentHash).toBe(createHash('sha256').update(source).digest('hex'))
  })

  it('projects only current-conversation rules and pins human-only severity', () => {
    const specification = approvedFixture()
    const projection = providerProjection(specification, { projectionCode: 'fictional', projectionVersion: '1' })
    expect(projection.rules).toHaveLength(3)
    expect(projection.rules.every((rule) => rule.candidateLevelMode === 'human_only')).toBe(true)
    expect(projection.rules.every((rule) => !('canonicalBroadClass' in rule))).toBe(true)
  })

  it('encodes the approved three-rule Whakapapa v0.1 mappings and human-only levels', () => {
    expect(WHAKAPAPA_PILOT_V01_DRAFT.rules.map((rule) => ({ code: rule.ruleCode, broadClass: rule.canonicalBroadClass, levels: rule.permittedHumanConcernLevels, levelMode: rule.candidateLevelMode, protectiveMode: rule.protectiveIndicatorMode }))).toEqual([
      { code: 'WHAKAPAPA_IDENTITY_CONTEXT_001', broadClass: 'practice_quality', levels: ['low', 'watch', 'action'], levelMode: 'human_only', protectiveMode: 'report_only' },
      { code: 'WHAKAPAPA_STRENGTHS_PROTECTIVE_002', broadClass: 'practice_quality', levels: ['low', 'watch', 'action'], levelMode: 'human_only', protectiveMode: 'report_only' },
      { code: 'WHAKAPAPA_CULTURAL_DISTRESS_003', broadClass: 'whanau_safety', levels: ['low', 'watch', 'action'], levelMode: 'human_only', protectiveMode: 'report_only' },
    ])
    expect(WHAKAPAPA_PILOT_V01_DRAFT.rules.some((rule) => /deficit/i.test(rule.ruleCode))).toBe(false)
  })

  it('requires explicit rule-approved evidence for every outcome', () => {
    const projection = providerProjection(approvedFixture(), { projectionCode: 'fictional', projectionVersion: '1' })
    const turnId = randomUUID()
    const complete = projection.rules.map((rule) => ({ ruleCode: rule.ruleCode, ruleVersion: rule.ruleVersion, outcome: 'possible_concern' as const, candidateConcernLevel: null, matchedProtectiveIndicatorCodes: [], matchedConcernIndicatorCodes: [rule.concernIndicators[0]!.code], missingInformationCodes: [], uncertaintyReasonCodes: [], applicabilityReasonCode: null, evidenceTurnIds: [turnId] }))
    expect(validateProviderAssessmentSet(projection, complete, new Set([turnId]))).toHaveLength(3)
    expect(() => validateProviderAssessmentSet(projection, [{ ...complete[0]!, matchedConcernIndicatorCodes: [] }, ...complete.slice(1)])).toThrow('explicit approved concern')
    expect(() => validateProviderAssessmentSet(projection, [{ ...complete[0]!, candidateConcernLevel: 'urgent' }, ...complete.slice(1)])).toThrow('Provider concern levels')
    expect(() => validateProviderAssessmentSet(projection, [{ ...complete[0]!, evidenceTurnIds: [randomUUID()] }, ...complete.slice(1)], new Set([turnId]))).toThrow('outside the retained')
    expect(() => validateProviderAssessmentSet(projection, [{ ...complete[0]!, evidenceTurnIds: [turnId, turnId] }, ...complete.slice(1)], new Set([turnId]))).toThrow('duplicate evidence')
    expect(() => validateProviderAssessmentSet(projection, [{ ...complete[0]!, evidenceTurnIds: Array.from({ length: 9 }, () => randomUUID()) }, ...complete.slice(1)])).toThrow()
    expect(() => validateProviderAssessmentSet(projection, complete.slice(1))).toThrow('exactly')
  })

  it('keeps the source-derived template inactive but materialises an approved, provisionable v0.1 only with real provenance', () => {
    expect(() => assertProvisionableSpecification(WHAKAPAPA_PILOT_V01_DRAFT)).toThrow('approved-for-pilot')
    expect(assertProvisionableSpecification(approvedWhakapapaPilotV01({ approvedForPilotBy: randomUUID(), approvedForPilotAt: '2026-08-12T12:00:00.000Z' }))).toMatchObject({ approvalStatus: 'approved_for_pilot', specificationCode: 'TE_WAHAROA_WHAKAPAPA_SAFETY', specificationVersion: '0.1' })
  })

  it('enforces the approved cultural-distress outcome semantics without provider severity', () => {
    const projection = providerProjection(approvedFixture(), { projectionCode: 'fictional', projectionVersion: '1' })
    const assessments = projection.rules.map((rule) => rule.ruleCode === 'WHAKAPAPA_CULTURAL_DISTRESS_003'
      ? { ruleCode: rule.ruleCode, ruleVersion: rule.ruleVersion, outcome: 'not_applicable' as const, candidateConcernLevel: null, matchedProtectiveIndicatorCodes: [], matchedConcernIndicatorCodes: [], missingInformationCodes: [], uncertaintyReasonCodes: [], applicabilityReasonCode: 'no_explicit_cultural_identity_distress', evidenceTurnIds: [] }
      : { ruleCode: rule.ruleCode, ruleVersion: rule.ruleVersion, outcome: 'no_candidate_concern' as const, candidateConcernLevel: null, matchedProtectiveIndicatorCodes: [rule.protectiveIndicators[0]!.code], matchedConcernIndicatorCodes: [], missingInformationCodes: [], uncertaintyReasonCodes: [], applicabilityReasonCode: null, evidenceTurnIds: [randomUUID()] })
    expect(validateProviderAssessmentSet(projection, assessments)).toHaveLength(3)
    expect(() => validateProviderAssessmentSet(projection, assessments.map((assessment) => assessment.ruleCode === 'WHAKAPAPA_CULTURAL_DISTRESS_003' ? { ...assessment, candidateConcernLevel: 'low' } : assessment))).toThrow('Provider concern levels')
  })

  it('rejects evidence-free no-candidate results so not discussed is never treated as not present', () => {
    const projection = providerProjection(approvedFixture(), { projectionCode: 'fictional', projectionVersion: '1' })
    const rule = projection.rules[0]!
    expect(() => validateProviderAssessmentSet(projection, projection.rules.map((candidate) => ({
      ruleCode: candidate.ruleCode, ruleVersion: candidate.ruleVersion, outcome: 'no_candidate_concern' as const, candidateConcernLevel: null,
      matchedProtectiveIndicatorCodes: [], matchedConcernIndicatorCodes: [], missingInformationCodes: [], uncertaintyReasonCodes: [], applicabilityReasonCode: null, evidenceTurnIds: [],
    })))).toThrow('adequate-exploration')
    expect(rule.protectiveIndicators).not.toHaveLength(0)
  })
})
