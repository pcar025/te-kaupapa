import { createHash, randomBytes } from 'node:crypto'

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import {
  WORKFLOW_POU_IDS,
  type WorkflowActionInput,
  type WorkflowActionStatus,
  type WorkflowActionType,
  type WorkflowCommand,
  type WorkflowImmediateConcern,
  type WorkflowInteractionType,
  type WorkflowPouConcern,
  type WorkflowPouId,
  type WorkflowReferralInput,
  type WorkflowReferralStatus,
  type WorkflowStage,
  type WorkflowStatus,
} from '../../shared/workflow.js'
import type { AuthenticatedUser } from '../domain/auth.js'
import * as schema from '../db/schema.js'
import {
  checkpointAfterActionPlan,
  checkpointAfterCompletion,
  checkpointAfterPouReview,
  checkpointAfterPouSummary,
  checkpointAfterReferralPlan,
  checkpointAfterSetup,
  checkpointAfterStructuredReview,
  WorkflowTransitionError,
} from './domain.js'

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

export interface WorkflowActionView {
  id: string
  pouId: WorkflowPouId | null
  title: string
  type: WorkflowActionType
  dueDate: string | null
  status: WorkflowActionStatus
  notes: string | null
  withdrawnAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface WorkflowReferralView {
  id: string
  pouId: WorkflowPouId | null
  destinationCode: string | null
  destinationName: string
  reason: string
  handoverNote: string | null
  notes: string | null
  status: WorkflowReferralStatus
  withdrawnAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface WorkflowStructuredReview {
  reference: string
  setup: WorkflowView['setup']
  checkpoints: WorkflowCheckpointView[]
  actions: WorkflowActionView[]
  referrals: WorkflowReferralView[]
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
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
  actions: WorkflowActionView[]
  referrals: WorkflowReferralView[]
  structuredReview: WorkflowStructuredReview
  completedAt: Date | null
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

export interface CompletedWorkflowListItem {
  id: string
  reference: string
  whanauReference: string | null
  completedAt: Date
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
  listCompleted(actor: AuthenticatedUser): Promise<CompletedWorkflowListItem[]>
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

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowValidationError'
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

  async listCompleted(actor: AuthenticatedUser): Promise<CompletedWorkflowListItem[]> {
    const rows = await this.db
      .select({
        id: schema.workflowSessions.id,
        reference: schema.workflowSessions.reference,
        whanauReference: schema.workflowSessions.whanauReference,
        completedAt: schema.workflowSessions.completedAt,
        updatedAt: schema.workflowSessions.updatedAt,
      })
      .from(schema.workflowSessions)
      .where(and(
        eq(schema.workflowSessions.organisationId, actor.organisation.id),
        eq(schema.workflowSessions.kaimahiUserId, actor.id),
        eq(schema.workflowSessions.status, 'completed'),
      ))
      .orderBy(desc(schema.workflowSessions.completedAt))
      .limit(50)

    return rows.flatMap((row) => row.completedAt ? [{ ...row, completedAt: row.completedAt }] : [])
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
        let interactionType: WorkflowInteractionType
        let interactionPouId: WorkflowPouId | undefined

        if (input.command.type === 'setup-confirmed') {
          const isInitialSetup = workflow.status === 'draft' && workflow.currentStage === 'setup'
          const isSetupRevision = workflow.status === 'in_progress' && workflow.currentStage === 'pou-overview'
          if (!isInitialSetup && !isSetupRevision) throw new WorkflowTransitionError()
          const checkpoint = isInitialSetup
            ? checkpointAfterSetup()
            : { stage: workflow.currentStage, currentPouId: workflow.currentPouId }
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
        } else if (input.command.type === 'pou-review-confirmed') {
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
        } else {
          if (workflow.status !== 'in_progress') throw new WorkflowTransitionError()
          const checkpoint = {
            stage: workflow.currentStage as WorkflowStage,
            currentPouId: workflow.currentPouId as WorkflowPouId | null,
          }

          if (input.command.type === 'pou-summary-confirmed') {
            const checkpoints = await tx
              .select({ progress: schema.workflowPouCheckpoints.progress })
              .from(schema.workflowPouCheckpoints)
              .where(eq(schema.workflowPouCheckpoints.workflowSessionId, workflow.id))
            if (checkpoints.length !== WORKFLOW_POU_IDS.length || checkpoints.some(({ progress }) => progress !== 'confirmed')) {
              throw new WorkflowTransitionError('All seven Pou must be confirmed before the summary can be acknowledged.')
            }
            const next = checkpointAfterPouSummary(checkpoint)
            await this.updateWorkflowCheckpoint(tx, workflow.id, next, resultingVersion, timestamp)
            interactionType = 'pou_summary_confirmed'
          } else if (input.command.type === 'action-plan-confirmed') {
            const next = workflow.currentStage === 'action-planning'
              ? checkpointAfterActionPlan(checkpoint)
              : this.assertActionRevisionStage(checkpoint)
            await this.replaceActions(tx, workflow.id, input.actor, input.command.actions, timestamp)
            await this.updateWorkflowCheckpoint(tx, workflow.id, next, resultingVersion, timestamp)
            interactionType = 'action_plan_confirmed'
          } else if (input.command.type === 'referral-plan-confirmed') {
            const next = workflow.currentStage === 'referral-planning'
              ? checkpointAfterReferralPlan(checkpoint)
              : this.assertReferralRevisionStage(checkpoint)
            await this.replaceReferrals(tx, workflow.id, input.actor, input.command.referrals, timestamp)
            await this.updateWorkflowCheckpoint(tx, workflow.id, next, resultingVersion, timestamp)
            interactionType = 'referral_plan_confirmed'
          } else if (input.command.type === 'structured-review-confirmed') {
            const next = checkpointAfterStructuredReview(checkpoint)
            await this.updateWorkflowCheckpoint(tx, workflow.id, next, resultingVersion, timestamp)
            interactionType = 'structured_review_confirmed'
          } else {
            const next = checkpointAfterCompletion(checkpoint)
            await tx.update(schema.workflowSessions).set({
              status: 'completed',
              currentStage: next.stage,
              currentPouId: next.currentPouId,
              completedAt: timestamp,
              completedByUserId: input.actor.id,
              version: resultingVersion,
              updatedAt: timestamp,
            }).where(eq(schema.workflowSessions.id, workflow.id))
            interactionType = 'workflow_completed'
          }
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

  private assertActionRevisionStage(checkpoint: { stage: WorkflowStage; currentPouId: WorkflowPouId | null }) {
    if (!['referral-planning', 'structured-review', 'record-review'].includes(checkpoint.stage)) throw new WorkflowTransitionError()
    return checkpoint
  }

  private assertReferralRevisionStage(checkpoint: { stage: WorkflowStage; currentPouId: WorkflowPouId | null }) {
    if (!['structured-review', 'record-review'].includes(checkpoint.stage)) throw new WorkflowTransitionError()
    return checkpoint
  }

  private async updateWorkflowCheckpoint(
    executor: WorkflowDatabase,
    workflowId: string,
    checkpoint: { stage: WorkflowStage; currentPouId: WorkflowPouId | null },
    version: number,
    timestamp: Date,
  ) {
    await executor.update(schema.workflowSessions).set({
      currentStage: checkpoint.stage,
      currentPouId: checkpoint.currentPouId,
      version,
      updatedAt: timestamp,
    }).where(eq(schema.workflowSessions.id, workflowId))
  }

  private assertUniqueIds(items: Array<{ id: string }>, kind: string) {
    if (new Set(items.map(({ id }) => id)).size !== items.length) {
      throw new WorkflowValidationError(`${kind} identifiers must be unique.`)
    }
  }

  private async replaceActions(
    executor: WorkflowDatabase,
    workflowId: string,
    actor: AuthenticatedUser,
    actions: WorkflowActionInput[],
    timestamp: Date,
  ) {
    this.assertUniqueIds(actions, 'Action')
    const existing = await executor
      .select()
      .from(schema.workflowActions)
      .where(eq(schema.workflowActions.workflowSessionId, workflowId))
    const existingById = new Map(existing.map((action) => [action.id, action]))
    const requestedIds = new Set(actions.map(({ id }) => id))

    for (const action of actions) {
      const values = {
        pouId: action.pouId ?? null,
        title: action.title.trim(),
        type: action.type,
        dueDate: action.dueDate ?? null,
        status: action.status,
        notes: action.notes?.trim() || null,
        withdrawnAt: null,
        updatedAt: timestamp,
      }
      if (existingById.has(action.id)) {
        await executor.update(schema.workflowActions).set(values).where(and(
          eq(schema.workflowActions.id, action.id),
          eq(schema.workflowActions.workflowSessionId, workflowId),
        ))
      } else {
        await executor.insert(schema.workflowActions).values({
          id: action.id,
          workflowSessionId: workflowId,
          organisationId: actor.organisation.id,
          createdByUserId: actor.id,
          ownerUserId: actor.id,
          ...values,
          createdAt: timestamp,
        })
      }
    }

    for (const action of existing) {
      if (!requestedIds.has(action.id) && action.status !== 'withdrawn') {
        await executor.update(schema.workflowActions).set({
          status: 'withdrawn',
          withdrawnAt: timestamp,
          updatedAt: timestamp,
        }).where(eq(schema.workflowActions.id, action.id))
      }
    }
  }

  private async replaceReferrals(
    executor: WorkflowDatabase,
    workflowId: string,
    actor: AuthenticatedUser,
    referrals: WorkflowReferralInput[],
    timestamp: Date,
  ) {
    this.assertUniqueIds(referrals, 'Referral')
    const existing = await executor
      .select()
      .from(schema.workflowReferrals)
      .where(eq(schema.workflowReferrals.workflowSessionId, workflowId))
    const existingById = new Map(existing.map((referral) => [referral.id, referral]))
    const requestedIds = new Set(referrals.map(({ id }) => id))

    for (const referral of referrals) {
      const values = {
        pouId: referral.pouId ?? null,
        destinationCode: referral.destinationCode?.trim() || null,
        destinationName: referral.destinationName.trim(),
        reason: referral.reason.trim(),
        handoverNote: referral.handoverNote?.trim() || null,
        notes: referral.notes?.trim() || null,
        status: referral.status,
        withdrawnAt: null,
        updatedAt: timestamp,
      }
      if (existingById.has(referral.id)) {
        await executor.update(schema.workflowReferrals).set(values).where(and(
          eq(schema.workflowReferrals.id, referral.id),
          eq(schema.workflowReferrals.workflowSessionId, workflowId),
        ))
      } else {
        await executor.insert(schema.workflowReferrals).values({
          id: referral.id,
          workflowSessionId: workflowId,
          organisationId: actor.organisation.id,
          createdByUserId: actor.id,
          ...values,
          createdAt: timestamp,
        })
      }
    }

    for (const referral of existing) {
      if (!requestedIds.has(referral.id) && referral.status !== 'withdrawn') {
        await executor.update(schema.workflowReferrals).set({
          status: 'withdrawn',
          withdrawnAt: timestamp,
          updatedAt: timestamp,
        }).where(eq(schema.workflowReferrals.id, referral.id))
      }
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

    const [actions, referrals] = await Promise.all([
      executor
        .select()
        .from(schema.workflowActions)
        .where(eq(schema.workflowActions.workflowSessionId, workflow.id))
        .orderBy(schema.workflowActions.createdAt),
      executor
        .select()
        .from(schema.workflowReferrals)
        .where(eq(schema.workflowReferrals.workflowSessionId, workflow.id))
        .orderBy(schema.workflowReferrals.createdAt),
    ])

    const setup = workflow.whanauReference && workflow.engagementType && workflow.sessionFocus && workflow.immediateConcern
      ? {
          whanauReference: workflow.whanauReference,
          engagementType: workflow.engagementType,
          sessionFocus: workflow.sessionFocus,
          additionalNotes: workflow.additionalNotes,
          immediateConcern: workflow.immediateConcern,
        }
      : null

    const checkpointViews = checkpoints.map((checkpoint) => ({
      pouId: checkpoint.pouId as WorkflowPouId,
      ordinal: checkpoint.ordinal,
      progress: checkpoint.progress,
      userSelectedConcern: checkpoint.userSelectedConcern as WorkflowPouConcern | null,
      note: checkpoint.note,
      referralSuggested: checkpoint.referralSuggested,
      supervisorReviewSuggested: checkpoint.supervisorReviewSuggested,
      confirmedAt: checkpoint.confirmedAt,
    }))
    const actionViews = actions.map((action) => ({
      id: action.id,
      pouId: action.pouId as WorkflowPouId | null,
      title: action.title,
      type: action.type as WorkflowActionType,
      dueDate: action.dueDate,
      status: action.status as WorkflowActionStatus,
      notes: action.notes,
      withdrawnAt: action.withdrawnAt,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
    }))
    const referralViews = referrals.map((referral) => ({
      id: referral.id,
      pouId: referral.pouId as WorkflowPouId | null,
      destinationCode: referral.destinationCode,
      destinationName: referral.destinationName,
      reason: referral.reason,
      handoverNote: referral.handoverNote,
      notes: referral.notes,
      status: referral.status as WorkflowReferralStatus,
      withdrawnAt: referral.withdrawnAt,
      createdAt: referral.createdAt,
      updatedAt: referral.updatedAt,
    }))

    const view = {
      id: workflow.id,
      reference: workflow.reference,
      status: workflow.status as WorkflowStatus,
      currentStage: workflow.currentStage as WorkflowStage,
      currentPouId: workflow.currentPouId as WorkflowPouId | null,
      version: workflow.version,
      setup,
      checkpoints: checkpointViews,
      actions: actionViews,
      referrals: referralViews,
      completedAt: workflow.completedAt,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    }
    return {
      ...view,
      structuredReview: {
        reference: view.reference,
        setup: view.setup,
        checkpoints: view.checkpoints,
        actions: view.actions.filter(({ status }) => status !== 'withdrawn'),
        referrals: view.referrals.filter(({ status }) => status !== 'withdrawn'),
        createdAt: view.createdAt,
        updatedAt: view.updatedAt,
        completedAt: view.completedAt,
      },
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
