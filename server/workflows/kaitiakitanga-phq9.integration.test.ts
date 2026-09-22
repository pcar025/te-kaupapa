import { randomUUID } from 'node:crypto'

import { and, eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import type { AuthenticatedUser } from '../domain/auth.js'
import {
  appUsers,
  organisations,
  workflowInteractions,
  workflowKaitiakitangaPhq9Confirmations,
  workflowPouCheckpoints,
  workflowSafetyObservations,
  workflowSafetyObservationRevisions,
  workflowSafetyRuleEvaluations,
  workflowSafetyConsequences,
  workflowSessions,
} from '../db/schema.js'
import { hasTestDatabaseUrl, withMigratedTestDatabase } from '../db/test-harness.js'
import { PostgresWorkflowRepository, WorkflowNotFoundError, WorkflowValidationError } from './repository.js'
import { WorkflowTransitionError } from './domain.js'

const readiness = { verbalConsentConfirmed: true, writtenConsentConfirmed: true, initialRiskAssessmentCompleted: true }

describe.skipIf(!hasTestDatabaseUrl())('Kaitiakitanga authoritative PHQ-9 confirmation', () => {
  it('derives only the approved >=12 requirement from explicitly confirmed, scoped facts', async () => {
    const organisationId = randomUUID()
    const userId = randomUUID()
    const foreignOrganisationId = randomUUID()
    const foreignUserId = randomUUID()
    const actor: AuthenticatedUser = { id: userId, displayName: 'PHQ-9 test Kaimahi', status: 'active', organisation: { id: organisationId, slug: `phq9-${organisationId}`, name: 'PHQ-9 test organisation' }, roles: ['KAIMAHI'] }
    const foreignActor: AuthenticatedUser = { id: foreignUserId, displayName: 'Foreign Kaimahi', status: 'active', organisation: { id: foreignOrganisationId, slug: `foreign-${foreignOrganisationId}`, name: 'Foreign organisation' }, roles: ['KAIMAHI'] }
    const workflowIds: string[] = []

    await withMigratedTestDatabase(async (connection) => {
      await connection.db.insert(organisations).values([{ id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name }, { id: foreignOrganisationId, slug: foreignActor.organisation.slug, name: foreignActor.organisation.name }])
      await connection.db.insert(appUsers).values([{ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName }, { id: foreignUserId, organisationId: foreignOrganisationId, email: `${foreignUserId}@example.invalid`, displayName: foreignActor.displayName }])
      let reference = 0
      const repository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-09-22T00:00:00.000Z'), () => `TK-PHQ9-${++reference}`)

      const prepare = async () => {
        const created = await repository.createDraft({ actor, idempotencyKey: randomUUID() })
        workflowIds.push(created.workflow.id)
        await repository.submitCommand({ actor, workflowSessionId: created.workflow.id, command: {
          type: 'setup-confirmed', idempotencyKey: randomUUID(), expectedVersion: 1,
          whanauReference: 'PHQ-9', engagementType: 'home-visit', sessionFocus: 'Synthetic Kaitiakitanga reflection', immediateConcern: 'none', readiness,
        } })
        return created.workflow.id
      }
      const confirm = async (facts: { phq9Indicated: boolean; phq9Completed: boolean; confirmedTotalScore?: number }) => {
        const workflowId = await prepare()
        return { workflowId, result: await repository.submitCommand({ actor, workflowSessionId: workflowId, command: {
          type: 'kaitiakitanga-phq9-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, ...facts,
        } }) }
      }

      for (const [facts, expected] of [
        [{ phq9Indicated: false, phq9Completed: false }, { score: null, required: false }],
        [{ phq9Indicated: true, phq9Completed: false }, { score: null, required: false }],
        [{ phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 0 }, { score: 0, required: false }],
        [{ phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 11 }, { score: 11, required: false }],
        [{ phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 12 }, { score: 12, required: true }],
        [{ phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 27 }, { score: 27, required: true }],
      ] as const) {
        const { result } = await confirm(facts)
        expect(result.workflow.kaitiakitangaPhq9).toMatchObject({ confirmedTotalScore: expected.score, supervisorEscalationRequired: expected.required, ruleCode: 'PHQ9_CONFIRMED_SCORE_GTE_12_SUPERVISOR_ESCALATION', ruleVersion: 1 })
        expect(result.workflow.safety).toMatchObject({ observations: [], requiredConsequences: [] })
      }

      for (const facts of [
        { phq9Indicated: true, phq9Completed: true, confirmedTotalScore: -1 },
        { phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 28 },
        { phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 12.5 },
        { phq9Indicated: true, phq9Completed: false, confirmedTotalScore: 0 },
        { phq9Indicated: true, phq9Completed: true },
        { phq9Indicated: false, phq9Completed: true, confirmedTotalScore: 12 },
      ]) {
        const workflowId = await prepare()
        await expect(repository.submitCommand({ actor, workflowSessionId: workflowId, command: { type: 'kaitiakitanga-phq9-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, ...facts } as never })).rejects.toThrow(WorkflowValidationError)
      }

      const workflowId = await prepare()
      const idempotencyKey = randomUUID()
      const command = { type: 'kaitiakitanga-phq9-confirmed' as const, idempotencyKey, expectedVersion: 2, phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 12 }
      const accepted = await repository.submitCommand({ actor, workflowSessionId: workflowId, command })
      const replay = await repository.submitCommand({ actor, workflowSessionId: workflowId, command })
      expect(replay).toMatchObject({ replayed: true, interactionId: accepted.interactionId, workflow: { version: 3, kaitiakitangaPhq9: { supervisorEscalationRequired: true } } })
      expect(await connection.db.select().from(workflowKaitiakitangaPhq9Confirmations).where(eq(workflowKaitiakitangaPhq9Confirmations.workflowSessionId, workflowId))).toHaveLength(1)
      await expect(repository.submitCommand({ actor: foreignActor, workflowSessionId: workflowId, command: { ...command, idempotencyKey: randomUUID(), expectedVersion: 3 } })).rejects.toThrow(WorkflowNotFoundError)

      const forgedWorkflow = await prepare()
      const [unrelatedInteraction] = await connection.db.select().from(workflowInteractions).where(and(
        eq(workflowInteractions.workflowSessionId, forgedWorkflow),
        eq(workflowInteractions.type, 'setup_confirmed'),
      )).limit(1)
      await expect(connection.db.insert(workflowKaitiakitangaPhq9Confirmations).values({
        workflowSessionId: forgedWorkflow, organisationId, pouId: 'kaitiakitanga',
        phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 12, supervisorEscalationRequired: true,
        escalationRuleCode: 'PHQ9_CONFIRMED_SCORE_GTE_12_SUPERVISOR_ESCALATION', escalationRuleVersion: 1,
        confirmedByUserId: userId, confirmedAt: new Date(), interactionId: unrelatedInteraction!.id,
      })).rejects.toThrow()

      const wrongStage = await prepare()
      await repository.submitCommand({ actor, workflowSessionId: wrongStage, command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'kaitiakitanga' } })
      await expect(repository.submitCommand({ actor, workflowSessionId: wrongStage, command: { ...command, idempotencyKey: randomUUID(), expectedVersion: 3 } })).rejects.toThrow(WorkflowTransitionError)

      const safetyWorkflow = await prepare()
      await repository.submitCommand({ actor, workflowSessionId: safetyWorkflow, command: {
        type: 'safety-observation-confirmed', observationId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion: 2,
        observation: { assessmentContext: 'pou', pouId: 'kaitiakitanga', broadClass: 'whanau_safety', concernLevel: 'low' },
      } })
      const lowScore = await repository.submitCommand({ actor, workflowSessionId: safetyWorkflow, command: { type: 'kaitiakitanga-phq9-confirmed', idempotencyKey: randomUUID(), expectedVersion: 3, phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 11 } })
      expect(lowScore.workflow.safety.observations).toHaveLength(1)
      expect(lowScore.workflow.kaitiakitangaPhq9?.supervisorEscalationRequired).toBe(false)
    }, async (connection) => {
      for (const workflowId of workflowIds) {
        await connection.db.delete(workflowKaitiakitangaPhq9Confirmations).where(eq(workflowKaitiakitangaPhq9Confirmations.workflowSessionId, workflowId))
        const observations = await connection.db.select({ id: workflowSafetyObservations.id }).from(workflowSafetyObservations).where(eq(workflowSafetyObservations.workflowSessionId, workflowId))
        const observationIds = observations.map(({ id }) => id)
        if (observationIds.length > 0) {
          await connection.db.delete(workflowSafetyConsequences).where(inArray(workflowSafetyConsequences.observationId, observationIds))
          await connection.db.delete(workflowSafetyRuleEvaluations).where(inArray(workflowSafetyRuleEvaluations.observationId, observationIds))
        }
        await connection.db.delete(workflowSafetyObservationRevisions).where(eq(workflowSafetyObservationRevisions.workflowSessionId, workflowId))
        await connection.db.delete(workflowSafetyObservations).where(eq(workflowSafetyObservations.workflowSessionId, workflowId))
        await connection.db.delete(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, workflowId))
        await connection.db.delete(workflowPouCheckpoints).where(eq(workflowPouCheckpoints.workflowSessionId, workflowId))
        await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, workflowId))
      }
      await connection.db.delete(appUsers).where(and(eq(appUsers.id, userId), eq(appUsers.organisationId, organisationId)))
      await connection.db.delete(appUsers).where(and(eq(appUsers.id, foreignUserId), eq(appUsers.organisationId, foreignOrganisationId)))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
      await connection.db.delete(organisations).where(eq(organisations.id, foreignOrganisationId))
    })
  })
})
