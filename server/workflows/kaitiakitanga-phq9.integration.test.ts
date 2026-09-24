import { randomUUID } from 'node:crypto'

import { and, eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import type { AuthenticatedUser } from '../domain/auth.js'
import {
  appUsers,
  organisations,
  roleAssignments,
  supervision,
  workflowInteractions,
  workflowKaitiakitangaPhq9Confirmations,
  workflowPhq9SupervisorEscalations,
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
import { PostgresPhq9SupervisorEscalationRepository } from '../phq9-escalations/repository.js'

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
    const supervisorId = randomUUID()
    const secondSupervisorId = randomUUID()
    const inactiveSupervisorId = randomUUID()
    const inactiveKaimahiId = randomUUID()
    const unrelatedKaimahiId = randomUUID()
    const acceptanceKaimahiId = randomUUID()
    const revokedKaimahiId = randomUUID()
    const staleKaimahiId = randomUUID()
    const preSendRevokedKaimahiId = randomUUID()
    const malformedSupervisorId = randomUUID()
    const malformedRecipientKaimahiId = randomUUID()

    await withMigratedTestDatabase(async (connection) => {
      await connection.db.insert(organisations).values([{ id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name }, { id: foreignOrganisationId, slug: foreignActor.organisation.slug, name: foreignActor.organisation.name }])
      await connection.db.insert(appUsers).values([{ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName }, { id: foreignUserId, organisationId: foreignOrganisationId, email: `${foreignUserId}@example.invalid`, displayName: foreignActor.displayName }])
      await connection.db.insert(roleAssignments).values({ userId, role: 'KAIMAHI' })
      let reference = 0
      const escalationRepository = new PostgresPhq9SupervisorEscalationRepository(connection.db, () => new Date('2026-09-22T00:00:00.000Z'))
      const repository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-09-22T00:00:00.000Z'), () => `TK-PHQ9-${++reference}`, undefined, undefined, undefined, escalationRepository)

      const prepare = async (owner = actor) => {
        const created = await repository.createDraft({ actor: owner, idempotencyKey: randomUUID() })
        workflowIds.push(created.workflow.id)
        await repository.submitCommand({ actor: owner, workflowSessionId: created.workflow.id, command: {
          type: 'setup-confirmed', idempotencyKey: randomUUID(), expectedVersion: 1,
          whanauReference: 'PHQ-9', engagementType: 'home-visit', sessionFocus: 'Synthetic Kaitiakitanga reflection', immediateConcern: 'none', readiness,
        } })
        return created.workflow.id
      }
      const confirm = async (facts: { phq9Indicated: boolean; phq9Completed: boolean; confirmedTotalScore?: number }, owner = actor) => {
        const workflowId = await prepare(owner)
        return { workflowId, result: await repository.submitCommand({ actor: owner, workflowSessionId: workflowId, command: {
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
        const { workflowId, result } = await confirm(facts)
        expect(result.workflow).toMatchObject({ currentStage: 'pou-overview', currentPouId: 'kaitiakitanga' })
        expect(result.workflow.checkpoints.find((checkpoint) => checkpoint.pouId === 'kaitiakitanga')).toMatchObject({ progress: 'not_started' })
        expect(result.workflow.kaitiakitangaPhq9).toMatchObject({ confirmedTotalScore: expected.score, supervisorEscalationRequired: expected.required, ruleCode: 'PHQ9_CONFIRMED_SCORE_GTE_12_SUPERVISOR_ESCALATION', ruleVersion: 1 })
        expect(result.workflow.safety).toMatchObject({ observations: [], requiredConsequences: [] })
        const escalation = await escalationRepository.findForWorkflow(organisationId, workflowId)
        if (expected.required) expect(escalation).toMatchObject({ status: 'recipient_unresolved', attemptCount: 0 })
        else expect(escalation).toBeNull()
      }

      await connection.db.insert(appUsers).values([
        { id: supervisorId, organisationId, email: `${supervisorId}@example.invalid`, displayName: 'Active supervisor' },
        { id: secondSupervisorId, organisationId, email: `${secondSupervisorId}@example.invalid`, displayName: 'Second supervisor' },
        { id: inactiveSupervisorId, organisationId, email: `${inactiveSupervisorId}@example.invalid`, displayName: 'Inactive supervisor', status: 'inactive' },
        { id: inactiveKaimahiId, organisationId, email: `${inactiveKaimahiId}@example.invalid`, displayName: 'Inactive-supervisor Kaimahi' },
        { id: unrelatedKaimahiId, organisationId, email: `${unrelatedKaimahiId}@example.invalid`, displayName: 'Unrelated-supervisor Kaimahi' },
        { id: revokedKaimahiId, organisationId, email: `${revokedKaimahiId}@example.invalid`, displayName: 'Revoked-supervisor Kaimahi' },
        { id: staleKaimahiId, organisationId, email: `${staleKaimahiId}@example.invalid`, displayName: 'Stale-send Kaimahi' },
        { id: preSendRevokedKaimahiId, organisationId, email: `${preSendRevokedKaimahiId}@example.invalid`, displayName: 'Pre-send-revoked Kaimahi' },
        { id: malformedSupervisorId, organisationId, email: 'not-an-email', displayName: 'Malformed-address supervisor' },
        { id: malformedRecipientKaimahiId, organisationId, email: `${malformedRecipientKaimahiId}@example.invalid`, displayName: 'Malformed-recipient Kaimahi' },
      ])
      await connection.db.insert(roleAssignments).values([
        { userId: supervisorId, role: 'SUPERVISOR' }, { userId: secondSupervisorId, role: 'SUPERVISOR' }, { userId: inactiveSupervisorId, role: 'SUPERVISOR' },
        { userId: malformedSupervisorId, role: 'SUPERVISOR' }, { userId: inactiveKaimahiId, role: 'KAIMAHI' }, { userId: unrelatedKaimahiId, role: 'KAIMAHI' },
        { userId: revokedKaimahiId, role: 'KAIMAHI' }, { userId: staleKaimahiId, role: 'KAIMAHI' }, { userId: malformedRecipientKaimahiId, role: 'KAIMAHI' },
        { userId: preSendRevokedKaimahiId, role: 'KAIMAHI' },
      ])
      await connection.db.insert(supervision).values({ organisationId, supervisorUserId: supervisorId, kaimahiUserId: userId })
      const oneSupervisor = await confirm({ phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 12 })
      expect(await escalationRepository.findForWorkflow(organisationId, oneSupervisor.workflowId)).toMatchObject({ status: 'queued', supervisorUserId: supervisorId, recipientEmail: `${supervisorId}@example.invalid` })
      const assignedEscalations = await escalationRepository.findAssignedToSupervisor(organisationId, supervisorId)
      expect(assignedEscalations).toEqual([expect.objectContaining({ workflowReference: oneSupervisor.result.workflow.reference, kaimahiDisplayName: actor.displayName, status: 'queued' })])
      expect(assignedEscalations[0]).not.toHaveProperty('confirmedTotalScore')
      const assignedDetail = await escalationRepository.findAssignedDetailToSupervisor(organisationId, supervisorId, assignedEscalations[0]!.id)
      expect(assignedDetail).toMatchObject({ workflowReference: oneSupervisor.result.workflow.reference, kaimahiDisplayName: actor.displayName, confirmedTotalScore: 12, ruleCode: 'PHQ9_CONFIRMED_SCORE_GTE_12_SUPERVISOR_ESCALATION', ruleVersion: 1, status: 'queued' })
      expect(assignedDetail).not.toHaveProperty('recipientEmail')
      expect(assignedDetail).not.toHaveProperty('providerMessageId')
      expect(assignedDetail).not.toHaveProperty('transcript')
      expect(await escalationRepository.findAssignedDetailToSupervisor(organisationId, secondSupervisorId, assignedEscalations[0]!.id)).toBeNull()
      expect(await escalationRepository.findAssignedDetailToSupervisor(foreignOrganisationId, supervisorId, assignedEscalations[0]!.id)).toBeNull()
      expect(await escalationRepository.findForWorkflow(organisationId, oneSupervisor.workflowId)).toMatchObject({ status: 'queued', attemptCount: 0 })
      const firstAttempt = await escalationRepository.claimNext()
      expect(firstAttempt).toMatchObject({ workflowSessionId: oneSupervisor.workflowId, status: 'sending', attemptCount: 1 })
      await escalationRepository.failed(firstAttempt!.id, 'transient')
      expect(await escalationRepository.findForWorkflow(organisationId, oneSupervisor.workflowId)).toMatchObject({ status: 'retry_pending', attemptCount: 1 })
      const secondAttempt = await new PostgresPhq9SupervisorEscalationRepository(connection.db).claimNext()
      await escalationRepository.failed(secondAttempt!.id, 'transient')
      const finalAttempt = await escalationRepository.claimNext()
      await escalationRepository.failed(finalAttempt!.id, 'transient')
      expect(await escalationRepository.findForWorkflow(organisationId, oneSupervisor.workflowId)).toMatchObject({ status: 'failed', attemptCount: 3, failureCategory: 'transient' })
      expect(await escalationRepository.findAssignedDetailToSupervisor(organisationId, supervisorId, assignedEscalations[0]!.id)).toMatchObject({ status: 'failed' })
      expect(await connection.db.select().from(workflowPhq9SupervisorEscalations).where(eq(workflowPhq9SupervisorEscalations.workflowSessionId, oneSupervisor.workflowId))).toHaveLength(1)
      const navigationWorkflow = await confirm({ phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 12 })
      expect(await escalationRepository.findForWorkflow(organisationId, navigationWorkflow.workflowId)).toMatchObject({ status: 'queued', attemptCount: 0 })
      const advancedWhileQueued = await repository.submitCommand({ actor, workflowSessionId: navigationWorkflow.workflowId, command: {
        type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: navigationWorkflow.result.workflow.version, pouId: 'kaitiakitanga',
      } })
      expect(advancedWhileQueued.workflow).toMatchObject({ currentStage: 'pou-convo', currentPouId: 'tikanga' })
      expect(await escalationRepository.findForWorkflow(organisationId, navigationWorkflow.workflowId)).toMatchObject({ status: 'queued', attemptCount: 0 })
      const postNavigationAttempt = await escalationRepository.claimNext()
      expect(postNavigationAttempt).toMatchObject({ workflowSessionId: navigationWorkflow.workflowId, status: 'sending', attemptCount: 1 })
      await escalationRepository.providerAccepted(postNavigationAttempt!.id, 'post-navigation-provider-acceptance')
      expect(await escalationRepository.findForWorkflow(organisationId, navigationWorkflow.workflowId)).toMatchObject({ status: 'provider_accepted', attemptCount: 1 })
      await connection.db.insert(supervision).values({ organisationId, supervisorUserId: secondSupervisorId, kaimahiUserId: userId })
      expect(await escalationRepository.findAssignedDetailToSupervisor(organisationId, supervisorId, assignedEscalations[0]!.id)).toBeNull()
      const multipleSupervisors = await confirm({ phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 27 })
      expect(await escalationRepository.findForWorkflow(organisationId, multipleSupervisors.workflowId)).toMatchObject({ status: 'recipient_unresolved', supervisorUserId: null, recipientEmail: null })
      expect(await escalationRepository.findAssignedToSupervisor(organisationId, supervisorId)).toEqual([])
      await connection.db.insert(supervision).values({ organisationId, supervisorUserId: inactiveSupervisorId, kaimahiUserId: inactiveKaimahiId })
      const inactiveActor: AuthenticatedUser = { ...actor, id: inactiveKaimahiId, displayName: 'Inactive-supervisor Kaimahi' }
      const inactiveSupervisor = await confirm({ phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 12 }, inactiveActor)
      expect(await escalationRepository.findForWorkflow(organisationId, inactiveSupervisor.workflowId)).toMatchObject({ status: 'recipient_unresolved' })
      const unrelatedActor: AuthenticatedUser = { ...actor, id: unrelatedKaimahiId, displayName: 'Unrelated-supervisor Kaimahi' }
      const unrelatedSupervisor = await confirm({ phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 12 }, unrelatedActor)
      expect(await escalationRepository.findForWorkflow(organisationId, unrelatedSupervisor.workflowId)).toMatchObject({ status: 'recipient_unresolved' })
      await connection.db.insert(supervision).values([{ organisationId, supervisorUserId: supervisorId, kaimahiUserId: malformedRecipientKaimahiId }, { organisationId, supervisorUserId: malformedSupervisorId, kaimahiUserId: malformedRecipientKaimahiId }])
      const malformedRecipientActor: AuthenticatedUser = { ...actor, id: malformedRecipientKaimahiId, displayName: 'Malformed-recipient Kaimahi' }
      const malformedRecipient = await confirm({ phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 12 }, malformedRecipientActor)
      expect(await escalationRepository.findForWorkflow(organisationId, malformedRecipient.workflowId)).toMatchObject({ status: 'recipient_unresolved' })
      await connection.db.insert(supervision).values({ organisationId, supervisorUserId: supervisorId, kaimahiUserId: revokedKaimahiId })
      const revokedActor: AuthenticatedUser = { ...actor, id: revokedKaimahiId, displayName: 'Revoked-supervisor Kaimahi' }
      const revokedRecipient = await confirm({ phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 12 }, revokedActor)
      const revokedEscalation = await escalationRepository.findForWorkflow(organisationId, revokedRecipient.workflowId)
      expect(revokedEscalation).toMatchObject({ status: 'queued', supervisorUserId: supervisorId })
      expect(await escalationRepository.findAssignedDetailToSupervisor(organisationId, supervisorId, revokedEscalation!.id)).toMatchObject({ confirmedTotalScore: 12, status: 'queued' })
      await connection.db.delete(supervision).where(and(eq(supervision.organisationId, organisationId), eq(supervision.supervisorUserId, supervisorId), eq(supervision.kaimahiUserId, revokedKaimahiId)))
      expect(await escalationRepository.findAssignedDetailToSupervisor(organisationId, supervisorId, revokedEscalation!.id)).toBeNull()
      expect(await escalationRepository.findForWorkflow(organisationId, revokedRecipient.workflowId)).toMatchObject({ status: 'queued', supervisorUserId: supervisorId })
      expect(await escalationRepository.claimNext()).toBeNull()
      expect(await escalationRepository.findForWorkflow(organisationId, revokedRecipient.workflowId)).toMatchObject({ status: 'recipient_unresolved', supervisorUserId: null, recipientEmail: null })
      await connection.db.insert(supervision).values({ organisationId, supervisorUserId: supervisorId, kaimahiUserId: preSendRevokedKaimahiId })
      const preSendRevokedActor: AuthenticatedUser = { ...actor, id: preSendRevokedKaimahiId, displayName: 'Pre-send-revoked Kaimahi' }
      const preSendRevoked = await confirm({ phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 12 }, preSendRevokedActor)
      const preSendAttempt = await escalationRepository.claimNext()
      await connection.db.delete(supervision).where(and(eq(supervision.organisationId, organisationId), eq(supervision.supervisorUserId, supervisorId), eq(supervision.kaimahiUserId, preSendRevokedKaimahiId)))
      expect(await escalationRepository.revalidateClaimedRecipient(preSendAttempt!.id)).toBe(false)
      expect(await escalationRepository.findForWorkflow(organisationId, preSendRevoked.workflowId)).toMatchObject({ status: 'recipient_unresolved', supervisorUserId: null, recipientEmail: null })
      await connection.db.insert(supervision).values({ organisationId, supervisorUserId: supervisorId, kaimahiUserId: staleKaimahiId })
      const staleActor: AuthenticatedUser = { ...actor, id: staleKaimahiId, displayName: 'Stale-send Kaimahi' }
      const staleRecipient = await confirm({ phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 12 }, staleActor)
      const staleAttempt = await escalationRepository.claimNext()
      expect(staleAttempt).toMatchObject({ workflowSessionId: staleRecipient.workflowId, status: 'sending' })
      const recoveryRepository = new PostgresPhq9SupervisorEscalationRepository(connection.db, () => new Date('2026-09-22T00:06:00.000Z'))
      await recoveryRepository.recoverStaleSending()
      expect(await recoveryRepository.findForWorkflow(organisationId, staleRecipient.workflowId)).toMatchObject({ status: 'failed', failureCategory: 'ambiguous', attemptCount: 1 })
      expect(await recoveryRepository.claimNext()).toBeNull()
      await connection.db.insert(appUsers).values({ id: acceptanceKaimahiId, organisationId, email: `${acceptanceKaimahiId}@example.invalid`, displayName: 'Provider-acceptance Kaimahi' })
      await connection.db.insert(roleAssignments).values({ userId: acceptanceKaimahiId, role: 'KAIMAHI' })
      await connection.db.insert(supervision).values({ organisationId, supervisorUserId: supervisorId, kaimahiUserId: acceptanceKaimahiId })
      const acceptanceActor: AuthenticatedUser = { ...actor, id: acceptanceKaimahiId, displayName: 'Provider-acceptance Kaimahi' }
      const providerAcceptance = await confirm({ phq9Indicated: true, phq9Completed: true, confirmedTotalScore: 12 }, acceptanceActor)
      const acceptanceAttempt = await escalationRepository.claimNext()
      await escalationRepository.providerAccepted(acceptanceAttempt!.id, 'synthetic-ses-message-id')
      expect(await escalationRepository.findForWorkflow(organisationId, providerAcceptance.workflowId)).toMatchObject({ status: 'provider_accepted', providerMessageId: 'synthetic-ses-message-id', attemptCount: 1 })
      const providerAcceptedDetail = await escalationRepository.findAssignedDetailToSupervisor(organisationId, supervisorId, acceptanceAttempt!.id)
      expect(providerAcceptedDetail).toMatchObject({ workflowReference: providerAcceptance.result.workflow.reference, confirmedTotalScore: 12, status: 'provider_accepted' })
      expect(providerAcceptedDetail).not.toHaveProperty('providerMessageId')
      await connection.db.update(appUsers).set({ status: 'inactive' }).where(eq(appUsers.id, supervisorId))
      expect(await escalationRepository.findAssignedToSupervisor(organisationId, supervisorId)).toEqual([])
      expect(await escalationRepository.findAssignedDetailToSupervisor(organisationId, supervisorId, acceptanceAttempt!.id)).toBeNull()
      await expect(connection.db.update(workflowPhq9SupervisorEscalations).set({ providerMessageId: null }).where(eq(workflowPhq9SupervisorEscalations.id, acceptanceAttempt!.id))).rejects.toThrow()
      await expect(connection.db.update(workflowPhq9SupervisorEscalations).set({ status: 'failed', providerMessageId: null, providerAcceptedAt: null, failureCategory: 'unbounded' as never }).where(eq(workflowPhq9SupervisorEscalations.id, acceptanceAttempt!.id))).rejects.toThrow()
      await expect(connection.db.update(workflowPhq9SupervisorEscalations).set({ status: 'retry_pending', providerMessageId: null, providerAcceptedAt: null, failureCategory: null }).where(eq(workflowPhq9SupervisorEscalations.id, acceptanceAttempt!.id))).rejects.toThrow()
      await expect(connection.db.insert(supervision).values({ organisationId, supervisorUserId: foreignUserId, kaimahiUserId: userId })).rejects.toThrow()

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
      const acceptedInteractions = await connection.db.select({ type: workflowInteractions.type }).from(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, workflowId))
      expect(replay).toMatchObject({ replayed: true, interactionId: accepted.interactionId, workflow: { version: 3, kaitiakitangaPhq9: { supervisorEscalationRequired: true } } })
      expect(acceptedInteractions.map((interaction) => interaction.type).sort()).toEqual(['workflow_created', 'setup_confirmed', 'kaitiakitanga_phq9_confirmed'].sort())
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
      await expect(connection.db.insert(workflowPhq9SupervisorEscalations).values({
        organisationId, workflowSessionId: forgedWorkflow, pouId: 'kaitiakitanga', phq9ConfirmationInteractionId: unrelatedInteraction!.id,
        ruleCode: 'PHQ9_CONFIRMED_SCORE_GTE_12_SUPERVISOR_ESCALATION', ruleVersion: 1, kaimahiUserId: userId,
        status: 'recipient_unresolved', createdAt: new Date(), updatedAt: new Date(),
      })).rejects.toThrow()

      const wrongStage = await prepare()
      await expect(repository.submitCommand({ actor, workflowSessionId: wrongStage, command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'kaitiakitanga' } })).rejects.toThrow('PHQ-9 details must be explicitly confirmed')
      await repository.submitCommand({ actor, workflowSessionId: wrongStage, command: { ...command, idempotencyKey: randomUUID(), expectedVersion: 2 } })
      const advanced = await repository.submitCommand({ actor, workflowSessionId: wrongStage, command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 3, pouId: 'kaitiakitanga' } })
      expect(advanced.workflow).toMatchObject({ currentStage: 'pou-convo', currentPouId: 'tikanga' })
      await expect(repository.submitCommand({ actor, workflowSessionId: wrongStage, command: { ...command, idempotencyKey: randomUUID(), expectedVersion: 4 } })).rejects.toThrow(WorkflowTransitionError)

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
        await connection.db.delete(workflowPhq9SupervisorEscalations).where(eq(workflowPhq9SupervisorEscalations.workflowSessionId, workflowId))
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
      await connection.db.delete(supervision).where(eq(supervision.organisationId, organisationId))
      await connection.db.delete(roleAssignments).where(inArray(roleAssignments.userId, [userId, supervisorId, secondSupervisorId, inactiveSupervisorId, inactiveKaimahiId, unrelatedKaimahiId, acceptanceKaimahiId, revokedKaimahiId, staleKaimahiId, preSendRevokedKaimahiId, malformedSupervisorId, malformedRecipientKaimahiId]))
      await connection.db.delete(appUsers).where(inArray(appUsers.id, [supervisorId, secondSupervisorId, inactiveSupervisorId, inactiveKaimahiId, unrelatedKaimahiId, acceptanceKaimahiId, revokedKaimahiId, staleKaimahiId, preSendRevokedKaimahiId, malformedSupervisorId, malformedRecipientKaimahiId]))
      await connection.db.delete(appUsers).where(and(eq(appUsers.id, userId), eq(appUsers.organisationId, organisationId)))
      await connection.db.delete(appUsers).where(and(eq(appUsers.id, foreignUserId), eq(appUsers.organisationId, foreignOrganisationId)))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
      await connection.db.delete(organisations).where(eq(organisations.id, foreignOrganisationId))
    })
  }, 15_000)
})
