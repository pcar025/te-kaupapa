import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { describe, expect, it } from 'vitest'

import type { AuthenticatedUser } from '../domain/auth.js'
import { createDatabaseConnection } from '../db/repository.js'
import { appUsers, organisations, workflowInteractions, workflowPouCheckpoints, workflowSessions } from '../db/schema.js'
import { ActiveWorkflowError, IdempotencyKeyReuseError, PostgresWorkflowRepository, StaleWorkflowError } from './repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('PostgreSQL workflow repository integration', () => {
  it('creates exactly one resumable workflow and preserves retry and stale-state guarantees', async () => {
    const connection = createDatabaseConnection(databaseUrl!)
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
    try {
      await migrate(connection.db, { migrationsFolder: path.resolve(process.cwd(), 'server/db/migrations') })
      await connection.db.insert(organisations).values({ id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name })
      await connection.db.insert(appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName })
      const repository = new PostgresWorkflowRepository(
        connection.db,
        () => new Date('2026-08-10T00:00:00.000Z'),
        () => 'TK-7K4M2P9Q',
      )
      const createKey = randomUUID()
      const created = await repository.createDraft({ actor, idempotencyKey: createKey })
      workflowId = created.workflow.id
      expect(created).toMatchObject({ replayed: false, workflow: { reference: 'TK-7K4M2P9Q', status: 'draft', version: 1 } })
      expect(created.workflow.checkpoints).toHaveLength(7)

      const replayedCreate = await repository.createDraft({ actor, idempotencyKey: createKey })
      expect(replayedCreate).toMatchObject({ replayed: true, interactionId: created.interactionId, workflow: { id: workflowId, version: 1 } })
      await expect(repository.createDraft({ actor, idempotencyKey: randomUUID() })).rejects.toThrow(ActiveWorkflowError)

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
        },
      })
      expect(setup).toMatchObject({ replayed: false, workflow: { version: 2, status: 'in_progress', currentStage: 'pou-overview', currentPouId: 'whakapapa' } })
      expect(setup.workflow.setup?.whanauReference).toBe('TW-04')

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
        },
      })
      expect(revisedSetup).toMatchObject({ replayed: false, workflow: { version: 3, currentStage: 'pou-overview', currentPouId: 'whakapapa' } })

      await expect(repository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'pou-review-confirmed',
          idempotencyKey: randomUUID(),
          expectedVersion: 1,
          pouId: 'whakapapa',
          userSelectedConcern: 'watch',
          note: 'A confirmed human observation.',
          referralSuggested: false,
          supervisorReviewSuggested: false,
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
          pouId: 'whakapapa',
          userSelectedConcern: 'watch',
          note: 'A confirmed human observation.',
          referralSuggested: false,
          supervisorReviewSuggested: false,
        },
      })
      expect(pou).toMatchObject({ replayed: false, workflow: { version: 4, currentStage: 'pou-convo', currentPouId: 'manaakitanga' } })
      expect(pou.workflow.checkpoints[0]).toMatchObject({ progress: 'confirmed', userSelectedConcern: 'watch' })

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
          pouId: 'whakapapa',
          userSelectedConcern: 'watch',
          note: 'A confirmed human observation.',
          referralSuggested: false,
          supervisorReviewSuggested: false,
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
          pouId: 'whakapapa',
          userSelectedConcern: 'low',
          note: 'Changed request using the same key.',
          referralSuggested: false,
          supervisorReviewSuggested: false,
        },
      })).rejects.toThrow(IdempotencyKeyReuseError)
    } finally {
      if (workflowId) {
        await connection.db.delete(workflowInteractions).where(eq(workflowInteractions.workflowSessionId, workflowId))
        await connection.db.delete(workflowPouCheckpoints).where(eq(workflowPouCheckpoints.workflowSessionId, workflowId))
        await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, workflowId))
      }
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
      await connection.db.delete(appUsers).where(eq(appUsers.id, foreignUserId))
      await connection.db.delete(organisations).where(eq(organisations.id, foreignOrganisationId))
      await connection.close()
    }
  })
})
