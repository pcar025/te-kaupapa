import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as schema from '../db/schema.js'
import { hasTestDatabaseUrl } from '../db/test-harness.js'
import { PostgresWorkflowRepository } from '../workflows/repository.js'
import { withPhase5BTestContext } from '../safety-assessments/integration-fixture.js'
import { PostgresPhq9SupervisorEscalationRepository } from './repository.js'

describe.skipIf(!hasTestDatabaseUrl())('Supervisor PHQ-9 escalation context summary', () => {
  it('returns only the explicitly confirmed persisted Kaitiakitanga context to the exact assigned Supervisor without read-side effects', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, request, payload, repository, reviewDraftRepository, assessmentCallCount }: any) => {
      const supervisorId = randomUUID()
      const unassignedSupervisorId = randomUUID()
      const foreignOrganisationId = randomUUID()
      const foreignSupervisorId = randomUUID()
      const now = new Date('2026-09-24T00:00:00.000Z')
      const escalationRepository = new PostgresPhq9SupervisorEscalationRepository(connection.db, () => now)
      const workflowRepository = new PostgresWorkflowRepository(connection.db, () => now, () => 'TK-CONTEXT-SUMMARY', repository, reviewDraftRepository, undefined, escalationRepository)

      await connection.db.insert(schema.appUsers).values([
        { id: supervisorId, organisationId: actor.organisation.id, email: `${supervisorId}@example.invalid`, displayName: 'Assigned Supervisor' },
        { id: unassignedSupervisorId, organisationId: actor.organisation.id, email: `${unassignedSupervisorId}@example.invalid`, displayName: 'Unassigned Supervisor' },
      ])
      await connection.db.insert(schema.roleAssignments).values([{ userId: actor.id, role: 'KAIMAHI' }, { userId: supervisorId, role: 'SUPERVISOR' }, { userId: unassignedSupervisorId, role: 'SUPERVISOR' }])
      await connection.db.insert(schema.supervision).values({ organisationId: actor.organisation.id, supervisorUserId: supervisorId, kaimahiUserId: actor.id })
      await connection.db.insert(schema.organisations).values({ id: foreignOrganisationId, slug: `safety-foreign-${foreignOrganisationId}`, name: 'Foreign safety fixture' })
      await connection.db.insert(schema.appUsers).values({ id: foreignSupervisorId, organisationId: foreignOrganisationId, email: `${foreignSupervisorId}@example.invalid`, displayName: 'Foreign Supervisor' })
      await connection.db.insert(schema.roleAssignments).values({ userId: foreignSupervisorId, role: 'SUPERVISOR' })

      await workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: {
        type: 'kaitiakitanga-phq9-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2,
        phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 12,
      } })
      const escalation = await escalationRepository.findForWorkflow(actor.organisation.id, workflowId)
      expect(escalation).toMatchObject({ supervisorUserId: supervisorId, status: 'queued' })

      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection with strength. [scenario:all-no-concern]' }))).statusCode).toBe(202)
      const draft = await reviewDraftRepository.findForKaimahi(actor, workflowId, 'kaitiakitanga')
      expect(draft).toMatchObject({ status: 'ready', draft: { revision: 1 } })
      const persistedSummary = 'Confirmed Kaitiakitanga context from the reviewed reflection.'
      const edited = await reviewDraftRepository.edit(actor, workflowId, {
        reviewDraftId: draft.draft.id, expectedRevision: draft.draft.revision,
        content: { overallSummary: persistedSummary, strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: draft.draft.evidenceTurnIds },
      })
      await connection.db.transaction((tx: any) => reviewDraftRepository.confirmCanonical(tx, { actor, workflowSessionId: workflowId, pouId: 'kaitiakitanga', reviewDraftRevisionId: edited.revisionId, timestamp: now }))

      const [beforeEscalation] = await connection.db.select().from(schema.workflowPhq9SupervisorEscalations).where(eq(schema.workflowPhq9SupervisorEscalations.id, escalation!.id))
      const [beforeWorkflow] = await connection.db.select().from(schema.workflowSessions).where(eq(schema.workflowSessions.id, workflowId))
      const [beforeReview] = await connection.db.select().from(schema.workflowPouReviews).where(and(eq(schema.workflowPouReviews.workflowSessionId, workflowId), eq(schema.workflowPouReviews.pouId, 'kaitiakitanga')))
      const providerCallsBeforeRead = assessmentCallCount()

      const first = await escalationRepository.findAssignedDetailToSupervisor(actor.organisation.id, supervisorId, escalation!.id)
      const second = await escalationRepository.findAssignedDetailToSupervisor(actor.organisation.id, supervisorId, escalation!.id)
      expect(first).toMatchObject({ contextSummary: persistedSummary, confirmedTotalScore: 12 })
      expect(second).toEqual(first)
      expect(await escalationRepository.findAssignedToSupervisor(actor.organisation.id, supervisorId)).toEqual([expect.not.objectContaining({ contextSummary: expect.anything() })])
      expect(first).not.toHaveProperty('transcript')
      expect(first).not.toHaveProperty('rawTurns')
      expect(first).not.toHaveProperty('phq9ItemResponses')
      expect(first).not.toHaveProperty('recipientEmail')
      expect(first).not.toHaveProperty('providerMessageId')
      expect(assessmentCallCount()).toBe(providerCallsBeforeRead)
      const [afterEscalation] = await connection.db.select().from(schema.workflowPhq9SupervisorEscalations).where(eq(schema.workflowPhq9SupervisorEscalations.id, escalation!.id))
      const [afterWorkflow] = await connection.db.select().from(schema.workflowSessions).where(eq(schema.workflowSessions.id, workflowId))
      const [afterReview] = await connection.db.select().from(schema.workflowPouReviews).where(and(eq(schema.workflowPouReviews.workflowSessionId, workflowId), eq(schema.workflowPouReviews.pouId, 'kaitiakitanga')))
      expect(afterEscalation).toEqual(beforeEscalation)
      expect(afterWorkflow).toEqual(beforeWorkflow)
      expect(afterReview).toEqual(beforeReview)

      expect(await escalationRepository.findAssignedDetailToSupervisor(actor.organisation.id, unassignedSupervisorId, escalation!.id)).toBeNull()
      expect(await escalationRepository.findAssignedDetailToSupervisor(foreignOrganisationId, foreignSupervisorId, escalation!.id)).toBeNull()
      await connection.db.update(schema.appUsers).set({ status: 'inactive' }).where(eq(schema.appUsers.id, supervisorId))
      expect(await escalationRepository.findAssignedDetailToSupervisor(actor.organisation.id, supervisorId, escalation!.id)).toBeNull()
    }, { pouId: 'kaitiakitanga' })
  }, 15_000)
})
