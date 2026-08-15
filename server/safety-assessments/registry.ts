import { approvedWhakapapaPilotV01, safetySpecificationSchema, WHAKAPAPA_PILOT_V01_DRAFT, type SafetySpecificationVersion } from './domain.js'
import { PHASE_5D_DRAFT_SAFETY_SPECIFICATION_BY_CODE } from './phase5d-specifications.js'

/** Application-owned immutable templates materialise approval provenance only at provisioning time. */
export function safetySpecificationFromRegistry(code: string, version: string, approval: { approvedForPilotBy: string; approvedForPilotAt: string }): SafetySpecificationVersion {
  if (code === WHAKAPAPA_PILOT_V01_DRAFT.specificationCode && version === WHAKAPAPA_PILOT_V01_DRAFT.specificationVersion) return approvedWhakapapaPilotV01(approval)
  const draft = PHASE_5D_DRAFT_SAFETY_SPECIFICATION_BY_CODE.get(`${code}@${version}`)
  if (draft) {
    const approvedAt = new Date(approval.approvedForPilotAt)
    if (Number.isNaN(approvedAt.getTime())) throw new Error('The approved-for-pilot timestamp must be a valid ISO instant.')
    return safetySpecificationSchema.parse({ ...draft, approvalStatus: 'approved_for_pilot', approvedForPilotBy: approval.approvedForPilotBy, approvedForPilotAt: approvedAt.toISOString() })
  }
  throw new Error('The requested application-owned safety specification is not registered.')
}
