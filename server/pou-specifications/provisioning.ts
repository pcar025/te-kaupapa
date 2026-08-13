import { and, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from '../db/schema.js'
import {
  contentHash,
  providerProjection,
  safetySpecificationSchema,
  type ProviderAssessmentProjection,
  type SafetySpecificationVersion,
} from '../safety-assessments/domain.js'
import {
  assertApprovedOrganisationPouSpecification,
  conversationGuidanceProjection,
  organisationPouSpecificationSchema,
  pouReviewProjection,
  type ConversationGuidanceProjection,
  type OrganisationPouSpecificationVersion,
  type PouReviewProjection,
} from './domain.js'

type Database = NodePgDatabase<typeof schema>

export class OrganisationPouSpecificationProvisioningError extends Error {}

export interface OrganisationPouSpecificationProvisioningInput {
  organisationId: string
  operatorUserId: string
  specification: OrganisationPouSpecificationVersion
  guidanceProjection: Pick<ConversationGuidanceProjection, 'projectionCode' | 'projectionVersion'>
  reviewProjection: Pick<PouReviewProjection, 'projectionCode' | 'projectionVersion'>
}

export interface OrganisationPouSpecificationProvisioningResult {
  specificationId: string
  guidanceProjectionId: string
  reviewProjectionId: string
  safetyLinkId: string
  activationId: string
}

function sameRuleReferences(specification: OrganisationPouSpecificationVersion, safety: SafetySpecificationVersion): boolean {
  const expected = specification.safetyRuleReferences.map((rule) => `${rule.ruleCode}@${rule.ruleVersion}`).sort()
  const actual = safety.rules.map((rule) => `${rule.ruleCode}@${rule.ruleVersion}`).sort()
  return expected.length === actual.length && expected.every((reference, index) => reference === actual[index])
}

function sameSourceProvenance(specification: OrganisationPouSpecificationVersion, safety: SafetySpecificationVersion): boolean {
  return specification.sourceDocumentCode === safety.sourceDocumentCode
    && specification.sourceDocumentStatus === safety.sourceDocumentStatus
    && specification.sourceReference === safety.sourceReference
    && specification.sourceDocumentHash === safety.sourceDocumentHash
}

/**
 * Operator-only local-pilot activation.  It has no HTTP route and creates a
 * new immutable aggregate pinned to the current approved safety activation.
 */
export class OrganisationPouSpecificationProvisioningService {
  constructor(private readonly db: Database, private readonly now: () => Date = () => new Date()) {}

  async provisionAndActivate(input: OrganisationPouSpecificationProvisioningInput): Promise<OrganisationPouSpecificationProvisioningResult> {
    const specification = assertApprovedOrganisationPouSpecification(input.specification)
    const guidance = conversationGuidanceProjection(specification, input.guidanceProjection)
    const review = pouReviewProjection(specification, input.reviewProjection)
    const specificationHash = contentHash(specification)
    const guidanceHash = contentHash(guidance)
    const reviewHash = contentHash(review)

    if (guidance.specificationHash !== specificationHash || review.specificationHash !== specificationHash) {
      throw new OrganisationPouSpecificationProvisioningError('Derived organisation Pou projections do not match the approved specification hash.')
    }

    return this.db.transaction(async (tx) => {
      const safetyRows = await tx.execute(sql`
        select
          activation.id as activation_id,
          specification.id as specification_id,
          specification.content_hash as specification_hash,
          specification.specification as specification,
          projection.id as projection_id,
          projection.projection_hash as projection_hash,
          projection.projection as projection
        from safety_specification_activation activation
        inner join safety_specification_version specification on specification.id = activation.specification_id
        inner join provider_assessment_projection projection on projection.id = activation.projection_id
        where activation.organisation_id = ${input.organisationId}
          and activation.pou_id = 'whakapapa'
          and activation.deactivated_at is null
        for update
      `)
      const safetyRow = safetyRows.rows[0] as {
        specification_id?: string
        specification_hash?: string
        specification?: unknown
        projection_id?: string
        projection_hash?: string
        projection?: unknown
      } | undefined
      if (!safetyRow?.specification_id || !safetyRow.projection_id || !safetyRow.specification_hash || !safetyRow.projection_hash) {
        throw new OrganisationPouSpecificationProvisioningError('No active approved Whakapapa safety activation is available for linkage.')
      }

      const safetySpecification = safetySpecificationSchema.parse(safetyRow.specification)
      const safetyProjection = safetyRow.projection as ProviderAssessmentProjection
      if (
        safetySpecification.approvalStatus !== 'approved_for_pilot'
        || !safetySpecification.approvedForPilotBy
        || !safetySpecification.approvedForPilotAt
        || contentHash(safetySpecification) !== safetyRow.specification_hash
        || contentHash(safetyProjection) !== safetyRow.projection_hash
        || safetyProjection.specificationHash !== safetyRow.specification_hash
        || !sameRuleReferences(specification, safetySpecification)
        || !sameSourceProvenance(specification, safetySpecification)
      ) {
        throw new OrganisationPouSpecificationProvisioningError('The active safety projection is not an approved exact match for the organisation Pou specification linkage.')
      }

      const [storedSpecification] = await tx.insert(schema.organisationPouSpecificationVersions).values({
        organisationId: input.organisationId,
        specificationCode: specification.specificationCode,
        specificationVersion: specification.specificationVersion,
        pouId: specification.pouId,
        approvalStatus: specification.approvalStatus,
        contentHash: specificationHash,
        specification,
        sourceDocumentCode: specification.sourceDocumentCode,
        sourceDocumentStatus: specification.sourceDocumentStatus,
        sourceReference: specification.sourceReference,
        sourceDocumentHash: specification.sourceDocumentHash,
        derivedAt: new Date(specification.derivedAt),
        approvedForPilotBy: specification.approvedForPilotBy,
        approvedForPilotAt: new Date(specification.approvedForPilotAt!),
        createdAt: this.now(),
      }).returning()
      if (!storedSpecification) throw new OrganisationPouSpecificationProvisioningError('Organisation Pou specification provisioning failed.')

      const [storedGuidance] = await tx.insert(schema.conversationGuidanceProjections).values({
        organisationId: input.organisationId,
        pouId: specification.pouId,
        specificationId: storedSpecification.id,
        projectionCode: guidance.projectionCode,
        projectionVersion: guidance.projectionVersion,
        projectionHash: guidanceHash,
        projection: guidance,
        createdAt: this.now(),
      }).returning()
      const [storedReview] = await tx.insert(schema.pouReviewProjections).values({
        organisationId: input.organisationId,
        pouId: specification.pouId,
        specificationId: storedSpecification.id,
        projectionCode: review.projectionCode,
        projectionVersion: review.projectionVersion,
        projectionHash: reviewHash,
        projection: review,
        createdAt: this.now(),
      }).returning()
      if (!storedGuidance || !storedReview) throw new OrganisationPouSpecificationProvisioningError('Organisation Pou projection provisioning failed.')

      const [safetyLink] = await tx.insert(schema.organisationPouSafetySpecificationLinks).values({
        organisationId: input.organisationId,
        pouId: specification.pouId,
        organisationPouSpecificationId: storedSpecification.id,
        safetySpecificationId: safetyRow.specification_id,
        safetyProjectionId: safetyRow.projection_id,
        createdAt: this.now(),
      }).returning()
      if (!safetyLink) throw new OrganisationPouSpecificationProvisioningError('Organisation Pou safety linkage provisioning failed.')

      await tx.update(schema.organisationPouSpecificationActivations).set({ deactivatedAt: this.now() }).where(and(
        eq(schema.organisationPouSpecificationActivations.organisationId, input.organisationId),
        eq(schema.organisationPouSpecificationActivations.pouId, specification.pouId),
        sql`${schema.organisationPouSpecificationActivations.deactivatedAt} is null`,
      ))
      const [activation] = await tx.insert(schema.organisationPouSpecificationActivations).values({
        organisationId: input.organisationId,
        pouId: specification.pouId,
        specificationId: storedSpecification.id,
        conversationGuidanceProjectionId: storedGuidance.id,
        pouReviewProjectionId: storedReview.id,
        safetyLinkId: safetyLink.id,
        activatedByUserId: input.operatorUserId,
        activatedAt: this.now(),
      }).returning()
      if (!activation) throw new OrganisationPouSpecificationProvisioningError('Organisation Pou activation failed.')
      return {
        specificationId: storedSpecification.id,
        guidanceProjectionId: storedGuidance.id,
        reviewProjectionId: storedReview.id,
        safetyLinkId: safetyLink.id,
        activationId: activation.id,
      }
    })
  }
}
