import {
  organisationPouSpecificationSchema,
  type OrganisationPouSpecificationVersion,
} from './domain.js'

const SOURCE_HASH = 'b4c12e532d17b1a4a2e5facd24d0450686672e8124ec03a4162e54f77e9c8baa'
const source = (pou: number) => `src/imports/pasted_text/te-waharoa-model-update.md#pou-${pou}`

type DraftInput = Omit<OrganisationPouSpecificationVersion, 'schemaVersion' | 'specificationVersion' | 'sourceDocumentCode' | 'sourceDocumentStatus' | 'sourceDocumentHash' | 'derivedAt' | 'approvalStatus' | 'approvedForPilotBy' | 'approvedForPilotAt'>

function draft(input: DraftInput): OrganisationPouSpecificationVersion {
  return organisationPouSpecificationSchema.parse({
    schemaVersion: 1,
    specificationVersion: '0.1',
    sourceDocumentCode: 'te-waharoa-model-of-care',
    sourceDocumentStatus: 'draft',
    sourceDocumentHash: SOURCE_HASH,
    derivedAt: '2026-08-14T00:00:00.000Z',
    approvalStatus: 'draft_derived',
    approvedForPilotBy: null,
    approvedForPilotAt: null,
    ...input,
  })
}

/**
 * Controlled SME-POC templates only. The source gives safety-flag examples,
 * but not bounded runtime rules/mappings for Pou 2–7, so those references are
 * intentionally empty rather than manufactured.
 */
