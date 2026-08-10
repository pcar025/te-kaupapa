import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { count, eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { describe, expect, it } from 'vitest'

import { WORKFLOW_POU_IDS } from '../../shared/workflow.js'
import { createDatabaseConnection } from './repository.js'
import { appUsers, organisations, workflowInteractions, workflowPouCheckpoints, workflowSessions } from './schema.js'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('PostgreSQL workflow schema integration', () => {
  it('migrates the workflow envelope with exactly seven checkpoints and one resumable workflow per Kaimahi', async () => {
    const connection = createDatabaseConnection(databaseUrl!)
    const organisationId = randomUUID()
    const userId = randomUUID()
    const workflowId = randomUUID()
    try {
      await migrate(connection.db, { migrationsFolder: path.resolve(process.cwd(), 'server/db/migrations') })
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

      await expect(connection.db.insert(workflowSessions).values({
        id: randomUUID(),
        organisationId,
        kaimahiUserId: userId,
        reference: 'TK-9Q2M4K7P',
        status: 'in_progress',
        currentStage: 'pou-overview',
        currentPouId: 'whakapapa',
        version: 1,
      })).rejects.toThrow()
    } finally {
      await connection.db.delete(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, workflowId))
      await connection.db.delete(workflowPouCheckpoints).where(eq(workflowPouCheckpoints.workflowSessionId, workflowId))
      await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, workflowId))
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
      await connection.close()
    }
  })
})
