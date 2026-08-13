import { approvedWhakapapaPilotV01, WHAKAPAPA_PILOT_V01_DRAFT, type SafetySpecificationVersion } from './domain.js'

/** Application-owned immutable templates materialise approval provenance only at provisioning time. */
export function safetySpecificationFromRegistry(code: string, version: string, approval: { approvedForPilotBy: string; approvedForPilotAt: string }): SafetySpecificationVersion {
  if (code === WHAKAPAPA_PILOT_V01_DRAFT.specificationCode && version === WHAKAPAPA_PILOT_V01_DRAFT.specificationVersion) return approvedWhakapapaPilotV01(approval)
  throw new Error('The requested application-owned safety specification is not registered.')
}
