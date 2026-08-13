import { randomUUID } from 'node:crypto'

import { count, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { WORKFLOW_POU_IDS } from '../../shared/workflow.js'
import {
  appUsers,
  organisations,
  workflowActions,
  workflowInteractions,
  workflowPouCheckpoints,
  workflowReferrals,
  workflowSessions,
} from './schema.js'
import { hasTestDatabaseUrl, withMigratedTestDatabase } from './test-harness.js'

describe.skipIf(!hasTestDatabaseUrl())('PostgreSQL workflow schema integration', () => {
  it('migrates independent resumable workflow envelopes with exactly seven checkpoints each', async () => {
    const organisationId = randomUUID()
    const userId = randomUUID()
    const workflowId = randomUUID()
    let independentWorkflowId: string | undefined
    await withMigratedTestDatabase(async (connection) => {
      await connection.db.insert(organisations).values({ id: organisationId, slug: `workflow-${organisationId}`, name: 'Workflow test organisation' })
      await connection.db.insert(appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: 'Workflow test Kaimahi' })
      await connection.db.insert(workflowSessions).values({
        id: workflowId,
        organisationId,
        kaimahiUserId: userId,
        reference: 'TK-7K4M2P9Q',
        status: 'draft',
        currentStage: 'setup',
        version: 1,
      })
      await connection.db.insert(workflowPouCheckpoints).values(WORKFLOW_POU_IDS.map((pouId, index) => ({
        workflowSessionId: workflowId,
        organisationId,
        pouId,
        ordinal: index + 1,
      })))

      const checkpointCount = await connection.db
        .select({ value: count() })
        .from(workflowPouCheckpoints)
        .where(eq(workflowPouCheckpoints.workflowSessionId, workflowId))
      expect(checkpointCount[0]?.value).toBe(7)

      await connection.db.insert(workflowActions).values({
        id: randomUUID(), workflowSessionId: workflowId, organisationId, pouId: 'whakapapa',
        title: 'Kaimahi-confirmed follow-up', type: 'follow-up', status: 'open', createdByUserId: userId, ownerUserId: userId,
      })
      await connection.db.insert(workflowReferrals).values({
        id: randomUUID(), workflowSessionId: workflowId, organisationId, pouId: 'manaakitanga',
        destinationName: 'A manually named destination', reason: 'Manual referral reason', status: 'draft', createdByUserId: userId,
      })

      await expect(connection.db.insert(workflowActions).values({
        id: randomUUID(), workflowSessionId: workflowId, organisationId,
        title: 'An invalid ownership row', type: 'other', status: 'open', createdByUserId: userId, ownerUserId: randomUUID(),
      })).rejects.toThrow()

      const newWorkflowId = randomUUID()
      independentWorkflowId = newWorkflowId
      await connection.db.insert(workflowSessions).values({
        id: newWorkflowId,
        organisationId,
        kaimahiUserId: userId,
        reference: 'TK-9Q2M4K7P',
        status: 'in_progress',
        currentStage: 'pou-overview',
        currentPouId: 'whakapapa',
        version: 1,
      })
      await connection.db.insert(workflowPouCheckpoints).values(WORKFLOW_POU_IDS.map((pouId, index) => ({
        workflowSessionId: newWorkflowId,
        organisationId,
        pouId,
        ordinal: index + 1,
      })))
      const independentCheckpointCount = await connection.db
        .select({ value: count() })
        .from(workflowPouCheckpoints)
        .where(eq(workflowPouCheckpoints.workflowSessionId, newWorkflowId))
      expect(independentCheckpointCount[0]?.value).toBe(7)
    }, async (connection) => {
      await connection.db.delete(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, workflowId))
      await connection.db.delete(workflowActions).where(eq(workflowActions.workflowSessionId, workflowId))
      await connection.db.delete(workflowReferrals).where(eq(workflowReferrals.workflowSessionId, workflowId))
      if (independentWorkflowId) await connection.db.delete(workflowPouCheckpoints).where(eq(workflowPouCheckpoints.workflowSessionId, independentWorkflowId))
      await connection.db.delete(workflowPouCheckpoints).where(eq(workflowPouCheckpoints.workflowSessionId, workflowId))
      if (independentWorkflowId) await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, independentWorkflowId))
      await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, workflowId))
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
    })
  })
})
