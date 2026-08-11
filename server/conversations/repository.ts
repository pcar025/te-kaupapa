import { and, desc, eq, inArray } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import type { WorkflowPouId } from '../../shared/workflow.js'
import type { AuthenticatedUser } from '../domain/auth.js'
import * as schema from '../db/schema.js'
import type { ConversationStatus, ConversationTerminationReason } from './domain.js'

type ConversationDatabase = NodePgDatabase<typeof schema>

export interface ConversationRecord {
  id: string
  organisationId: string
  workflowSessionId: string
  pouId: WorkflowPouId
  startedByUserId: string
  provider: string
  providerConversationId: string | null
  providerAgentReference: string
  providerBranchReference: string | null
  providerEnvironment: string
  conversationSpecificationCode: string
  conversationSpecificationVersion: number
  status: ConversationStatus
  startIdempotencyKey: string
  requestFingerprint: string
  authorizedAt: Date | null
  connectedAt: Date | null
  endedAt: Date | null
  terminationReason: string | null
  createdAt: Date
  updatedAt: Date
}

export interface PrepareConversationInput {
  actor: AuthenticatedUser
  workflowSessionId: string
  pouId: WorkflowPouId
  provider: string
  providerAgentReference: string
  providerBranchReference?: string
  providerEnvironment: string
  conversationSpecificationCode: string
  conversationSpecificationVersion: number
  idempotencyKey: string
  requestFingerprint: string
}

export interface PreparedConversation {
  conversation: ConversationRecord
  created: boolean
}

export interface ConversationRepository {
  prepare(input: PrepareConversationInput): Promise<PreparedConversation>
  findById(actor: AuthenticatedUser, conversationId: string): Promise<ConversationRecord | null>
  findCurrent(actor: AuthenticatedUser, workflowSessionId: string, pouId: WorkflowPouId): Promise<ConversationRecord | null>
  authorize(conversationId: string, providerConversationId: string): Promise<ConversationRecord>
  markActive(conversationId: string): Promise<ConversationRecord>
  terminate(conversationId: string, status: 'ended' | 'failed', reason: ConversationTerminationReason): Promise<ConversationRecord>
}

export class ConversationIdempotencyKeyReuseError extends Error {
  constructor() {
    super('The conversation idempotency key was used for a different request.')
    this.name = 'ConversationIdempotencyKeyReuseError'
  }
}

export class OpenConversationExistsError extends Error {
  constructor() {
    super('An open conversation already exists for this workflow Pou.')
    this.name = 'OpenConversationExistsError'
  }
}

export class ConversationRepositoryError extends Error {
  constructor() {
    super('The conversation record could not be updated.')
    this.name = 'ConversationRepositoryError'
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && (error as { code?: string }).code === '23505') return true
  return 'cause' in error && isUniqueViolation((error as { cause?: unknown }).cause)
}

function asRecord(row: typeof schema.workflowConversations.$inferSelect): ConversationRecord {
  return { ...row, pouId: row.pouId as WorkflowPouId, status: row.status as ConversationStatus }
}

export class PostgresConversationRepository implements ConversationRepository {
  constructor(private readonly db: ConversationDatabase, private readonly now: () => Date = () => new Date()) {}

