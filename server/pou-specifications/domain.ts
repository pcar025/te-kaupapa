import { z } from 'zod'

import { WORKFLOW_POU_IDS, type WorkflowPouId } from '../../shared/workflow.js'
import { contentHash } from '../safety-assessments/domain.js'

export const POU_EVIDENCE_SCOPES = ['current_conversation', 'application_state', 'longitudinal'] as const
export const POU_REVIEW_CRITERION_STATUSES = ['evidenced', 'partially_evidenced', 'not_explored', 'insufficient_information', 'not_applicable'] as const

const code = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{1,119}$/)
const sourceItemReference = z.string().min(1).max(300)
const guidance = z.string().min(1).max(1_200)
const pouId = z.enum(WORKFLOW_POU_IDS)

/** Stable source terminology, kept server-side so runtime guidance is never browser-selected. */
export const POU_DISPLAY_NAMES: Record<WorkflowPouId, string> = {
  whakapapa: 'Whakapapa',
  manaakitanga: 'Manaakitanga & Duty of Care',
  tikanga: 'Tikanga & Ethical Practice',
  kaitiakitanga: 'Kaitiakitanga & Risk Management',
  puukenga: 'Pūkenga & Practitioner Capability',
  haepapa: 'Haepapa & Accountability',
  oranga: 'Oranga & Protective Factors',
}

export const pouEvidenceCriterionSchema = z.object({
  criterionCode: code,
  label: z.string().min(1).max(240),
  description: z.string().min(1).max(1_200),
  evidenceScope: z.enum(POU_EVIDENCE_SCOPES),
  sourceItemReferences: z.array(sourceItemReference).min(1).max(20),
  strengthsOrProtective: z.boolean(),
  areasForAttention: z.boolean(),
  followUpGuidance: z.array(guidance).max(8),
  missingInformationCodes: z.array(code).max(12),
  applicabilityRule: z.string().min(1).max(800).nullable(),
}).strict()

export const organisationPouSpecificationSchema = z.object({
  schemaVersion: z.literal(1),
  specificationCode: code,
  specificationVersion: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/),
  pouId,
  sourceDocumentCode: z.string().min(1).max(160),
  sourceDocumentStatus: z.enum(['draft', 'approved']),
  sourceReference: z.string().min(1).max(500),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/),
  derivedAt: z.string().datetime(),
  approvalStatus: z.enum(['draft_derived', 'approved_for_pilot']),
  approvedForPilotBy: z.string().uuid().nullable(),
  approvedForPilotAt: z.string().datetime().nullable(),
  purpose: z.string().min(1).max(2_000),
  conversationExplorationAreas: z.array(z.object({ code, label: z.string().min(1).max(240), intent: guidance, followUpGuidance: z.array(guidance).max(8), evidenceScope: z.enum(POU_EVIDENCE_SCOPES), sourceItemReferences: z.array(sourceItemReference).min(1).max(20) }).strict()).min(1).max(20),
  evidenceCriteria: z.array(pouEvidenceCriterionSchema).min(1).max(30),
  reviewSynthesisGuidance: z.array(guidance).min(1).max(12),
  /** Empty only where the source has no bounded, approved runtime safety rule. */
  safetyRuleReferences: z.array(z.object({ ruleCode: code, ruleVersion: z.number().int().positive() }).strict()).max(50),
}).strict().superRefine((specification, context) => {
  const approved = specification.approvalStatus === 'approved_for_pilot'
  if (approved !== Boolean(specification.approvedForPilotBy && specification.approvedForPilotAt)) {
    context.addIssue({ code: 'custom', message: 'Pilot approval identity and timestamp must be supplied together.' })
  }
  const criterionCodes = specification.evidenceCriteria.map((criterion) => criterion.criterionCode)
  if (new Set(criterionCodes).size !== criterionCodes.length) context.addIssue({ code: 'custom', message: 'Criterion codes must be unique.' })
  const explorationCodes = specification.conversationExplorationAreas.map((area) => area.code)
  if (new Set(explorationCodes).size !== explorationCodes.length) context.addIssue({ code: 'custom', message: 'Exploration area codes must be unique.' })
})

export type OrganisationPouSpecificationVersion = z.infer<typeof organisationPouSpecificationSchema>
export type PouEvidenceCriterion = z.infer<typeof pouEvidenceCriterionSchema>

