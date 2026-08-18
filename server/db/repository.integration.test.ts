import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { PostgresAuthRepository } from './repository.js'
import { appUsers, applicationSessions, externalIdentities, organisations, roleAssignments, supervision } from './schema.js'
import { hasTestDatabaseUrl, withMigratedTestDatabase } from './test-harness.js'

describe.skipIf(!hasTestDatabaseUrl())('PostgreSQL auth repository integration', () => {
  it('returns an organization-scoped dual-role user after running the real migration', async () => {
    const userId = randomUUID()
    const organisationId = randomUUID()
    const sessionId = randomUUID()
    const tokenHash = `test-${randomUUID()}`
    await withMigratedTestDatabase(async (connection) => {
      await connection.db.insert(organisations).values({ id: organisationId, slug: `test-${userId}`, name: 'Integration test organisation' })
      await connection.db.insert(appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: 'Integration test user' })
      await connection.db.insert(externalIdentities).values({ userId, provider: 'cognito', providerSubject: `subject-${userId}` })
      await connection.db.insert(roleAssignments).values([
        { userId, role: 'KAIMAHI' },
        { userId, role: 'SUPERVISOR' },
      ])
      await expect(connection.db.insert(roleAssignments).values({ userId, role: 'KAIMAHI' })).rejects.toThrow()
      await expect(connection.db.insert(externalIdentities).values({
        userId,
        provider: 'cognito',
        providerSubject: `subject-${userId}`,
      })).rejects.toThrow()
      await expect(connection.db.insert(supervision).values({ organisationId, supervisorUserId: userId, kaimahiUserId: userId })).rejects.toThrow()
      await connection.db.insert(applicationSessions).values({
        id: sessionId,
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
      })

      const repository = new PostgresAuthRepository(connection.db)
      await expect(repository.findUserBySessionHash(tokenHash, new Date())).resolves.toMatchObject({
        id: userId,
        organisation: { id: organisationId },
        roles: ['KAIMAHI', 'SUPERVISOR'],
      })
    }, async (connection) => {
      await connection.db.delete(applicationSessions).where(eq(applicationSessions.userId, userId))
      await connection.db.delete(externalIdentities).where(eq(externalIdentities.userId, userId))
      await connection.db.delete(roleAssignments).where(eq(roleAssignments.userId, userId))
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
    })
  })

  it('keeps trusted sessions outside the standard idle policy and revokes every active session for a user', async () => {
    const userId = randomUUID()
    const organisationId = randomUUID()
    const standardTokenHash = `standard-${randomUUID()}`
    const trustedTokenHash = `trusted-${randomUUID()}`
    const now = new Date('2026-09-20T09:00:00.000Z')
    await withMigratedTestDatabase(async (connection) => {
      await connection.db.insert(organisations).values({ id: organisationId, slug: `trusted-${userId}`, name: 'Trusted session integration organisation' })
      await connection.db.insert(appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: 'Trusted session integration user' })
      await connection.db.insert(externalIdentities).values({ userId, provider: 'cognito', providerSubject: `trusted-subject-${userId}` })
      await connection.db.insert(roleAssignments).values({ userId, role: 'KAIMAHI' })
      await connection.db.insert(applicationSessions).values([
        {
          id: randomUUID(), userId, tokenHash: standardTokenHash, mode: 'standard',
          expiresAt: new Date('2026-09-21T09:00:00.000Z'), lastActivityAt: new Date('2026-09-20T01:00:00.000Z'),
        },
        {
          id: randomUUID(), userId, tokenHash: trustedTokenHash, mode: 'trusted_device',
          expiresAt: new Date('2026-10-01T09:00:00.000Z'), lastActivityAt: new Date('2026-09-01T09:00:00.000Z'),
        },
      ])

      const repository = new PostgresAuthRepository(connection.db)
      await expect(repository.findUserBySessionHash(standardTokenHash, now)).resolves.toBeNull()
      await expect(repository.findUserBySessionHash(trustedTokenHash, now)).resolves.toMatchObject({ id: userId, roles: ['KAIMAHI'] })
      await repository.invalidateSessionsForUser(userId, now)
      await expect(repository.findUserBySessionHash(standardTokenHash, now)).resolves.toBeNull()
      await expect(repository.findUserBySessionHash(trustedTokenHash, now)).resolves.toBeNull()
    }, async (connection) => {
      await connection.db.delete(applicationSessions).where(eq(applicationSessions.userId, userId))
      await connection.db.delete(externalIdentities).where(eq(externalIdentities.userId, userId))
      await connection.db.delete(roleAssignments).where(eq(roleAssignments.userId, userId))
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
    })
  })
})
