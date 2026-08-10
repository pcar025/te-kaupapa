import { createHash, randomBytes } from 'node:crypto'

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import {
  WORKFLOW_POU_IDS,
  type WorkflowCommand,
  type WorkflowImmediateConcern,
  type WorkflowPouConcern,
  type WorkflowPouId,
  type WorkflowStage,
  type WorkflowStatus,
} from '../../shared/workflow.js'
import type { AuthenticatedUser } from '../domain/auth.js'
import * as schema from '../db/schema.js'
import { checkpointAfterPouReview, checkpointAfterSetup, WorkflowTransitionError } from './domain.js'

type WorkflowDatabase = NodePgDatabase<typeof schema>

export interface WorkflowCheckpointView {
  pouId: WorkflowPouId
  ordinal: number
  progress: 'not_started' | 'confirmed'
  userSelectedConcern: WorkflowPouConcern | null
  note: string | null
  referralSuggested: boolean
  supervisorReviewSuggested: boolean
  confirmedAt: Date | null
}

export interface WorkflowView {
  id: string
  reference: string
  status: WorkflowStatus
  currentStage: WorkflowStage
  currentPouId: WorkflowPouId | null
  version: number
  setup: {
    whanauReference: string
    engagementType: 'home-visit' | 'phone' | 'office' | 'hui' | 'outreach'
    sessionFocus: string
    additionalNotes: string | null
    immediateConcern: WorkflowImmediateConcern
  } | null
  checkpoints: WorkflowCheckpointView[]
  createdAt: Date
  updatedAt: Date
}

export interface WorkflowListItem {
  id: string
  reference: string
  whanauReference: string | null
  status: 'draft' | 'in_progress'
  currentStage: WorkflowStage
  currentPouId: WorkflowPouId | null
  version: number
  updatedAt: Date
}

export interface WorkflowMutationResult {
  workflow: WorkflowView
  interactionId: string
  replayed: boolean
}

export interface CreateWorkflowInput {
  actor: AuthenticatedUser
  idempotencyKey: string
}

export interface SubmitWorkflowCommandInput {
  actor: AuthenticatedUser
  workflowSessionId: string
  command: WorkflowCommand
}

export interface WorkflowRepository {
  createDraft(input: CreateWorkflowInput): Promise<WorkflowMutationResult>
  findById(actor: AuthenticatedUser, workflowSessionId: string): Promise<WorkflowView | null>
  listResumable(actor: AuthenticatedUser): Promise<WorkflowListItem[]>
  submitCommand(input: SubmitWorkflowCommandInput): Promise<WorkflowMutationResult>
}

export class ActiveWorkflowError extends Error {
  constructor(public readonly workflowId?: string) {
    super('The Kaimahi already has a resumable workflow.')
    this.name = 'ActiveWorkflowError'
  }
}

export class IdempotencyKeyReuseError extends Error {
  constructor() {
    super('The idempotency key was previously used for a different request.')
    this.name = 'IdempotencyKeyReuseError'
  }
}

export class StaleWorkflowError extends Error {
  constructor(public readonly currentVersion: number) {
    super('The workflow has changed since it was loaded.')
    this.name = 'StaleWorkflowError'
  }
}

export class WorkflowNotFoundError extends Error {
  constructor() {
    super('The workflow could not be found.')
    this.name = 'WorkflowNotFoundError'
  }
}

const referenceAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateWorkflowReference(): string {
  return `TK-${Array.from(randomBytes(8), (value) => referenceAlphabet[value & 31]).join('')}`
}

export function workflowRequestFingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('base64url')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505'
}

export class PostgresWorkflowRepository implements WorkflowRepository {
  constructor(
    private readonly db: WorkflowDatabase,
    private readonly now: () => Date = () => new Date(),
    private readonly referenceGenerator: () => string = generateWorkflowReference,
  ) {}