export interface ConversationGuidanceProjection {
  projectionCode: string
  projectionVersion: string
  specificationCode: string
  specificationVersion: string
  specificationHash: string
  /** Present on Phase 5D projections; omitted only by the immutable historic Whakapapa v0.1 projection. */
  pouId?: WorkflowPouId
  purpose: string
  explorationAreas: Array<{ code: string; label: string; intent: string; followUpGuidance: string[] }>
  constraints: string[]
}

export interface PouReviewProjection {
  projectionCode: string
  projectionVersion: string
  specificationCode: string
  specificationVersion: string
  specificationHash: string
  /** Present on Phase 5D projections; omitted only by the immutable historic Whakapapa v0.1 projection. */
  pouId?: WorkflowPouId
  criterionStatusVocabulary: typeof POU_REVIEW_CRITERION_STATUSES
  criteria: Array<Pick<PouEvidenceCriterion, 'criterionCode' | 'label' | 'description' | 'evidenceScope' | 'strengthsOrProtective' | 'areasForAttention' | 'missingInformationCodes' | 'applicabilityRule'>>
  synthesisGuidance: string[]
}

export interface ConversationRuntimeDynamicVariables {
  pou_name: string
  pou_guidance: string
}

const MAX_RUNTIME_GUIDANCE_CHARACTERS = 4_000

/** A bounded, non-public error class for an invalid pinned guidance projection. */
export class ConversationGuidanceProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversationGuidanceProjectionError'
  }
}

/**
 * The only per-session values Te Kaupapa gives to the ElevenLabs SDK.  They
 * are deliberately derived from the pinned, CURRENT_CONVERSATION-only
 * projection: browser code never composes or selects SME guidance.
 */
export function conversationRuntimeDynamicVariables(projection: ConversationGuidanceProjection, expectedPouId = projection.pouId): ConversationRuntimeDynamicVariables {
  if (!expectedPouId || projection.pouId && projection.pouId !== expectedPouId) {
    throw new ConversationGuidanceProjectionError('The pinned runtime Pou guidance has an invalid scope.')
  }
  const exploration = projection.explorationAreas
    .map((area) => `- ${area.label}: ${area.intent}`)
    .join('\n')
  const followUps = projection.explorationAreas
    .flatMap((area) => area.followUpGuidance)
    .map((item) => `- ${item}`)
    .join('\n')
  const constraints = projection.constraints.map((item) => `- ${item}`).join('\n')
  const pou_guidance = [
    'PURPOSE',
    projection.purpose,
    'AREAS TO EXPLORE',
    exploration,
    'FOLLOW-UP GUIDANCE',
    followUps || '- Use only the approved areas above; do not infer missing information.',
    'CONVERSATION-SPECIFIC BOUNDARIES',
    constraints,
  ].join('\n\n')
  if (pou_guidance.length > MAX_RUNTIME_GUIDANCE_CHARACTERS) {
    throw new ConversationGuidanceProjectionError('The approved runtime Pou guidance exceeds its bounded contract.')
  }
  return { pou_name: POU_DISPLAY_NAMES[expectedPouId], pou_guidance }
}

export function assertApprovedOrganisationPouSpecification(specification: OrganisationPouSpecificationVersion): OrganisationPouSpecificationVersion {
  const parsed = organisationPouSpecificationSchema.parse(specification)
  if (parsed.approvalStatus !== 'approved_for_pilot' || !parsed.approvedForPilotBy || !parsed.approvedForPilotAt) throw new Error('Only an approved organisation Pou specification may drive runtime projections.')
  return parsed
}

export function conversationGuidanceProjection(specification: OrganisationPouSpecificationVersion, identity: Pick<ConversationGuidanceProjection, 'projectionCode' | 'projectionVersion'>): ConversationGuidanceProjection {
  const parsed = assertApprovedOrganisationPouSpecification(specification)
  return {
    ...identity,
    specificationCode: parsed.specificationCode,
    specificationVersion: parsed.specificationVersion,
    specificationHash: contentHash(parsed),
    pouId: parsed.pouId,
    purpose: parsed.purpose,
    explorationAreas: parsed.conversationExplorationAreas.filter((area) => area.evidenceScope === 'current_conversation').map(({ code, label, intent, followUpGuidance }) => ({ code, label, intent, followUpGuidance })),
    constraints: [
      'Use the guidance to explore, not to make canonical decisions.',
      'Do not treat silence or an unmentioned topic as absence of concern.',
      'Do not choose concern levels, create actions, referrals, observations, or claim that the Pou is met.',
    ],
  }
}

