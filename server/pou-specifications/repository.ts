import { and, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from '../db/schema.js'
import type { WorkflowPouId } from '../../shared/workflow.js'
import type { AssessmentStartPin } from '../safety-assessments/repository.js'
import { contentHash } from '../safety-assessments/domain.js'
import { conversationGuidanceProjection, isExactHistoricWhakapapaV01ProjectionPair, organisationPouSpecificationSchema, pouReviewProjection, type ConversationGuidanceProjection, type OrganisationPouSpecificationVersion, type PouReviewProjection } from './domain.js'

type Database = NodePgDatabase<typeof schema>

export interface PouSpecificationStartPin {
  specificationId: string
  specification: OrganisationPouSpecificationVersion
  specificationHash: string
  conversationGuidanceProjectionId: string
  conversationGuidanceProjection: ConversationGuidanceProjection
  conversationGuidanceProjectionHash: string
  pouReviewProjectionId: string
  pouReviewProjection: PouReviewProjection
  pouReviewProjectionHash: string
}

export class PouSpecificationUnavailableError extends Error {}

/** Resolves a single approved organisation version and verifies its three projections share it. */
export class PostgresOrganisationPouSpecificationRepository {
  constructor(private readonly db: Database) {}

  async resolveActivePin(organisationId: string, pouId: WorkflowPouId, safetyPin: AssessmentStartPin): Promise<PouSpecificationStartPin> {
    const rows = await this.db.select({ activation: schema.organisationPouSpecificationActivations, specification: schema.organisationPouSpecificationVersions, guidance: schema.conversationGuidanceProjections, review: schema.pouReviewProjections, link: schema.organisationPouSafetySpecificationLinks })
      .from(schema.organisationPouSpecificationActivations)
      .innerJoin(schema.organisationPouSpecificationVersions, eq(schema.organisationPouSpecificationActivations.specificationId, schema.organisationPouSpecificationVersions.id))
      .innerJoin(schema.conversationGuidanceProjections, eq(schema.organisationPouSpecificationActivations.conversationGuidanceProjectionId, schema.conversationGuidanceProjections.id))
      .innerJoin(schema.pouReviewProjections, eq(schema.organisationPouSpecificationActivations.pouReviewProjectionId, schema.pouReviewProjections.id))
      .innerJoin(schema.organisationPouSafetySpecificationLinks, eq(schema.organisationPouSpecificationActivations.safetyLinkId, schema.organisationPouSafetySpecificationLinks.id))
      .where(and(eq(schema.organisationPouSpecificationActivations.organisationId, organisationId), eq(schema.organisationPouSpecificationActivations.pouId, pouId), sql`${schema.organisationPouSpecificationActivations.deactivatedAt} is null`)).limit(1)
    const row = rows[0]
    if (!row || row.specification.approvalStatus !== 'approved_for_pilot' || !row.specification.approvedForPilotBy || !row.specification.approvedForPilotAt) throw new PouSpecificationUnavailableError('No active approved organisation Pou specification is available.')
    if (row.link.organisationPouSpecificationId !== row.specification.id || row.link.safetySpecificationId !== safetyPin.specificationId || row.link.safetyProjectionId !== safetyPin.projectionId) throw new PouSpecificationUnavailableError('The active safety projection is not linked to the active organisation Pou specification.')
    const specification = organisationPouSpecificationSchema.parse(row.specification.specification)
    if (specification.pouId !== pouId || safetyPin.specification.pouId !== pouId || safetyPin.projection.specificationCode !== safetyPin.specification.specificationCode) throw new PouSpecificationUnavailableError('The active specification scope is invalid.')
    const guidance = row.guidance.projection as ConversationGuidanceProjection
    const review = row.review.projection as PouReviewProjection
    const expectedGuidance = conversationGuidanceProjection(specification, { projectionCode: row.guidance.projectionCode, projectionVersion: row.guidance.projectionVersion })
    const expectedReview = pouReviewProjection(specification, { projectionCode: row.review.projectionCode, projectionVersion: row.review.projectionVersion })
    const sameSourceProvenance = specification.sourceDocumentCode === safetyPin.specification.sourceDocumentCode
      && specification.sourceDocumentStatus === safetyPin.specification.sourceDocumentStatus
      && specification.sourceReference === safetyPin.specification.sourceReference
      && specification.sourceDocumentHash === safetyPin.specification.sourceDocumentHash
    const linkedRules = specification.safetyRuleReferences.map((rule) => `${rule.ruleCode}@${rule.ruleVersion}`).sort()
    const safetyRules = safetyPin.specification.rules.map((rule) => `${rule.ruleCode}@${rule.ruleVersion}`).sort()
    const currentDerivationMatches = contentHash(expectedGuidance) === row.guidance.projectionHash
      && contentHash(expectedReview) === row.review.projectionHash
    const historicWhakapapaV01Matches = isExactHistoricWhakapapaV01ProjectionPair({
      pouId,
      specification,
      guidance,
      review,
    })
    if (contentHash(specification) !== row.specification.contentHash || contentHash(guidance) !== row.guidance.projectionHash || contentHash(review) !== row.review.projectionHash || (!currentDerivationMatches && !historicWhakapapaV01Matches) || guidance.specificationHash !== row.specification.contentHash || review.specificationHash !== row.specification.contentHash || !sameSourceProvenance || linkedRules.length !== safetyRules.length || linkedRules.some((rule, index) => rule !== safetyRules[index])) throw new PouSpecificationUnavailableError('The active organisation Pou projection provenance is invalid.')
    return { specificationId: row.specification.id, specification, specificationHash: row.specification.contentHash, conversationGuidanceProjectionId: row.guidance.id, conversationGuidanceProjection: guidance, conversationGuidanceProjectionHash: row.guidance.projectionHash, pouReviewProjectionId: row.review.id, pouReviewProjection: review, pouReviewProjectionHash: row.review.projectionHash }
  }
}
