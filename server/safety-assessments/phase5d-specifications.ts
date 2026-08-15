import { PHASE_5D_DRAFT_POU_SPECIFICATIONS } from '../pou-specifications/phase5d-specifications.js'
import { safetySpecificationSchema, type SafetySpecificationVersion } from './domain.js'

/**
 * The model-of-care lists safety-flag examples for Pou 2–7 but does not define
 * bounded runtime indicators, mappings, or levels. These draft-derived empty
 * rule manifests preserve one pinned safety projection without inventing
 * policy. A later SME version may add only explicitly approved rules.
 */
export const PHASE_5D_DRAFT_SAFETY_SPECIFICATIONS = PHASE_5D_DRAFT_POU_SPECIFICATIONS.map((pou) => safetySpecificationSchema.parse({
  schemaVersion: 1,
  specificationCode: `${pou.specificationCode}_SAFETY`,
  specificationVersion: pou.specificationVersion,
  pouId: pou.pouId,
  sourceDocumentCode: pou.sourceDocumentCode,
  sourceDocumentStatus: pou.sourceDocumentStatus,
  sourceReference: pou.sourceReference,
  sourceDocumentHash: pou.sourceDocumentHash,
  derivedAt: pou.derivedAt,
  approvalStatus: 'draft_derived',
  approvedForPilotBy: null,
  approvedForPilotAt: null,
  rules: [],
})) as readonly SafetySpecificationVersion[]

export const PHASE_5D_DRAFT_SAFETY_SPECIFICATION_BY_CODE = new Map(
  PHASE_5D_DRAFT_SAFETY_SPECIFICATIONS.map((specification) => [`${specification.specificationCode}@${specification.specificationVersion}`, specification]),
)
