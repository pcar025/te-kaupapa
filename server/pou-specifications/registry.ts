import {
  approvedWhakapapaOrganisationPouV01,
  WHAKAPAPA_ORGANISATION_POU_V01_DRAFT,
  type OrganisationPouSpecificationVersion,
} from './domain.js'

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
  throw new Error('The requested application-owned organisation Pou specification is not registered.')
}
