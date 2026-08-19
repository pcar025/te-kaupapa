import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import type { AuthenticatedUser } from '../domain/auth.js'
import { appUsers, organisations, workflowConversations, workflowPouCheckpoints, workflowSessions } from '../db/schema.js'
import { hasTestDatabaseUrl, withMigratedTestDatabase } from '../db/test-harness.js'
import { ConversationIdempotencyKeyReuseError, OpenConversationExistsError, PostgresConversationRepository } from './repository.js'

describe.skipIf(!hasTestDatabaseUrl())('PostgreSQL conversation repository integration', () => {
  it('persists only conversation provenance while enforcing organisation, provider, idempotency, and one-open-attempt boundaries', async () => {
    const organisationId = randomUUID()
    const userId = randomUUID()
    const workflowId = randomUUID()
    const actor: AuthenticatedUser = {
      id: userId,
      displayName: 'Conversation test Kaimahi',
      status: 'active',
      organisation: { id: organisationId, slug: `conversation-${organisationId}`, name: 'Conversation test organisation' },
      roles: ['KAIMAHI'],
    }
    await withMigratedTestDatabase(async (connection) => {
      await connection.db.insert(organisations).values({ id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name })
      await connection.db.insert(appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName })
      await connection.db.insert(workflowSessions).values({
        id: workflowId, organisationId, kaimahiUserId: userId, reference: `TK-${workflowId.slice(0, 8)}`, status: 'in_progress', currentStage: 'pou-overview', currentPouId: 'whakapapa', version: 2,
      })
      await connection.db.insert(workflowPouCheckpoints).values({ workflowSessionId: workflowId, organisationId, pouId: 'whakapapa', ordinal: 1 })
      const repository = new PostgresConversationRepository(connection.db, () => new Date('2026-08-11T00:00:00.000Z'))
      const input = {
        actor, workflowSessionId: workflowId, pouId: 'whakapapa' as const, provider: 'elevenlabs', providerAgentReference: 'agent-staging', providerBranchReference: 'branch-staging', providerEnvironment: 'staging',
        conversationSpecificationCode: 'whakapapa-reflection', conversationSpecificationVersion: 1, idempotencyKey: randomUUID(), requestFingerprint: 'fingerprint-one',
      }
      const prepared = await repository.prepare(input)
      expect(prepared).toMatchObject({ created: true, conversation: { status: 'preparing', providerConversationId: null, conversationSpecificationCode: 'whakapapa-reflection' } })
      await expect(connection.db.insert(workflowConversations).values({
        organisationId,
        workflowSessionId: workflowId,
        pouId: 'whakapapa',
        startedByUserId: userId,
        provider: 'elevenlabs',
        providerAgentReference: 'agent-staging',
        providerEnvironment: 'staging',
        conversationSpecificationCode: 'whakapapa-reflection',
        conversationSpecificationVersion: 1,
        status: 'authorized',
        startIdempotencyKey: randomUUID(),
        requestFingerprint: 'invalid-lifecycle',
      })).rejects.toThrow()
      await expect(connection.db.insert(workflowConversations).values({
        organisationId,
        workflowSessionId: workflowId,
        pouId: 'whakapapa',
        startedByUserId: userId,
        provider: 'elevenlabs',
        providerConversationId: 'must-not-exist-before-authorization',
        providerAgentReference: 'agent-staging',
        providerEnvironment: 'staging',
        conversationSpecificationCode: 'whakapapa-reflection',
        conversationSpecificationVersion: 1,
        status: 'preparing',
        startIdempotencyKey: randomUUID(),
        requestFingerprint: 'invalid-preparing-lifecycle',
      })).rejects.toThrow()
      await expect(connection.db.insert(workflowConversations).values({
        organisationId,
        workflowSessionId: workflowId,
        pouId: 'whakapapa',
        startedByUserId: userId,
        provider: 'elevenlabs',
        providerConversationId: 'provider-without-authorization',
        providerAgentReference: 'agent-staging',
        providerEnvironment: 'staging',
        conversationSpecificationCode: 'whakapapa-reflection',
        conversationSpecificationVersion: 1,
        status: 'failed',
        startIdempotencyKey: randomUUID(),
        requestFingerprint: 'invalid-failed-lifecycle',
        endedAt: new Date('2026-08-11T00:00:00.000Z'),
        terminationReason: 'startup_failed',
      })).rejects.toThrow()
      const failedAt = new Date('2026-08-11T00:00:00.000Z')
      const failedBase = {
        organisationId,
        workflowSessionId: workflowId,
        pouId: 'whakapapa' as const,
        startedByUserId: userId,
        provider: 'elevenlabs',
        providerAgentReference: 'agent-staging',
        providerEnvironment: 'staging',
        conversationSpecificationCode: 'whakapapa-reflection',
        conversationSpecificationVersion: 1,
        status: 'failed' as const,
        endedAt: failedAt,
        terminationReason: 'startup_failed',
      }
      await expect(connection.db.insert(workflowConversations).values({
        ...failedBase,
        authorizedAt: failedAt,
        startIdempotencyKey: randomUUID(),
        requestFingerprint: 'invalid-failed-authorization-without-provider',
      })).rejects.toThrow()
      await expect(connection.db.insert(workflowConversations).values({
        ...failedBase,
        connectedAt: failedAt,
        startIdempotencyKey: randomUUID(),
        requestFingerprint: 'invalid-failed-connection-without-provenance',
      })).rejects.toThrow()
      await expect(connection.db.insert(workflowConversations).values({
        ...failedBase,
        providerConversationId: 'provider-connected-without-authorization',
        connectedAt: failedAt,
        startIdempotencyKey: randomUUID(),
        requestFingerprint: 'invalid-failed-connection-before-authorization',
      })).rejects.toThrow()
      await expect(repository.prepare(input)).resolves.toMatchObject({ created: false, conversation: { id: prepared.conversation.id } })
      await expect(repository.prepare({ ...input, requestFingerprint: 'conflicting-fingerprint' })).rejects.toThrow(ConversationIdempotencyKeyReuseError)
      await expect(repository.prepare({ ...input, idempotencyKey: randomUUID(), requestFingerprint: 'fingerprint-two' })).rejects.toThrow(OpenConversationExistsError)

      const authorized = await repository.authorize(prepared.conversation.id, 'provider-conversation-one')
      expect(authorized).toMatchObject({ status: 'authorized', providerConversationId: 'provider-conversation-one', authorizedAt: new Date('2026-08-11T00:00:00.000Z') })
      const active = await repository.markActive(prepared.conversation.id)
      expect(active).toMatchObject({ status: 'active', connectedAt: new Date('2026-08-11T00:00:00.000Z') })
      const ended = await repository.terminate(prepared.conversation.id, 'ended', 'user_ended')
      expect(ended).toMatchObject({ status: 'ended', terminationReason: 'user_ended', endedAt: new Date('2026-08-11T00:00:00.000Z') })
      await expect(repository.findCurrent(actor, workflowId, 'whakapapa')).resolves.toMatchObject({ id: prepared.conversation.id, status: 'ended' })
      await expect(connection.db.insert(workflowConversations).values({
        ...failedBase,
        startIdempotencyKey: randomUUID(),
        requestFingerprint: 'valid-failed-pre-authorization',
      })).resolves.toBeDefined()
      await expect(connection.db.insert(workflowConversations).values({
        ...failedBase,
        providerConversationId: 'provider-with-authorization',
        authorizedAt: failedAt,
        startIdempotencyKey: randomUUID(),
        requestFingerprint: 'valid-failed-post-authorization',
      })).resolves.toBeDefined()
      await expect(connection.db.insert(workflowConversations).values({
        ...failedBase,
        providerConversationId: 'provider-with-connection',
        authorizedAt: failedAt,
        connectedAt: failedAt,
        startIdempotencyKey: randomUUID(),
        requestFingerprint: 'valid-failed-post-connection',
      })).resolves.toBeDefined()

      const next = await repository.prepare({ ...input, idempotencyKey: randomUUID(), requestFingerprint: 'fingerprint-three' })
      await expect(repository.authorize(next.conversation.id, 'provider-conversation-one')).rejects.toThrow()
      await repository.terminate(next.conversation.id, 'failed', 'startup_failed')

      const concurrent = await Promise.allSettled([
        repository.prepare({ ...input, idempotencyKey: randomUUID(), requestFingerprint: 'concurrent-one' }),
        repository.prepare({ ...input, idempotencyKey: randomUUID(), requestFingerprint: 'concurrent-two' }),
      ])
      expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = concurrent.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      expect(rejected).toHaveLength(1)
      expect(rejected[0]?.reason).toBeInstanceOf(OpenConversationExistsError)
    }, async (connection) => {
      await connection.db.delete(workflowConversations).where(eq(workflowConversations.workflowSessionId, workflowId))
      await connection.db.delete(workflowPouCheckpoints).where(eq(workflowPouCheckpoints.workflowSessionId, workflowId))
      await connection.db.delete(workflowSessions).where(eq(workflowSessions.id, workflowId))
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
    })
  })
})
