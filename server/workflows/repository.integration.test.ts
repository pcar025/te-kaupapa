import { randomUUID } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import type { AuthenticatedUser } from '../domain/auth.js'
import {
  appUsers,
  organisations,
  workflowActions,
  workflowInteractions,
  workflowPouCheckpoints,
  workflowReferrals,
  workflowSafetyConsequences,
  workflowSafetyObservationRevisions,
  workflowSafetyObservations,
  workflowSafetyRuleEvaluations,
  workflowSessions,
  workflowSupervisorReviewRequests,
} from '../db/schema.js'
import { getTestDatabaseUrl, hasTestDatabaseUrl, withMigratedTestDatabase } from '../db/test-harness.js'
import { createDatabaseConnection, type DatabaseConnection } from '../db/repository.js'
import { PostgresWorkflowSynthesisRepository } from '../workflow-synthesis/repository.js'
import type { WorkflowSynthesisProvider } from '../workflow-synthesis/provider.js'
import {
  IdempotencyKeyReuseError,
  PostgresWorkflowRepository,
  StaleWorkflowError,
  StaleSafetyObservationError,
} from './repository.js'
import { WorkflowReadinessError, WorkflowTransitionError } from './domain.js'
import { SAFETY_RULE_CODE, SAFETY_RULE_VERSION } from '../safety/domain.js'

const INTERACTION_GATE_LOCK_ID = 724188219

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForBlockedDatabaseWork(connection: DatabaseConnection) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await connection.db.execute(sql`select count(*)::int as count from pg_locks where not granted`)
    if (Number((result.rows[0] as { count?: number | string } | undefined)?.count ?? 0) >= 2) return
    await pause(10)
  }
  throw new Error('Expected both concurrent safety requests to be blocked before releasing the test gate.')
}

