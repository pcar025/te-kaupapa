import { randomUUID } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as schema from '../db/schema.js'
import type { AuthenticatedUser } from '../domain/auth.js'
import { withPhase5BTestContext } from '../safety-assessments/integration-fixture.js'
import { CanonicalPouEvidenceSourceIntegrityError, PostgresCanonicalCriterionSourceEvidenceRepository } from './repository.js'

async function confirmedEvidenceFixture(context: any) {
  expect((await context.request(context.payload({ transcript: [
    { role: 'user', message: 'Synthetic Whakapapa reflection with strength and cultural connection. [scenario:all-no-concern]' },
    { role: 'agent', message: 'Unrelated supporting turn that must not be returned.' },
  ] }))).statusCode).toBe(202)
  const ready = await context.reviewDraftRepository.findForKaimahi(context.actor, context.workflowId)
  await context.workflowRepository.submitCommand({
    actor: context.actor,
    workflowSessionId: context.workflowId,
    command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa', reviewDraftRevisionId: ready.draft.revisionId },
  })
  const [review] = await context.connection.db.select().from(schema.workflowPouReviews).where(eq(schema.workflowPouReviews.workflowSessionId, context.workflowId))
  const [snapshot] = await context.connection.db.select().from(schema.workflowPouReviewCriterionSnapshots).where(and(
    eq(schema.workflowPouReviewCriterionSnapshots.workflowPouReviewId, review!.id),
    eq(schema.workflowPouReviewCriterionSnapshots.availabilityStatus, 'evidenced'),
  ))
  return { review: review!, snapshot: snapshot! }
}

