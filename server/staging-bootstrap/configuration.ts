import { type WorkflowPouId } from '../../shared/workflow.js'
import {
  WHAKAPAPA_ORGANISATION_POU_V01_DRAFT,
  approvedOrganisationPouSpecification,
  organisationPouSpecificationSchema,
  type OrganisationPouSpecificationVersion,
} from '../pou-specifications/domain.js'
import { PHASE_5D_DRAFT_POU_SPECIFICATIONS } from '../pou-specifications/phase5d-specifications.js'
import { approvedWhakapapaPilotV01, safetySpecificationSchema, type SafetySpecificationVersion } from '../safety-assessments/domain.js'
import { PHASE_5D_DRAFT_SAFETY_SPECIFICATIONS } from '../safety-assessments/phase5d-specifications.js'

export const STAGING_CLIENT_DEMO_ORGANISATION = {
  slug: 'te-kaupapa-client-demo-staging',
  name: 'Te Kaupapa client demo staging',
  bootstrapUserEmail: 'staging-bootstrap@te-kaupapa.invalid',
  bootstrapUserDisplayName: 'Staging configuration bootstrap',
} as const

/**
 * Approved v0.2 staging baseline.  It is deliberately source-controlled,
 * synthetic, and limited to the SME-authored opening added to each v0.1
 * ordinary Pou specification.
 */
export const STAGING_CLIENT_DEMO_OPENINGS: Record<WorkflowPouId, string> = {
  whakapapa: 'Thinking about this engagement, what have you learned about the person’s identity, whakapapa, whānau and the people, places or cultural connections that are important to them, and how have these shaped the way you have worked together?',
  manaakitanga: 'Thinking about the way you engaged with this person, how did you work to ensure they felt listened to, respected, safe and able to express what mattered to them, and was there anything that made this more difficult?',
  tikanga: 'Thinking about this engagement, how did you make sure the person’s preferences, consent, cultural expectations and ways of doing things were understood and respected, and is there anything you still need to clarify?',
  kaitiakitanga: 'Thinking about the person’s current situation, what risks, pressures or vulnerabilities did you notice, what strengths or supports may help protect them, and what still needs to be understood?',
  puukenga: 'Thinking about your own practice in this engagement, what knowledge, skills and approaches helped you work effectively, and were there areas where you needed more information, support or expertise?',
  haepapa: 'Thinking about what was discussed and agreed, how clear are the responsibilities, next steps and timeframes for you, the person and anyone else involved, and what still needs to be followed up?',
  oranga: 'Thinking about the person’s wider wellbeing, what strengths, relationships, routines, cultural connections and other protective factors are supporting them, and what could help strengthen those further?',
}

const ordinaryV01Specifications = [
  WHAKAPAPA_ORGANISATION_POU_V01_DRAFT,
  ...PHASE_5D_DRAFT_POU_SPECIFICATIONS,
] as const

export function stagingClientDemoOrdinarySpecificationsV02(approval: { approvedForPilotBy: string; approvedForPilotAt: string }): OrganisationPouSpecificationVersion[] {
  return ordinaryV01Specifications.map((v01) => approvedOrganisationPouSpecification(
    organisationPouSpecificationSchema.parse({
      ...v01,
      specificationVersion: '0.2',
      openingReflectionQuestion: STAGING_CLIENT_DEMO_OPENINGS[v01.pouId],
      openingReflectionQuestionProvenance: 'sme_authored',
    }),
    approval,
  ))
}

/**
 * The staging baseline deliberately excludes local experimental formal safety
 * rules. Whakapapa retains its approved three-rule v0.1 policy; Pou 2–7 are
 * explicitly approved empty rule manifests.
 */
export function stagingClientDemoSafetySpecifications(approval: { approvedForPilotBy: string; approvedForPilotAt: string }): SafetySpecificationVersion[] {
  return [
    approvedWhakapapaPilotV01(approval),
    ...PHASE_5D_DRAFT_SAFETY_SPECIFICATIONS.map((draft) => safetySpecificationSchema.parse({
      ...draft,
      approvalStatus: 'approved_for_pilot',
      approvedForPilotBy: approval.approvedForPilotBy,
      approvedForPilotAt: approval.approvedForPilotAt,
    })),
  ]
}