export function pouReviewProjection(specification: OrganisationPouSpecificationVersion, identity: Pick<PouReviewProjection, 'projectionCode' | 'projectionVersion'>): PouReviewProjection {
  const parsed = assertApprovedOrganisationPouSpecification(specification)
  return {
    ...identity,
    specificationCode: parsed.specificationCode,
    specificationVersion: parsed.specificationVersion,
    specificationHash: contentHash(parsed),
    pouId: parsed.pouId,
    criterionStatusVocabulary: POU_REVIEW_CRITERION_STATUSES,
    criteria: parsed.evidenceCriteria.filter((criterion) => criterion.evidenceScope === 'current_conversation').map(({ criterionCode, label, description, evidenceScope, strengthsOrProtective, areasForAttention, missingInformationCodes, applicabilityRule }) => ({ criterionCode, label, description, evidenceScope, strengthsOrProtective, areasForAttention, missingInformationCodes, applicabilityRule })),
    synthesisGuidance: parsed.reviewSynthesisGuidance,
  }
}

/**
 * Phase 5D added a redundant projection-level Pou identifier. The accepted
 * Whakapapa v0.1 activation predates that field, so a conversation pinned to
 * its exact immutable derivation must remain readable. This is deliberately
 * not a general fallback for projections that omit their Pou scope.
 */
export function isExactHistoricWhakapapaV01ProjectionPair(input: {
  pouId: WorkflowPouId
  specification: OrganisationPouSpecificationVersion
  guidance: ConversationGuidanceProjection
  review: PouReviewProjection
}): boolean {
  const hasExactOwnKeys = (value: object, keys: readonly string[]) => {
    const actual = Object.keys(value)
    return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  }
  if (
    input.pouId !== 'whakapapa'
    || input.specification.specificationCode !== 'TE_WAHAROA_WHAKAPAPA'
    || input.specification.specificationVersion !== '0.1'
    || input.guidance.projectionCode !== 'TE_WAHAROA_WHAKAPAPA-conversation-guidance'
    || input.guidance.projectionVersion !== '0.1'
    || input.review.projectionCode !== 'TE_WAHAROA_WHAKAPAPA-review'
    || input.review.projectionVersion !== '0.1'
    || 'pouId' in input.guidance
    || 'pouId' in input.review
    || !hasExactOwnKeys(input.guidance, ['projectionCode', 'projectionVersion', 'specificationCode', 'specificationVersion', 'specificationHash', 'purpose', 'explorationAreas', 'constraints'])
    || !hasExactOwnKeys(input.review, ['projectionCode', 'projectionVersion', 'specificationCode', 'specificationVersion', 'specificationHash', 'criterionStatusVocabulary', 'criteria', 'synthesisGuidance'])
  ) return false
  const expectedGuidance = conversationGuidanceProjection(input.specification, input.guidance)
  const expectedReview = pouReviewProjection(input.specification, input.review)
  const { pouId: _guidancePouId, ...historicGuidance } = expectedGuidance
  const { pouId: _reviewPouId, ...historicReview } = expectedReview
  return contentHash(input.guidance) === contentHash(historicGuidance)
    && contentHash(input.review) === contentHash(historicReview)
}

