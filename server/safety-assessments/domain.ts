import { createHash } from 'node:crypto'

import { z } from 'zod'

import { SAFETY_BROAD_CLASSES, SAFETY_OBSERVATION_CONCERN_LEVELS, type SafetyBroadClass, type SafetyObservationConcernLevel, type WorkflowPouId } from '../../shared/workflow.js'

export const SAFETY_EVIDENCE_SCOPES = ['current_conversation', 'application_state', 'longitudinal'] as const
export const PROVIDER_ASSESSMENT_OUTCOMES = ['no_candidate_concern', 'possible_concern', 'insufficient_information', 'not_applicable'] as const
export const CANDIDATE_LEVEL_MODES = ['human_only', 'provider_permitted'] as const
export const PROTECTIVE_INDICATOR_MODES = ['report_only', 'rule_defined_effect'] as const

const code = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{1,119}$/)
const indicator = z.object({ code, description: z.string().min(1).max(500) }).strict()

export const safetyRuleSchema = z.object({
  ruleCode: code,
  ruleVersion: z.number().int().positive(),
  title: z.string().min(1).max(300),
  purpose: z.string().min(1).max(2000),
  definition: z.string().min(1).max(4000),
  pouId: z.literal('whakapapa'),
  evidenceScope: z.enum(SAFETY_EVIDENCE_SCOPES),
  sourceItemReferences: z.array(z.string().min(1).max(300)).min(1).max(20),
  protectiveIndicators: z.array(indicator).max(20),
  concernIndicators: z.array(indicator).max(20),
  requiredInformation: z.array(indicator).max(20),
  applicabilityCriteria: z.array(z.string().min(1).max(500)).max(20),
  exclusionCriteria: z.array(z.string().min(1).max(500)).max(20),
  /** Approved machine-readable vocabularies.  Free-form provider reasons are never accepted. */
  applicabilityReasonCodes: z.array(code).max(20),
  uncertaintyReasonCodes: z.array(code).max(20),
  allowedCandidateOutcomes: z.array(z.enum(PROVIDER_ASSESSMENT_OUTCOMES)).min(1),
  candidateLevelMode: z.enum(CANDIDATE_LEVEL_MODES),
  protectiveIndicatorMode: z.enum(PROTECTIVE_INDICATOR_MODES),
  canonicalBroadClass: z.enum(SAFETY_BROAD_CLASSES).nullable(),
  permittedHumanConcernLevels: z.array(z.enum(SAFETY_OBSERVATION_CONCERN_LEVELS)).max(4),
}).strict().superRefine((rule, context) => {
  if (rule.candidateLevelMode === 'human_only' && rule.allowedCandidateOutcomes.includes('possible_concern') && rule.permittedHumanConcernLevels.includes('unsure')) {
    context.addIssue({ code: 'custom', message: 'Pou human confirmation cannot use the setup-only unsure level.' })
  }
  for (const collection of [rule.protectiveIndicators, rule.concernIndicators, rule.requiredInformation]) {
    const values = collection.map(({ code: value }) => value)
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message: 'Indicator codes must be unique within a rule.' })
  }
})

export const safetySpecificationSchema = z.object({
  schemaVersion: z.literal(1),
  specificationCode: code,
  specificationVersion: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/),
  pouId: z.literal('whakapapa'),
  sourceDocumentCode: z.string().min(1).max(160),
  sourceDocumentStatus: z.enum(['draft', 'approved']),
  sourceReference: z.string().min(1).max(500),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/),
  derivedAt: z.string().datetime(),
  approvalStatus: z.enum(['draft_derived', 'approved_for_pilot']),
  approvedForPilotBy: z.string().uuid().nullable(),
  approvedForPilotAt: z.string().datetime().nullable(),
  rules: z.array(safetyRuleSchema).min(1).max(50),
}).strict().superRefine((specification, context) => {
  const keys = specification.rules.map((rule) => `${rule.ruleCode}@${rule.ruleVersion}`)
  if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', message: 'Rule code and version pairs must be unique.' })
  const approved = specification.approvalStatus === 'approved_for_pilot'
  if (approved !== Boolean(specification.approvedForPilotBy && specification.approvedForPilotAt)) {
    context.addIssue({ code: 'custom', message: 'Pilot approval identity and timestamp must be supplied together.' })
  }
  if (approved) for (const rule of specification.rules.filter((rule) => rule.allowedCandidateOutcomes.includes('possible_concern'))) {
    if (!rule.canonicalBroadClass || rule.permittedHumanConcernLevels.length === 0) {
      context.addIssue({ code: 'custom', message: 'Approved confirmable rules require an explicit canonical mapping and permitted human levels.' })
    }
  }
})