  async createDraft(input: CreateWorkflowInput): Promise<WorkflowMutationResult> {
    const fingerprint = workflowRequestFingerprint({ type: 'workflow-created' })
    const replay = await this.findReplay(input.actor, input.idempotencyKey, fingerprint)
    if (replay) return replay

    try {
      const created = await this.db.transaction(async (tx) => {
        const repeated = await this.findReplay(input.actor, input.idempotencyKey, fingerprint, tx)
        if (repeated) return repeated

        const existing = await tx
          .select({ id: schema.workflowSessions.id })
          .from(schema.workflowSessions)
          .where(and(
            eq(schema.workflowSessions.kaimahiUserId, input.actor.id),
            inArray(schema.workflowSessions.status, ['draft', 'in_progress']),
          ))
          .limit(1)
        if (existing[0]) throw new ActiveWorkflowError(existing[0].id)

        const timestamp = this.now()
        const workflowId = crypto.randomUUID()
        const reference = this.referenceGenerator()
        await tx.insert(schema.workflowSessions).values({
          id: workflowId,
          organisationId: input.actor.organisation.id,
          kaimahiUserId: input.actor.id,
          reference,
          status: 'draft',
          currentStage: 'setup',
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        await tx.insert(schema.workflowPouCheckpoints).values(WORKFLOW_POU_IDS.map((pouId, index) => ({
          workflowSessionId: workflowId,
          organisationId: input.actor.organisation.id,
          pouId,
          ordinal: index + 1,
          progress: 'not_started' as const,
          updatedAt: timestamp,
        })))
        const [interaction] = await tx.insert(schema.workflowInteractions).values({
          workflowSessionId: workflowId,
          organisationId: input.actor.organisation.id,
          actorUserId: input.actor.id,
          type: 'workflow_created',
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
          resultingVersion: 1,
          createdAt: timestamp,
        }).returning({ id: schema.workflowInteractions.id })
        if (!interaction) throw new Error('The workflow creation interaction was not recorded.')
        return { workflowId, interactionId: interaction.id, replayed: false }
      })

      if ('workflow' in created) return created
      const workflow = await this.findById(input.actor, created.workflowId)
      if (!workflow) throw new WorkflowNotFoundError()
      return { workflow, interactionId: created.interactionId, replayed: created.replayed }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const repeated = await this.findReplay(input.actor, input.idempotencyKey, fingerprint)
      if (repeated) return repeated
      const existing = await this.findResumableWorkflowId(input.actor)
      if (existing) throw new ActiveWorkflowError(existing)
      throw error
    }
  }

  async findById(actor: AuthenticatedUser, workflowSessionId: string): Promise<WorkflowView | null> {
    return this.findByIdWithExecutor(actor, workflowSessionId, this.db)
  }

  async listResumable(actor: AuthenticatedUser): Promise<WorkflowListItem[]> {
    const rows = await this.db
      .select({
        id: schema.workflowSessions.id,
        reference: schema.workflowSessions.reference,
        whanauReference: schema.workflowSessions.whanauReference,
        status: schema.workflowSessions.status,
        currentStage: schema.workflowSessions.currentStage,
        currentPouId: schema.workflowSessions.currentPouId,
        version: schema.workflowSessions.version,
        updatedAt: schema.workflowSessions.updatedAt,
      })
      .from(schema.workflowSessions)
      .where(and(
        eq(schema.workflowSessions.organisationId, actor.organisation.id),
        eq(schema.workflowSessions.kaimahiUserId, actor.id),
        inArray(schema.workflowSessions.status, ['draft', 'in_progress']),
      ))
      .orderBy(desc(schema.workflowSessions.updatedAt))

    return rows.map((row) => ({
      ...row,
      status: row.status as 'draft' | 'in_progress',
      currentStage: row.currentStage as WorkflowStage,
      currentPouId: row.currentPouId as WorkflowPouId | null,
    }))
  }

  async submitCommand(input: SubmitWorkflowCommandInput): Promise<WorkflowMutationResult> {
    const fingerprint = workflowRequestFingerprint({ workflowSessionId: input.workflowSessionId, command: input.command })
    const replay = await this.findReplay(input.actor, input.command.idempotencyKey, fingerprint)
    if (replay) return replay

    try {
      const accepted = await this.db.transaction(async (tx) => {
        const repeated = await this.findReplay(input.actor, input.command.idempotencyKey, fingerprint, tx)
        if (repeated) return repeated

        const locked = await tx.execute(sql`
          select id from workflow_session
          where id = ${input.workflowSessionId}
            and organisation_id = ${input.actor.organisation.id}
            and kaimahi_user_id = ${input.actor.id}
          for update
        `)
        if (locked.rows.length === 0) throw new WorkflowNotFoundError()

        const [workflow] = await tx
          .select()
          .from(schema.workflowSessions)
          .where(eq(schema.workflowSessions.id, input.workflowSessionId))
          .limit(1)
        if (!workflow) throw new WorkflowNotFoundError()
        if (workflow.version !== input.command.expectedVersion) throw new StaleWorkflowError(workflow.version)

        const timestamp = this.now()
        const resultingVersion = workflow.version + 1
        let interactionType: 'setup_confirmed' | 'pou_review_confirmed'
        let interactionPouId: WorkflowPouId | undefined

        if (input.command.type === 'setup-confirmed') {
          if (workflow.status !== 'draft' || workflow.currentStage !== 'setup') throw new WorkflowTransitionError()
          const checkpoint = checkpointAfterSetup()
          await tx.update(schema.workflowSessions).set({
            whanauReference: input.command.whanauReference.trim(),
            engagementType: input.command.engagementType,
            sessionFocus: input.command.sessionFocus,
            additionalNotes: input.command.additionalNotes || null,
            immediateConcern: input.command.immediateConcern,
            status: 'in_progress',
            currentStage: checkpoint.stage,
            currentPouId: checkpoint.currentPouId,
            version: resultingVersion,
            setupConfirmedAt: timestamp,
            updatedAt: timestamp,
          }).where(eq(schema.workflowSessions.id, workflow.id))
          interactionType = 'setup_confirmed'
        } else {
          if (workflow.status !== 'in_progress') throw new WorkflowTransitionError()
          const [checkpoint] = await tx
            .select()
            .from(schema.workflowPouCheckpoints)
            .where(and(
              eq(schema.workflowPouCheckpoints.workflowSessionId, workflow.id),
              eq(schema.workflowPouCheckpoints.pouId, input.command.pouId),
            ))
            .limit(1)
          if (!checkpoint) throw new WorkflowTransitionError('The Pou checkpoint could not be found.')
          const next = checkpointAfterPouReview({
            stage: workflow.currentStage as WorkflowStage,
            currentPouId: workflow.currentPouId as WorkflowPouId | null,
          }, input.command.pouId, checkpoint.progress === 'confirmed')
          await tx.update(schema.workflowPouCheckpoints).set({
            progress: 'confirmed',
            userSelectedConcern: input.command.userSelectedConcern,
            note: input.command.note || null,
            referralSuggested: input.command.referralSuggested,
            supervisorReviewSuggested: input.command.supervisorReviewSuggested,
            confirmedByUserId: input.actor.id,
            confirmedAt: timestamp,
            updatedAt: timestamp,
          }).where(and(
            eq(schema.workflowPouCheckpoints.workflowSessionId, workflow.id),
            eq(schema.workflowPouCheckpoints.pouId, input.command.pouId),
          ))
          await tx.update(schema.workflowSessions).set({
            currentStage: next.stage,
            currentPouId: next.currentPouId,
            version: resultingVersion,
            updatedAt: timestamp,
          }).where(eq(schema.workflowSessions.id, workflow.id))
          interactionType = 'pou_review_confirmed'
          interactionPouId = input.command.pouId
        }

        const [interaction] = await tx.insert(schema.workflowInteractions).values({
          workflowSessionId: workflow.id,
          organisationId: input.actor.organisation.id,
          actorUserId: input.actor.id,
          type: interactionType,
          pouId: interactionPouId,
          idempotencyKey: input.command.idempotencyKey,
          requestFingerprint: fingerprint,
          expectedVersion: input.command.expectedVersion,
          resultingVersion,
          createdAt: timestamp,
        }).returning({ id: schema.workflowInteractions.id })
        if (!interaction) throw new Error('The workflow interaction was not recorded.')
        return { workflowId: workflow.id, interactionId: interaction.id, replayed: false }
      })

      if ('workflow' in accepted) return accepted
      const workflow = await this.findById(input.actor, accepted.workflowId)
      if (!workflow) throw new WorkflowNotFoundError()
      return { workflow, interactionId: accepted.interactionId, replayed: accepted.replayed }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const repeated = await this.findReplay(input.actor, input.command.idempotencyKey, fingerprint)
      if (repeated) return repeated
      throw error
    }
  }

  private async findReplay(
    actor: AuthenticatedUser,
    idempotencyKey: string,
    fingerprint: string,
    executor: WorkflowDatabase = this.db,
  ): Promise<WorkflowMutationResult | null> {
    const [interaction] = await executor
      .select({
        id: schema.workflowInteractions.id,
        workflowSessionId: schema.workflowInteractions.workflowSessionId,
        requestFingerprint: schema.workflowInteractions.requestFingerprint,
      })
      .from(schema.workflowInteractions)
      .where(and(
        eq(schema.workflowInteractions.actorUserId, actor.id),
        eq(schema.workflowInteractions.idempotencyKey, idempotencyKey),
      ))
      .limit(1)
    if (!interaction) return null
    if (interaction.requestFingerprint !== fingerprint) throw new IdempotencyKeyReuseError()
    const workflow = await this.findByIdWithExecutor(actor, interaction.workflowSessionId, executor)
    if (!workflow) throw new WorkflowNotFoundError()
    return { workflow, interactionId: interaction.id, replayed: true }
  }

  private async findByIdWithExecutor(
    actor: AuthenticatedUser,
    workflowSessionId: string,
    executor: WorkflowDatabase,
  ): Promise<WorkflowView | null> {
    const [workflow] = await executor
      .select()
      .from(schema.workflowSessions)
      .where(and(
        eq(schema.workflowSessions.id, workflowSessionId),
        eq(schema.workflowSessions.organisationId, actor.organisation.id),
        eq(schema.workflowSessions.kaimahiUserId, actor.id),
      ))
      .limit(1)
    if (!workflow) return null

    const checkpoints = await executor
      .select()
      .from(schema.workflowPouCheckpoints)
      .where(eq(schema.workflowPouCheckpoints.workflowSessionId, workflow.id))
      .orderBy(schema.workflowPouCheckpoints.ordinal)

    const setup = workflow.whanauReference && workflow.engagementType && workflow.sessionFocus && workflow.immediateConcern
      ? {
          whanauReference: workflow.whanauReference,
          engagementType: workflow.engagementType,
          sessionFocus: workflow.sessionFocus,
          additionalNotes: workflow.additionalNotes,
          immediateConcern: workflow.immediateConcern,
        }
      : null

    return {
      id: workflow.id,
      reference: workflow.reference,
      status: workflow.status as WorkflowStatus,
      currentStage: workflow.currentStage as WorkflowStage,
      currentPouId: workflow.currentPouId as WorkflowPouId | null,
      version: workflow.version,
      setup,
      checkpoints: checkpoints.map((checkpoint) => ({
        pouId: checkpoint.pouId as WorkflowPouId,
        ordinal: checkpoint.ordinal,
        progress: checkpoint.progress,
        userSelectedConcern: checkpoint.userSelectedConcern as WorkflowPouConcern | null,
        note: checkpoint.note,
        referralSuggested: checkpoint.referralSuggested,
        supervisorReviewSuggested: checkpoint.supervisorReviewSuggested,
        confirmedAt: checkpoint.confirmedAt,
      })),
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    }
  }

  private async findResumableWorkflowId(actor: AuthenticatedUser): Promise<string | null> {
    const [workflow] = await this.db
      .select({ id: schema.workflowSessions.id })
      .from(schema.workflowSessions)
      .where(and(
        eq(schema.workflowSessions.organisationId, actor.organisation.id),
        eq(schema.workflowSessions.kaimahiUserId, actor.id),
        inArray(schema.workflowSessions.status, ['draft', 'in_progress']),
      ))
      .limit(1)
    return workflow?.id ?? null
  }
}
