import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { describe, expect, it } from 'vitest'

import { createDatabaseConnection, PostgresAuthRepository } from './repository.js'
import { appUsers, applicationSessions, externalIdentities, organisations, roleAssignments, supervision } from './schema.js'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('PostgreSQL auth repository integration', () => {
  it('returns an organization-scoped dual-role user after running the real migration', async () => {
    const connection = createDatabaseConnection(databaseUrl!)
    const userId = randomUUID()
    const organisationId = randomUUID()
    const sessionId = randomUUID()
    const tokenHash = `test-${randomUUID()}`
    try {
      await migrate(connection.db, { migrationsFolder: path.resolve(process.cwd(), 'server/db/migrations') })
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
      await expect(repository.findUserBySessionHash(tokenHash, new Date(), 60)).resolves.toMatchObject({
        id: userId,
        organisation: { id: organisationId },
        roles: ['KAIMAHI', 'SUPERVISOR'],
      })
    } finally {
      await connection.db.delete(applicationSessions).where(eq(applicationSessions.userId, userId))
      await connection.db.delete(externalIdentities).where(eq(externalIdentities.userId, userId))
      await connection.db.delete(roleAssignments).where(eq(roleAssignments.userId, userId))
      await connection.db.delete(appUsers).where(eq(appUsers.id, userId))
      await connection.db.delete(organisations).where(eq(organisations.id, organisationId))
      await connection.close()
    }
  })
})
