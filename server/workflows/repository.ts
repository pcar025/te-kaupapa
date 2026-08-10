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
  type SafetyBroadClass,
  type SafetyObservationConcernLevel,
  type SafetyObservationContext,
  type SafetyObservationSnapshotInput,
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
import {
  evaluateConfirmedSafetyObservation,
  type SafetyConsequenceType,
  type SafetyDecisionCode,
} from '../safety/domain.js'

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

export interface SafetyObservationCurrentView {
  id: string
  assessmentContext: SafetyObservationContext
  pouId: WorkflowPouId | null
  broadClass: SafetyBroadClass
  concernLevel: SafetyObservationConcernLevel
  contextNote: string | null
  status: 'active' | 'retracted'
  currentRevision: number
  confirmedAt: Date
  updatedAt: Date
  retractedAt: Date | null
}

export interface SafetyConsequenceView {
  id: string
  observationId: string
  type: SafetyConsequenceType
  requiredAt: Date
}

export interface SupervisorReviewRequestView {
  id: string
  pouId: WorkflowPouId | null
  requestNote: string | null
  requestedAt: Date
}

export interface WorkflowSafetyIndicators {
  activeObservationCount: number
  urgentObservationCount: number
  supervisorReviewRequired: boolean
  supervisorNotificationRequired: boolean
  manualReviewRequestCount: number
  hasRetractedHistory: boolean
}

export interface WorkflowSafetyState {
  observations: SafetyObservationCurrentView[]
  requiredConsequences: SafetyConsequenceView[]
  supervisorReviewRequests: SupervisorReviewRequestView[]
  indicators: WorkflowSafetyIndicators
}

export interface WorkflowSafetyObservationHistory {
  observation: SafetyObservationCurrentView
  revisions: Array<{
    revision: number
    assessmentContext: SafetyObservationContext
    pouId: WorkflowPouId | null
    broadClass: SafetyBroadClass
    concernLevel: SafetyObservationConcernLevel
    resultingStatus: 'active' | 'retracted'
    operation: 'confirmed' | 'corrected' | 'retracted'
    changeReason: string | null
    createdAt: Date
  }>
  evaluations: Array<{
    observationRevision: number
    ruleCode: string
    ruleVersion: number
    decisionCode: SafetyDecisionCode
    evaluatedAt: Date
  }>
  consequenceEpisodes: Array<{
    id: string
    type: SafetyConsequenceType
    state: 'required' | 'ceased'
    requiredAt: Date
    ceasedAt: Date | null
    cessationReason: 'observation_corrected' | 'observation_retracted' | null
  }>
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
  safety: WorkflowSafetyState
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
  safetyIndicators: WorkflowSafetyIndicators
}

