import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'

import * as schema from '../db/schema.js'
import type { AuthenticatedUser } from '../domain/auth.js'
import type { WorkflowPouId } from '../../shared/workflow.js'

type Database = NodePgDatabase<typeof schema>
type EvidenceActorRole = 'KAIMAHI' | 'SUPERVISOR'

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
    return Boolean(await authorisedEvidenceRole(this.db, actor, organisationId, kaimahiUserId))
  }
}

export type CriterionSourceEvidence = {
  criterionCode: string
  pouId: WorkflowPouId
  excerpts: Array<{
    ordinal: number
    speaker: 'kaimahi' | 'assistant' | 'unknown'
    text: string
  }>
}

/**
 * Deliberately resolves only IDs already pinned in a confirmed snapshot. The
 * audit insert is in the same transaction as the sensitive text read, so no
 * text is released if the approved business-audit record cannot persist.
 */
export class PostgresCanonicalCriterionSourceEvidenceRepository {
  constructor(private readonly db: Database, private readonly now: () => Date = () => new Date()) {}

  async findAndAuditForAuthorizedUser(input: { actor: AuthenticatedUser; workflowSessionId: string; pouId: WorkflowPouId; criterionCode: string; requestId: string }): Promise<CriterionSourceEvidence | null> {
    return this.db.transaction(async (transaction) => {
      const executor = transaction as unknown as Database
      const [scope] = await executor.select({
        organisationId: schema.workflowPouReviews.organisationId,
        kaimahiUserId: schema.workflowSessions.kaimahiUserId,
        workflowPouReviewId: schema.workflowPouReviews.id,
        reviewDraftRevisionId: schema.workflowPouReviews.reviewDraftRevisionId,
        criterionSnapshotId: schema.workflowPouReviewCriterionSnapshots.id,
        sourceCriterionAssessmentId: schema.workflowPouReviewCriterionSnapshots.sourceCriterionAssessmentId,
        evidenceTurnIds: schema.workflowPouReviewCriterionSnapshots.evidenceTurnIds,
      })
        .from(schema.workflowPouReviewCriterionSnapshots)
        .innerJoin(schema.workflowPouReviews, eq(schema.workflowPouReviewCriterionSnapshots.workflowPouReviewId, schema.workflowPouReviews.id))
        .innerJoin(schema.workflowSessions, and(
          eq(schema.workflowSessions.id, schema.workflowPouReviews.workflowSessionId),
          eq(schema.workflowSessions.organisationId, schema.workflowPouReviews.organisationId),
        ))
        .where(and(
          eq(schema.workflowPouReviews.workflowSessionId, input.workflowSessionId),
          eq(schema.workflowPouReviews.organisationId, input.actor.organisation.id),
          eq(schema.workflowPouReviews.pouId, input.pouId),
          eq(schema.workflowPouReviews.criterionSnapshotsVersion, 1),
          eq(schema.workflowPouReviewCriterionSnapshots.criterionCode, input.criterionCode),
        ))
        .limit(1)

      if (!scope) return null
      const actorRole = await authorisedEvidenceRole(executor, input.actor, scope.organisationId, scope.kaimahiUserId)
      if (!actorRole) return null
      const referencedTurnIds = uuidArray(scope.evidenceTurnIds)
      if (referencedTurnIds.length === 0) return null

      const [provenance] = await executor.select({
        reviewDraftRevisionId: schema.conversationReviewDraftCriterionAssessments.reviewDraftRevisionId,
        workflowSessionId: schema.conversationReviewDrafts.workflowSessionId,
        organisationId: schema.conversationReviewDrafts.organisationId,
        pouId: schema.conversationReviewDrafts.pouId,
        workflowConversationId: schema.conversationReviewDrafts.workflowConversationId,
        transcriptId: schema.conversationTranscripts.id,
      })
        .from(schema.conversationReviewDraftCriterionAssessments)
        .innerJoin(schema.conversationReviewDraftRevisions, eq(schema.conversationReviewDraftCriterionAssessments.reviewDraftRevisionId, schema.conversationReviewDraftRevisions.id))
        .innerJoin(schema.conversationReviewDrafts, eq(schema.conversationReviewDraftRevisions.reviewDraftId, schema.conversationReviewDrafts.id))
        .innerJoin(schema.workflowConversations, and(
          eq(schema.workflowConversations.id, schema.conversationReviewDrafts.workflowConversationId),
          eq(schema.workflowConversations.organisationId, schema.conversationReviewDrafts.organisationId),
          eq(schema.workflowConversations.workflowSessionId, schema.conversationReviewDrafts.workflowSessionId),
          eq(schema.workflowConversations.pouId, schema.conversationReviewDrafts.pouId),
        ))
        .innerJoin(schema.conversationTranscripts, and(
          eq(schema.conversationTranscripts.workflowConversationId, schema.workflowConversations.id),
          eq(schema.conversationTranscripts.organisationId, schema.workflowConversations.organisationId),
          eq(schema.conversationTranscripts.workflowSessionId, schema.workflowConversations.workflowSessionId),
          eq(schema.conversationTranscripts.pouId, schema.workflowConversations.pouId),
        ))
        .where(eq(schema.conversationReviewDraftCriterionAssessments.id, scope.sourceCriterionAssessmentId))
        .limit(1)

      if (!provenance
        || provenance.reviewDraftRevisionId !== scope.reviewDraftRevisionId
        || provenance.organisationId !== scope.organisationId
        || provenance.workflowSessionId !== input.workflowSessionId
        || provenance.pouId !== input.pouId) throw new CanonicalPouEvidenceSourceIntegrityError()

      const turns = await executor.select({
        id: schema.conversationTranscriptTurns.id,
        ordinal: schema.conversationTranscriptTurns.ordinal,
        speaker: schema.conversationTranscriptTurns.speaker,
        text: schema.conversationTranscriptTurns.text,
      })
        .from(schema.conversationTranscriptTurns)
        .innerJoin(schema.conversationTranscripts, eq(schema.conversationTranscriptTurns.transcriptId, schema.conversationTranscripts.id))
        .where(and(
          eq(schema.conversationTranscriptTurns.transcriptId, provenance.transcriptId),
          eq(schema.conversationTranscripts.organisationId, scope.organisationId),
          eq(schema.conversationTranscripts.workflowSessionId, input.workflowSessionId),
          eq(schema.conversationTranscripts.pouId, input.pouId),
          eq(schema.conversationTranscripts.workflowConversationId, provenance.workflowConversationId),
          inArray(schema.conversationTranscriptTurns.id, referencedTurnIds),
        ))
        .orderBy(asc(schema.conversationTranscriptTurns.ordinal))

      if (turns.length !== referencedTurnIds.length || new Set(turns.map((turn) => turn.id)).size !== referencedTurnIds.length) {
        throw new CanonicalPouEvidenceSourceIntegrityError()
      }

      await executor.insert(schema.workflowCriterionSourceEvidenceAccessAudits).values({
        eventType: 'criterion_source_evidence_viewed',
        actorUserId: input.actor.id,
        actorRole,
        organisationId: scope.organisationId,
        targetKaimahiUserId: scope.kaimahiUserId,
        workflowSessionId: input.workflowSessionId,
        pouId: input.pouId,
        workflowPouReviewId: scope.workflowPouReviewId,
        criterionSnapshotId: scope.criterionSnapshotId,
        criterionCode: input.criterionCode,
        workflowConversationId: provenance.workflowConversationId,
        referencedTurnIds,
        referencedTurnCount: referencedTurnIds.length,
        requestId: input.requestId.slice(0, 200),
        outcome: 'success',
        createdAt: this.now(),
      })

      return {
        criterionCode: input.criterionCode,
        pouId: input.pouId,
        excerpts: turns.map((turn) => ({
          ordinal: turn.ordinal,
          speaker: turn.speaker,
          text: turn.text,
        })),
      }
    })
  }
}

export class CanonicalPouEvidenceSourceIntegrityError extends Error {}

async function authorisedEvidenceRole(db: Database, actor: AuthenticatedUser, organisationId: string, kaimahiUserId: string): Promise<EvidenceActorRole | null> {
  if (actor.status !== 'active') return null
  if (actor.roles.includes('KAIMAHI') && actor.id === kaimahiUserId) return 'KAIMAHI'
  if (!actor.roles.includes('SUPERVISOR')) return null

  const supervisor = alias(schema.appUsers, 'canonical_evidence_supervisor')
  const kaimahi = alias(schema.appUsers, 'canonical_evidence_kaimahi')
  const supervisorRole = alias(schema.roleAssignments, 'canonical_evidence_supervisor_role')
  const kaimahiRole = alias(schema.roleAssignments, 'canonical_evidence_kaimahi_role')
  const [relationship] = await db.select({ id: schema.supervision.id })
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
  return relationship ? 'SUPERVISOR' : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...value] : []
}

function uuidArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) throw new CanonicalPouEvidenceSourceIntegrityError()
  const ids = value.map((item) => z.string().uuid().parse(item))
  if (new Set(ids).size !== ids.length) throw new CanonicalPouEvidenceSourceIntegrityError()
  return ids
}