export const PHASE_5D_DRAFT_POU_SPECIFICATIONS = [
  draft({
    specificationCode: 'TE_WAHAROA_MANAAKITANGA', pouId: 'manaakitanga', sourceReference: source(2),
    purpose: 'Reflect on respectful communication, feeling heard and safe, boundaries, responsiveness to distress, and professional responsibility.',
    conversationExplorationAreas: [
      { code: 'mana_enhancing_communication', label: 'Respectful, mana-enhancing communication', intent: 'Explore how presence and communication affected the person or whānau.', followUpGuidance: ['Clarify what helped the person feel heard, safe, upheld, or diminished.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-2-focus', 'pou-2-prompts'] },
      { code: 'distress_responsiveness', label: 'Responsiveness to distress', intent: 'Explore emotional shifts or distress that were noticed and how they were responded to.', followUpGuidance: ['Do not infer an adequate response from silence.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-2-focus', 'pou-2-prompts'] },
      { code: 'professional_boundaries', label: 'Aroha and professional responsibility', intent: 'Reflect on balancing aroha, boundaries, and professional responsibility.', followUpGuidance: ['Invite reflection on rushing, rescuing, avoidance, or over-control only when relevant.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-2-focus', 'pou-2-prompts'] },
    ],
    evidenceCriteria: [
      { criterionCode: 'MANAAKITANGA_COMMUNICATION', label: 'Respectful communication', description: 'Grounded reflection on communication, presence, or whether whānau felt heard or safe.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-2-focus', 'pou-2-prompts'], strengthsOrProtective: true, areasForAttention: true, followUpGuidance: ['Clarify communication impact when it remains unclear.'], missingInformationCodes: ['communication_impact'], applicabilityRule: null },
      { criterionCode: 'MANAAKITANGA_DISTRESS_RESPONSE', label: 'Responsiveness to distress', description: 'Grounded reflection on noticed distress or emotional shifts and the response.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-2-focus', 'pou-2-prompts'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: ['Clarify a response to explicitly discussed distress.'], missingInformationCodes: ['distress_response'], applicabilityRule: null },
      { criterionCode: 'MANAAKITANGA_BOUNDARIES', label: 'Professional boundaries', description: 'Grounded reflection on balancing aroha with professional responsibility and boundaries.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-2-focus', 'pou-2-prompts'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: ['Clarify boundaries or professional responsibility where relevant.'], missingInformationCodes: ['boundaries'], applicabilityRule: null },
      { criterionCode: 'MANAAKITANGA_FOLLOW_UP_DOCUMENTATION', label: 'Appropriate follow-up documented', description: 'Whether follow-up and escalation are documented in application records.', evidenceScope: 'application_state', sourceItemReferences: ['pou-2-review-language'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: [], missingInformationCodes: ['follow_up_records'], applicabilityRule: null },
    ],
    reviewSynthesisGuidance: ['Describe only grounded current-conversation material.', 'Separate respectful or protective practice from attention areas.', 'Not explored is not evidence that a response, boundary, or follow-up was adequate.', 'Do not create a safety candidate from review attention alone.'], safetyRuleReferences: [],
  }),
  draft({
    specificationCode: 'TE_WAHAROA_TIKANGA', pouId: 'tikanga', sourceReference: source(3),
    purpose: 'Reflect on consent, confidentiality, ethical tensions, tikanga, shared power, consultation, and rationale for difficult decisions.',
    conversationExplorationAreas: [
      { code: 'tikanga_ethics', label: 'Tikanga and ethical tensions', intent: 'Explore tikanga considerations and ethical tensions in the engagement.', followUpGuidance: ['Clarify tensions without prescribing an ethical decision.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-3-focus', 'pou-3-prompts'] },
      { code: 'informed_consent', label: 'Informed consent and confidentiality', intent: 'Explore whether consent and confidentiality were understood and discussed.', followUpGuidance: ['Do not infer consent or confidentiality from silence.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-3-focus', 'pou-3-prompts'] },
      { code: 'power_consultation', label: 'Shared power and consultation', intent: 'Reflect on shared power and whether guidance or consultation was needed.', followUpGuidance: ['Invite clarification where consultation was considered but not discussed.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-3-focus', 'pou-3-prompts'] },
    ],
    evidenceCriteria: [
      { criterionCode: 'TIKANGA_ETHICAL_TENSIONS', label: 'Tikanga and ethical tensions', description: 'Grounded reflection on tikanga or ethical tensions relevant to the engagement.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-3-focus', 'pou-3-prompts'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: ['Clarify a relevant ethical tension or tikanga consideration.'], missingInformationCodes: ['ethical_tension'], applicabilityRule: null },
      { criterionCode: 'TIKANGA_CONSENT_CONFIDENTIALITY', label: 'Consent and confidentiality understanding', description: 'Grounded reflection on informed consent or confidentiality understanding.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-3-focus', 'pou-3-prompts'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: ['Clarify understanding rather than assuming it was established.'], missingInformationCodes: ['consent_or_confidentiality'], applicabilityRule: null },
      { criterionCode: 'TIKANGA_POWER_CONSULTATION', label: 'Shared power and consultation', description: 'Grounded reflection on shared power or consultation where it was relevant.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-3-prompts'], strengthsOrProtective: true, areasForAttention: true, followUpGuidance: ['Clarify whether guidance or consultation was needed.'], missingInformationCodes: ['power_or_consultation'], applicabilityRule: null },
      { criterionCode: 'TIKANGA_DOCUMENTATION', label: 'Ethical rationale documented', description: 'Whether ethical rationale and planning records are documented.', evidenceScope: 'application_state', sourceItemReferences: ['pou-3-review-language'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: [], missingInformationCodes: ['ethical_documentation'], applicabilityRule: null },
    ],
    reviewSynthesisGuidance: ['Ground every statement in the spoken reflection.', 'Do not infer consent, confidentiality, or ethical adequacy from an unmentioned topic.', 'Keep consultation and documentation questions separate from transcript-only evidence.', 'Do not create a safety candidate from review attention alone.'], safetyRuleReferences: [],
  }),
  draft({
    specificationCode: 'TE_WAHAROA_KAITIAKITANGA', pouId: 'kaitiakitanga', sourceReference: source(4),
    purpose: 'Reflect on visible and invisible risk, relational safety planning, cultural supports, crisis response, and risks for whānau, practitioner, or team.',
    conversationExplorationAreas: [
      { code: 'visible_invisible_risk', label: 'Visible and invisible risk', intent: 'Explore risks that were visible or less visible without minimising or overstating them.', followUpGuidance: ['Clarify the meaning of an explicitly raised risk.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-4-focus', 'pou-4-prompts'] },
      { code: 'relational_safety_planning', label: 'Relational safety planning', intent: 'Explore whether planning was realistic, relational, and connected with whānau or cultural supports.', followUpGuidance: ['Do not infer a safety plan exists unless it was discussed.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-4-focus', 'pou-4-prompts'] },
      { code: 'practitioner_team_risk', label: 'Practitioner and team risk', intent: 'Make space for risks relevant to the practitioner or team.', followUpGuidance: ['Clarify support needs when practitioner or team risk is raised.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-4-prompts'] },
    ],
    evidenceCriteria: [
      { criterionCode: 'KAITIAKITANGA_RISK_CONTEXT', label: 'Visible and invisible risk context', description: 'Grounded reflection on visible or invisible risk.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-4-focus', 'pou-4-prompts'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: ['Clarify explicitly raised risk context.'], missingInformationCodes: ['risk_context'], applicabilityRule: null },
      { criterionCode: 'KAITIAKITANGA_RELATIONAL_PLANNING', label: 'Relational safety planning and supports', description: 'Grounded reflection on realistic planning, whānau involvement, or cultural supports.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-4-prompts'], strengthsOrProtective: true, areasForAttention: true, followUpGuidance: ['Clarify whether planning or supports were discussed.'], missingInformationCodes: ['safety_planning_or_supports'], applicabilityRule: null },
      { criterionCode: 'KAITIAKITANGA_PRACTITIONER_TEAM_RISK', label: 'Practitioner or team risk', description: 'Grounded reflection on risk or support needs for practitioner or team.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-4-prompts'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: ['Clarify practitioner or team risk when raised.'], missingInformationCodes: ['practitioner_or_team_risk'], applicabilityRule: null },
      { criterionCode: 'KAITIAKITANGA_RISK_RECORDS', label: 'Risk assessment and response records', description: 'Whether risk assessments, plans, escalations, referrals, and crisis response are recorded.', evidenceScope: 'application_state', sourceItemReferences: ['pou-4-review-language'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: [], missingInformationCodes: ['risk_response_records'], applicabilityRule: null },
      { criterionCode: 'KAITIAKITANGA_CRISIS_PATTERN', label: 'Crisis reassessment pattern', description: 'Whether multiple crisis events were reassessed over time.', evidenceScope: 'longitudinal', sourceItemReferences: ['pou-4-safety-flags'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: [], missingInformationCodes: ['crisis_reassessment_pattern'], applicabilityRule: null },
    ],
    reviewSynthesisGuidance: ['Describe current-conversation risk context without deciding severity.', 'Do not treat unmentioned risks or plans as absent.', 'Keep formal escalation, referral, and safety-policy decisions outside this draft.', 'Do not create a safety candidate from review attention alone.'], safetyRuleReferences: [],
  }),
  draft({
    specificationCode: 'TE_WAHAROA_PUUKENGA', pouId: 'puukenga', sourceReference: source(5),
    purpose: 'Reflect on practitioner capability, uncertainty, support needs, scope of practice, cultural integrity, learning, and strengths brought to the engagement.',
    conversationExplorationAreas: [
      { code: 'capability_uncertainty', label: 'Capability and uncertainty', intent: 'Explore knowledge gaps, capability, uncertainty, and working within scope.', followUpGuidance: ['Clarify uncertainty without treating it as failure.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-5-focus', 'pou-5-prompts'] },
      { code: 'support_supervision', label: 'Support and supervision needs', intent: 'Explore support or supervision that may be needed.', followUpGuidance: ['Do not infer support needs from silence.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-5-focus', 'pou-5-prompts'] },
      { code: 'cultural_integrity_strengths', label: 'Cultural integrity and practitioner strengths', intent: 'Reflect on cultural integrity and strengths brought into the session.', followUpGuidance: ['Invite grounded examples rather than generic self-assessment.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-5-prompts'] },
    ],
    evidenceCriteria: [
      { criterionCode: 'PUUKENGA_CAPABILITY_UNCERTAINTY', label: 'Capability and uncertainty', description: 'Grounded reflection on capability, knowledge gaps, scope, or uncertainty.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-5-focus', 'pou-5-prompts'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: ['Clarify a capability or uncertainty issue where relevant.'], missingInformationCodes: ['capability_or_uncertainty'], applicabilityRule: null },
      { criterionCode: 'PUUKENGA_SUPPORT_SUPERVISION', label: 'Support and supervision needs', description: 'Grounded reflection on support or supervision needs.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-5-prompts'], strengthsOrProtective: true, areasForAttention: true, followUpGuidance: ['Clarify support needs rather than assuming supervision occurred.'], missingInformationCodes: ['support_or_supervision'], applicabilityRule: null },
      { criterionCode: 'PUUKENGA_CULTURAL_INTEGRITY_STRENGTHS', label: 'Cultural integrity and strengths', description: 'Grounded reflection on cultural integrity or strengths brought to the engagement.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-5-prompts'], strengthsOrProtective: true, areasForAttention: false, followUpGuidance: ['Clarify a named strength or cultural-practice reflection.'], missingInformationCodes: ['cultural_integrity_or_strengths'], applicabilityRule: null },
      { criterionCode: 'PUUKENGA_LEARNING_RECORDS', label: 'Training, supervision, and learning records', description: 'Whether training, supervision, reflective notes, and learning evidence are recorded.', evidenceScope: 'application_state', sourceItemReferences: ['pou-5-review-language'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: [], missingInformationCodes: ['learning_records'], applicabilityRule: null },
    ],
    reviewSynthesisGuidance: ['Treat uncertainty as information for reflection, not as a safety outcome.', 'Do not infer scope adherence or supervision from silence.', 'Separate practitioner strengths from areas needing support.', 'Do not create a safety candidate from review attention alone.'], safetyRuleReferences: [],
  }),
  draft({
    specificationCode: 'TE_WAHAROA_HAEPAPA', pouId: 'haepapa', sourceReference: source(6),
    purpose: 'Reflect on accountability, commitments, trust, transparency, follow-through, and conversations that may be avoided.',
    conversationExplorationAreas: [
      { code: 'accountability_relationships', label: 'Accountability and relationships', intent: 'Explore who the Kaimahi is accountable to and how actions affected trust.', followUpGuidance: ['Clarify an accountability relationship when relevant.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-6-focus', 'pou-6-prompts'] },
      { code: 'commitments_follow_through', label: 'Commitments and follow-through', intent: 'Reflect on commitments, follow-through, and responsibility.', followUpGuidance: ['Do not infer completed action from an unmentioned commitment.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-6-focus', 'pou-6-prompts'] },
      { code: 'transparency_avoidance', label: 'Transparency and avoided conversations', intent: 'Explore transparency, responsibility, and conversations that may be difficult or avoided.', followUpGuidance: ['Invite reflection without assigning blame.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-6-prompts'] },
    ],
    evidenceCriteria: [
      { criterionCode: 'HAEPAPA_ACCOUNTABILITY_TRUST', label: 'Accountability and trust', description: 'Grounded reflection on accountability or the effect of actions on trust.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-6-focus', 'pou-6-prompts'], strengthsOrProtective: true, areasForAttention: true, followUpGuidance: ['Clarify relevant accountability or trust context.'], missingInformationCodes: ['accountability_or_trust'], applicabilityRule: null },
      { criterionCode: 'HAEPAPA_FOLLOW_THROUGH', label: 'Commitments and follow-through', description: 'Grounded reflection on commitments and follow-through.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-6-prompts'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: ['Clarify a commitment or follow-through issue.'], missingInformationCodes: ['commitments_or_follow_through'], applicabilityRule: null },
      { criterionCode: 'HAEPAPA_TRANSPARENCY', label: 'Transparency and responsibility', description: 'Grounded reflection on transparency, responsibility, or difficult conversations.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-6-prompts'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: ['Clarify what remains difficult or avoided.'], missingInformationCodes: ['transparency_or_responsibility'], applicabilityRule: null },
      { criterionCode: 'HAEPAPA_ACCOUNTABILITY_RECORDS', label: 'Accountability records and follow-up', description: 'Whether notes, reviews, reporting, hui, and actions are completed and evidenced.', evidenceScope: 'application_state', sourceItemReferences: ['pou-6-review-language'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: [], missingInformationCodes: ['accountability_records'], applicabilityRule: null },
      { criterionCode: 'HAEPAPA_ACCOUNTABILITY_PATTERN', label: 'Accountability pattern over time', description: 'Patterns of incomplete tasks, avoided accountability, or note/action discrepancies over time.', evidenceScope: 'longitudinal', sourceItemReferences: ['pou-6-safety-flags'], strengthsOrProtective: false, areasForAttention: true, followUpGuidance: [], missingInformationCodes: ['accountability_pattern'], applicabilityRule: null },
    ],
    reviewSynthesisGuidance: ['Describe only spoken accountability reflection.', 'Do not infer completed documentation or actions from silence.', 'Avoid punitive language.', 'Do not create a safety candidate from review attention alone.'], safetyRuleReferences: [],
  }),
  draft({
    specificationCode: 'TE_WAHAROA_ORANGA', pouId: 'oranga', sourceReference: source(7),
    purpose: 'Reflect on protective factors, whānau strengths, connection to supports, cultural engagement, mana restoration, and wellbeing.',
    conversationExplorationAreas: [
      { code: 'whanau_strengths', label: 'Whānau strengths', intent: 'Explore sources of strength emerging for whānau.', followUpGuidance: ['Invite a grounded strength rather than assuming one.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-7-focus', 'pou-7-prompts'] },
      { code: 'supports_cultural_engagement', label: 'Supports and cultural engagement', intent: 'Explore connection to supports, cultural engagement, and mana restoration.', followUpGuidance: ['Clarify what support or connection means in the reflection.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-7-focus', 'pou-7-prompts'] },
      { code: 'oranga_indicators', label: 'Indicators of oranga', intent: 'Explore visible emotional, relational, or spiritual shifts and protective factors needing strengthening.', followUpGuidance: ['Do not infer wellbeing improvement from silence.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-7-prompts'] },
    ],
    evidenceCriteria: [
      { criterionCode: 'ORANGA_STRENGTHS', label: 'Whānau strengths', description: 'Grounded strengths described in the reflection.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-7-focus', 'pou-7-prompts'], strengthsOrProtective: true, areasForAttention: true, followUpGuidance: ['Clarify strengths when important but unexplored.'], missingInformationCodes: ['whanau_strengths'], applicabilityRule: null },
      { criterionCode: 'ORANGA_SUPPORTS_CONNECTION', label: 'Supports, cultural engagement, and mana restoration', description: 'Grounded connection to supports, cultural engagement, or mana restoration.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-7-focus', 'pou-7-prompts'], strengthsOrProtective: true, areasForAttention: true, followUpGuidance: ['Clarify a support, connection, or protective factor.'], missingInformationCodes: ['supports_or_cultural_connection'], applicabilityRule: null },
      { criterionCode: 'ORANGA_WELLBEING_INDICATORS', label: 'Indicators of oranga', description: 'Grounded emotional, relational, or spiritual shifts and areas needing strengthening.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-7-prompts'], strengthsOrProtective: true, areasForAttention: true, followUpGuidance: ['Clarify indicators rather than assuming improvement.'], missingInformationCodes: ['oranga_indicators'], applicabilityRule: null },
      { criterionCode: 'ORANGA_PROTECTION_RECORDS', label: 'Protective factors and goals recorded', description: 'Whether protective factors, goals, supports, and wellbeing are recorded or updated.', evidenceScope: 'application_state', sourceItemReferences: ['pou-7-review-language'], strengthsOrProtective: true, areasForAttention: true, followUpGuidance: [], missingInformationCodes: ['protection_records'], applicabilityRule: null },
      { criterionCode: 'ORANGA_PROGRESS_PATTERN', label: 'Wellbeing and goal progression over time', description: 'Wellbeing improvement and goal progression across relevant engagements.', evidenceScope: 'longitudinal', sourceItemReferences: ['pou-7-focus', 'pou-7-review-language'], strengthsOrProtective: true, areasForAttention: true, followUpGuidance: [], missingInformationCodes: ['wellbeing_progress_pattern'], applicabilityRule: null },
    ],
    reviewSynthesisGuidance: ['Describe strengths and protective factors without treating silence as their absence.', 'Keep outcome and progress claims bounded to spoken material.', 'Separate future record review and longitudinal progress from this conversation.', 'Do not create a safety candidate from review attention alone.'], safetyRuleReferences: [],
  }),
] as const satisfies readonly OrganisationPouSpecificationVersion[]

export const PHASE_5D_DRAFT_SPECIFICATION_BY_CODE = new Map(
  PHASE_5D_DRAFT_POU_SPECIFICATIONS.map((specification) => [`${specification.specificationCode}@${specification.specificationVersion}`, specification]),
)