describe('canonical criterion source-evidence drill-down', () => {
  it('returns only the snapshot-referenced turn and writes text-free sensitive-read audit rows', async () => {
    await withPhase5BTestContext(async (context) => {
      const { snapshot } = await confirmedEvidenceFixture(context)
      const reader = new PostgresCanonicalCriterionSourceEvidenceRepository(context.connection.db, () => new Date('2026-09-27T00:00:00.000Z'))
      const before = await context.canonicalSnapshot()
      const result = await reader.findAndAuditForAuthorizedUser({ actor: context.actor, workflowSessionId: context.workflowId, pouId: 'whakapapa', criterionCode: snapshot.criterionCode, requestId: 'source-evidence-owner' })

      expect(result).toMatchObject({ criterionCode: snapshot.criterionCode, pouId: 'whakapapa', excerpts: [{ ordinal: 1, speaker: 'kaimahi', text: 'Synthetic Whakapapa reflection with strength and cultural connection. [scenario:all-no-concern]' }] })
      expect(JSON.stringify(result)).not.toContain('Unrelated supporting turn')
      expect(result?.excerpts).toHaveLength((snapshot.evidenceTurnIds as string[]).length)
      expect(await context.canonicalSnapshot()).toEqual(before)
      expect(context.assessmentCallCount()).toBe(1)

      const audits = await context.connection.db.select().from(schema.workflowCriterionSourceEvidenceAccessAudits).where(eq(schema.workflowCriterionSourceEvidenceAccessAudits.workflowSessionId, context.workflowId))
      expect(audits).toHaveLength(1)
      expect(audits[0]).toMatchObject({
        eventType: 'criterion_source_evidence_viewed', actorUserId: context.actor.id, actorRole: 'KAIMAHI', organisationId: context.actor.organisation.id,
        targetKaimahiUserId: context.actor.id, pouId: 'whakapapa', criterionSnapshotId: snapshot.id, criterionCode: snapshot.criterionCode,
        referencedTurnIds: snapshot.evidenceTurnIds, referencedTurnCount: (snapshot.evidenceTurnIds as string[]).length, outcome: 'success', requestId: 'source-evidence-owner',
      })
      expect(JSON.stringify(audits[0])).not.toContain('Synthetic Whakapapa reflection')
      expect(JSON.stringify(audits[0])).not.toContain('Unrelated supporting turn')

      await expect(reader.findAndAuditForAuthorizedUser({ actor: context.actor, workflowSessionId: context.workflowId, pouId: 'whakapapa', criterionCode: snapshot.criterionCode, requestId: '' })).rejects.toThrow()
      expect(await context.connection.db.select().from(schema.workflowCriterionSourceEvidenceAccessAudits).where(eq(schema.workflowCriterionSourceEvidenceAccessAudits.workflowSessionId, context.workflowId))).toHaveLength(1)
    })
  })

  it('allows only the owner or an active explicitly assigned Supervisor and audits both successful roles', async () => {
    await withPhase5BTestContext(async (context) => {
      const { snapshot } = await confirmedEvidenceFixture(context)
      const reader = new PostgresCanonicalCriterionSourceEvidenceRepository(context.connection.db)
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

      await expect(reader.findAndAuditForAuthorizedUser({ actor: { ...context.actor, id: randomUUID() }, workflowSessionId: context.workflowId, pouId: 'whakapapa', criterionCode: snapshot.criterionCode, requestId: 'other-kaimahi' })).resolves.toBeNull()
      await expect(reader.findAndAuditForAuthorizedUser({ actor: { ...context.actor, organisation: { id: foreignOrganisationId, slug: 'foreign', name: 'Foreign' } }, workflowSessionId: context.workflowId, pouId: 'whakapapa', criterionCode: snapshot.criterionCode, requestId: 'foreign-kaimahi' })).resolves.toBeNull()
      await expect(reader.findAndAuditForAuthorizedUser({ actor: supervisor(unassignedId), workflowSessionId: context.workflowId, pouId: 'whakapapa', criterionCode: snapshot.criterionCode, requestId: 'unassigned' })).resolves.toBeNull()
      await expect(reader.findAndAuditForAuthorizedUser({ actor: supervisor(supervisorId, 'inactive'), workflowSessionId: context.workflowId, pouId: 'whakapapa', criterionCode: snapshot.criterionCode, requestId: 'inactive' })).resolves.toBeNull()
      const assigned = await reader.findAndAuditForAuthorizedUser({ actor: supervisor(supervisorId), workflowSessionId: context.workflowId, pouId: 'whakapapa', criterionCode: snapshot.criterionCode, requestId: 'assigned-supervisor' })
      expect(assigned?.excerpts).toHaveLength(1)
      await context.connection.db.delete(schema.supervision).where(and(eq(schema.supervision.supervisorUserId, supervisorId), eq(schema.supervision.kaimahiUserId, context.actor.id)))
      await expect(reader.findAndAuditForAuthorizedUser({ actor: supervisor(supervisorId), workflowSessionId: context.workflowId, pouId: 'whakapapa', criterionCode: snapshot.criterionCode, requestId: 'revoked' })).resolves.toBeNull()
      expect((await context.connection.db.select({ actorRole: schema.workflowCriterionSourceEvidenceAccessAudits.actorRole }).from(schema.workflowCriterionSourceEvidenceAccessAudits))).toEqual([{ actorRole: 'SUPERVISOR' }])
    })
  })

  it('fails closed for legacy, arbitrary or inconsistent source references without reconstructing evidence', async () => {
    await withPhase5BTestContext(async (context) => {
      const { review, snapshot } = await confirmedEvidenceFixture(context)
      const reader = new PostgresCanonicalCriterionSourceEvidenceRepository(context.connection.db)
      await context.connection.db.execute(sql`alter table workflow_pou_review disable trigger workflow_pou_review_immutable`)
      try {
        await context.connection.db.update(schema.workflowPouReviews).set({ criterionSnapshotsVersion: null }).where(eq(schema.workflowPouReviews.id, review.id))
      } finally {
        await context.connection.db.execute(sql`alter table workflow_pou_review enable trigger workflow_pou_review_immutable`)
      }
      await expect(reader.findAndAuditForAuthorizedUser({ actor: context.actor, workflowSessionId: context.workflowId, pouId: 'whakapapa', criterionCode: snapshot.criterionCode, requestId: 'legacy' })).resolves.toBeNull()

      await context.connection.db.execute(sql`alter table workflow_pou_review disable trigger workflow_pou_review_immutable`)
      await context.connection.db.execute(sql`alter table workflow_pou_review_criterion_snapshot disable trigger workflow_pou_review_criterion_snapshot_immutable`)
      await context.connection.db.execute(sql`alter table workflow_pou_review_criterion_snapshot disable trigger workflow_pou_review_criterion_snapshot_source_provenance`)
      try {
        await context.connection.db.update(schema.workflowPouReviews).set({ criterionSnapshotsVersion: 1 }).where(eq(schema.workflowPouReviews.id, review.id))
        await context.connection.db.update(schema.workflowPouReviewCriterionSnapshots).set({ evidenceTurnIds: [randomUUID()] }).where(eq(schema.workflowPouReviewCriterionSnapshots.id, snapshot.id))
      } finally {
        await context.connection.db.execute(sql`alter table workflow_pou_review enable trigger workflow_pou_review_immutable`)
        await context.connection.db.execute(sql`alter table workflow_pou_review_criterion_snapshot enable trigger workflow_pou_review_criterion_snapshot_immutable`)
        await context.connection.db.execute(sql`alter table workflow_pou_review_criterion_snapshot enable trigger workflow_pou_review_criterion_snapshot_source_provenance`)
      }
      await expect(reader.findAndAuditForAuthorizedUser({ actor: context.actor, workflowSessionId: context.workflowId, pouId: 'whakapapa', criterionCode: snapshot.criterionCode, requestId: 'forged-turn' })).rejects.toBeInstanceOf(CanonicalPouEvidenceSourceIntegrityError)
      expect(await context.connection.db.select().from(schema.workflowCriterionSourceEvidenceAccessAudits)).toHaveLength(0)
    })
  })
})