export interface CompletedWorkflowListItem {
  id: string
  reference: string
  whanauReference: string | null
  completedAt: Date
  updatedAt: Date
  safetyIndicators: WorkflowSafetyIndicators
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
  findSafetyObservationHistory(actor: AuthenticatedUser, workflowSessionId: string, observationId: string): Promise<WorkflowSafetyObservationHistory | null>
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

export class StaleSafetyObservationError extends Error {
  constructor(public readonly currentRevision: number) {
    super('The safety observation has changed since it was loaded.')
    this.name = 'StaleSafetyObservationError'
  }
}

export class SafetyObservationIdentifierReuseError extends Error {
  constructor() {
    super('The safety observation identifier is already in use.')
    this.name = 'SafetyObservationIdentifierReuseError'
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

    return Promise.all(rows.map(async (row) => ({
      ...row,
      status: row.status as 'draft' | 'in_progress',
      currentStage: row.currentStage as WorkflowStage,
      currentPouId: row.currentPouId as WorkflowPouId | null,
      safetyIndicators: await this.findSafetyIndicators(row.id, this.db),
    })))
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

    return Promise.all(rows.flatMap((row) => row.completedAt ? [row] : []).map(async (row) => ({
      ...row,
      completedAt: row.completedAt!,
      safetyIndicators: await this.findSafetyIndicators(row.id, this.db),
    })))
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

        const replayAfterLock = await this.findReplay(input.actor, input.command.idempotencyKey, fingerprint, tx)
        if (replayAfterLock) return replayAfterLock

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
        let recordedInteractionId: string | undefined

        if (input.command.type === 'safety-observation-confirmed') {
          this.assertSafetyObservationSnapshot(input.command.observation)
          if (workflow.status === 'completed' || workflow.status === 'abandoned') throw new WorkflowTransitionError()
          const [existing] = await tx
            .select({ id: schema.workflowSafetyObservations.id })
            .from(schema.workflowSafetyObservations)
            .where(eq(schema.workflowSafetyObservations.id, input.command.observationId))
            .limit(1)
          if (existing) throw new SafetyObservationIdentifierReuseError()
          interactionType = 'safety_observation_confirmed'
          interactionPouId = input.command.observation.pouId
          recordedInteractionId = await this.recordInteraction(tx, {
            workflowId: workflow.id, actor: input.actor, interactionType, interactionPouId,
            idempotencyKey: input.command.idempotencyKey, fingerprint, expectedVersion: input.command.expectedVersion, resultingVersion, timestamp,
          })
          const observation = this.normaliseSafetyObservation(input.command.observation)
          await tx.insert(schema.workflowSafetyObservations).values({
            id: input.command.observationId,
            workflowSessionId: workflow.id,
            organisationId: input.actor.organisation.id,
            ...observation,
            status: 'active',
            currentRevision: 1,
            confirmedByUserId: input.actor.id,
            confirmedAt: timestamp,
            updatedAt: timestamp,
          })
          await tx.insert(schema.workflowSafetyObservationRevisions).values({
            observationId: input.command.observationId,
            organisationId: input.actor.organisation.id,
            workflowSessionId: workflow.id,
            revision: 1,
            ...observation,
            resultingStatus: 'active',
            operation: 'confirmed',
            actorUserId: input.actor.id,
            interactionId: recordedInteractionId,
            createdAt: timestamp,
          })
          await this.evaluateAndReconcileSafetyObservation(tx, {
            observationId: input.command.observationId, organisationId: input.actor.organisation.id,
            revision: 1, concernLevel: observation.concernLevel, status: 'active', operation: 'confirmed', timestamp,
          })
          await this.updateSafetyOnlyWorkflow(tx, workflow.id, resultingVersion, timestamp)
        } else if (input.command.type === 'safety-observation-corrected' || input.command.type === 'safety-observation-retracted') {
          if (workflow.status === 'abandoned') throw new WorkflowTransitionError()
          const [current] = await tx.select().from(schema.workflowSafetyObservations).where(and(
            eq(schema.workflowSafetyObservations.id, input.command.observationId),
            eq(schema.workflowSafetyObservations.workflowSessionId, workflow.id),
            eq(schema.workflowSafetyObservations.organisationId, input.actor.organisation.id),
          )).limit(1)
          if (!current) throw new WorkflowNotFoundError()
          if (current.currentRevision !== input.command.expectedObservationRevision) throw new StaleSafetyObservationError(current.currentRevision)
          if (current.status === 'retracted') throw new WorkflowValidationError('A retracted safety observation cannot be changed.')
          const reason = input.command.reason.trim()
          if (!reason) throw new WorkflowValidationError('A correction or retraction reason is required.')
          const isCorrection = input.command.type === 'safety-observation-corrected'
          const replacement = input.command.type === 'safety-observation-corrected' ? input.command.replacement : undefined
          if (replacement) this.assertSafetyObservationSnapshot(replacement)
          const revision = current.currentRevision + 1
          const observation = replacement
            ? this.normaliseSafetyObservation(replacement)
            : {
                assessmentContext: current.assessmentContext as SafetyObservationContext,
                pouId: current.pouId as WorkflowPouId | null,
                broadClass: current.broadClass as SafetyBroadClass,
                concernLevel: current.concernLevel as SafetyObservationConcernLevel,
                contextNote: current.contextNote,
              }
          interactionType = isCorrection ? 'safety_observation_corrected' : 'safety_observation_retracted'
          interactionPouId = observation.pouId ?? undefined
          recordedInteractionId = await this.recordInteraction(tx, {
            workflowId: workflow.id, actor: input.actor, interactionType, interactionPouId,
            idempotencyKey: input.command.idempotencyKey, fingerprint, expectedVersion: input.command.expectedVersion, resultingVersion, timestamp,
          })
          const status = isCorrection ? 'active' as const : 'retracted' as const
          await tx.update(schema.workflowSafetyObservations).set({
            ...observation,
            status,
            currentRevision: revision,
            updatedAt: timestamp,
            retractedAt: isCorrection ? null : timestamp,
          }).where(eq(schema.workflowSafetyObservations.id, current.id))
          await tx.insert(schema.workflowSafetyObservationRevisions).values({
            observationId: current.id,
            organisationId: input.actor.organisation.id,
            workflowSessionId: workflow.id,
            revision,
            ...observation,
            resultingStatus: status,
            operation: isCorrection ? 'corrected' : 'retracted',
            changeReason: reason,
            actorUserId: input.actor.id,
            interactionId: recordedInteractionId,
            createdAt: timestamp,
          })
          await this.evaluateAndReconcileSafetyObservation(tx, {
            observationId: current.id, organisationId: input.actor.organisation.id, revision,
            concernLevel: observation.concernLevel, status, operation: isCorrection ? 'corrected' : 'retracted', timestamp,
          })
          await this.updateSafetyOnlyWorkflow(tx, workflow.id, resultingVersion, timestamp)
        } else if (input.command.type === 'supervisor-review-requested') {
          if (workflow.status === 'completed' || workflow.status === 'abandoned') throw new WorkflowTransitionError()
          interactionType = 'supervisor_review_requested'
          interactionPouId = input.command.pouId
          recordedInteractionId = await this.recordInteraction(tx, {
            workflowId: workflow.id, actor: input.actor, interactionType, interactionPouId,
            idempotencyKey: input.command.idempotencyKey, fingerprint, expectedVersion: input.command.expectedVersion, resultingVersion, timestamp,
          })
          await tx.insert(schema.workflowSupervisorReviewRequests).values({
            id: input.command.requestId,
            workflowSessionId: workflow.id,
            organisationId: input.actor.organisation.id,
            pouId: input.command.pouId ?? null,
            requestNote: input.command.requestNote?.trim() || null,
            requestedByUserId: input.actor.id,
            interactionId: recordedInteractionId,
            requestedAt: timestamp,
          })
          await this.updateSafetyOnlyWorkflow(tx, workflow.id, resultingVersion, timestamp)
        } else if (input.command.type === 'setup-confirmed') {
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

        const interactionId = recordedInteractionId ?? await this.recordInteraction(tx, {
          workflowId: workflow.id, actor: input.actor, interactionType, interactionPouId,
          idempotencyKey: input.command.idempotencyKey, fingerprint, expectedVersion: input.command.expectedVersion, resultingVersion, timestamp,
        })
        return { workflowId: workflow.id, interactionId, replayed: false }
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

  async findSafetyObservationHistory(
    actor: AuthenticatedUser,
    workflowSessionId: string,
    observationId: string,
  ): Promise<WorkflowSafetyObservationHistory | null> {
    const workflow = await this.findByIdWithExecutor(actor, workflowSessionId, this.db)
    if (!workflow) return null
    const [observation] = await this.db.select().from(schema.workflowSafetyObservations).where(and(
      eq(schema.workflowSafetyObservations.id, observationId),
      eq(schema.workflowSafetyObservations.workflowSessionId, workflowSessionId),
      eq(schema.workflowSafetyObservations.organisationId, actor.organisation.id),
    )).limit(1)
    if (!observation) return null
    const [revisions, evaluations, consequences] = await Promise.all([
      this.db.select().from(schema.workflowSafetyObservationRevisions).where(and(
        eq(schema.workflowSafetyObservationRevisions.observationId, observation.id),
        eq(schema.workflowSafetyObservationRevisions.organisationId, actor.organisation.id),
      )).orderBy(schema.workflowSafetyObservationRevisions.revision),
      this.db.select().from(schema.workflowSafetyRuleEvaluations).where(and(
        eq(schema.workflowSafetyRuleEvaluations.observationId, observation.id),
        eq(schema.workflowSafetyRuleEvaluations.organisationId, actor.organisation.id),
      )).orderBy(schema.workflowSafetyRuleEvaluations.observationRevision),
      this.db.select().from(schema.workflowSafetyConsequences).where(and(
        eq(schema.workflowSafetyConsequences.observationId, observation.id),
        eq(schema.workflowSafetyConsequences.organisationId, actor.organisation.id),
      )).orderBy(schema.workflowSafetyConsequences.requiredAt),
    ])
    return {
      observation: this.toSafetyObservationView(observation),
      revisions: revisions.map((revision) => ({
        revision: revision.revision,
        assessmentContext: revision.assessmentContext as SafetyObservationContext,
        pouId: revision.pouId as WorkflowPouId | null,
        broadClass: revision.broadClass as SafetyBroadClass,
        concernLevel: revision.concernLevel as SafetyObservationConcernLevel,
        resultingStatus: revision.resultingStatus as 'active' | 'retracted',
        operation: revision.operation as 'confirmed' | 'corrected' | 'retracted',
        changeReason: revision.changeReason,
        createdAt: revision.createdAt,
      })),
      evaluations: evaluations.map((evaluation) => ({
        observationRevision: evaluation.observationRevision,
        ruleCode: evaluation.ruleCode,
        ruleVersion: evaluation.ruleVersion,
        decisionCode: evaluation.decisionCode as SafetyDecisionCode,
        evaluatedAt: evaluation.evaluatedAt,
      })),
      consequenceEpisodes: consequences.map((consequence) => ({
        id: consequence.id,
        type: consequence.type as SafetyConsequenceType,
        state: consequence.state as 'required' | 'ceased',
        requiredAt: consequence.requiredAt,
        ceasedAt: consequence.ceasedAt,
        cessationReason: consequence.cessationReason as 'observation_corrected' | 'observation_retracted' | null,
      })),
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

  private assertSafetyObservationSnapshot(snapshot: SafetyObservationSnapshotInput) {
    const hasPou = snapshot.pouId !== undefined
    if ((snapshot.assessmentContext === 'setup' && hasPou) || (snapshot.assessmentContext === 'pou' && !hasPou)) {
      throw new WorkflowValidationError('Safety observation context and Pou must be consistent.')
    }
    if ((snapshot.assessmentContext === 'setup' && !['unsure', 'urgent'].includes(snapshot.concernLevel))
      || (snapshot.assessmentContext === 'pou' && !['low', 'watch', 'action', 'urgent'].includes(snapshot.concernLevel))) {
      throw new WorkflowValidationError('Safety observation concern level is not permitted for its context.')
    }
    if (snapshot.contextNote !== undefined && snapshot.contextNote.trim().length > 4_000) {
      throw new WorkflowValidationError('Safety observation context note is too long.')
    }
  }

  private normaliseSafetyObservation(snapshot: SafetyObservationSnapshotInput) {
    return {
      assessmentContext: snapshot.assessmentContext,
      pouId: snapshot.pouId ?? null,
      broadClass: snapshot.broadClass,
      concernLevel: snapshot.concernLevel,
      contextNote: snapshot.contextNote?.trim() || null,
    }
  }

  private async recordInteraction(
    executor: WorkflowDatabase,
    input: {
      workflowId: string
      actor: AuthenticatedUser
      interactionType: WorkflowInteractionType
      interactionPouId?: WorkflowPouId
      idempotencyKey: string
      fingerprint: string
      expectedVersion: number
      resultingVersion: number
      timestamp: Date
    },
  ): Promise<string> {
    const [interaction] = await executor.insert(schema.workflowInteractions).values({
      workflowSessionId: input.workflowId,
      organisationId: input.actor.organisation.id,
      actorUserId: input.actor.id,
      type: input.interactionType,
      pouId: input.interactionPouId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.fingerprint,
      expectedVersion: input.expectedVersion,
      resultingVersion: input.resultingVersion,
      createdAt: input.timestamp,
    }).returning({ id: schema.workflowInteractions.id })
    if (!interaction) throw new Error('The workflow interaction was not recorded.')
    return interaction.id
  }

  private async updateSafetyOnlyWorkflow(executor: WorkflowDatabase, workflowId: string, version: number, timestamp: Date) {
    await executor.update(schema.workflowSessions).set({ version, updatedAt: timestamp }).where(eq(schema.workflowSessions.id, workflowId))
  }

  private async evaluateAndReconcileSafetyObservation(
    executor: WorkflowDatabase,
    input: {
      observationId: string
      organisationId: string
      revision: number
      concernLevel: SafetyObservationConcernLevel
      status: 'active' | 'retracted'
      operation: 'confirmed' | 'corrected' | 'retracted'
      timestamp: Date
    },
  ) {
    const policy = evaluateConfirmedSafetyObservation({ concernLevel: input.concernLevel, status: input.status })
    const evaluationId = crypto.randomUUID()
    await executor.insert(schema.workflowSafetyRuleEvaluations).values({
      id: evaluationId,
      observationId: input.observationId,
      organisationId: input.organisationId,
      observationRevision: input.revision,
      ruleCode: policy.ruleCode,
      ruleVersion: policy.ruleVersion,
      decisionCode: policy.decisionCode,
      evaluatedAt: input.timestamp,
    })
    const active = await executor.select().from(schema.workflowSafetyConsequences).where(and(
      eq(schema.workflowSafetyConsequences.observationId, input.observationId),
      eq(schema.workflowSafetyConsequences.organisationId, input.organisationId),
      eq(schema.workflowSafetyConsequences.state, 'required'),
    ))
    const activeTypes = new Set(active.map(({ type }) => type as SafetyConsequenceType))
    for (const type of policy.consequenceTypes) {
      if (activeTypes.has(type)) continue
      await executor.insert(schema.workflowSafetyConsequences).values({
        id: crypto.randomUUID(),
        observationId: input.observationId,
        organisationId: input.organisationId,
        type,
        state: 'required',
        createdByEvaluationId: evaluationId,
        requiredAt: input.timestamp,
      })
    }
    if (policy.consequenceTypes.length === 0 && active.length > 0) {
      const cessationReason = input.operation === 'retracted' ? 'observation_retracted' : 'observation_corrected'
      await executor.update(schema.workflowSafetyConsequences).set({
        state: 'ceased',
        ceasedByEvaluationId: evaluationId,
        cessationReason,
        ceasedAt: input.timestamp,
      }).where(and(
        eq(schema.workflowSafetyConsequences.observationId, input.observationId),
        eq(schema.workflowSafetyConsequences.organisationId, input.organisationId),
        eq(schema.workflowSafetyConsequences.state, 'required'),
      ))
    }
  }

  private async findSafetyIndicators(workflowSessionId: string, executor: WorkflowDatabase): Promise<WorkflowSafetyIndicators> {
    const observations = await executor.select().from(schema.workflowSafetyObservations)
      .where(eq(schema.workflowSafetyObservations.workflowSessionId, workflowSessionId))
    const consequences = await executor.select({ type: schema.workflowSafetyConsequences.type }).from(schema.workflowSafetyConsequences)
      .innerJoin(schema.workflowSafetyObservations, eq(schema.workflowSafetyConsequences.observationId, schema.workflowSafetyObservations.id))
      .where(and(eq(schema.workflowSafetyObservations.workflowSessionId, workflowSessionId), eq(schema.workflowSafetyConsequences.state, 'required')))
    const requests = await executor.select({ id: schema.workflowSupervisorReviewRequests.id }).from(schema.workflowSupervisorReviewRequests)
      .where(eq(schema.workflowSupervisorReviewRequests.workflowSessionId, workflowSessionId))
    const active = observations.filter(({ status }) => status === 'active')
    const requiredTypes = new Set(consequences.map(({ type }) => type))
    return {
      activeObservationCount: active.length,
      urgentObservationCount: active.filter(({ concernLevel }) => concernLevel === 'urgent').length,
      supervisorReviewRequired: requiredTypes.has('supervisor_review_required'),
      supervisorNotificationRequired: requiredTypes.has('supervisor_notification_required'),
      manualReviewRequestCount: requests.length,
      hasRetractedHistory: observations.some(({ status }) => status === 'retracted'),
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

    const actions = await executor
      .select()
      .from(schema.workflowActions)
      .where(eq(schema.workflowActions.workflowSessionId, workflow.id))
      .orderBy(schema.workflowActions.createdAt)
    const referrals = await executor
      .select()
      .from(schema.workflowReferrals)
      .where(eq(schema.workflowReferrals.workflowSessionId, workflow.id))
      .orderBy(schema.workflowReferrals.createdAt)
    const safety = await this.findSafetyState(workflow.id, executor)

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
      safety,
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

  private toSafetyObservationView(observation: typeof schema.workflowSafetyObservations.$inferSelect): SafetyObservationCurrentView {
    return {
      id: observation.id,
      assessmentContext: observation.assessmentContext as SafetyObservationContext,
      pouId: observation.pouId as WorkflowPouId | null,
      broadClass: observation.broadClass as SafetyBroadClass,
      concernLevel: observation.concernLevel as SafetyObservationConcernLevel,
      contextNote: observation.contextNote,
      status: observation.status as 'active' | 'retracted',
      currentRevision: observation.currentRevision,
      confirmedAt: observation.confirmedAt,
      updatedAt: observation.updatedAt,
      retractedAt: observation.retractedAt,
    }
  }

  private async findSafetyState(workflowSessionId: string, executor: WorkflowDatabase): Promise<WorkflowSafetyState> {
    const observations = await executor.select().from(schema.workflowSafetyObservations)
      .where(eq(schema.workflowSafetyObservations.workflowSessionId, workflowSessionId))
      .orderBy(schema.workflowSafetyObservations.confirmedAt)
    const requiredConsequences = await executor.select({
      id: schema.workflowSafetyConsequences.id,
      observationId: schema.workflowSafetyConsequences.observationId,
      type: schema.workflowSafetyConsequences.type,
      requiredAt: schema.workflowSafetyConsequences.requiredAt,
    }).from(schema.workflowSafetyConsequences)
      .innerJoin(schema.workflowSafetyObservations, eq(schema.workflowSafetyConsequences.observationId, schema.workflowSafetyObservations.id))
      .where(and(eq(schema.workflowSafetyObservations.workflowSessionId, workflowSessionId), eq(schema.workflowSafetyConsequences.state, 'required')))
      .orderBy(schema.workflowSafetyConsequences.requiredAt)
    const requests = await executor.select().from(schema.workflowSupervisorReviewRequests)
      .where(eq(schema.workflowSupervisorReviewRequests.workflowSessionId, workflowSessionId))
      .orderBy(schema.workflowSupervisorReviewRequests.requestedAt)
    const indicators = await this.findSafetyIndicators(workflowSessionId, executor)
    return {
      observations: observations.map((observation) => this.toSafetyObservationView(observation)),
      requiredConsequences: requiredConsequences.map((consequence) => ({
        ...consequence,
        type: consequence.type as SafetyConsequenceType,
      })),
      supervisorReviewRequests: requests.map((request) => ({
        id: request.id,
        pouId: request.pouId as WorkflowPouId | null,
        requestNote: request.requestNote,
        requestedAt: request.requestedAt,
      })),
      indicators,
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
