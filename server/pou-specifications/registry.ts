import {
  approvedOrganisationPouSpecification,
  approvedWhakapapaOrganisationPouV01,
  WHAKAPAPA_ORGANISATION_POU_V01_DRAFT,
  type OrganisationPouSpecificationVersion,
} from './domain.js'
import { PHASE_5D_DRAFT_SPECIFICATION_BY_CODE } from './phase5d-specifications.js'

/**
 * Application-owned pilot registry.  Approval provenance is supplied only by
 * the operator at provisioning time; the draft-derived source template is
 * never activated directly.
 */
export function organisationPouSpecificationFromRegistry(
  code: string,
  version: string,
  approval: { approvedForPilotBy: string; approvedForPilotAt: string },
): OrganisationPouSpecificationVersion {
  if (
    code === WHAKAPAPA_ORGANISATION_POU_V01_DRAFT.specificationCode
    && version === WHAKAPAPA_ORGANISATION_POU_V01_DRAFT.specificationVersion
  ) {
    const approvedAt = new Date(approval.approvedForPilotAt)
    if (Number.isNaN(approvedAt.getTime())) throw new Error('The approved-for-pilot timestamp must be a valid ISO instant.')
    return approvedWhakapapaOrganisationPouV01({ ...approval, approvedForPilotAt: approvedAt.toISOString() })
  }
  const draft = PHASE_5D_DRAFT_SPECIFICATION_BY_CODE.get(`${code}@${version}`)
  if (draft) {
    const approvedAt = new Date(approval.approvedForPilotAt)
    if (Number.isNaN(approvedAt.getTime())) throw new Error('The approved-for-pilot timestamp must be a valid ISO instant.')
    return approvedOrganisationPouSpecification(draft, { ...approval, approvedForPilotAt: approvedAt.toISOString() })
  }
  throw new Error('The requested application-owned organisation Pou specification is not registered.')
}
