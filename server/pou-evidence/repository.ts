import { and, asc, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { alias } from 'drizzle-orm/pg-core'

import * as schema from '../db/schema.js'
import type { AuthenticatedUser } from '../domain/auth.js'
import type { WorkflowPouId } from '../../shared/workflow.js'

type Database = NodePgDatabase<typeof schema>

export type ConfirmedPouEvidence = {
  status: 'canonical_snapshot'
  pouId: WorkflowPouId
  confirmedAt: string
  snapshotVersion: 1
  criteria: Array<{
    criterionCode: string
    availabilityStatus: 'evidenced' | 'partially_evidenced' | 'not_explored' | 'insufficient_information' | 'not_applicable'
    missingInformationCodes: string[]
    sourceEvidenceReferences: { available: boolean; count: number }
  }>
} | {
  status: 'legacy_unavailable'
  pouId: WorkflowPouId
  confirmedAt: string
  snapshotVersion: null
}

/**
 * The ordinary evidence read exposes only the immutable 6D snapshot.  It
 * intentionally has no dependency on a draft, transcript, or provider.
 */
export class PostgresCanonicalPouEvidenceRepository {
  constructor(private readonly db: Database) {}

  async findForAuthorizedUser(actor: AuthenticatedUser, workflowSessionId: string, pouId: WorkflowPouId): Promise<ConfirmedPouEvidence | null> {
    if (actor.status !== 'active') return null

    const [review] = await this.db.select({
      id: schema.workflowPouReviews.id,
      organisationId: schema.workflowPouReviews.organisationId,
      kaimahiUserId: schema.workflowSessions.kaimahiUserId,
      criterionSnapshotsVersion: schema.workflowPouReviews.criterionSnapshotsVersion,
      confirmedAt: schema.workflowPouReviews.confirmedAt,
    })
      .from(schema.workflowPouReviews)
      .innerJoin(schema.workflowSessions, and(
        eq(schema.workflowSessions.id, schema.workflowPouReviews.workflowSessionId),
        eq(schema.workflowSessions.organisationId, schema.workflowPouReviews.organisationId),
      ))
      .where(and(
        eq(schema.workflowPouReviews.workflowSessionId, workflowSessionId),
        eq(schema.workflowPouReviews.pouId, pouId),
        eq(schema.workflowPouReviews.organisationId, actor.organisation.id),
      ))
      .limit(1)

    if (!review || !await this.canRead(actor, review.organisationId, review.kaimahiUserId)) return null

    const confirmedAt = review.confirmedAt.toISOString()
    if (review.criterionSnapshotsVersion === null) {
      return { status: 'legacy_unavailable', pouId, confirmedAt, snapshotVersion: null }
    }

    const rows = await this.db.select({
      criterionCode: schema.workflowPouReviewCriterionSnapshots.criterionCode,
      availabilityStatus: schema.workflowPouReviewCriterionSnapshots.availabilityStatus,
      missingInformationCodes: schema.workflowPouReviewCriterionSnapshots.missingInformationCodes,
      sourceEvidenceReferenceCount: sql<number>`coalesce(jsonb_array_length(${schema.workflowPouReviewCriterionSnapshots.evidenceTurnIds}), 0)`,
    })
      .from(schema.workflowPouReviewCriterionSnapshots)
      .where(eq(schema.workflowPouReviewCriterionSnapshots.workflowPouReviewId, review.id))
      .orderBy(asc(schema.workflowPouReviewCriterionSnapshots.criterionCode))

    return {
      status: 'canonical_snapshot',
      pouId,
      confirmedAt,
      snapshotVersion: 1,
      criteria: rows.map((row) => ({
        criterionCode: row.criterionCode,
        availabilityStatus: row.availabilityStatus,
        missingInformationCodes: stringArray(row.missingInformationCodes),
        sourceEvidenceReferences: {
          available: Number(row.sourceEvidenceReferenceCount) > 0,
          count: Number(row.sourceEvidenceReferenceCount),
        },
      })),
    }
  }

  private async canRead(actor: AuthenticatedUser, organisationId: string, kaimahiUserId: string): Promise<boolean> {
    if (actor.roles.includes('KAIMAHI') && actor.id === kaimahiUserId) return true
    if (!actor.roles.includes('SUPERVISOR')) return false

    const supervisor = alias(schema.appUsers, 'canonical_evidence_supervisor')
    const kaimahi = alias(schema.appUsers, 'canonical_evidence_kaimahi')
    const supervisorRole = alias(schema.roleAssignments, 'canonical_evidence_supervisor_role')
    const kaimahiRole = alias(schema.roleAssignments, 'canonical_evidence_kaimahi_role')
    const [relationship] = await this.db.select({ id: schema.supervision.id })
      .from(schema.supervision)
      .innerJoin(supervisor, and(
        eq(supervisor.id, schema.supervision.supervisorUserId),
        eq(supervisor.organisationId, schema.supervision.organisationId),
      ))
      .innerJoin(supervisorRole, and(eq(supervisorRole.userId, supervisor.id), eq(supervisorRole.role, 'SUPERVISOR')))
      .innerJoin(kaimahi, and(
        eq(kaimahi.id, schema.supervision.kaimahiUserId),
        eq(kaimahi.organisationId, schema.supervision.organisationId),
      ))
      .innerJoin(kaimahiRole, and(eq(kaimahiRole.userId, kaimahi.id), eq(kaimahiRole.role, 'KAIMAHI')))
      .where(and(
        eq(schema.supervision.organisationId, organisationId),
        eq(schema.supervision.supervisorUserId, actor.id),
        eq(schema.supervision.kaimahiUserId, kaimahiUserId),
        eq(supervisor.status, 'active'),
        eq(kaimahi.status, 'active'),
      ))
      .limit(1)
    return Boolean(relationship)
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...value] : []
}