  async prepare(input: PrepareConversationInput): Promise<PreparedConversation> {
    const findExisting = async (executor: ConversationDatabase) => executor
      .select()
      .from(schema.workflowConversations)
      .where(and(
        eq(schema.workflowConversations.startedByUserId, input.actor.id),
        eq(schema.workflowConversations.startIdempotencyKey, input.idempotencyKey),
      ))
      .limit(1)

    try {
      return await this.db.transaction(async (tx) => {
        const existing = await findExisting(tx)
        if (existing[0]) {
          const conversation = asRecord(existing[0])
          if (conversation.requestFingerprint !== input.requestFingerprint) throw new ConversationIdempotencyKeyReuseError()
          return { conversation, created: false }
        }

        const timestamp = this.now()
        const [created] = await tx.insert(schema.workflowConversations).values({
          organisationId: input.actor.organisation.id,
          workflowSessionId: input.workflowSessionId,
          pouId: input.pouId,
          startedByUserId: input.actor.id,
          provider: input.provider,
          providerAgentReference: input.providerAgentReference,
          providerBranchReference: input.providerBranchReference,
          providerEnvironment: input.providerEnvironment,
          conversationSpecificationCode: input.conversationSpecificationCode,
          conversationSpecificationVersion: input.conversationSpecificationVersion,
          status: 'preparing',
          startIdempotencyKey: input.idempotencyKey,
          requestFingerprint: input.requestFingerprint,
          createdAt: timestamp,
          updatedAt: timestamp,
        }).returning()
        if (!created) throw new ConversationRepositoryError()
        return { conversation: asRecord(created), created: true }
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const existing = await findExisting(this.db)
      if (existing[0]) {
        const conversation = asRecord(existing[0])
        if (conversation.requestFingerprint !== input.requestFingerprint) throw new ConversationIdempotencyKeyReuseError()
        return { conversation, created: false }
      }
      throw new OpenConversationExistsError()
    }
  }

  async findById(actor: AuthenticatedUser, conversationId: string): Promise<ConversationRecord | null> {
    const rows = await this.db.select().from(schema.workflowConversations).where(and(
      eq(schema.workflowConversations.id, conversationId),
      eq(schema.workflowConversations.organisationId, actor.organisation.id),
      eq(schema.workflowConversations.startedByUserId, actor.id),
    )).limit(1)
    return rows[0] ? asRecord(rows[0]) : null
  }

  async findCurrent(actor: AuthenticatedUser, workflowSessionId: string, pouId: WorkflowPouId): Promise<ConversationRecord | null> {
    const rows = await this.db.select().from(schema.workflowConversations).where(and(
      eq(schema.workflowConversations.organisationId, actor.organisation.id),
      eq(schema.workflowConversations.startedByUserId, actor.id),
      eq(schema.workflowConversations.workflowSessionId, workflowSessionId),
      eq(schema.workflowConversations.pouId, pouId),
    )).orderBy(desc(schema.workflowConversations.createdAt)).limit(1)
    return rows[0] ? asRecord(rows[0]) : null
  }

  async authorize(conversationId: string, providerConversationId: string): Promise<ConversationRecord> {
    const timestamp = this.now()
    const rows = await this.db.update(schema.workflowConversations).set({
      providerConversationId,
      status: 'authorized',
      authorizedAt: timestamp,
      updatedAt: timestamp,
    }).where(and(
      eq(schema.workflowConversations.id, conversationId),
      eq(schema.workflowConversations.status, 'preparing'),
    )).returning()
    if (!rows[0]) throw new ConversationRepositoryError()
    return asRecord(rows[0])
  }

  async markActive(conversationId: string): Promise<ConversationRecord> {
    const timestamp = this.now()
    const rows = await this.db.update(schema.workflowConversations).set({
      status: 'active',
      connectedAt: timestamp,
      updatedAt: timestamp,
    }).where(and(
      eq(schema.workflowConversations.id, conversationId),
      eq(schema.workflowConversations.status, 'authorized'),
    )).returning()
    if (!rows[0]) throw new ConversationRepositoryError()
    return asRecord(rows[0])
  }

  async terminate(conversationId: string, status: 'ended' | 'failed', reason: ConversationTerminationReason): Promise<ConversationRecord> {
    const timestamp = this.now()
    const rows = await this.db.update(schema.workflowConversations).set({
      status,
      endedAt: timestamp,
      terminationReason: reason,
      updatedAt: timestamp,
    }).where(and(
      eq(schema.workflowConversations.id, conversationId),
      inArray(schema.workflowConversations.status, ['preparing', 'authorized', 'active']),
    )).returning()
    if (!rows[0]) throw new ConversationRepositoryError()
    return asRecord(rows[0])
  }
}
