import { randomUUID } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as schema from '../db/schema.js'
import type { AuthenticatedUser } from '../domain/auth.js'
import { withPhase5BTestContext } from '../safety-assessments/integration-fixture.js'
import { PostgresCanonicalPouEvidenceRepository } from './repository.js'

async function confirmWhakapapa(context: any) {
  expect((await context.request(context.payload({ transcript: 'Synthetic Whakapapa reflection [scenario:all-no-concern]' }))).statusCode).toBe(202)
  const ready = await context.reviewDraftRepository.findForKaimahi(context.actor, context.workflowId)
  await context.workflowRepository.submitCommand({
    actor: context.actor,
    workflowSessionId: context.workflowId,
    command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa', reviewDraftRevisionId: ready.draft.revisionId },
  })
  return ready
}

describe('canonical confirmed Pou evidence read', () => {
  it('returns only the stable canonical snapshot, never its draft or provider inputs', async () => {
    await withPhase5BTestContext(async (context) => {
      await confirmWhakapapa(context)
      const reader = new PostgresCanonicalPouEvidenceRepository(context.connection.db)
      const before = await context.canonicalSnapshot()
      const snapshots = await context.connection.db.select().from(schema.workflowPouReviewCriterionSnapshots)
      const first = await reader.findForAuthorizedUser(context.actor, context.workflowId, 'whakapapa')
      const second = await reader.findForAuthorizedUser(context.actor, context.workflowId, 'whakapapa')

      expect(first).toEqual(second)
      expect(first).toMatchObject({ status: 'canonical_snapshot', pouId: 'whakapapa', snapshotVersion: 1 })
      expect(first?.status === 'canonical_snapshot' && first.criteria).toEqual([...snapshots]
        .sort((left: any, right: any) => left.criterionCode.localeCompare(right.criterionCode))
        .map((snapshot: any) => ({
          criterionCode: snapshot.criterionCode,
          availabilityStatus: snapshot.availabilityStatus,
          missingInformationCodes: snapshot.missingInformationCodes,
          sourceEvidenceReferences: { available: snapshot.evidenceTurnIds.length > 0, count: snapshot.evidenceTurnIds.length },
        })))
      expect(JSON.stringify(first)).not.toMatch(/Synthetic Whakapapa reflection|provider|transcript|turnIds|sourceCriterion|safety|action|referral|supervision|phq/i)
      expect(context.assessmentCallCount()).toBe(1)
      expect(await context.canonicalSnapshot()).toEqual(before)
      expect(await context.connection.db.select().from(schema.workflowPouReviewCriterionSnapshots)).toEqual(snapshots)

      const sourceSnapshot = snapshots.find((snapshot: any) => snapshot.availabilityStatus === 'evidenced')!
      await context.connection.db.execute(sql`alter table conversation_review_draft_criterion_assessment disable trigger conversation_review_draft_criterion_assessment_immutable`)
      try {
        await context.connection.db.execute(sql`update conversation_review_draft_criterion_assessment set status = 'not_applicable' where id = ${sourceSnapshot.sourceCriterionAssessmentId}`)
      } finally {
        await context.connection.db.execute(sql`alter table conversation_review_draft_criterion_assessment enable trigger conversation_review_draft_criterion_assessment_immutable`)
      }
      const [changedSource] = await context.connection.db.select().from(schema.conversationReviewDraftCriterionAssessments).where(eq(schema.conversationReviewDraftCriterionAssessments.id, sourceSnapshot.sourceCriterionAssessmentId))
      expect(changedSource!.status).toBe('not_applicable')
      expect(await reader.findForAuthorizedUser(context.actor, context.workflowId, 'whakapapa')).toEqual(first)
    })
  })

  it('reports a pre-6D review as legacy unavailable and does not manufacture a snapshot', async () => {
    await withPhase5BTestContext(async (context) => {
      const ready = await confirmWhakapapa(context)
      const [review] = await context.connection.db.select().from(schema.workflowPouReviews).where(eq(schema.workflowPouReviews.workflowSessionId, context.workflowId))
      await context.connection.db.execute(sql`alter table workflow_pou_review disable trigger workflow_pou_review_immutable`)
      try {
        await context.connection.db.update(schema.workflowPouReviews).set({ criterionSnapshotsVersion: null }).where(eq(schema.workflowPouReviews.id, review!.id))
      } finally {
        await context.connection.db.execute(sql`alter table workflow_pou_review enable trigger workflow_pou_review_immutable`)
      }
      await context.connection.db.execute(sql`alter table workflow_pou_review_criterion_snapshot disable trigger workflow_pou_review_criterion_snapshot_immutable`)
      try {
        await context.connection.db.delete(schema.workflowPouReviewCriterionSnapshots).where(eq(schema.workflowPouReviewCriterionSnapshots.workflowPouReviewId, review!.id))
      } finally {
        await context.connection.db.execute(sql`alter table workflow_pou_review_criterion_snapshot enable trigger workflow_pou_review_criterion_snapshot_immutable`)
      }
      const reader = new PostgresCanonicalPouEvidenceRepository(context.connection.db)
      await expect(reader.findForAuthorizedUser(context.actor, context.workflowId, 'whakapapa')).resolves.toMatchObject({ status: 'legacy_unavailable', snapshotVersion: null })
      expect(await context.connection.db.select().from(schema.workflowPouReviewCriterionSnapshots)).toHaveLength(0)
      expect(ready.draft).toBeTruthy()
    })
  })

  it('requires the workflow owner or a current, active explicit Supervisor relationship', async () => {
    await withPhase5BTestContext(async (context) => {
      await confirmWhakapapa(context)
      const reader = new PostgresCanonicalPouEvidenceRepository(context.connection.db)
      const supervisorId = randomUUID()
      const unassignedId = randomUUID()
      const foreignOrganisationId = randomUUID()
      const supervisor = (id: string, status: 'active' | 'inactive' = 'active'): AuthenticatedUser => ({ id, displayName: 'Supervisor', status, organisation: context.actor.organisation, roles: ['SUPERVISOR'] })
      await context.connection.db.insert(schema.appUsers).values([
        { id: supervisorId, organisationId: context.actor.organisation.id, email: `${supervisorId}@example.invalid`, displayName: 'Assigned Supervisor' },
        { id: unassignedId, organisationId: context.actor.organisation.id, email: `${unassignedId}@example.invalid`, displayName: 'Unassigned Supervisor' },
      ])
      await context.connection.db.insert(schema.roleAssignments).values([
        { userId: context.actor.id, role: 'KAIMAHI' },
        { userId: supervisorId, role: 'SUPERVISOR' },
        { userId: unassignedId, role: 'SUPERVISOR' },
      ])
      await context.connection.db.insert(schema.supervision).values({ organisationId: context.actor.organisation.id, supervisorUserId: supervisorId, kaimahiUserId: context.actor.id })

      await expect(reader.findForAuthorizedUser(context.actor, context.workflowId, 'whakapapa')).resolves.toMatchObject({ status: 'canonical_snapshot' })
      await expect(reader.findForAuthorizedUser({ ...context.actor, id: randomUUID() }, context.workflowId, 'whakapapa')).resolves.toBeNull()
      await expect(reader.findForAuthorizedUser({ ...context.actor, organisation: { id: foreignOrganisationId, slug: 'foreign', name: 'Foreign' } }, context.workflowId, 'whakapapa')).resolves.toBeNull()
      await expect(reader.findForAuthorizedUser(supervisor(supervisorId), context.workflowId, 'whakapapa')).resolves.toMatchObject({ status: 'canonical_snapshot' })
      await expect(reader.findForAuthorizedUser(supervisor(unassignedId), context.workflowId, 'whakapapa')).resolves.toBeNull()
      await expect(reader.findForAuthorizedUser(supervisor(supervisorId, 'inactive'), context.workflowId, 'whakapapa')).resolves.toBeNull()
      await context.connection.db.delete(schema.supervision).where(and(eq(schema.supervision.supervisorUserId, supervisorId), eq(schema.supervision.kaimahiUserId, context.actor.id)))
      await expect(reader.findForAuthorizedUser(supervisor(supervisorId), context.workflowId, 'whakapapa')).resolves.toBeNull()
    })
  })
})
