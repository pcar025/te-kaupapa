import { and, eq, gt, isNull } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import type { ApplicationRole, AuthenticatedUser } from '../domain/auth.js'
import * as schema from './schema.js'

export interface CreateSessionInput {
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
  lastActivityAt?: Date
}

export interface AuthRepository {
  findUserByExternalIdentity(provider: string, providerSubject: string): Promise<AuthenticatedUser | null>
  createSession(input: CreateSessionInput): Promise<void>
  findUserBySessionHash(tokenHash: string, now: Date, idleTimeoutMinutes: number): Promise<AuthenticatedUser | null>
  touchSession(tokenHash: string, activityAt: Date): Promise<void>
  invalidateSession(tokenHash: string, invalidatedAt: Date): Promise<void>
  isSupervisorOf(supervisorUserId: string, kaimahiUserId: string): Promise<boolean>
}

export interface DatabaseConnection {
  db: NodePgDatabase<typeof schema>
  close(): Promise<void>
}

export function createDatabaseConnection(connectionString: string): DatabaseConnection {
  const pool = new Pool({ connectionString })
  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  }
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findUserByExternalIdentity(provider: string, providerSubject: string): Promise<AuthenticatedUser | null> {
    const rows = await this.db
      .select({
        id: schema.appUsers.id,
        displayName: schema.appUsers.displayName,
        status: schema.appUsers.status,
        organisationId: schema.organisations.id,
        organisationSlug: schema.organisations.slug,
        organisationName: schema.organisations.name,
      })
      .from(schema.externalIdentities)
      .innerJoin(schema.appUsers, eq(schema.externalIdentities.userId, schema.appUsers.id))
      .innerJoin(schema.organisations, eq(schema.appUsers.organisationId, schema.organisations.id))
      .where(and(eq(schema.externalIdentities.provider, provider), eq(schema.externalIdentities.providerSubject, providerSubject)))
      .limit(1)

    if (!rows[0]) return null
    return this.withRoles(rows[0])
  }

  async createSession(input: CreateSessionInput): Promise<void> {
    await this.db.insert(schema.applicationSessions).values(input)
  }

  async findUserBySessionHash(tokenHash: string, now: Date, idleTimeoutMinutes: number): Promise<AuthenticatedUser | null> {
    const rows = await this.db
      .select({
        id: schema.appUsers.id,
        displayName: schema.appUsers.displayName,
        status: schema.appUsers.status,
        organisationId: schema.organisations.id,
        organisationSlug: schema.organisations.slug,
        organisationName: schema.organisations.name,
      })
      .from(schema.applicationSessions)
      .innerJoin(schema.appUsers, eq(schema.applicationSessions.userId, schema.appUsers.id))
      .innerJoin(schema.organisations, eq(schema.appUsers.organisationId, schema.organisations.id))
      .where(and(
        eq(schema.applicationSessions.tokenHash, tokenHash),
        isNull(schema.applicationSessions.invalidatedAt),
        gt(schema.applicationSessions.expiresAt, now),
        gt(schema.applicationSessions.lastActivityAt, new Date(now.getTime() - idleTimeoutMinutes * 60 * 1000)),
      ))
      .limit(1)

    if (!rows[0]) return null
    return this.withRoles(rows[0])
  }

  async touchSession(tokenHash: string, activityAt: Date): Promise<void> {
    await this.db
      .update(schema.applicationSessions)
      .set({ lastActivityAt: activityAt })
      .where(and(eq(schema.applicationSessions.tokenHash, tokenHash), isNull(schema.applicationSessions.invalidatedAt)))
  }

  async invalidateSession(tokenHash: string, invalidatedAt: Date): Promise<void> {
    await this.db
      .update(schema.applicationSessions)
      .set({ invalidatedAt })
      .where(and(eq(schema.applicationSessions.tokenHash, tokenHash), isNull(schema.applicationSessions.invalidatedAt)))
  }

  async isSupervisorOf(supervisorUserId: string, kaimahiUserId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.supervision.id })
      .from(schema.supervision)
      .where(and(
        eq(schema.supervision.supervisorUserId, supervisorUserId),
        eq(schema.supervision.kaimahiUserId, kaimahiUserId),
      ))
      .limit(1)
    return Boolean(rows[0])
  }

  private async withRoles(row: {
    id: string
    displayName: string
    status: 'active' | 'inactive'
    organisationId: string
    organisationSlug: string
    organisationName: string
  }): Promise<AuthenticatedUser> {
    const roles = await this.db
      .select({ role: schema.roleAssignments.role })
      .from(schema.roleAssignments)
      .where(eq(schema.roleAssignments.userId, row.id))

    return {
      id: row.id,
      displayName: row.displayName,
      status: row.status,
      organisation: { id: row.organisationId, slug: row.organisationSlug, name: row.organisationName },
      roles: roles.map(({ role }) => role as ApplicationRole),
    }
  }
}