export type SafetyRuleVersion = z.infer<typeof safetyRuleSchema>
export type SafetySpecificationVersion = z.infer<typeof safetySpecificationSchema>
export type ProviderAssessmentOutcome = (typeof PROVIDER_ASSESSMENT_OUTCOMES)[number]

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export interface ProviderAssessmentProjection {
  projectionCode: string
  projectionVersion: string
  specificationCode: string
  specificationVersion: string
  specificationHash: string
  ruleManifestHash: string
  rules: Array<Pick<SafetyRuleVersion, 'ruleCode' | 'ruleVersion' | 'title' | 'purpose' | 'definition' | 'protectiveIndicators' | 'concernIndicators' | 'requiredInformation' | 'applicabilityCriteria' | 'exclusionCriteria' | 'applicabilityReasonCodes' | 'uncertaintyReasonCodes' | 'allowedCandidateOutcomes' | 'candidateLevelMode' | 'protectiveIndicatorMode'>>
}

/** Application-owned assessment policy; it contains no conversation-provider identity. */
export function providerProjection(specification: SafetySpecificationVersion, projectionIdentity: Pick<ProviderAssessmentProjection, 'projectionCode' | 'projectionVersion'>): ProviderAssessmentProjection {
  const validated = safetySpecificationSchema.parse(specification)
  const rules = validated.rules
    .filter((rule) => rule.evidenceScope === 'current_conversation')
    .map(({ canonicalBroadClass: _canonicalBroadClass, permittedHumanConcernLevels: _permittedHumanConcernLevels, evidenceScope: _evidenceScope, sourceItemReferences: _sourceItemReferences, pouId: _pouId, ...rule }) => rule)
  return {
    ...projectionIdentity,
    specificationCode: validated.specificationCode,
    specificationVersion: validated.specificationVersion,
    specificationHash: contentHash(validated),
    ruleManifestHash: contentHash(rules),
    rules,
  }
}

export const providerRuleAssessmentSchema = z.object({
  ruleCode: code,
  ruleVersion: z.number().int().positive(),
  outcome: z.enum(PROVIDER_ASSESSMENT_OUTCOMES),
  candidateConcernLevel: z.enum(SAFETY_OBSERVATION_CONCERN_LEVELS).nullable(),
  matchedProtectiveIndicatorCodes: z.array(code).max(20),
  matchedConcernIndicatorCodes: z.array(code).max(20),
  missingInformationCodes: z.array(code).max(20),
  uncertaintyReasonCodes: z.array(code).max(20),
  applicabilityReasonCode: code.nullable(),
  evidenceTurnIds: z.array(z.string().uuid()).max(8),
}).strict()

export type ProviderRuleAssessment = z.infer<typeof providerRuleAssessmentSchema>