/** The reviewed Whakapapa POC contains only source-derived current-conversation content. */
export const WHAKAPAPA_ORGANISATION_POU_V01_DRAFT = organisationPouSpecificationSchema.parse({
  schemaVersion: 1, specificationCode: 'TE_WAHAROA_WHAKAPAPA', specificationVersion: '0.1', pouId: 'whakapapa',
  sourceDocumentCode: 'te-waharoa-model-of-care', sourceDocumentStatus: 'draft', sourceReference: 'src/imports/pasted_text/te-waharoa-model-update.md#pou-1', sourceDocumentHash: 'b4c12e532d17b1a4a2e5facd24d0450686672e8124ec03a4162e54f77e9c8baa', derivedAt: '2026-08-13T00:00:00.000Z', approvalStatus: 'draft_derived', approvedForPilotBy: null, approvedForPilotAt: null,
  purpose: 'Understand and uphold whakapapa, identity, whānau voice, cultural context, strengths, and protective cultural factors without reducing a person to symptoms or problems.',
  conversationExplorationAreas: [
    { code: 'identity_whakapapa', label: 'Whakapapa and identity context', intent: 'Explore identity and whakapapa where the Kaimahi considers it meaningful to the reflection.', followUpGuidance: ['Invite clarification rather than assuming identity context.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-1-focus', 'pou-1-prompts'] },
    { code: 'whanau_voice', label: 'Whānau voice and wider story', intent: 'Make room for whānau voice and the wider story rather than a symptoms-only account.', followUpGuidance: ['Clarify whose voice or perspective is represented when it matters.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-1-focus', 'pou-1-prompts'] },
    { code: 'strengths_protection', label: 'Strengths and protective cultural factors', intent: 'Recognise strengths, intergenerational factors, and cultural protective factors alongside distress.', followUpGuidance: ['Explore a named strength or protective factor when it is mentioned but unclear.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-1-focus', 'pou-1-prompts'] },
    { code: 'cultural_connection', label: 'Cultural connection or disconnection', intent: 'Explore explicitly raised cultural connection or disconnection and its meaning for wellbeing.', followUpGuidance: ['If disconnection is mentioned, clarify its relevance or effect without assuming distress.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-1-focus', 'pou-1-prompts'] },
  ],
  evidenceCriteria: [
    { criterionCode: 'WHAKAPAPA_IDENTITY_CONTEXT', label: 'Identity and wider context', description: 'Grounded identity, whakapapa, whānau voice, or wider-story evidence from the reflection.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-1-focus', 'pou-1-prompts'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: ['Clarify identity, whānau context, or voice when relevant but incomplete.'], missingInformationCodes: ['identity_or_whanau_context'], applicabilityRule: null },
    { criterionCode: 'WHAKAPAPA_STRENGTHS_PROTECTION', label: 'Strengths and protective factors', description: 'Grounded strengths, intergenerational factors, or cultural protective factors.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-1-focus', 'pou-1-prompts'], strengthsOrProtective: true, areasForAttention: true, followUpGuidance: ['Ask about strengths or protective factors when they are relevant but have not been explored.'], missingInformationCodes: ['strengths_or_protection'], applicabilityRule: null },
    { criterionCode: 'WHAKAPAPA_CULTURAL_CONNECTION', label: 'Cultural connection or disconnection', description: 'Explicitly discussed cultural connection or disconnection and its relevance to wellbeing.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-1-prompts'], strengthsOrProtective: true, areasForAttention: true, followUpGuidance: ['Clarify explicitly raised disconnection; do not infer distress from identity or silence.'], missingInformationCodes: ['explicit_cultural_distress_context'], applicabilityRule: null },
    { criterionCode: 'WHAKAPAPA_DOCUMENTATION_QUALITY', label: 'Whakapapa information documented appropriately', description: 'Whether documentation appropriately captures Whakapapa information.', evidenceScope: 'application_state', sourceItemReferences: ['pou-1-review-language'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: [], missingInformationCodes: ['documentation_quality'], applicabilityRule: null },
    { criterionCode: 'WHAKAPAPA_INTERGENERATIONAL_PATTERN', label: 'Intergenerational context over time', description: 'Patterns in intergenerational context across relevant engagements.', evidenceScope: 'longitudinal', sourceItemReferences: ['pou-1-focus'], strengthsOrProtective: true, areasForAttention: true, followUpGuidance: [], missingInformationCodes: ['longitudinal_context'], applicabilityRule: null },
  ],
  reviewSynthesisGuidance: ['Describe only grounded current-conversation evidence.', 'Separate strengths from areas needing further exploration.', 'State not explored or insufficient information rather than inferring absence.', 'Do not describe the Pou as met, safe, unsafe, or cleared.'],
  safetyRuleReferences: [{ ruleCode: 'WHAKAPAPA_IDENTITY_CONTEXT_001', ruleVersion: 1 }, { ruleCode: 'WHAKAPAPA_STRENGTHS_PROTECTIVE_002', ruleVersion: 1 }, { ruleCode: 'WHAKAPAPA_CULTURAL_DISTRESS_003', ruleVersion: 1 }],
})

export function approvedWhakapapaOrganisationPouV01(approval: { approvedForPilotBy: string; approvedForPilotAt: string }): OrganisationPouSpecificationVersion {
  return organisationPouSpecificationSchema.parse({ ...WHAKAPAPA_ORGANISATION_POU_V01_DRAFT, approvalStatus: 'approved_for_pilot', approvedForPilotBy: approval.approvedForPilotBy, approvedForPilotAt: approval.approvedForPilotAt })
}

/** Materialises only recorded operator approval; the source-derived template is never mutated. */
export function approvedOrganisationPouSpecification(
  draft: OrganisationPouSpecificationVersion,
  approval: { approvedForPilotBy: string; approvedForPilotAt: string },
): OrganisationPouSpecificationVersion {
  return organisationPouSpecificationSchema.parse({
    ...draft,
    approvalStatus: 'approved_for_pilot',
    approvedForPilotBy: approval.approvedForPilotBy,
    approvedForPilotAt: approval.approvedForPilotAt,
  })
}