describe.skipIf(!hasTestDatabaseUrl())('PostgreSQL workflow repository integration', () => {
  it('creates independent resumable workflows and preserves retry, scoping, and stale-state guarantees', async () => {
    const organisationId = randomUUID()
    const userId = randomUUID()
    const foreignOrganisationId = randomUUID()
    const foreignUserId = randomUUID()
    const actor: AuthenticatedUser = {
      id: userId,
      displayName: 'Workflow test Kaimahi',
      status: 'active',
      organisation: { id: organisationId, slug: `workflow-${organisationId}`, name: 'Workflow test organisation' },
      roles: ['KAIMAHI'],
    }
    let workflowId: string | undefined
    let independentWorkflowId: string | undefined
    await withMigratedTestDatabase(async (connection) => {
      await connection.db.insert(organisations).values({ id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name })
      await connection.db.insert(appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName })
      const references = ['TK-7K4M2P9Q', 'TK-9Q2M4K7P']
      const repository = new PostgresWorkflowRepository(
        connection.db,
        () => new Date('2026-08-10T00:00:00.000Z'),
        () => references.shift()!,
      )
      const createKey = randomUUID()
      const created = await repository.createDraft({ actor, idempotencyKey: createKey })
      workflowId = created.workflow.id
      expect(created).toMatchObject({ replayed: false, workflow: { reference: 'TK-7K4M2P9Q', status: 'draft', version: 1 } })
      expect(created.workflow.readiness).toEqual({ verbalConsentConfirmed: false, writtenConsentConfirmed: false, initialRiskAssessmentCompleted: false })
      expect(created.workflow.checkpoints).toHaveLength(7)

      const replayedCreate = await repository.createDraft({ actor, idempotencyKey: createKey })
      expect(replayedCreate).toMatchObject({ replayed: true, interactionId: created.interactionId, workflow: { id: workflowId, version: 1 } })

      await expect(repository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'setup-confirmed', idempotencyKey: randomUUID(), expectedVersion: 1,
          whanauReference: 'TW-04', engagementType: 'home-visit', sessionFocus: 'Whānau support discussion', immediateConcern: 'none',
          readiness: { verbalConsentConfirmed: true, writtenConsentConfirmed: false, initialRiskAssessmentCompleted: true },
        },
      })).rejects.toThrow(WorkflowReadinessError)
      expect(await repository.findById(actor, workflowId)).toMatchObject({ status: 'draft', currentStage: 'setup', version: 1, readiness: { verbalConsentConfirmed: false, writtenConsentConfirmed: false, initialRiskAssessmentCompleted: false } })

      const setup = await repository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'setup-confirmed',
          idempotencyKey: randomUUID(),
          expectedVersion: 1,
          whanauReference: '  TW-04  ',
          engagementType: 'home-visit',
          sessionFocus: 'Whānau support discussion',
          additionalNotes: 'A short acknowledged note.',
          immediateConcern: 'none',
          readiness: { verbalConsentConfirmed: true, writtenConsentConfirmed: true, initialRiskAssessmentCompleted: true },
        },
      })
      expect(setup).toMatchObject({ replayed: false, workflow: { version: 2, status: 'in_progress', currentStage: 'pou-overview', currentPouId: 'kaitiakitanga' } })
      expect(setup.workflow.setup?.whanauReference).toBe('TW-04')
      expect(setup.workflow.readiness).toEqual({ verbalConsentConfirmed: true, writtenConsentConfirmed: true, initialRiskAssessmentCompleted: true })

      const revisedSetup = await repository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'setup-confirmed',
          idempotencyKey: randomUUID(),
          expectedVersion: 2,
          whanauReference: 'TW-04',
          engagementType: 'home-visit',
          sessionFocus: 'Updated whānau support discussion',
          immediateConcern: 'none',
          readiness: { verbalConsentConfirmed: true, writtenConsentConfirmed: true, initialRiskAssessmentCompleted: true },
        },
      })
      expect(revisedSetup).toMatchObject({ replayed: false, workflow: { version: 3, currentStage: 'pou-overview', currentPouId: 'kaitiakitanga' } })

      await expect(repository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'pou-review-confirmed',
          idempotencyKey: randomUUID(),
          expectedVersion: 1,
          pouId: 'kaitiakitanga',
          note: 'A confirmed human observation.',
        },
      })).rejects.toThrow(StaleWorkflowError)

      const pouKey = randomUUID()
      const pou = await repository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'pou-review-confirmed',
          idempotencyKey: pouKey,
          expectedVersion: 3,
          pouId: 'kaitiakitanga',
          note: 'A confirmed human observation.',
        },
      })
      expect(pou).toMatchObject({ replayed: false, workflow: { version: 4, currentStage: 'pou-convo', currentPouId: 'tikanga' } })
      expect(pou.workflow.checkpoints[0]).toMatchObject({
        progress: 'confirmed',
        // Ordinary narrative confirmation no longer carries concern or
        // escalation semantics; those require a separate safety command.
        userSelectedConcern: null,
        referralSuggested: false,
        supervisorReviewSuggested: false,
      })

      const independent = await repository.createDraft({ actor, idempotencyKey: randomUUID() })
      independentWorkflowId = independent.workflow.id
      expect(independent).toMatchObject({
        replayed: false,
        workflow: {
          reference: 'TK-9Q2M4K7P', status: 'draft', currentStage: 'setup', currentPouId: null, version: 1,
          setup: null, actions: [], referrals: [], safety: { observations: [], requiredConsequences: [], supervisorReviewRequests: [] },
        },
      })
      expect(independent.workflow.id).not.toBe(workflowId)
      expect(independent.workflow.checkpoints).toHaveLength(7)
      expect(independent.workflow.checkpoints.every((checkpoint) => checkpoint.progress === 'not_started')).toBe(true)
      const preserved = await repository.findById(actor, workflowId)
      expect(preserved).toMatchObject({
        id: workflowId, status: 'in_progress', currentStage: 'pou-convo', currentPouId: 'tikanga', version: 4,
        readiness: { verbalConsentConfirmed: true, writtenConsentConfirmed: true, initialRiskAssessmentCompleted: true },
      })
      expect(preserved?.checkpoints.find((checkpoint) => checkpoint.pouId === 'kaitiakitanga')).toMatchObject({ progress: 'confirmed' })
      expect((await repository.listResumable(actor)).map((workflow) => workflow.id)).toEqual(expect.arrayContaining([workflowId, independentWorkflowId]))

      const foreignActor: AuthenticatedUser = {
        id: foreignUserId,
        displayName: 'Foreign organisation Kaimahi',
        status: 'active',
        organisation: { id: foreignOrganisationId, slug: `foreign-${foreignOrganisationId}`, name: 'Foreign organisation' },
        roles: ['KAIMAHI'],
      }
      await connection.db.insert(organisations).values({ id: foreignOrganisationId, slug: foreignActor.organisation.slug, name: foreignActor.organisation.name })
      await connection.db.insert(appUsers).values({ id: foreignUserId, organisationId: foreignOrganisationId, email: `${foreignUserId}@example.invalid`, displayName: foreignActor.displayName })
      await expect(repository.findById(foreignActor, workflowId)).resolves.toBeNull()

      const replayedPou = await repository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'pou-review-confirmed',
          idempotencyKey: pouKey,
          expectedVersion: 3,
          pouId: 'kaitiakitanga',
          note: 'A confirmed human observation.',
        },
      })
      expect(replayedPou).toMatchObject({ replayed: true, workflow: { version: 4 } })
      await expect(repository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'pou-review-confirmed',
          idempotencyKey: pouKey,
          expectedVersion: 4,
          pouId: 'kaitiakitanga',
          note: 'Changed request using the same key.',
        },
      })).rejects.toThrow(IdempotencyKeyReuseError)
    }, async (connection) => {
      for (const id of [workflowId, independentWorkflowId].filter((value): value is string => Boolean(value))) {
        await connection.db.delete(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, id))
        await connection.db.delete(workflowActions).where(eq(workflowActions.workflowSessionId, id))
        await connection.db.delete(workflowReferrals).where(eq(workflowReferrals.workflowSessionId, id))
        await connection.db.delete(workflowPouCheckpoints).where(eq(workflowPouCheckpoints.workflowSessionId, id))
        await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, id))
      }
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
      await connection.db.delete(appUsers).where(eq(appUsers.id, foreignUserId))
      await connection.db.delete(organisations).where(eq(organisations.id, foreignOrganisationId))
    })
  })

  it('keeps a completed workflow created before this gate readable without inferring readiness confirmations', async () => {
    const organisationId = randomUUID()
    const userId = randomUUID()
    const workflowId = randomUUID()
    const actor: AuthenticatedUser = {
      id: userId,
      displayName: 'Legacy workflow Kaimahi',
      status: 'active',
      organisation: { id: organisationId, slug: `legacy-${organisationId}`, name: 'Legacy workflow organisation' },
      roles: ['KAIMAHI'],
    }
    await withMigratedTestDatabase(async (connection) => {
      const timestamp = new Date('2026-08-10T00:00:00.000Z')
      await connection.db.insert(organisations).values({ id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name })
      await connection.db.insert(appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName })
      await connection.db.insert(workflowSessions).values({
        id: workflowId, organisationId, kaimahiUserId: userId, reference: 'TK-LEGACY',
        status: 'completed', currentStage: 'complete', version: 9,
        setupConfirmedAt: timestamp, completedAt: timestamp, completedByUserId: userId,
        createdAt: timestamp, updatedAt: timestamp,
      })

      const workflow = await new PostgresWorkflowRepository(connection.db).findById(actor, workflowId)
      expect(workflow).toMatchObject({ id: workflowId, status: 'completed', currentStage: 'complete', version: 9 })
      expect(workflow?.readiness).toEqual({ verbalConsentConfirmed: false, writtenConsentConfirmed: false, initialRiskAssessmentCompleted: false })
    }, async (connection) => {
      await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, workflowId))
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
    })
  })

  it('continues an in-progress historic workflow using its persisted Pou ordinals', async () => {
    const organisationId = randomUUID()
    const userId = randomUUID()
    const workflowId = randomUUID()
    const actor: AuthenticatedUser = {
      id: userId,
      displayName: 'Historic journey Kaimahi',
      status: 'active',
      organisation: { id: organisationId, slug: `historic-${organisationId}`, name: 'Historic journey organisation' },
      roles: ['KAIMAHI'],
    }
    const historicPouOrder = ['whakapapa', 'manaakitanga', 'tikanga', 'kaitiakitanga', 'puukenga', 'haepapa', 'oranga'] as const
    const timestamp = new Date('2026-08-10T00:00:00.000Z')

    await withMigratedTestDatabase(async (connection) => {
      await connection.db.insert(organisations).values({ id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name })
      await connection.db.insert(appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName })
      await connection.db.insert(workflowSessions).values({
        id: workflowId, organisationId, kaimahiUserId: userId, reference: 'TK-HISTORIC',
        status: 'in_progress', currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 3,
        setupConfirmedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
      })
      await connection.db.insert(workflowPouCheckpoints).values(historicPouOrder.map((pouId, index) => ({
        workflowSessionId: workflowId,
        organisationId,
        pouId,
        ordinal: index + 1,
        progress: index === 0 ? 'confirmed' as const : 'not_started' as const,
        confirmedByUserId: index === 0 ? userId : null,
        confirmedAt: index === 0 ? timestamp : null,
        updatedAt: timestamp,
      })))

      const repository = new PostgresWorkflowRepository(connection.db, () => timestamp)
      expect(await repository.findById(actor, workflowId)).toMatchObject({
        currentStage: 'pou-convo', currentPouId: 'manaakitanga',
        checkpoints: expect.arrayContaining([
          expect.objectContaining({ pouId: 'whakapapa', ordinal: 1, progress: 'confirmed' }),
          expect.objectContaining({ pouId: 'manaakitanga', ordinal: 2, progress: 'not_started' }),
        ]),
      })

      const advanced = await repository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 3, pouId: 'manaakitanga' },
      })
      expect(advanced.workflow).toMatchObject({ currentStage: 'pou-convo', currentPouId: 'tikanga', version: 4 })
      expect(advanced.workflow.checkpoints).toEqual(expect.arrayContaining([
        expect.objectContaining({ pouId: 'whakapapa', ordinal: 1, progress: 'confirmed' }),
        expect.objectContaining({ pouId: 'manaakitanga', ordinal: 2, progress: 'confirmed' }),
      ]))
    }, async (connection) => {
      await connection.db.delete(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, workflowId))
      await connection.db.delete(workflowPouCheckpoints).where(eq(workflowPouCheckpoints.workflowSessionId, workflowId))
      await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, workflowId))
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
    })
  })

  it('persists the complete manual downstream plan, preserves withdrawals, and freezes it on completion', async () => {
    const organisationId = randomUUID()
    const userId = randomUUID()
    const actor: AuthenticatedUser = {
      id: userId,
      displayName: 'Workflow completion Kaimahi',
      status: 'active',
      organisation: { id: organisationId, slug: `complete-${organisationId}`, name: 'Completion test organisation' },
      roles: ['KAIMAHI'],
    }
    let workflowId: string | undefined
    let nextWorkflowId: string | undefined
    await withMigratedTestDatabase(async (connection) => {
      await connection.db.insert(organisations).values({ id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name })
      await connection.db.insert(appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName })
      const now = new Date('2026-08-10T00:00:00.000Z')
      const syntheses = new PostgresWorkflowSynthesisRepository(connection.db, () => now)
      const repository = new PostgresWorkflowRepository(connection.db, () => now, undefined, undefined, undefined, syntheses)
      const created = await repository.createDraft({ actor, idempotencyKey: randomUUID() })
      workflowId = created.workflow.id
      let version = created.workflow.version

      const setup = await repository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'setup-confirmed', idempotencyKey: randomUUID(), expectedVersion: version,
          whanauReference: 'TW-41', engagementType: 'hui', sessionFocus: 'Kaimahi-confirmed workflow completion', immediateConcern: 'none', readiness: { verbalConsentConfirmed: true, writtenConsentConfirmed: true, initialRiskAssessmentCompleted: true },
        },
      })
      version = setup.workflow.version
      let workflow = setup.workflow
      for (const pouId of ['kaitiakitanga', 'tikanga', 'whakapapa', 'manaakitanga', 'puukenga', 'haepapa', 'oranga'] as const) {
        const result = await repository.submitCommand({
          actor,
          workflowSessionId: workflowId,
          command: {
            type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: version, pouId,
            note: `${pouId} confirmed by the Kaimahi`,
          },
        })
        version = result.workflow.version
        workflow = result.workflow
      }

      const provider: WorkflowSynthesisProvider = {
        generateWorkflowSynthesis: async () => ({
          content: {
            overallSummary: 'Manual downstream-plan synthesis.', keyThemes: null,
            strengthsSummary: null, areasForAttentionSummary: null,
            informationStillToExploreSummary: null,
            confirmedSafetyConcernsSummary: 'No human-confirmed safety concerns are recorded.',
          },
          provider: 'test', model: 'test-model', configurationHash: 'a'.repeat(64), schemaVersion: '1', generatedAt: now,
        }),
      }
      const synthesis = await syntheses.generate(actor, workflow, provider)
      const summary = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'workflow-synthesis-confirmed', idempotencyKey: randomUUID(), expectedVersion: version, synthesisRevisionId: synthesis.draft!.id },
      })
      expect(summary.workflow.currentStage).toBe('action-planning')
      version = summary.workflow.version

      const keptActionId = randomUUID()
      const withdrawnActionId = randomUUID()
      const actionPlan = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: {
          type: 'action-plan-confirmed', idempotencyKey: randomUUID(), expectedVersion: version,
          actions: [
            { id: keptActionId, title: 'Arrange a follow-up kōrero', type: 'follow-up', pouId: 'manaakitanga', dueDate: '2026-08-20', status: 'open', notes: 'Manual Kaimahi action.' },
            { id: withdrawnActionId, title: 'Offer practical support', type: 'support', status: 'completed' },
          ],
        },
      })
      expect(actionPlan.workflow).toMatchObject({ currentStage: 'referral-planning', actions: [{ id: keptActionId }, { id: withdrawnActionId }] })
      version = actionPlan.workflow.version

      const revisedActions = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: {
          type: 'action-plan-confirmed', idempotencyKey: randomUUID(), expectedVersion: version,
          actions: [{ id: keptActionId, title: 'Arrange a follow-up kōrero', type: 'follow-up', pouId: 'manaakitanga', dueDate: '2026-08-20', status: 'completed' }],
        },
      })
      expect(revisedActions.workflow).toMatchObject({ currentStage: 'referral-planning', actions: [
        { id: keptActionId, status: 'completed' }, { id: withdrawnActionId, status: 'withdrawn' },
      ] })
      version = revisedActions.workflow.version

      const referralId = randomUUID()
      const referrals = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: {
          type: 'referral-plan-confirmed', idempotencyKey: randomUUID(), expectedVersion: version,
          referrals: [{ id: referralId, destinationCode: 'local-support', destinationName: 'Local support service', reason: 'Kaimahi-requested support pathway', pouId: 'manaakitanga', status: 'prepared' }],
        },
      })
      expect(referrals.workflow).toMatchObject({ currentStage: 'structured-review', referrals: [{ id: referralId, status: 'prepared' }] })
      version = referrals.workflow.version

      const review = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'structured-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: version },
      })
      version = review.workflow.version
      expect(review.workflow.currentStage).toBe('record-review')

      const safetyBeforeCompletion = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: {
          type: 'safety-observation-confirmed', observationId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion: version,
          observation: { assessmentContext: 'setup', broadClass: 'whanau_safety', concernLevel: 'urgent' },
        },
      })
      expect(safetyBeforeCompletion.workflow.safety.requiredConsequences).toHaveLength(2)
      version = safetyBeforeCompletion.workflow.version

      const completionKey = randomUUID()
      const completed = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'workflow-completed', idempotencyKey: completionKey, expectedVersion: version },
      })
      expect(completed.workflow).toMatchObject({ status: 'completed', currentStage: 'complete', completedAt: new Date('2026-08-10T00:00:00.000Z') })
      expect(completed.workflow.safety.requiredConsequences).toHaveLength(2)
      expect(completed.workflow.structuredReview).toMatchObject({ reference: completed.workflow.reference, actions: [{ id: keptActionId }], referrals: [{ id: referralId }] })
      expect(await repository.listResumable(actor)).toEqual([])
      expect(await repository.listCompleted(actor)).toMatchObject([{ id: workflowId, reference: completed.workflow.reference }])

      const replayedCompletion = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'workflow-completed', idempotencyKey: completionKey, expectedVersion: version },
      })
      expect(replayedCompletion.replayed).toBe(true)
      await expect(repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'action-plan-confirmed', idempotencyKey: randomUUID(), expectedVersion: completed.workflow.version, actions: [] },
      })).rejects.toThrow(WorkflowTransitionError)

      const nextWorkflow = await repository.createDraft({ actor, idempotencyKey: randomUUID() })
      nextWorkflowId = nextWorkflow.workflow.id
      expect(nextWorkflow).toMatchObject({ workflow: { status: 'draft' } })
    }, async (connection) => {
      await connection.db.execute(sql`alter table workflow_synthesis_revision disable trigger workflow_synthesis_revision_immutable`)
      await connection.db.execute(sql`alter table workflow_confirmed_synthesis disable trigger workflow_confirmed_synthesis_immutable`)
      await connection.db.execute(sql`alter table workflow_final_record disable trigger workflow_final_record_immutable`)
      try {
        await connection.db.execute(sql`delete from workflow_final_record where organisation_id = ${organisationId}`)
        await connection.db.execute(sql`delete from workflow_confirmed_synthesis where organisation_id = ${organisationId}`)
        await connection.db.execute(sql`delete from workflow_synthesis_revision where synthesis_id in (select id from workflow_synthesis where organisation_id = ${organisationId})`)
        await connection.db.execute(sql`delete from workflow_synthesis where organisation_id = ${organisationId}`)
        for (const id of [workflowId, nextWorkflowId].filter((value): value is string => Boolean(value))) {
          await connection.db.delete(workflowSafetyConsequences).where(eq(workflowSafetyConsequences.organisationId, organisationId))
          await connection.db.delete(workflowSafetyRuleEvaluations).where(eq(workflowSafetyRuleEvaluations.organisationId, organisationId))
          await connection.db.delete(workflowSafetyObservationRevisions).where(eq(workflowSafetyObservationRevisions.organisationId, organisationId))
          await connection.db.delete(workflowSafetyObservations).where(eq(workflowSafetyObservations.workflowSessionId, id))
          await connection.db.delete(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, id))
          await connection.db.delete(workflowActions).where(eq(workflowActions.workflowSessionId, id))
          await connection.db.delete(workflowReferrals).where(eq(workflowReferrals.workflowSessionId, id))
          await connection.db.delete(workflowPouCheckpoints).where(eq(workflowPouCheckpoints.workflowSessionId, id))
          await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, id))
        }
      } finally {
        await connection.db.execute(sql`alter table workflow_synthesis_revision enable trigger workflow_synthesis_revision_immutable`)
        await connection.db.execute(sql`alter table workflow_confirmed_synthesis enable trigger workflow_confirmed_synthesis_immutable`)
        await connection.db.execute(sql`alter table workflow_final_record enable trigger workflow_final_record_immutable`)
      }
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
    })
  })

  it('persists human-confirmed safety revisions and reconciles only the approved urgent consequence episodes', async () => {
    const organisationId = randomUUID()
    const userId = randomUUID()
    const actor: AuthenticatedUser = {
      id: userId,
      displayName: 'Safety test Kaimahi',
      status: 'active',
      organisation: { id: organisationId, slug: `safety-${organisationId}`, name: 'Safety test organisation' },
      roles: ['KAIMAHI'],
    }
    let workflowId: string | undefined
    await withMigratedTestDatabase(async (connection) => {
      await connection.db.insert(organisations).values({ id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name })
      await connection.db.insert(appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName })
      const repository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-10T00:00:00.000Z'))
      const created = await repository.createDraft({ actor, idempotencyKey: randomUUID() })
      workflowId = created.workflow.id
      const urgentObservationId = randomUUID()
      const urgentCommand = {
        type: 'safety-observation-confirmed' as const,
        observationId: urgentObservationId,
        idempotencyKey: randomUUID(),
        expectedVersion: 1,
        observation: { assessmentContext: 'setup' as const, broadClass: 'whanau_safety' as const, concernLevel: 'urgent' as const, contextNote: 'Confirmed urgent concern.' },
      }
      const urgent = await repository.submitCommand({ actor, workflowSessionId: workflowId, command: urgentCommand })
      expect(urgent.workflow.safety).toMatchObject({
        indicators: { urgentObservationCount: 1, supervisorReviewRequired: true, supervisorNotificationRequired: true },
        requiredConsequences: [{ type: 'supervisor_review_required' }, { type: 'supervisor_notification_required' }],
      })
      const [initialEvaluation] = await connection.db.select().from(workflowSafetyRuleEvaluations)
        .where(eq(workflowSafetyRuleEvaluations.observationId, urgentObservationId))
      if (!initialEvaluation) throw new Error('Expected the urgent observation evaluation to be persisted.')
      await expect(connection.db.insert(workflowSafetyConsequences).values({
        id: randomUUID(), observationId: urgentObservationId, organisationId, type: 'supervisor_review_required', state: 'required',
        createdByEvaluationId: initialEvaluation.id, requiredAt: new Date('2026-08-10T00:00:00.000Z'),
      })).rejects.toThrow()
      expect((await repository.submitCommand({ actor, workflowSessionId: workflowId, command: urgentCommand })).replayed).toBe(true)

      const urgentToUrgent = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: {
          type: 'safety-observation-corrected', observationId: urgentObservationId, expectedObservationRevision: 1,
          idempotencyKey: randomUUID(), expectedVersion: 2, reason: 'The urgent observation wording was clarified.',
          replacement: { assessmentContext: 'setup', broadClass: 'whanau_safety', concernLevel: 'urgent', contextNote: 'Still an urgent human-confirmed concern.' },
        },
      })
      expect(urgentToUrgent.workflow.safety.requiredConsequences).toEqual(urgent.workflow.safety.requiredConsequences)

      const manual = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'supervisor-review-requested', requestId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion: 3, requestNote: 'Independent Kaimahi supervision request.' },
      })
      expect(manual.workflow.safety.indicators.manualReviewRequestCount).toBe(1)

      const urgentToWatch = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: {
          type: 'safety-observation-corrected', observationId: urgentObservationId, expectedObservationRevision: 2,
          idempotencyKey: randomUUID(), expectedVersion: 4, reason: 'Clarified by the Kaimahi.',
          replacement: { assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'whanau_safety', concernLevel: 'watch' },
        },
      })
      expect(urgentToWatch.workflow.safety).toMatchObject({
        indicators: { urgentObservationCount: 0, supervisorReviewRequired: false, manualReviewRequestCount: 1 },
        requiredConsequences: [],
      })

      const watchToUrgent = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: {
          type: 'safety-observation-corrected', observationId: urgentObservationId, expectedObservationRevision: 3,
          idempotencyKey: randomUUID(), expectedVersion: 5, reason: 'New human-confirmed information.',
          replacement: { assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'whanau_safety', concernLevel: 'urgent' },
        },
      })
      expect(watchToUrgent.workflow.safety.requiredConsequences).toHaveLength(2)
      await expect(repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: {
          type: 'safety-observation-retracted', observationId: urgentObservationId, expectedObservationRevision: 3,
          idempotencyKey: randomUUID(), expectedVersion: 6, reason: 'Stale revision must not be accepted.',
        },
      })).rejects.toThrow(StaleSafetyObservationError)

      const retracted = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'safety-observation-retracted', observationId: urgentObservationId, expectedObservationRevision: 4, idempotencyKey: randomUUID(), expectedVersion: 6, reason: 'Observation no longer applies.' },
      })
      expect(retracted.workflow.safety).toMatchObject({ indicators: { activeObservationCount: 0, hasRetractedHistory: true, manualReviewRequestCount: 1 }, requiredConsequences: [] })
      const history = await repository.findSafetyObservationHistory(actor, workflowId, urgentObservationId)
      expect(history).toMatchObject({
        revisions: [{ revision: 1, operation: 'confirmed' }, { revision: 2, operation: 'corrected' }, { revision: 3, operation: 'corrected' }, { revision: 4, operation: 'corrected' }, { revision: 5, operation: 'retracted' }],
      })
      expect(history?.consequenceEpisodes).toHaveLength(4)
      expect(history?.consequenceEpisodes.filter(({ cessationReason }) => cessationReason === 'observation_corrected')).toHaveLength(2)
      expect(history?.consequenceEpisodes.filter(({ cessationReason }) => cessationReason === 'observation_retracted')).toHaveLength(2)

      const activeObservationId = randomUUID()
      const second = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'safety-observation-confirmed', observationId: activeObservationId, idempotencyKey: randomUUID(), expectedVersion: 7, observation: { assessmentContext: 'setup', broadClass: 'practice_quality', concernLevel: 'urgent' } },
      })
      await connection.db.update(workflowSessions).set({
        status: 'completed', currentStage: 'complete', currentPouId: null, completedAt: new Date('2026-08-10T00:00:00.000Z'), completedByUserId: userId,
      }).where(eq(workflowSessions.id, workflowId))
      const correctedAfterCompletion = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: {
          type: 'safety-observation-corrected', observationId: activeObservationId, expectedObservationRevision: 1,
          idempotencyKey: randomUUID(), expectedVersion: second.workflow.version, reason: 'Post-completion correction.',
          replacement: { assessmentContext: 'setup', broadClass: 'practice_quality', concernLevel: 'unsure' },
        },
      })
      expect(correctedAfterCompletion.workflow).toMatchObject({ status: 'completed', currentStage: 'complete', completedAt: new Date('2026-08-10T00:00:00.000Z'), version: 9 })
      const retractedAfterCompletion = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'safety-observation-retracted', observationId: activeObservationId, expectedObservationRevision: 2, idempotencyKey: randomUUID(), expectedVersion: 9, reason: 'Post-completion retraction.' },
      })
      expect(retractedAfterCompletion.workflow).toMatchObject({ status: 'completed', currentStage: 'complete', completedAt: new Date('2026-08-10T00:00:00.000Z'), version: 10 })
      await expect(repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'safety-observation-confirmed', observationId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion: 10, observation: { assessmentContext: 'setup', broadClass: 'practice_quality', concernLevel: 'unsure' } },
      })).rejects.toThrow(WorkflowTransitionError)
      await expect(repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'supervisor-review-requested', requestId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion: 10 },
      })).rejects.toThrow(WorkflowTransitionError)
    }, async (connection) => {
      if (workflowId) {
        await connection.db.delete(workflowSafetyConsequences).where(eq(workflowSafetyConsequences.organisationId, organisationId))
        await connection.db.delete(workflowSafetyRuleEvaluations).where(eq(workflowSafetyRuleEvaluations.organisationId, organisationId))
        await connection.db.delete(workflowSafetyObservationRevisions).where(eq(workflowSafetyObservationRevisions.organisationId, organisationId))
        await connection.db.delete(workflowSafetyObservations).where(eq(workflowSafetyObservations.workflowSessionId, workflowId))
        await connection.db.delete(workflowSupervisorReviewRequests).where(eq(workflowSupervisorReviewRequests.workflowSessionId, workflowId))
        await connection.db.delete(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, workflowId))
        await connection.db.delete(workflowPouCheckpoints).where(eq(workflowPouCheckpoints.workflowSessionId, workflowId))
        await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, workflowId))
      }
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
    })
  })

  it('replays concurrent identical safety confirmations, corrections, and retractions after the workflow lock', async () => {
    const organisationId = randomUUID()
    const userId = randomUUID()
    const actor: AuthenticatedUser = {
      id: userId,
      displayName: 'Concurrent safety Kaimahi',
      status: 'active',
      organisation: { id: organisationId, slug: `concurrent-${organisationId}`, name: 'Concurrent safety organisation' },
      roles: ['KAIMAHI'],
    }
    let workflowId: string | undefined
    await withMigratedTestDatabase(async (connection) => {
      await connection.db.insert(organisations).values({ id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name })
      await connection.db.insert(appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName })
      const repository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-10T00:00:00.000Z'))
      workflowId = (await repository.createDraft({ actor, idempotencyKey: randomUUID() })).workflow.id

      await connection.db.execute(sql`
        create or replace function te_kaupapa_m4_interaction_gate() returns trigger language plpgsql as $$
        begin
          perform pg_advisory_xact_lock(724188219);
          return new;
        end;
        $$
      `)
      await connection.db.execute(sql`create trigger te_kaupapa_m4_interaction_gate before insert on "workflow_interaction" for each row execute function te_kaupapa_m4_interaction_gate()`)

      try {
        const submitConcurrently = async (command: Parameters<typeof repository.submitCommand>[0]['command']) => {
          let releaseGate: (() => void) | undefined
          let signalGateHeld: (() => void) | undefined
          const gateHeld = new Promise<void>((resolve) => { signalGateHeld = resolve })
          const holderConnection = createDatabaseConnection(getTestDatabaseUrl())
          const firstConnection = createDatabaseConnection(getTestDatabaseUrl())
          const secondConnection = createDatabaseConnection(getTestDatabaseUrl())
          const firstRepository = new PostgresWorkflowRepository(firstConnection.db, () => new Date('2026-08-10T00:00:00.000Z'))
          const secondRepository = new PostgresWorkflowRepository(secondConnection.db, () => new Date('2026-08-10T00:00:00.000Z'))
          const holder = holderConnection.db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(${INTERACTION_GATE_LOCK_ID})`)
            signalGateHeld?.()
            await new Promise<void>((resolve) => { releaseGate = resolve })
          })
          try {
            await gateHeld
            const first = firstRepository.submitCommand({ actor, workflowSessionId: workflowId!, command })
            await pause(20)
            const second = secondRepository.submitCommand({ actor, workflowSessionId: workflowId!, command })
            await waitForBlockedDatabaseWork(connection)
            releaseGate?.()
            await holder
            return await Promise.all([first, second])
          } finally {
            releaseGate?.()
            await holder.catch(() => undefined)
            await holderConnection.close()
            await firstConnection.close()
            await secondConnection.close()
          }
        }

        const observationId = randomUUID()
        const confirmation = await submitConcurrently({
          type: 'safety-observation-confirmed', observationId, idempotencyKey: randomUUID(), expectedVersion: 1,
          observation: { assessmentContext: 'setup', broadClass: 'whanau_safety', concernLevel: 'urgent' },
        })
        expect(confirmation.map(({ replayed }) => replayed).sort()).toEqual([false, true])
        expect(confirmation.map(({ workflow }) => workflow.version)).toEqual([2, 2])

        const correction = await submitConcurrently({
          type: 'safety-observation-corrected', observationId, expectedObservationRevision: 1, idempotencyKey: randomUUID(), expectedVersion: 2,
          reason: 'Concurrent correction replay test.',
          replacement: { assessmentContext: 'setup', broadClass: 'whanau_safety', concernLevel: 'urgent' },
        })
        expect(correction.map(({ replayed }) => replayed).sort()).toEqual([false, true])
        expect(correction.map(({ workflow }) => workflow.version)).toEqual([3, 3])

        const retraction = await submitConcurrently({
          type: 'safety-observation-retracted', observationId, expectedObservationRevision: 2, idempotencyKey: randomUUID(), expectedVersion: 3,
          reason: 'Concurrent retraction replay test.',
        })
        expect(retraction.map(({ replayed }) => replayed).sort()).toEqual([false, true])
        expect(retraction.map(({ workflow }) => workflow.version)).toEqual([4, 4])
      } finally {
        await connection.db.execute(sql`drop trigger if exists te_kaupapa_m4_interaction_gate on "workflow_interaction"`)
        await connection.db.execute(sql`drop function if exists te_kaupapa_m4_interaction_gate()`)
      }
    }, async (connection) => {
      if (workflowId) {
        await connection.db.delete(workflowSafetyConsequences).where(eq(workflowSafetyConsequences.organisationId, organisationId))
        await connection.db.delete(workflowSafetyRuleEvaluations).where(eq(workflowSafetyRuleEvaluations.organisationId, organisationId))
        await connection.db.delete(workflowSafetyObservationRevisions).where(eq(workflowSafetyObservationRevisions.organisationId, organisationId))
        await connection.db.delete(workflowSafetyObservations).where(eq(workflowSafetyObservations.workflowSessionId, workflowId))
        await connection.db.delete(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, workflowId))
        await connection.db.delete(workflowPouCheckpoints).where(eq(workflowPouCheckpoints.workflowSessionId, workflowId))
        await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, workflowId))
      }
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
    })
  })

  it('does not promote legacy concerns and persists only deterministic no-consequence evaluations for nonurgent and retracted observations', async () => {
    const organisationId = randomUUID()
    const userId = randomUUID()
    const actor: AuthenticatedUser = {
      id: userId,
      displayName: 'Deterministic evaluation Kaimahi',
      status: 'active',
      organisation: { id: organisationId, slug: `evaluation-${organisationId}`, name: 'Deterministic evaluation organisation' },
      roles: ['KAIMAHI'],
    }
    let workflowId: string | undefined
    await withMigratedTestDatabase(async (connection) => {
      await connection.db.insert(organisations).values({ id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name })
      await connection.db.insert(appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName })
      const repository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-10T00:00:00.000Z'))
      workflowId = (await repository.createDraft({ actor, idempotencyKey: randomUUID() })).workflow.id

      const setup = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'setup-confirmed', idempotencyKey: randomUUID(), expectedVersion: 1, whanauReference: 'Legacy-1', engagementType: 'hui', sessionFocus: 'Legacy fields remain non-authoritative.', immediateConcern: 'urgent', readiness: { verbalConsentConfirmed: true, writtenConsentConfirmed: true, initialRiskAssessmentCompleted: true } },
      })
      const pou = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: setup.workflow.version, pouId: 'kaitiakitanga' },
      })
      expect(pou.workflow.safety).toMatchObject({ observations: [], requiredConsequences: [], indicators: { activeObservationCount: 0, supervisorReviewRequired: false } })
      expect(await connection.db.select().from(workflowSafetyObservations).where(eq(workflowSafetyObservations.workflowSessionId, workflowId))).toHaveLength(0)

      const observationId = randomUUID()
      const confirmed = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'safety-observation-confirmed', observationId, idempotencyKey: randomUUID(), expectedVersion: pou.workflow.version, observation: { assessmentContext: 'setup', broadClass: 'practice_quality', concernLevel: 'unsure' } },
      })
      const retracted = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'safety-observation-retracted', observationId, expectedObservationRevision: 1, idempotencyKey: randomUUID(), expectedVersion: confirmed.workflow.version, reason: 'The Kaimahi retracted the nonurgent observation.' },
      })
      expect(retracted.workflow.safety.requiredConsequences).toEqual([])
      const evaluations = await connection.db.select().from(workflowSafetyRuleEvaluations).where(eq(workflowSafetyRuleEvaluations.observationId, observationId))
      expect(evaluations).toHaveLength(2)
      expect(evaluations).toEqual(expect.arrayContaining([
        expect.objectContaining({ ruleCode: SAFETY_RULE_CODE, ruleVersion: SAFETY_RULE_VERSION, decisionCode: 'no_approved_consequence' }),
      ]))
      expect(await connection.db.select().from(workflowSafetyConsequences).where(eq(workflowSafetyConsequences.observationId, observationId))).toHaveLength(0)
    }, async (connection) => {
      if (workflowId) {
        await connection.db.delete(workflowSafetyConsequences).where(eq(workflowSafetyConsequences.organisationId, organisationId))
        await connection.db.delete(workflowSafetyRuleEvaluations).where(eq(workflowSafetyRuleEvaluations.organisationId, organisationId))
        await connection.db.delete(workflowSafetyObservationRevisions).where(eq(workflowSafetyObservationRevisions.organisationId, organisationId))
        await connection.db.delete(workflowSafetyObservations).where(eq(workflowSafetyObservations.workflowSessionId, workflowId))
        await connection.db.delete(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, workflowId))
        await connection.db.delete(workflowPouCheckpoints).where(eq(workflowPouCheckpoints.workflowSessionId, workflowId))
        await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, workflowId))
      }
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
    })
  })

  it('enforces observation provenance and owner, organisation, and workflow isolation for safety history', async () => {
    const organisationId = randomUUID()
    const foreignOrganisationId = randomUUID()
    const userId = randomUUID()
    const colleagueId = randomUUID()
    const foreignUserId = randomUUID()
    const actor: AuthenticatedUser = {
      id: userId, displayName: 'History owner', status: 'active',
      organisation: { id: organisationId, slug: `history-${organisationId}`, name: 'History organisation' }, roles: ['KAIMAHI'],
    }
    const colleague: AuthenticatedUser = { ...actor, id: colleagueId, displayName: 'Same organisation colleague' }
    const foreignActor: AuthenticatedUser = {
      id: foreignUserId, displayName: 'Foreign history Kaimahi', status: 'active',
      organisation: { id: foreignOrganisationId, slug: `foreign-history-${foreignOrganisationId}`, name: 'Foreign history organisation' }, roles: ['KAIMAHI'],
    }
    let workflowId: string | undefined
    const secondWorkflowId = randomUUID()
    await withMigratedTestDatabase(async (connection) => {
      await connection.db.insert(organisations).values([
        { id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name },
        { id: foreignOrganisationId, slug: foreignActor.organisation.slug, name: foreignActor.organisation.name },
      ])
      await connection.db.insert(appUsers).values([
        { id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName },
        { id: colleagueId, organisationId, email: `${colleagueId}@example.invalid`, displayName: colleague.displayName },
        { id: foreignUserId, organisationId: foreignOrganisationId, email: `${foreignUserId}@example.invalid`, displayName: foreignActor.displayName },
      ])
      const repository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-10T00:00:00.000Z'))
      workflowId = (await repository.createDraft({ actor, idempotencyKey: randomUUID() })).workflow.id
      const firstObservationId = randomUUID()
      const first = await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'safety-observation-confirmed', observationId: firstObservationId, idempotencyKey: randomUUID(), expectedVersion: 1, observation: { assessmentContext: 'setup', broadClass: 'whanau_safety', concernLevel: 'unsure' } },
      })
      const secondObservationId = randomUUID()
      await repository.submitCommand({
        actor, workflowSessionId: workflowId,
        command: { type: 'safety-observation-confirmed', observationId: secondObservationId, idempotencyKey: randomUUID(), expectedVersion: first.workflow.version, observation: { assessmentContext: 'setup', broadClass: 'practice_quality', concernLevel: 'unsure' } },
      })
      const [firstEvaluation] = await connection.db.select().from(workflowSafetyRuleEvaluations).where(eq(workflowSafetyRuleEvaluations.observationId, firstObservationId))
      const [secondEvaluation] = await connection.db.select().from(workflowSafetyRuleEvaluations).where(eq(workflowSafetyRuleEvaluations.observationId, secondObservationId))
      if (!firstEvaluation || !secondEvaluation) throw new Error('Expected deterministic evaluations for provenance test.')
      await expect(connection.db.insert(workflowSafetyConsequences).values({
        id: randomUUID(), observationId: firstObservationId, organisationId, type: 'supervisor_review_required', state: 'required',
        createdByEvaluationId: secondEvaluation.id, requiredAt: new Date('2026-08-10T00:00:00.000Z'),
      })).rejects.toThrow()

      await connection.db.insert(workflowSessions).values({
        id: secondWorkflowId, organisationId, kaimahiUserId: userId, reference: `TK-${secondWorkflowId.slice(0, 8)}`,
        status: 'completed', currentStage: 'complete', version: 1, completedAt: new Date('2026-08-10T00:00:00.000Z'), completedByUserId: userId,
      })
      const crossWorkflowInteractionId = randomUUID()
      await connection.db.insert(workflowInteractions).values({
        id: crossWorkflowInteractionId, workflowSessionId: secondWorkflowId, organisationId, actorUserId: userId,
        type: 'workflow_created', idempotencyKey: randomUUID(), requestFingerprint: 'cross-workflow-provenance-test', resultingVersion: 1,
      })
      await expect(connection.db.insert(workflowSafetyObservationRevisions).values({
        observationId: firstObservationId, organisationId, workflowSessionId: workflowId, revision: 2,
        assessmentContext: 'setup', pouId: null, broadClass: 'whanau_safety', concernLevel: 'unsure', resultingStatus: 'active',
        operation: 'corrected', changeReason: 'This direct cross-workflow link must be rejected.', actorUserId: userId,
        interactionId: crossWorkflowInteractionId, createdAt: new Date('2026-08-10T00:00:00.000Z'),
      })).rejects.toThrow()
      await expect(connection.db.insert(workflowSupervisorReviewRequests).values({
        id: randomUUID(), workflowSessionId: workflowId, organisationId, requestedByUserId: userId,
        interactionId: crossWorkflowInteractionId, requestedAt: new Date('2026-08-10T00:00:00.000Z'),
      })).rejects.toThrow()

      await expect(repository.findSafetyObservationHistory(actor, workflowId, firstObservationId)).resolves.toMatchObject({
        observation: { id: firstObservationId, currentRevision: 1 },
        revisions: [{ revision: 1, operation: 'confirmed' }],
        evaluations: [{ ruleCode: SAFETY_RULE_CODE, ruleVersion: SAFETY_RULE_VERSION, decisionCode: 'no_approved_consequence' }],
        consequenceEpisodes: [],
      })
      await expect(repository.findSafetyObservationHistory(colleague, workflowId, firstObservationId)).resolves.toBeNull()
      await expect(repository.findSafetyObservationHistory(foreignActor, workflowId, firstObservationId)).resolves.toBeNull()
      await expect(repository.findSafetyObservationHistory(actor, secondWorkflowId, firstObservationId)).resolves.toBeNull()
    }, async (connection) => {
      if (workflowId) {
        await connection.db.delete(workflowSafetyConsequences).where(eq(workflowSafetyConsequences.organisationId, organisationId))
        await connection.db.delete(workflowSafetyRuleEvaluations).where(eq(workflowSafetyRuleEvaluations.organisationId, organisationId))
        await connection.db.delete(workflowSafetyObservationRevisions).where(eq(workflowSafetyObservationRevisions.organisationId, organisationId))
        await connection.db.delete(workflowSafetyObservations).where(eq(workflowSafetyObservations.workflowSessionId, workflowId))
        await connection.db.delete(workflowSupervisorReviewRequests).where(eq(workflowSupervisorReviewRequests.workflowSessionId, workflowId))
        await connection.db.delete(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, workflowId))
        await connection.db.delete(workflowPouCheckpoints).where(eq(workflowPouCheckpoints.workflowSessionId, workflowId))
        await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, workflowId))
      }
      await connection.db.delete(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, secondWorkflowId))
      await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, secondWorkflowId))
      await connection.db.delete(appUsers).where(and(eq(appUsers.id, userId), eq(appUsers.organisationId, organisationId)))
      await connection.db.delete(appUsers).where(eq(appUsers.id, colleagueId))
      await connection.db.delete(appUsers).where(eq(appUsers.id, foreignUserId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
      await connection.db.delete(organisations).where(eq(organisations.id, foreignOrganisationId))
    })
  })

  it('rolls back the interaction and all safety writes when a safety revision cannot be persisted', async () => {
    const organisationId = randomUUID()
    const userId = randomUUID()
    const actor: AuthenticatedUser = {
      id: userId, displayName: 'Rollback safety Kaimahi', status: 'active',
      organisation: { id: organisationId, slug: `rollback-${organisationId}`, name: 'Rollback organisation' }, roles: ['KAIMAHI'],
    }
    let workflowId: string | undefined
    await withMigratedTestDatabase(async (connection) => {
      await connection.db.insert(organisations).values({ id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name })
      await connection.db.insert(appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName })
      const repository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-10T00:00:00.000Z'))
      workflowId = (await repository.createDraft({ actor, idempotencyKey: randomUUID() })).workflow.id
      await connection.db.execute(sql`
        create or replace function te_kaupapa_m4_revision_failure() returns trigger language plpgsql as $$
        begin
          raise exception 'm4 test safety revision failure';
        end;
        $$
      `)
      await connection.db.execute(sql`create trigger te_kaupapa_m4_revision_failure before insert on "workflow_safety_observation_revision" for each row execute function te_kaupapa_m4_revision_failure()`)
      try {
        await expect(repository.submitCommand({
          actor, workflowSessionId: workflowId,
          command: { type: 'safety-observation-confirmed', observationId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion: 1, observation: { assessmentContext: 'setup', broadClass: 'whanau_safety', concernLevel: 'urgent' } },
        })).rejects.toThrow()
      } finally {
        await connection.db.execute(sql`drop trigger if exists te_kaupapa_m4_revision_failure on "workflow_safety_observation_revision"`)
        await connection.db.execute(sql`drop function if exists te_kaupapa_m4_revision_failure()`)
      }
      expect(await connection.db.select().from(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, workflowId))).toHaveLength(1)
      expect(await connection.db.select().from(workflowSafetyObservations).where(eq(workflowSafetyObservations.workflowSessionId, workflowId))).toHaveLength(0)
      expect(await connection.db.select().from(workflowSafetyObservationRevisions).where(eq(workflowSafetyObservationRevisions.workflowSessionId, workflowId))).toHaveLength(0)
      expect(await connection.db.select().from(workflowSafetyRuleEvaluations).where(eq(workflowSafetyRuleEvaluations.organisationId, organisationId))).toHaveLength(0)
      expect(await connection.db.select().from(workflowSafetyConsequences).where(eq(workflowSafetyConsequences.organisationId, organisationId))).toHaveLength(0)
      const [workflow] = await connection.db.select().from(workflowSessions).where(eq(workflowSessions.id, workflowId))
      expect(workflow?.version).toBe(1)
    }, async (connection) => {
      if (workflowId) {
        await connection.db.delete(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, workflowId))
        await connection.db.delete(workflowPouCheckpoints).where(eq(workflowPouCheckpoints.workflowSessionId, workflowId))
        await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, workflowId))
      }
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
    })
  })
})