export function validateProviderAssessmentSet(projection: ProviderAssessmentProjection, assessments: ProviderRuleAssessment[], permittedEvidenceTurnIds?: ReadonlySet<string>): ProviderRuleAssessment[] {
  const parsed = z.array(providerRuleAssessmentSchema).parse(assessments)
  const projected = new Map(projection.rules.map((rule) => [`${rule.ruleCode}@${rule.ruleVersion}`, rule]))
  if (parsed.length !== projected.size) throw new Error('Provider assessment must contain exactly the projected rules.')
  const seen = new Set<string>()
  for (const assessment of parsed) {
    const key = `${assessment.ruleCode}@${assessment.ruleVersion}`
    const rule = projected.get(key)
    if (!rule || seen.has(key)) throw new Error('Provider assessment contains an unknown or duplicate rule.')
    seen.add(key)
    if (!rule.allowedCandidateOutcomes.includes(assessment.outcome)) throw new Error('Provider assessment contains an outcome not allowed by its rule.')
    if (assessment.candidateConcernLevel !== null) {
      throw new Error('Provider concern levels are not allowed for this assessment.')
    }
    if (new Set(assessment.evidenceTurnIds).size !== assessment.evidenceTurnIds.length) throw new Error('Provider assessment contains duplicate evidence turn references.')
    if (permittedEvidenceTurnIds && assessment.evidenceTurnIds.some((id) => !permittedEvidenceTurnIds.has(id))) throw new Error('Provider assessment references a turn outside the retained conversation transcript.')
    const assertExactCodes = (values: string[], allowed: Array<{ code: string }>, label: string) => {
      if (new Set(values).size !== values.length || values.some((value) => !allowed.some((candidate) => candidate.code === value))) {
        throw new Error(`Provider assessment contains an unsupported ${label} code.`)
      }
    }
    assertExactCodes(assessment.matchedProtectiveIndicatorCodes, rule.protectiveIndicators, 'protective indicator')
    assertExactCodes(assessment.matchedConcernIndicatorCodes, rule.concernIndicators, 'concern indicator')
    assertExactCodes(assessment.missingInformationCodes, rule.requiredInformation, 'missing-information')
    if (new Set(assessment.uncertaintyReasonCodes).size !== assessment.uncertaintyReasonCodes.length || assessment.uncertaintyReasonCodes.some((value) => !rule.uncertaintyReasonCodes.includes(value))) {
      throw new Error('Provider assessment contains an unsupported uncertainty reason code.')
    }
    if (assessment.outcome === 'possible_concern') {
      if (assessment.matchedConcernIndicatorCodes.length === 0 || assessment.missingInformationCodes.length !== 0 || assessment.applicabilityReasonCode !== null || assessment.evidenceTurnIds.length === 0) throw new Error('A possible concern requires explicit approved concern evidence and source turns only.')
    } else if (assessment.outcome === 'insufficient_information') {
      if (assessment.missingInformationCodes.length === 0 || assessment.applicabilityReasonCode !== null) throw new Error('Insufficient information requires approved missing-information evidence.')
    } else if (assessment.outcome === 'not_applicable') {
      if (!assessment.applicabilityReasonCode || !rule.applicabilityReasonCodes.includes(assessment.applicabilityReasonCode)) throw new Error('Not applicable requires an approved applicability reason.')
    } else if (assessment.outcome === 'no_candidate_concern') {
      if (assessment.matchedConcernIndicatorCodes.length !== 0 || assessment.applicabilityReasonCode !== null) throw new Error('No candidate concern cannot contain contradictory concern or applicability evidence.')
    }
  }
  return parsed
}

/**
 * The immutable source-derived v0.1 template is inactive until an authorised
 * product approver is supplied at provisioning time.  Its mappings and levels
 * are the approved controlled-pilot policy; its source remains draft-derived.
 */
export const WHAKAPAPA_PILOT_V01_DRAFT = safetySpecificationSchema.parse({
  schemaVersion: 1, specificationCode: 'TE_WAHAROA_WHAKAPAPA_SAFETY', specificationVersion: '0.1', pouId: 'whakapapa',
  sourceDocumentCode: 'te-waharoa-model-of-care', sourceDocumentStatus: 'draft', sourceReference: 'src/imports/pasted_text/te-waharoa-model-update.md#pou-1',
  sourceDocumentHash: 'b4c12e532d17b1a4a2e5facd24d0450686672e8124ec03a4162e54f77e9c8baa', derivedAt: '2026-08-12T00:00:00.000Z', approvalStatus: 'draft_derived', approvedForPilotBy: null, approvedForPilotAt: null,
  rules: [
    { ruleCode: 'WHAKAPAPA_IDENTITY_CONTEXT_001', ruleVersion: 1, title: 'Identity, whānau context and voice', purpose: 'Identity, wider whānau context or whānau voice was relevant but insufficiently explored.', definition: 'Assess only explicit current-conversation evidence. Include whether the person was reduced to symptoms rather than held in their wider story; do not infer documentation quality from silence.', pouId: 'whakapapa', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-1-focus', 'pou-1-prompts'], protectiveIndicators: [{ code: 'identity_upheld', description: 'Identity was discussed or upheld.' }, { code: 'whanau_voice_present', description: 'Whānau voice was present.' }], concernIndicators: [{ code: 'identity_context_not_explored', description: 'Relevant identity, wider whānau context or whānau voice was insufficiently explored.' }, { code: 'wider_story_reduced_to_symptoms', description: 'The person was reduced to symptoms rather than held in their wider story.' }], requiredInformation: [{ code: 'identity_or_whanau_context', description: 'Identity, wider whānau context, or whānau voice.' }], applicabilityCriteria: ['A reflection conversation occurred.'], exclusionCriteria: [], applicabilityReasonCodes: [], uncertaintyReasonCodes: [], allowedCandidateOutcomes: ['no_candidate_concern', 'possible_concern', 'insufficient_information'], candidateLevelMode: 'human_only', protectiveIndicatorMode: 'report_only', canonicalBroadClass: 'practice_quality', permittedHumanConcernLevels: ['low', 'watch', 'action'] },
    { ruleCode: 'WHAKAPAPA_STRENGTHS_PROTECTIVE_002', ruleVersion: 1, title: 'Strengths and protective factors', purpose: 'Relevant whānau strengths, intergenerational factors or cultural protective factors were insufficiently explored.', definition: 'Assess only explicit current-conversation evidence. Include whether strengths were recognised alongside distress; protective matches are reported only and do not offset a separately supported concern.', pouId: 'whakapapa', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-1-focus', 'pou-1-prompts'], protectiveIndicators: [{ code: 'strengths_present', description: 'Whānau strengths were discussed.' }, { code: 'intergenerational_factors_present', description: 'Intergenerational factors were discussed.' }, { code: 'cultural_protection_present', description: 'Cultural protective factors were discussed.' }], concernIndicators: [{ code: 'strengths_or_protection_not_explored', description: 'Relevant strengths or protective factors were insufficiently explored.' }, { code: 'strengths_not_recognised_alongside_distress', description: 'Strengths were not recognised alongside distress.' }], requiredInformation: [{ code: 'strengths_or_protection', description: 'Strengths, intergenerational factors, or protective cultural factors.' }], applicabilityCriteria: ['A reflection conversation occurred.'], exclusionCriteria: [], applicabilityReasonCodes: [], uncertaintyReasonCodes: [], allowedCandidateOutcomes: ['no_candidate_concern', 'possible_concern', 'insufficient_information'], candidateLevelMode: 'human_only', protectiveIndicatorMode: 'report_only', canonicalBroadClass: 'practice_quality', permittedHumanConcernLevels: ['low', 'watch', 'action'] },
    { ruleCode: 'WHAKAPAPA_CULTURAL_DISTRESS_003', ruleVersion: 1, title: 'Cultural or identity distress', purpose: 'Cultural disconnection or identity/cultural distress was explicitly present, but its relevance or impact was insufficiently explored.', definition: 'Do not infer cultural distress from demographics, identity assumptions, or silence. No explicit distress is not applicable; ambiguous evidence is insufficient information; explicit distress adequately explored has no candidate concern; explicit distress insufficiently explored is a possible concern.', pouId: 'whakapapa', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-1-prompts'], protectiveIndicators: [{ code: 'cultural_connection_present', description: 'Cultural connection was discussed.' }, { code: 'cultural_distress_adequately_explored', description: 'Explicit cultural or identity distress was adequately explored.' }], concernIndicators: [{ code: 'cultural_distress_not_explored', description: 'Explicit cultural or identity distress/disconnection was insufficiently explored.' }], requiredInformation: [{ code: 'explicit_cultural_distress_context', description: 'Whether cultural or identity distress/disconnection was explicitly present and, if so, explored.' }], applicabilityCriteria: ['Explicit cultural or identity distress/disconnection is present in the conversation.'], exclusionCriteria: ['Do not infer cultural distress from demographics, identity assumptions, or silence.'], applicabilityReasonCodes: ['no_explicit_cultural_identity_distress'], uncertaintyReasonCodes: ['ambiguous_cultural_identity_distress'], allowedCandidateOutcomes: ['no_candidate_concern', 'possible_concern', 'insufficient_information', 'not_applicable'], candidateLevelMode: 'human_only', protectiveIndicatorMode: 'report_only', canonicalBroadClass: 'whanau_safety', permittedHumanConcernLevels: ['low', 'watch', 'action'] },
  ],
})

export function approvedWhakapapaPilotV01(approval: { approvedForPilotBy: string; approvedForPilotAt: string }): SafetySpecificationVersion {
  return safetySpecificationSchema.parse({
    ...WHAKAPAPA_PILOT_V01_DRAFT,
    approvalStatus: 'approved_for_pilot',
    approvedForPilotBy: approval.approvedForPilotBy,
    approvedForPilotAt: approval.approvedForPilotAt,
  })
}

export function ruleForConfirmation(specification: SafetySpecificationVersion, ruleCode: string, ruleVersion: number): SafetyRuleVersion {
  const rule = specification.rules.find((candidate) => candidate.ruleCode === ruleCode && candidate.ruleVersion === ruleVersion)
  if (!rule || !rule.canonicalBroadClass || rule.permittedHumanConcernLevels.length === 0) throw new Error('The pinned safety rule is not eligible for human confirmation.')
  return rule
}

export function assertConfirmationMapping(rule: SafetyRuleVersion, pouId: WorkflowPouId, broadClass: SafetyBroadClass, level: SafetyObservationConcernLevel): void {
  if (pouId !== 'whakapapa' || rule.pouId !== 'whakapapa' || rule.canonicalBroadClass !== broadClass || !rule.permittedHumanConcernLevels.includes(level)) {
    throw new Error('The selected safety observation does not match the approved historical rule mapping.')
  }
}
