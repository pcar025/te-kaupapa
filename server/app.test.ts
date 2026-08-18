// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { createApplication } from './app.js'
import { sha256 } from './auth/crypto.js'
import type { OidcProvider } from './auth/oidc.js'
import { sessionExpiresAt, sessionHasIdleExpired } from './auth/session-policy.js'
import type { AppConfiguration } from './config.js'
import type { AuthRepository, CreateSessionInput } from './db/repository.js'
import type { AuthenticatedUser } from './domain/auth.js'
import {
  IdempotencyKeyReuseError,
  SafetyObservationIdentifierReuseError,
  StaleSafetyObservationError,
  StaleWorkflowError,
  WorkflowNotFoundError,
  type WorkflowMutationResult,
  type WorkflowRepository,
  type WorkflowView,
} from './workflows/repository.js'
import type { CreateWorkflowInput, SubmitWorkflowCommandInput } from './workflows/repository.js'
import {
  checkpointAfterActionPlan,
  checkpointAfterCompletion,
  checkpointAfterPouReview,
  checkpointAfterPouSummary,
  checkpointAfterReferralPlan,
  checkpointAfterSetup,
  checkpointAfterStructuredReview,
  WorkflowTransitionError,
} from './workflows/domain.js'
import { WORKFLOW_POU_IDS, type WorkflowCommand, type WorkflowPouId } from '../shared/workflow.js'
import type { CompletedWorkflowListItem, WorkflowListItem } from './workflows/repository.js'
import type { ConversationRecord } from './conversations/repository.js'
import type { ConversationApplicationService } from './conversations/service.js'
import { SafetyAssessmentValidationError } from './safety-assessments/repository.js'
import { PouSpecificationUnavailableError } from './pou-specifications/repository.js'

const activeKaimahi: AuthenticatedUser = {
  id: '0a7e65f8-3f45-4a2b-b837-7891aeff2ec4',
  displayName: 'Test Kaimahi',
  status: 'active',
  organisation: { id: 'fe750d03-3a1e-48c1-a8c0-d1c3855bb2f1', slug: 'test', name: 'Test organisation' },
  roles: ['KAIMAHI'],
}

class MemoryRepository implements AuthRepository {
  readonly identities = new Map<string, AuthenticatedUser>()
  readonly sessions = new Map<string, CreateSessionInput & { invalidatedAt?: Date }>()
  readonly supervision = new Set<string>()

  async findUserByExternalIdentity(provider: string, subject: string) {
    return this.identities.get(`${provider}:${subject}`) ?? null
  }

  async createSession(input: CreateSessionInput) {
    this.sessions.set(input.tokenHash, input)
  }

  async findUserBySessionHash(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash)
    if (!session) return null
    const lastActivityAt = session.lastActivityAt ?? session.expiresAt
    if (session.invalidatedAt || session.expiresAt <= now || sessionHasIdleExpired(session.mode ?? 'standard', lastActivityAt, now)) return null
    return [...this.identities.values()].find((user) => user.id === session.userId) ?? null
  }

  async touchSession(tokenHash: string, activityAt: Date) {
    const session = this.sessions.get(tokenHash)
    if (session) session.lastActivityAt = activityAt
  }

  async invalidateSession(tokenHash: string, invalidatedAt: Date) {
    const session = this.sessions.get(tokenHash)
    if (session) session.invalidatedAt = invalidatedAt
  }

  async invalidateSessionsForUser(userId: string, invalidatedAt: Date) {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.invalidatedAt) session.invalidatedAt = invalidatedAt
    }
  }

  async isSupervisorOf(supervisorUserId: string, kaimahiUserId: string) {
    return this.supervision.has(`${supervisorUserId}:${kaimahiUserId}`)
  }
}

class FakeOidcProvider implements OidcProvider {
  authorizationUrl(input: { state: string }) {
    return `https://idp.test/authorize?state=${encodeURIComponent(input.state)}`
  }

  async exchangeCode() {
    return { provider: 'cognito' as const, subject: 'cognito-subject', email: 'test@example.invalid', displayName: 'Test Kaimahi' }
  }
}

class MemoryWorkflowRepository implements WorkflowRepository {
  private readonly workflows = new Map<string, Omit<WorkflowView, 'structuredReview'> & { ownerId: string }>()
  private readonly operations = new Map<string, { fingerprint: string; result: WorkflowMutationResult }>()

  async createDraft(input: CreateWorkflowInput): Promise<WorkflowMutationResult> {
    const key = `${input.actor.id}:${input.idempotencyKey}`
    const existing = this.operations.get(key)
    if (existing) return { ...existing.result, replayed: true }
    const workflow: Omit<WorkflowView, 'structuredReview'> & { ownerId: string } = {
      id: '22b1f80c-2c12-4f82-bdd9-65d7b30712bb',
      reference: 'TK-7K4M2P9Q',
      status: 'draft',
      currentStage: 'setup',
      currentPouId: null,
      version: 1,
      setup: null,
      checkpoints: WORKFLOW_POU_IDS.map((pouId, ordinal) => ({
        pouId,
        ordinal: ordinal + 1,
        progress: 'not_started',
        userSelectedConcern: null,
        note: null,
        referralSuggested: false,
        supervisorReviewSuggested: false,
        confirmedAt: null,
      })),
      actions: [],
      referrals: [],
      carryForwards: [],
      pouReviews: [],
      safety: {
        observations: [],
        requiredConsequences: [],
        supervisorReviewRequests: [],
        indicators: {
          activeObservationCount: 0,
          urgentObservationCount: 0,
          supervisorReviewRequired: false,
          supervisorNotificationRequired: false,
          manualReviewRequestCount: 0,
          hasRetractedHistory: false,
        },
      },
      completedAt: null,
      createdAt: new Date('2026-08-10T00:00:00.000Z'),
      updatedAt: new Date('2026-08-10T00:00:00.000Z'),
      ownerId: input.actor.id,
    }
    this.workflows.set(workflow.id, workflow)
    const result = { workflow: this.publicWorkflow(workflow), interactionId: '630d8188-c67d-4c65-a8ef-505254c819d5', replayed: false }
    this.operations.set(key, { fingerprint: 'create', result })
    return result
  }

  async findById(actor: AuthenticatedUser, workflowSessionId: string): Promise<WorkflowView | null> {
    const workflow = this.workflows.get(workflowSessionId)
    return workflow?.ownerId === actor.id ? this.publicWorkflow(workflow) : null
  }

  async listResumable(actor: AuthenticatedUser): Promise<WorkflowListItem[]> {
    return [...this.workflows.values()]
      .filter((workflow) => workflow.ownerId === actor.id && (workflow.status === 'draft' || workflow.status === 'in_progress'))
      .map((workflow) => ({
        id: workflow.id,
        reference: workflow.reference,
        whanauReference: workflow.setup?.whanauReference ?? null,
        status: workflow.status as 'draft' | 'in_progress',
        currentStage: workflow.currentStage,
        currentPouId: workflow.currentPouId,
        version: workflow.version,
        updatedAt: workflow.updatedAt,
        safetyIndicators: workflow.safety.indicators,
      }))
  }

  async listCompleted(actor: AuthenticatedUser): Promise<CompletedWorkflowListItem[]> {
    return [...this.workflows.values()]
      .filter((workflow) => workflow.ownerId === actor.id && workflow.status === 'completed' && workflow.completedAt)
      .map((workflow) => ({
        id: workflow.id,
        reference: workflow.reference,
        whanauReference: workflow.setup?.whanauReference ?? null,
        completedAt: workflow.completedAt!,
        updatedAt: workflow.updatedAt,
        safetyIndicators: workflow.safety.indicators,
      }))
  }

  async submitCommand(input: SubmitWorkflowCommandInput): Promise<WorkflowMutationResult> {
    const workflow = this.workflows.get(input.workflowSessionId)
    if (!workflow || workflow.ownerId !== input.actor.id) throw new WorkflowNotFoundError()
    const key = `${input.actor.id}:${input.command.idempotencyKey}`
    const fingerprint = JSON.stringify(input.command)
    const existing = this.operations.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new IdempotencyKeyReuseError()
      return { ...existing.result, replayed: true }
    }
    if (workflow.version !== input.command.expectedVersion) throw new StaleWorkflowError(workflow.version)
    const command = input.command

    if (command.type === 'safety-observation-confirmed') {
      if (workflow.status === 'completed') throw new WorkflowTransitionError()
      if (workflow.safety.observations.some(({ id }) => id === command.observationId)) throw new SafetyObservationIdentifierReuseError()
      const observation = command.observation
      workflow.safety.observations.push({
        id: command.observationId,
        assessmentContext: observation.assessmentContext,
        pouId: observation.pouId ?? null,
        broadClass: observation.broadClass,
        concernLevel: observation.concernLevel,
        contextNote: observation.contextNote ?? null,
        status: 'active',
        currentRevision: 1,
        confirmedAt: new Date('2026-08-10T00:00:00.000Z'),
        updatedAt: new Date('2026-08-10T00:00:00.000Z'),
        retractedAt: null,
      })
      this.recalculateSafety(workflow)
    } else if (command.type === 'safety-observation-corrected' || command.type === 'safety-observation-retracted') {
      const observationId = command.observationId
      const expectedObservationRevision = command.expectedObservationRevision
      const observation = workflow.safety.observations.find(({ id }) => id === observationId)
      if (!observation) throw new WorkflowNotFoundError()
      if (observation.currentRevision !== expectedObservationRevision) throw new StaleSafetyObservationError(observation.currentRevision)
      if (observation.status === 'retracted') throw new WorkflowTransitionError()
      if (input.command.type === 'safety-observation-corrected') {
        observation.assessmentContext = input.command.replacement.assessmentContext
        observation.pouId = input.command.replacement.pouId ?? null
        observation.broadClass = input.command.replacement.broadClass
        observation.concernLevel = input.command.replacement.concernLevel
        observation.contextNote = input.command.replacement.contextNote ?? null
      } else {
        observation.status = 'retracted'
        observation.retractedAt = new Date('2026-08-10T00:00:00.000Z')
      }
      observation.currentRevision += 1
      observation.updatedAt = new Date('2026-08-10T00:00:00.000Z')
      this.recalculateSafety(workflow)
    } else if (input.command.type === 'supervisor-review-requested') {
      if (workflow.status === 'completed') throw new WorkflowTransitionError()
      workflow.safety.supervisorReviewRequests.push({
        id: input.command.requestId,
        pouId: input.command.pouId ?? null,
        requestNote: input.command.requestNote ?? null,
        requestedAt: new Date('2026-08-10T00:00:00.000Z'),
      })
      this.recalculateSafety(workflow)
    } else if (input.command.type === 'setup-confirmed') {
      const next = checkpointAfterSetup()
      workflow.status = 'in_progress'
      workflow.currentStage = next.stage
      workflow.currentPouId = next.currentPouId
      workflow.setup = {
        whanauReference: input.command.whanauReference.trim(),
        engagementType: input.command.engagementType,
        sessionFocus: input.command.sessionFocus,
        additionalNotes: input.command.additionalNotes || null,
        immediateConcern: input.command.immediateConcern,
      }
    } else if (input.command.type === 'pou-review-confirmed') {
      const command = input.command
      const checkpoint = workflow.checkpoints.find((item) => item.pouId === command.pouId)
      if (!checkpoint) throw new WorkflowNotFoundError()
      const next = checkpointAfterPouReview(
        { stage: workflow.currentStage, currentPouId: workflow.currentPouId },
        command.pouId,
        checkpoint.progress === 'confirmed',
      )
      checkpoint.progress = 'confirmed'
      checkpoint.userSelectedConcern = null
      checkpoint.note = command.note || null
      checkpoint.referralSuggested = false
      checkpoint.supervisorReviewSuggested = false
      checkpoint.confirmedAt = new Date('2026-08-10T00:00:00.000Z')
      workflow.currentStage = next.stage
      workflow.currentPouId = next.currentPouId
    } else if (input.command.type === 'pou-summary-confirmed') {
      const next = checkpointAfterPouSummary({ stage: workflow.currentStage, currentPouId: workflow.currentPouId })
      workflow.currentStage = next.stage
      workflow.currentPouId = next.currentPouId
    } else if (input.command.type === 'action-plan-confirmed') {
      workflow.actions = input.command.actions.map((action) => ({
        ...action,
        pouId: action.pouId ?? null,
        dueDate: action.dueDate ?? null,
        notes: action.notes ?? null,
        withdrawnAt: null,
        createdAt: new Date('2026-08-10T00:00:00.000Z'),
        updatedAt: new Date('2026-08-10T00:00:00.000Z'),
      }))
      if (workflow.currentStage === 'action-planning') {
        const next = checkpointAfterActionPlan({ stage: workflow.currentStage, currentPouId: workflow.currentPouId })
        workflow.currentStage = next.stage
        workflow.currentPouId = next.currentPouId
      }
    } else if (input.command.type === 'referral-plan-confirmed') {
      workflow.referrals = input.command.referrals.map((referral) => ({
        ...referral,
        pouId: referral.pouId ?? null,
        destinationCode: referral.destinationCode ?? null,
        handoverNote: referral.handoverNote ?? null,
        notes: referral.notes ?? null,
        withdrawnAt: null,
        createdAt: new Date('2026-08-10T00:00:00.000Z'),
        updatedAt: new Date('2026-08-10T00:00:00.000Z'),
      }))
      if (workflow.currentStage === 'referral-planning') {
        const next = checkpointAfterReferralPlan({ stage: workflow.currentStage, currentPouId: workflow.currentPouId })
        workflow.currentStage = next.stage
        workflow.currentPouId = next.currentPouId
      }
    } else if (input.command.type === 'structured-review-confirmed') {
      const next = checkpointAfterStructuredReview({ stage: workflow.currentStage, currentPouId: workflow.currentPouId })
      workflow.currentStage = next.stage
      workflow.currentPouId = next.currentPouId
    } else {
      const next = checkpointAfterCompletion({ stage: workflow.currentStage, currentPouId: workflow.currentPouId })
      workflow.status = 'completed'
      workflow.currentStage = next.stage
      workflow.currentPouId = next.currentPouId
      workflow.completedAt = new Date('2026-08-10T00:00:00.000Z')
    }
    workflow.version += 1
    const result = { workflow: this.publicWorkflow(workflow), interactionId: 'c784a337-05de-4d22-838f-0338b2e45027', replayed: false }
    this.operations.set(key, { fingerprint, result })
    return result
  }

  async findSafetyObservationHistory(actor: AuthenticatedUser, workflowSessionId: string, observationId: string) {
    const workflow = this.workflows.get(workflowSessionId)
    const observation = workflow?.ownerId === actor.id ? workflow.safety.observations.find(({ id }) => id === observationId) : undefined
    if (!workflow || !observation) return null
    return {
      observation,
      revisions: [{
        revision: observation.currentRevision,
        assessmentContext: observation.assessmentContext,
        pouId: observation.pouId,
        broadClass: observation.broadClass,
        concernLevel: observation.concernLevel,
        resultingStatus: observation.status,
        operation: 'confirmed' as const,
        changeReason: null,
        createdAt: observation.confirmedAt,
      }],
      evaluations: [{
        observationRevision: observation.currentRevision,
        ruleCode: 'te-kaupapa.safety.urgent-supervisor-attention',
        ruleVersion: 1,
        decisionCode: observation.concernLevel === 'urgent' && observation.status === 'active' ? 'urgent_supervisor_attention_required' as const : 'no_approved_consequence' as const,
        evaluatedAt: observation.confirmedAt,
      }],
      consequenceEpisodes: workflow.safety.requiredConsequences
        .filter(({ observationId: consequenceObservationId }) => consequenceObservationId === observationId)
        .map((consequence) => ({ ...consequence, state: 'required' as const, ceasedAt: null, cessationReason: null })),
    }
  }

  private recalculateSafety(workflow: Omit<WorkflowView, 'structuredReview'> & { ownerId: string }) {
    const active = workflow.safety.observations.filter(({ status }) => status === 'active')
    const urgent = active.filter(({ concernLevel }) => concernLevel === 'urgent')
    workflow.safety.requiredConsequences = urgent.flatMap((observation) => [
      { id: `${observation.id}:review`, observationId: observation.id, type: 'supervisor_review_required' as const, requiredAt: observation.confirmedAt },
      { id: `${observation.id}:notification`, observationId: observation.id, type: 'supervisor_notification_required' as const, requiredAt: observation.confirmedAt },
    ])
    workflow.safety.indicators = {
      activeObservationCount: active.length,
      urgentObservationCount: urgent.length,
      supervisorReviewRequired: urgent.length > 0,
      supervisorNotificationRequired: urgent.length > 0,
      manualReviewRequestCount: workflow.safety.supervisorReviewRequests.length,
      hasRetractedHistory: workflow.safety.observations.some(({ status }) => status === 'retracted'),
    }
  }

  private publicWorkflow({ ownerId: _ownerId, ...workflow }: Omit<WorkflowView, 'structuredReview'> & { ownerId: string }): WorkflowView {
    return structuredClone({
      ...workflow,
      structuredReview: {
        reference: workflow.reference,
        setup: workflow.setup,
        checkpoints: workflow.checkpoints,
        actions: workflow.actions,
        referrals: workflow.referrals,
        carryForwards: workflow.carryForwards,
        pouReviews: workflow.pouReviews,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        completedAt: workflow.completedAt,
      },
    })
  }
}

class FakeConversationService implements ConversationApplicationService {
  private conversation: ConversationRecord | null = null
  readonly starts: Array<{ workflowSessionId: string; pouId: string; idempotencyKey: string }> = []

  async start(actor: AuthenticatedUser, workflowSessionId: string, pouId: WorkflowPouId, idempotencyKey: string) {
    this.starts.push({ workflowSessionId, pouId, idempotencyKey })
    this.conversation = {
      id: '8e1fde30-c4b6-492a-8862-32200b2661a9', organisationId: actor.organisation.id, workflowSessionId, pouId, startedByUserId: actor.id,
      provider: 'elevenlabs', providerConversationId: 'provider-conversation-id', providerAgentReference: 'server-selected-agent', providerBranchReference: 'server-selected-branch', providerEnvironment: 'staging',
      conversationSpecificationCode: 'whakapapa-reflection', conversationSpecificationVersion: 1, status: 'authorized', startIdempotencyKey: idempotencyKey, requestFingerprint: 'test',
      authorizedAt: new Date('2026-08-11T00:00:00.000Z'), connectedAt: null, endedAt: null, terminationReason: null, createdAt: new Date('2026-08-11T00:00:00.000Z'), updatedAt: new Date('2026-08-11T00:00:00.000Z'),
    }
    return { kind: 'authorized' as const, conversation: this.conversation, conversationToken: 'temporary-conversation-token', dynamicVariables: { pou_name: 'Whakapapa', pou_opening: '', pou_guidance: 'Synthetic approved guidance' } }
  }

  async acknowledgeClientConnected(_actor: AuthenticatedUser, conversationId: string, providerConversationId: string) {
    if (!this.conversation || this.conversation.id !== conversationId || this.conversation.providerConversationId !== providerConversationId) throw new Error('provider mismatch')
    this.conversation = { ...this.conversation, status: 'active', connectedAt: new Date('2026-08-11T00:01:00.000Z') }
    return this.conversation
  }

  async end(_actor: AuthenticatedUser, conversationId: string, reason: 'user_ended' | 'navigation' | 'connection_lost' | 'startup_failed' | 'provider_error' | 'provider_id_mismatch') {
    if (!this.conversation || this.conversation.id !== conversationId) throw new Error('not found')
    this.conversation = { ...this.conversation, status: 'ended', endedAt: new Date('2026-08-11T00:02:00.000Z'), terminationReason: reason }
    return this.conversation
  }

  async current() { return this.conversation }
}

function config(): AppConfiguration {
  return {
    nodeEnv: 'test',
    port: 3011,
    host: '127.0.0.1',
    databaseUrl: 'postgresql://not-used',
    appOrigin: 'http://api.test',
    frontendOrigin: 'http://web.test',
    allowedOrigins: ['http://api.test', 'http://web.test'],
    cookieName: 'test_session',
    cookieSigningSecret: 'a-test-cookie-secret-that-is-long-enough',
    cognito: {
      clientId: 'test-client',
      issuer: 'https://cognito-idp.test/user-pool',
      managedLoginDomain: 'https://managed-login.test',
    },
  }
}

function cookieFrom(response: { headers: { ['set-cookie']?: string | string[] | number } }, name?: string): string {
  const header = response.headers['set-cookie']
  const values = Array.isArray(header) ? header : [typeof header === 'string' ? header : undefined]
  const value = name ? values.find((candidate) => candidate?.startsWith(`${name}=`)) : values[0]
  if (!value) throw new Error('Response had no cookie.')
  return value.split(';')[0]
}

describe('authenticated application shell API', () => {
  it('keeps Pou specification authoring behind the independent editor role', async () => {
    const repository = new MemoryRepository()
    const editor: AuthenticatedUser = { ...activeKaimahi, id: '719ba3e1-dbd4-4c89-a2a5-31a4cb2e3b01', roles: ['SPECIFICATION_EDITOR'] }
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    repository.identities.set('cognito:editor', editor)
    await Promise.all([
      repository.createSession({ id: '109ac11d-d9eb-41f6-b811-630f37d2d3a1', userId: activeKaimahi.id, tokenHash: sha256('kaimahi-authoring'), expiresAt: new Date(Date.now() + 60_000) }),
      repository.createSession({ id: 'bcd7ff3a-7e88-4826-a663-b4136e9d0a37', userId: editor.id, tokenHash: sha256('editor-authoring'), expiresAt: new Date(Date.now() + 60_000) }),
    ])
    const authoring = { list: vi.fn(async () => [{ pouId: 'whakapapa', activeVersion: '0.1', activeStatus: 'approved_for_pilot', activeSpecification: {}, draft: null }]) }
    const app = await createApplication({ config: config(), repository, pouSpecificationAuthoringService: authoring as any, oidcProvider: new FakeOidcProvider() })
    expect((await app.inject({ method: 'GET', url: '/api/pou-specifications' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/pou-specifications', headers: { cookie: 'test_session=kaimahi-authoring' } })).statusCode).toBe(403)
    const permitted = await app.inject({ method: 'GET', url: '/api/pou-specifications', headers: { cookie: 'test_session=editor-authoring' } })
    expect(permitted.statusCode).toBe(200)
    expect(permitted.json()).toEqual({ specifications: [{ pouId: 'whakapapa', activeVersion: '0.1', activeStatus: 'approved_for_pilot', activeSpecification: {}, draft: null }] })
    await app.close()
  })
  it('forwards only review content when saving a Whakapapa draft and reloads its edited revision', async () => {
    const repository = new MemoryRepository()
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    await repository.createSession({ id: 'a22f5c12-5dfa-4658-b4ea-b455ee5f0b6a', userId: activeKaimahi.id, tokenHash: sha256('review-draft-session'), expiresAt: new Date(Date.now() + 60_000) })
    const generated = {
      id: '11111111-1111-4111-8111-111111111111', revisionId: '22222222-2222-4222-8222-222222222222', revision: 1,
      overallSummary: 'Identity context was explored.', strengthsSummary: 'Whānau strengths were named.', areasForAttentionSummary: null,
      evidenceTurnIds: ['33333333-3333-4333-8333-333333333333'], generatedAt: new Date('2026-08-13T00:00:00.000Z'),
    }
    let current: {
      id: string
      revisionId: string
      revision: number
      overallSummary: string | null
      strengthsSummary: string | null
      areasForAttentionSummary: string | null
      evidenceTurnIds: string[]
      generatedAt: Date
    } = generated
    let captured: unknown
    const reviewDraftRepository = {
      findForKaimahi: async () => ({ status: 'ready' as const, assessmentCompleted: true, hasReviewableCandidate: false, draft: current }),
      edit: async (_actor: AuthenticatedUser, _workflowSessionId: string, input: { reviewDraftId: string; expectedRevision: number; content: { overallSummary: string | null; strengthsSummary: string | null; areasForAttentionSummary: string | null; evidenceTurnIds: string[] } }) => {
        captured = input
        current = { ...current, revisionId: '44444444-4444-4444-8444-444444444444', revision: 2, ...input.content }
        return current
      },
    }
    const app = await createApplication({ config: config(), repository, reviewDraftRepository: reviewDraftRepository as any, oidcProvider: new FakeOidcProvider() })
    const headers = { cookie: 'test_session=review-draft-session', origin: 'http://web.test' }
    const url = '/api/workflows/55555555-5555-4555-8555-555555555555/pou/whakapapa/review-draft'
    const before = await app.inject({ method: 'GET', url, headers })
    expect(before.statusCode).toBe(200)
    const saved = await app.inject({ method: 'PUT', url, headers, payload: { reviewDraftId: generated.id, expectedRevision: 1, overallSummary: 'Identity context was carefully explored.', strengthsSummary: generated.strengthsSummary, areasForAttentionSummary: null, evidenceTurnIds: generated.evidenceTurnIds } })
    expect(saved.statusCode).toBe(200)
    expect(captured).toEqual({ reviewDraftId: generated.id, expectedRevision: 1, content: { overallSummary: 'Identity context was carefully explored.', strengthsSummary: generated.strengthsSummary, areasForAttentionSummary: null, evidenceTurnIds: generated.evidenceTurnIds } })
    const after = await app.inject({ method: 'GET', url, headers })
    expect(after.statusCode).toBe(200)
    expect(after.json()).toMatchObject({ review: { status: 'ready', draft: { revision: 2, overallSummary: 'Identity context was carefully explored.' } } })
    await app.close()
  })

  it('does not reveal a profile without an application session', async () => {
    const app = await createApplication({ config: config(), repository: new MemoryRepository(), oidcProvider: new FakeOidcProvider() })
    const response = await app.inject({ method: 'GET', url: '/api/me' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('creates a server session only for a provisioned active user and invalidates it on logout', async () => {
    const repository = new MemoryRepository()
    repository.identities.set('cognito:cognito-subject', activeKaimahi)
    const app = await createApplication({ config: config(), repository, oidcProvider: new FakeOidcProvider() })

    const login = await app.inject({ method: 'GET', url: '/api/auth/login' })
    const transactionCookie = cookieFrom(login)
    const state = new URL(login.headers.location!).searchParams.get('state')!
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=code&state=${encodeURIComponent(state)}`,
      headers: { cookie: transactionCookie },
    })
    expect(callback.statusCode).toBe(302)
    expect(callback.headers.location).toBe('http://web.test')
    expect(String(callback.headers['set-cookie'])).toContain('HttpOnly')
    expect(String(callback.headers['set-cookie'])).toContain('SameSite=Lax')
    expect(String(callback.headers['set-cookie'])).toContain('Max-Age=43200')

    const sessionCookie = cookieFrom(callback, 'test_session')
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: sessionCookie } })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toEqual({
      profile: {
        id: activeKaimahi.id,
        displayName: 'Test Kaimahi',
        organisation: activeKaimahi.organisation,
        roles: ['KAIMAHI'],
      },
    })

    const forbidden = await app.inject({ method: 'GET', url: '/api/entry/SUPERVISOR', headers: { cookie: sessionCookie } })
    expect(forbidden.statusCode).toBe(403)
    const rejectedLogout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: sessionCookie } })
    expect(rejectedLogout.statusCode).toBe(403)
    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: sessionCookie, origin: 'http://web.test' },
    })
    expect(logout.statusCode).toBe(200)
    expect(logout.json()).toEqual({
      logoutUrl: 'https://managed-login.test/logout?client_id=test-client&logout_uri=http%3A%2F%2Fweb.test',
    })
    expect(String(logout.headers['set-cookie'])).toContain('test_session=;')
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: sessionCookie } })).statusCode).toBe(401)
    await app.close()
  })

  it('binds an explicit trusted-device choice to the signed OIDC transaction without trusting callback input', async () => {
    const repository = new MemoryRepository()
    repository.identities.set('cognito:cognito-subject', activeKaimahi)
    const authenticatedAt = new Date('2026-09-01T09:00:00.000Z')
    const app = await createApplication({ config: config(), repository, oidcProvider: new FakeOidcProvider(), now: () => authenticatedAt })

    const standardLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'http://web.test' },
      payload: { trustedDevice: false },
    })
    expect(standardLogin.statusCode).toBe(200)
    const standardCallback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=code&state=${new URL(standardLogin.json().authorizationUrl).searchParams.get('state')}&trustedDevice=true`,
      headers: { cookie: cookieFrom(standardLogin) },
    })
    expect(standardCallback.statusCode).toBe(302)
    expect(String(standardCallback.headers['set-cookie'])).toContain('Max-Age=43200')
    const standardSession = [...repository.sessions.values()].find((session) => session.tokenHash === sha256(cookieFrom(standardCallback, 'test_session').split('=')[1]!))!
    expect(standardSession).toMatchObject({ mode: 'standard', expiresAt: new Date('2026-09-01T21:00:00.000Z') })

    const trustedLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'http://web.test' },
      payload: { trustedDevice: true },
    })
    expect(trustedLogin.statusCode).toBe(200)
    const trustedCallback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=code&state=${new URL(trustedLogin.json().authorizationUrl).searchParams.get('state')}`,
      headers: { cookie: cookieFrom(trustedLogin) },
    })
    expect(trustedCallback.statusCode).toBe(302)
    expect(String(trustedCallback.headers['set-cookie'])).toContain('Max-Age=2592000')
    const trustedSession = [...repository.sessions.values()].find((session) => session.tokenHash === sha256(cookieFrom(trustedCallback, 'test_session').split('=')[1]!))!
    expect(trustedSession).toMatchObject({ mode: 'trusted_device', expiresAt: new Date('2026-10-01T09:00:00.000Z') })

    const tamperedLogin = await app.inject({ method: 'GET', url: '/api/auth/login' })
    const originalTransaction = cookieFrom(tamperedLogin)
    const tamperedTransaction = `${originalTransaction.slice(0, -1)}x`
    const failedCallback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=code&state=${new URL(tamperedLogin.headers.location!).searchParams.get('state')}`,
      headers: { cookie: tamperedTransaction },
    })
    expect(failedCallback.headers.location).toBe('http://web.test/?auth=failed')
    expect([...repository.sessions.values()]).toHaveLength(2)
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { trustedDevice: true } })).statusCode).toBe(403)
    await app.close()
  })

  it('does not create a session for an authenticated but unprovisioned identity', async () => {
    const app = await createApplication({ config: config(), repository: new MemoryRepository(), oidcProvider: new FakeOidcProvider() })
    const login = await app.inject({ method: 'GET', url: '/api/auth/login' })
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=code&state=${new URL(login.headers.location!).searchParams.get('state')}`,
      headers: { cookie: cookieFrom(login) },
    })
    expect(callback.headers.location).toBe('http://web.test/?auth=unprovisioned')
    expect(callback.headers['set-cookie']).not.toContain('test_session=')
    await app.close()
  })

  it('rejects an inactive or expired session and denies a supervisor outside their explicit relationship', async () => {
    const repository = new MemoryRepository()
    const inactive = { ...activeKaimahi, id: '3e5eb0bb-6bd3-4db2-8288-02d4176cc8e8', status: 'inactive' as const }
    const supervisor: AuthenticatedUser = { ...activeKaimahi, id: 'f279d807-3e4b-4d93-a370-d0b6e262c142', roles: ['SUPERVISOR'] }
    repository.identities.set('cognito:inactive', inactive)
    repository.identities.set('cognito:supervisor', supervisor)
    await repository.createSession({
      id: 'a04b9d4a-10c8-4f81-9073-5ea3bc883513',
      userId: inactive.id,
      tokenHash: sha256('inactive-session'),
      expiresAt: new Date(Date.now() + 60_000),
    })
    await repository.createSession({
      id: 'a59450ff-57b0-43af-bd5c-f4040bfae970',
      userId: supervisor.id,
      tokenHash: sha256('expired-session'),
      expiresAt: new Date(Date.now() - 60_000),
    })
    const app = await createApplication({ config: config(), repository, oidcProvider: new FakeOidcProvider() })

    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: 'test_session=inactive-session' } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: 'test_session=expired-session' } })).statusCode).toBe(401)
    await repository.createSession({
      id: 'e9016a7a-4654-4981-a71d-29f91e0ca8a2',
      userId: supervisor.id,
      tokenHash: sha256('supervisor-session'),
      expiresAt: new Date(Date.now() + 60_000),
    })
    expect((await app.inject({
      method: 'GET',
      url: '/api/supervision/0fba8d19-a0b7-4f28-931e-8940da7c364c',
      headers: { cookie: 'test_session=supervisor-session' },
    })).statusCode).toBe(403)
    repository.supervision.add(`${supervisor.id}:0fba8d19-a0b7-4f28-931e-8940da7c364c`)
    expect((await app.inject({
      method: 'GET',
      url: '/api/supervision/0fba8d19-a0b7-4f28-931e-8940da7c364c',
      headers: { cookie: 'test_session=supervisor-session' },
    })).statusCode).toBe(204)
    await app.close()
  })

  it('enforces the 12-hour standard-session boundary and 8-hour idle boundary without sliding expiry', async () => {
    const repository = new MemoryRepository()
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    const createdAt = new Date('2026-09-01T08:00:00.000Z')
    let currentTime = new Date('2026-09-01T15:59:00.000Z')
    const idleToken = 'standard-idle-boundary'
    await repository.createSession({
      id: '9f49620a-6a90-4739-934d-44c487c51d04',
      userId: activeKaimahi.id,
      tokenHash: sha256(idleToken),
      mode: 'standard',
      expiresAt: sessionExpiresAt('standard', createdAt),
      lastActivityAt: createdAt,
    })
    const app = await createApplication({ config: config(), repository, oidcProvider: new FakeOidcProvider(), now: () => currentTime })
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `test_session=${idleToken}` } })).statusCode).toBe(200)
    const validStandard = repository.sessions.get(sha256(idleToken))!
    expect(validStandard.lastActivityAt).toEqual(currentTime)
    expect(validStandard.expiresAt).toEqual(new Date('2026-09-01T20:00:00.000Z'))

    const expiredIdleToken = 'standard-expired-idle'
    await repository.createSession({
      id: 'f6c2eb10-64bb-4f0f-86f2-7150d0812a02',
      userId: activeKaimahi.id,
      tokenHash: sha256(expiredIdleToken),
      mode: 'standard',
      expiresAt: new Date('2026-09-02T03:59:00.000Z'),
      lastActivityAt: new Date('2026-09-01T07:59:00.000Z'),
    })
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `test_session=${expiredIdleToken}` } })).statusCode).toBe(401)

    const activeToken = 'standard-active-session'
    await repository.createSession({
      id: '12834aa0-8e1e-4d43-a57f-ddecae4b95f9',
      userId: activeKaimahi.id,
      tokenHash: sha256(activeToken),
      mode: 'standard',
      expiresAt: new Date('2026-09-01T20:00:00.000Z'),
      lastActivityAt: currentTime,
    })
    currentTime = new Date('2026-09-01T17:00:00.000Z')
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `test_session=${activeToken}` } })).statusCode).toBe(200)
    expect(repository.sessions.get(sha256(activeToken))!.expiresAt).toEqual(new Date('2026-09-01T20:00:00.000Z'))
    currentTime = new Date('2026-09-01T20:00:00.000Z')
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `test_session=${activeToken}` } })).statusCode).toBe(401)
    await app.close()
  })

  it('keeps a trusted-device session valid for its original 30 days without applying the standard idle limit', async () => {
    const repository = new MemoryRepository()
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    const authenticatedAt = new Date('2026-09-01T09:00:00.000Z')
    let currentTime = new Date('2026-09-10T09:00:00.000Z')
    const token = 'trusted-device-session'
    const expiresAt = sessionExpiresAt('trusted_device', authenticatedAt)
    await repository.createSession({
      id: '73c89849-4778-48cc-9b13-2675616d5d91',
      userId: activeKaimahi.id,
      tokenHash: sha256(token),
      mode: 'trusted_device',
      expiresAt,
      lastActivityAt: authenticatedAt,
    })
    const app = await createApplication({ config: config(), repository, oidcProvider: new FakeOidcProvider(), now: () => currentTime })
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `test_session=${token}` } })).statusCode).toBe(200)
    currentTime = new Date('2026-09-20T09:00:00.000Z')
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `test_session=${token}` } })).statusCode).toBe(200)
    currentTime = new Date('2026-09-30T08:59:00.000Z')
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `test_session=${token}` } })).statusCode).toBe(200)
    expect(repository.sessions.get(sha256(token))!.expiresAt).toEqual(expiresAt)
    currentTime = new Date('2026-10-01T09:00:00.000Z')
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `test_session=${token}` } })).statusCode).toBe(401)
    await app.close()
  })

  it('terminates a trusted-device session through the normal logout path', async () => {
    const repository = new MemoryRepository()
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    const now = new Date('2026-09-01T09:00:00.000Z')
    await repository.createSession({
      id: 'c18cbd73-6ae8-41ef-a836-a16d310cb6c2', userId: activeKaimahi.id, tokenHash: sha256('logout-trusted'), mode: 'trusted_device',
      expiresAt: sessionExpiresAt('trusted_device', now), lastActivityAt: now,
    })
    const app = await createApplication({ config: config(), repository, oidcProvider: new FakeOidcProvider(), now: () => now })
    const headers = { cookie: 'test_session=logout-trusted', origin: 'http://web.test' }
    expect((await app.inject({ method: 'GET', url: '/api/me', headers })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/me', headers })).statusCode).toBe(401)
    await app.close()
  })

  it('persists both session modes across application restart and supports revoke-all server-side invalidation', async () => {
    const repository = new MemoryRepository()
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    const now = new Date('2026-09-10T09:00:00.000Z')
    await repository.createSession({ id: '6e7f8dd7-9d88-4307-99b7-b0e55ca0f2a2', userId: activeKaimahi.id, tokenHash: sha256('restart-standard'), mode: 'standard', expiresAt: sessionExpiresAt('standard', now), lastActivityAt: now })
    await repository.createSession({ id: '11e4df01-e82b-43cd-8adc-52c856bd0ece', userId: activeKaimahi.id, tokenHash: sha256('restart-trusted'), mode: 'trusted_device', expiresAt: sessionExpiresAt('trusted_device', now), lastActivityAt: now })
    const beforeRestart = await createApplication({ config: config(), repository, oidcProvider: new FakeOidcProvider(), now: () => now })
    expect((await beforeRestart.inject({ method: 'GET', url: '/api/me', headers: { cookie: 'test_session=restart-standard' } })).statusCode).toBe(200)
    await beforeRestart.close()
    const afterRestart = await createApplication({ config: config(), repository, oidcProvider: new FakeOidcProvider(), now: () => now })
    expect((await afterRestart.inject({ method: 'GET', url: '/api/me', headers: { cookie: 'test_session=restart-standard' } })).statusCode).toBe(200)
    expect((await afterRestart.inject({ method: 'GET', url: '/api/me', headers: { cookie: 'test_session=restart-trusted' } })).statusCode).toBe(200)
    await repository.invalidateSessionsForUser(activeKaimahi.id, now)
    expect((await afterRestart.inject({ method: 'GET', url: '/api/me', headers: { cookie: 'test_session=restart-standard' } })).statusCode).toBe(401)
    expect((await afterRestart.inject({ method: 'GET', url: '/api/me', headers: { cookie: 'test_session=restart-trusted' } })).statusCode).toBe(401)
    await afterRestart.close()
  })

  it('rechecks current user, organisation membership, and every role on each session request', async () => {
    const repository = new MemoryRepository()
    const fullyAuthorized: AuthenticatedUser = { ...activeKaimahi, roles: ['KAIMAHI', 'SUPERVISOR', 'SPECIFICATION_EDITOR'] }
    repository.identities.set('cognito:kaimahi', fullyAuthorized)
    await repository.createSession({ id: 'e7bc5750-cc5e-4f6d-a5ef-e45f902fc47a', userId: activeKaimahi.id, tokenHash: sha256('live-authority'), mode: 'trusted_device', expiresAt: new Date('2026-10-01T09:00:00.000Z'), lastActivityAt: new Date('2026-09-01T09:00:00.000Z') })
    const app = await createApplication({ config: config(), repository, oidcProvider: new FakeOidcProvider(), now: () => new Date('2026-09-10T09:00:00.000Z') })
    const headers = { cookie: 'test_session=live-authority' }
    expect((await app.inject({ method: 'GET', url: '/api/entry/KAIMAHI', headers })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/entry/SUPERVISOR', headers })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/entry/SPECIFICATION_EDITOR', headers })).statusCode).toBe(200)
    repository.identities.set('cognito:kaimahi', { ...fullyAuthorized, roles: ['SUPERVISOR', 'SPECIFICATION_EDITOR'] })
    expect((await app.inject({ method: 'GET', url: '/api/entry/KAIMAHI', headers })).statusCode).toBe(403)
    repository.identities.set('cognito:kaimahi', { ...fullyAuthorized, roles: ['SPECIFICATION_EDITOR'] })
    expect((await app.inject({ method: 'GET', url: '/api/entry/SUPERVISOR', headers })).statusCode).toBe(403)
    repository.identities.set('cognito:kaimahi', { ...fullyAuthorized, roles: [] })
    expect((await app.inject({ method: 'GET', url: '/api/entry/SPECIFICATION_EDITOR', headers })).statusCode).toBe(403)
    repository.identities.delete('cognito:kaimahi')
    expect((await app.inject({ method: 'GET', url: '/api/me', headers })).statusCode).toBe(401)
    repository.identities.set('cognito:kaimahi', { ...fullyAuthorized, status: 'inactive' })
    expect((await app.inject({ method: 'GET', url: '/api/me', headers })).statusCode).toBe(401)
    await app.close()
  })

  it('persists Kaimahi workflow commands behind the existing session and CSRF boundaries', async () => {
    const repository = new MemoryRepository()
    const workflows = new MemoryWorkflowRepository()
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    await repository.createSession({
      id: '0ff258d3-3ca5-4cdd-bf5e-1dfe425b4624',
      userId: activeKaimahi.id,
      tokenHash: sha256('workflow-session'),
      expiresAt: new Date(Date.now() + 60_000),
    })
    const app = await createApplication({ config: config(), repository, workflowRepository: workflows, oidcProvider: new FakeOidcProvider() })
    const sessionCookie = 'test_session=workflow-session'

    expect((await app.inject({ method: 'GET', url: '/api/workflows' })).statusCode).toBe(401)
    expect((await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { cookie: sessionCookie },
      payload: { idempotencyKey: '4aa3c038-b5da-46e7-b11c-3f549416fcf4' },
    })).statusCode).toBe(403)

    const create = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { cookie: sessionCookie, origin: 'http://web.test' },
      payload: { idempotencyKey: '4aa3c038-b5da-46e7-b11c-3f549416fcf4' },
    })
    expect(create.statusCode).toBe(201)
    expect(create.json()).toMatchObject({ workflow: { reference: 'TK-7K4M2P9Q', status: 'draft', version: 1 } })
    expect((await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { cookie: sessionCookie, origin: 'http://web.test' },
      payload: { idempotencyKey: '4aa3c038-b5da-46e7-b11c-3f549416fcf4' },
    })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/workflows', headers: { cookie: sessionCookie } })).json()).toMatchObject({ workflows: [{ status: 'draft' }] })

    const setup = await app.inject({
      method: 'POST',
      url: '/api/workflows/22b1f80c-2c12-4f82-bdd9-65d7b30712bb/interactions',
      headers: { cookie: sessionCookie, origin: 'http://web.test' },
      payload: {
        type: 'setup-confirmed',
        idempotencyKey: 'db82d548-b703-4e0e-a5f7-f2d99c69c84a',
        expectedVersion: 1,
        whanauReference: ' TW-04 ',
        engagementType: 'home-visit',
        sessionFocus: 'Whānau support discussion',
        immediateConcern: 'none',
      },
    })
    expect(setup.statusCode).toBe(200)
    expect(setup.json()).toMatchObject({ workflow: { status: 'in_progress', currentStage: 'pou-overview', version: 2 } })

    const rejectedLegacyFields = await app.inject({
      method: 'POST',
      url: '/api/workflows/22b1f80c-2c12-4f82-bdd9-65d7b30712bb/interactions',
      headers: { cookie: sessionCookie, origin: 'http://web.test' },
      payload: {
        type: 'pou-review-confirmed',
        idempotencyKey: '99bd1f2c-4528-4fab-8bfa-96c4a11b0c07',
        expectedVersion: 2,
        pouId: 'whakapapa',
        userSelectedConcern: 'watch',
        referralSuggested: false,
        supervisorReviewSuggested: false,
      },
    })
    expect(rejectedLegacyFields.statusCode).toBe(400)

    const stale = await app.inject({
      method: 'POST',
      url: '/api/workflows/22b1f80c-2c12-4f82-bdd9-65d7b30712bb/interactions',
      headers: { cookie: sessionCookie, origin: 'http://web.test' },
      payload: {
        type: 'pou-review-confirmed',
        idempotencyKey: 'af9f9d73-b05d-455f-89fa-44f7db94d9ac',
        expectedVersion: 1,
        pouId: 'whakapapa',
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'stale_workflow', currentVersion: 2 })
    await app.close()
  })

  it('keeps cross-Pou synthesis and final-record output owner-scoped and free of raw source material', async () => {
    const repository = new MemoryRepository()
    const supervisor: AuthenticatedUser = { ...activeKaimahi, id: 'dd8a7c03-c7a9-496f-b6c4-92a8f90f4f19', roles: ['SUPERVISOR'] }
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    repository.identities.set('cognito:supervisor', supervisor)
    await repository.createSession({ id: 'c46e9761-b689-4f73-b0ea-a26ed3e8395a', userId: activeKaimahi.id, tokenHash: sha256('synthesis-owner'), expiresAt: new Date(Date.now() + 60_000) })
    await repository.createSession({ id: 'c0d7c224-22a8-467e-aeb7-099d17ed7158', userId: supervisor.id, tokenHash: sha256('synthesis-supervisor'), expiresAt: new Date(Date.now() + 60_000) })
    const synthesis = {
      status: 'ready', synthesisId: '0e24c9e7-af20-45e8-a706-549a15db4363', confirmedRevisionId: null, confirmedAt: null,
      draft: { id: '4a419730-8136-4c0d-a1cb-64a3ed0da2b5', revision: 1, source: 'generated', createdAt: new Date(), content: { overallSummary: 'Bounded summary.', keyThemes: null, strengthsSummary: null, areasForAttentionSummary: null, informationStillToExploreSummary: null, confirmedSafetyConcernsSummary: 'No human-confirmed safety concerns are recorded.' } },
    }
    const finalRecord = { id: 'a4c4535f-c5f1-4d09-aa6d-d4495fc3f582', reference: 'TK-7K4M2P9Q', organisationName: 'Test organisation', kaimahiDisplayName: activeKaimahi.displayName, overallSummary: 'Bounded final record.', keyThemes: null, strengthsSummary: null, areasForAttentionSummary: null, informationStillToExploreSummary: null, confirmedSafetyConcernsSummary: 'No human-confirmed safety concerns are recorded.', actions: [], referrals: [], safetyObservations: [], finalizedAt: new Date() }
    const synthesisRepository = {
      findForKaimahi: vi.fn(async (actor: AuthenticatedUser) => { if (actor.id !== activeKaimahi.id) throw new WorkflowNotFoundError(); return synthesis }),
      findFinalRecord: vi.fn(async (actor: AuthenticatedUser) => actor.id === activeKaimahi.id ? finalRecord : null),
    }
    const app = await createApplication({ config: config(), repository, workflowSynthesisRepository: synthesisRepository as any, oidcProvider: new FakeOidcProvider() })
    const workflowId = '22b1f80c-2c12-4f82-bdd9-65d7b30712bb'
    const ownerHeaders = { cookie: 'test_session=synthesis-owner' }
    const synthesisResponse = await app.inject({ method: 'GET', url: `/api/workflows/${workflowId}/synthesis`, headers: ownerHeaders })
    expect(synthesisResponse.statusCode).toBe(200)
    expect(synthesisResponse.headers['cache-control']).toBe('no-store')
    expect(synthesisResponse.body).not.toMatch(/transcript|payload|rationale/i)
    expect((await app.inject({ method: 'GET', url: `/api/workflows/${workflowId}/synthesis`, headers: { cookie: 'test_session=synthesis-supervisor' } })).statusCode).toBe(403)
    const textResponse = await app.inject({ method: 'GET', url: `/api/workflows/${workflowId}/final-record.txt`, headers: ownerHeaders })
    expect(textResponse.statusCode).toBe(200)
    expect(textResponse.headers['cache-control']).toBe('no-store')
    expect(textResponse.body).toContain('Bounded final record.')
    const pdfResponse = await app.inject({ method: 'GET', url: `/api/workflows/${workflowId}/final-record.pdf`, headers: ownerHeaders })
    expect(pdfResponse.statusCode).toBe(200)
    expect(pdfResponse.headers['content-type']).toContain('application/pdf')
    expect(pdfResponse.headers['cache-control']).toBe('no-store')
    expect((await app.inject({ method: 'GET', url: `/api/workflows/${workflowId}/final-record`, headers: { cookie: 'test_session=synthesis-supervisor' } })).statusCode).toBe(403)
    await app.close()
  })

  it('authorizes a Whakapapa voice attempt behind Kaimahi, owner, and trusted-origin boundaries without changing workflow state', async () => {
    const repository = new MemoryRepository()
    const workflows = new MemoryWorkflowRepository()
    const conversations = new FakeConversationService()
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    await repository.createSession({
      id: '0ff258d3-3ca5-4cdd-bf5e-1dfe425b4624', userId: activeKaimahi.id, tokenHash: sha256('conversation-session'), expiresAt: new Date(Date.now() + 60_000),
    })
    const created = await workflows.createDraft({ actor: activeKaimahi, idempotencyKey: '4aa3c038-b5da-46e7-b11c-3f549416fcf4' })
    await workflows.submitCommand({
      actor: activeKaimahi,
      workflowSessionId: created.workflow.id,
      command: { type: 'setup-confirmed', idempotencyKey: 'db82d548-b703-4e0e-a5f7-f2d99c69c84a', expectedVersion: 1, whanauReference: 'TW-04', engagementType: 'home-visit', sessionFocus: 'Whānau support discussion', immediateConcern: 'none' },
    })
    const app = await createApplication({ config: config(), repository, workflowRepository: workflows, conversationService: conversations, oidcProvider: new FakeOidcProvider() })
    const cookie = 'test_session=conversation-session'
    const url = `/api/workflows/${created.workflow.id}/pou/whakapapa/conversations`

    expect((await app.inject({ method: 'POST', url, headers: { origin: 'http://web.test' }, payload: { idempotencyKey: 'aa60db66-3417-4a34-9b05-86fd9c5dd5ef' } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url, headers: { cookie }, payload: { idempotencyKey: 'aa60db66-3417-4a34-9b05-86fd9c5dd5ef' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url, headers: { cookie, origin: 'http://web.test' }, payload: {
      idempotencyKey: 'aa60db66-3417-4a34-9b05-86fd9c5dd5ef',
      agentId: 'browser-must-not-select-this',
      branchId: 'browser-must-not-select-this',
      environment: 'browser-must-not-select-this',
    } })).statusCode).toBe(400)

    const started = await app.inject({ method: 'POST', url, headers: { cookie, origin: 'http://web.test' }, payload: { idempotencyKey: 'aa60db66-3417-4a34-9b05-86fd9c5dd5ef' } })
    expect(started.statusCode).toBe(201)
    expect(started.headers['cache-control']).toBe('no-store')
    expect(started.json()).toMatchObject({
      conversation: { pouId: 'whakapapa', status: 'authorized', providerConversationId: 'provider-conversation-id' },
      authorization: { transport: 'webrtc', conversationToken: 'temporary-conversation-token', dynamicVariables: { pou_name: 'Whakapapa', pou_opening: '', pou_guidance: 'Synthetic approved guidance' } },
    })
    expect(JSON.stringify(started.json())).not.toContain('server-selected-agent')
    expect(conversations.starts).toEqual([{ workflowSessionId: created.workflow.id, pouId: 'whakapapa', idempotencyKey: 'aa60db66-3417-4a34-9b05-86fd9c5dd5ef' }])

    const conversationId = started.json<{ conversation: { id: string } }>().conversation.id
    const connected = await app.inject({
      method: 'POST', url: `/api/conversations/${conversationId}/client-connected`, headers: { cookie, origin: 'http://web.test' }, payload: { providerConversationId: 'provider-conversation-id' },
    })
    expect(connected.json()).toMatchObject({ conversation: { status: 'active' } })
    expect(connected.headers['cache-control']).toBe('no-store')
    const current = await app.inject({ method: 'GET', url: `/api/workflows/${created.workflow.id}/pou/whakapapa/conversation`, headers: { cookie } })
    expect(current.json()).toMatchObject({ conversation: { status: 'active' } })
    expect(current.headers['cache-control']).toBe('no-store')
    expect(JSON.stringify(current.json())).not.toContain('temporary-conversation-token')
    const ended = await app.inject({
      method: 'POST', url: `/api/conversations/${conversationId}/end`, headers: { cookie, origin: 'http://web.test' }, payload: { reason: 'user_ended' },
    })
    expect(ended.json()).toMatchObject({ conversation: { status: 'ended', terminationReason: 'user_ended' } })
    expect(ended.headers['cache-control']).toBe('no-store')
    expect(await workflows.findById(activeKaimahi, created.workflow.id)).toMatchObject({ currentStage: 'pou-overview', currentPouId: 'whakapapa', version: 2 })
    await app.close()
  })

  it('reports an invalid active assessment activation without exposing its internals', async () => {
    const repository = new MemoryRepository()
    const workflows = new MemoryWorkflowRepository()
    const conversations = new FakeConversationService()
    conversations.start = async () => { throw new SafetyAssessmentValidationError('durable activation detail must remain server-only') }
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    await repository.createSession({
      id: '50f4d472-fd36-4c9e-a354-2a5b2adabc8f', userId: activeKaimahi.id, tokenHash: sha256('invalid-activation-session'), expiresAt: new Date(Date.now() + 60_000),
    })
    const created = await workflows.createDraft({ actor: activeKaimahi, idempotencyKey: '3a379063-fcd9-4fea-b5fc-31fbdf6b3ff4' })
    await workflows.submitCommand({
      actor: activeKaimahi,
      workflowSessionId: created.workflow.id,
      command: { type: 'setup-confirmed', idempotencyKey: 'ab5e4581-508c-45a3-8dac-4d5dd72c0a5e', expectedVersion: 1, whanauReference: 'TW-05', engagementType: 'home-visit', sessionFocus: 'Whānau support discussion', immediateConcern: 'none' },
    })
    const app = await createApplication({ config: config(), repository, workflowRepository: workflows, conversationService: conversations, oidcProvider: new FakeOidcProvider() })

    const response = await app.inject({
      method: 'POST',
      url: `/api/workflows/${created.workflow.id}/pou/whakapapa/conversations`,
      headers: { cookie: 'test_session=invalid-activation-session', origin: 'http://web.test' },
      payload: { idempotencyKey: '89a31317-47e4-44d2-8e85-a086e6495b38' },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'assessment_activation_invalid' })
    expect(response.body).not.toContain('durable activation detail')
    await app.close()
  })

  it('reports an invalid active Pou specification without exposing its provenance detail', async () => {
    const repository = new MemoryRepository()
    const workflows = new MemoryWorkflowRepository()
    const conversations = new FakeConversationService()
    conversations.start = async () => { throw new PouSpecificationUnavailableError('stored projection provenance detail must remain server-only') }
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    await repository.createSession({
      id: '94296822-1f1e-467d-9695-376c8ff1e14f', userId: activeKaimahi.id, tokenHash: sha256('invalid-pou-specification-session'), expiresAt: new Date(Date.now() + 60_000),
    })
    const created = await workflows.createDraft({ actor: activeKaimahi, idempotencyKey: 'e3cb4362-16c3-4b17-9a75-f7fdb4518ccc' })
    await workflows.submitCommand({
      actor: activeKaimahi,
      workflowSessionId: created.workflow.id,
      command: { type: 'setup-confirmed', idempotencyKey: '9c8bbd3d-6de8-4ca5-8970-ee7c144c38fa', expectedVersion: 1, whanauReference: 'TW-06', engagementType: 'home-visit', sessionFocus: 'Whānau support discussion', immediateConcern: 'none' },
    })
    const app = await createApplication({ config: config(), repository, workflowRepository: workflows, conversationService: conversations, oidcProvider: new FakeOidcProvider() })

    const response = await app.inject({
      method: 'POST',
      url: `/api/workflows/${created.workflow.id}/pou/whakapapa/conversations`,
      headers: { cookie: 'test_session=invalid-pou-specification-session', origin: 'http://web.test' },
      payload: { idempotencyKey: '3477c367-ae47-4493-8a61-f7bf8f3e5e8b' },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'pou_specification_invalid' })
    expect(response.body).not.toContain('stored projection provenance detail')
    await app.close()
  })

  it('does not expose a Kaimahi workflow to a supervisor or another Kaimahi', async () => {
    const repository = new MemoryRepository()
    const workflows = new MemoryWorkflowRepository()
    const supervisor: AuthenticatedUser = { ...activeKaimahi, id: '97f5c5ed-0244-4e4d-84e0-1c3e6288ee4d', roles: ['SUPERVISOR'] }
    const anotherKaimahi: AuthenticatedUser = { ...activeKaimahi, id: 'acfea59b-a70d-4160-9a42-d6155031db0a', displayName: 'Another Kaimahi' }
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    repository.identities.set('cognito:supervisor', supervisor)
    repository.identities.set('cognito:another-kaimahi', anotherKaimahi)
    await Promise.all([
      repository.createSession({ id: '5c0b13a8-2d09-44a0-bd93-fcd80cce8a33', userId: activeKaimahi.id, tokenHash: sha256('owner-session'), expiresAt: new Date(Date.now() + 60_000) }),
      repository.createSession({ id: 'fa11d7e8-5800-4c3c-879f-2459d1215a06', userId: supervisor.id, tokenHash: sha256('supervisor-session'), expiresAt: new Date(Date.now() + 60_000) }),
      repository.createSession({ id: 'b0c2e2bf-6d89-4c50-a2a2-8b01f01f63cd', userId: anotherKaimahi.id, tokenHash: sha256('another-kaimahi-session'), expiresAt: new Date(Date.now() + 60_000) }),
    ])
    await workflows.createDraft({ actor: activeKaimahi, idempotencyKey: 'a65c619a-9f17-4e01-8b7e-64de443d7bca' })
    const app = await createApplication({ config: config(), repository, workflowRepository: workflows, oidcProvider: new FakeOidcProvider() })
    const workflowPath = '/api/workflows/22b1f80c-2c12-4f82-bdd9-65d7b30712bb'

    expect((await app.inject({ method: 'GET', url: workflowPath, headers: { cookie: 'test_session=supervisor-session' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: workflowPath, headers: { cookie: 'test_session=another-kaimahi-session' } })).statusCode).toBe(404)
    await app.close()
  })

  it('accepts only human-confirmed, strictly validated Kaimahi safety observations behind the existing CSRF boundary', async () => {
    const repository = new MemoryRepository()
    const workflows = new MemoryWorkflowRepository()
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    await repository.createSession({
      id: '46fceba8-6d4a-4a44-90ea-824367013ec7',
      userId: activeKaimahi.id,
      tokenHash: sha256('safety-session'),
      expiresAt: new Date(Date.now() + 60_000),
    })
    const created = await workflows.createDraft({ actor: activeKaimahi, idempotencyKey: 'e35dfb02-c7e7-42b2-92e5-6236eddfbe70' })
    const app = await createApplication({ config: config(), repository, workflowRepository: workflows, oidcProvider: new FakeOidcProvider() })
    const url = `/api/workflows/${created.workflow.id}/interactions`
    const headers = { cookie: 'test_session=safety-session', origin: 'http://web.test' }

    expect((await app.inject({
      method: 'POST', url, headers,
      payload: {
        type: 'safety-observation-confirmed', observationId: '8e1fde30-c4b6-492a-8862-32200b2661a9', idempotencyKey: '69ce5116-7c5b-48b3-bf55-c4649a6729df', expectedVersion: 1,
        observation: { assessmentContext: 'setup', broadClass: 'whanau_safety', concernLevel: 'none' },
      },
    })).statusCode).toBe(400)

    const command = {
      type: 'safety-observation-confirmed', observationId: '8e1fde30-c4b6-492a-8862-32200b2661a9', idempotencyKey: '69ce5116-7c5b-48b3-bf55-c4649a6729df', expectedVersion: 1,
      observation: { assessmentContext: 'setup', broadClass: 'whanau_safety', concernLevel: 'urgent', contextNote: 'Confirmed by the Kaimahi.' },
    }
    const accepted = await app.inject({ method: 'POST', url, headers, payload: command })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json()).toMatchObject({ workflow: { version: 2, safety: { indicators: { urgentObservationCount: 1, supervisorReviewRequired: true, supervisorNotificationRequired: true }, requiredConsequences: [{ type: 'supervisor_review_required' }, { type: 'supervisor_notification_required' }] } } })
    expect((await app.inject({ method: 'POST', url, headers, payload: command })).json()).toMatchObject({ acknowledgement: { replayed: true } })
    expect((await app.inject({
      method: 'POST', url, headers,
      payload: { ...command, idempotencyKey: '0d80839b-6c3d-4290-96df-ed5c2338fc7f', expectedVersion: 2, observationId: '79cc1da8-86d6-4ee7-893c-321141990b11', ignoredCategory: 'not approved' },
    })).statusCode).toBe(400)
    await app.close()
  })

  it('returns exact safety history only to the owning Kaimahi', async () => {
    const repository = new MemoryRepository()
    const workflows = new MemoryWorkflowRepository()
    const supervisor: AuthenticatedUser = { ...activeKaimahi, id: '97f5c5ed-0244-4e4d-84e0-1c3e6288ee4d', roles: ['SUPERVISOR'] }
    const anotherKaimahi: AuthenticatedUser = { ...activeKaimahi, id: 'acfea59b-a70d-4160-9a42-d6155031db0a', displayName: 'Another Kaimahi' }
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    repository.identities.set('cognito:supervisor', supervisor)
    repository.identities.set('cognito:another-kaimahi', anotherKaimahi)
    await Promise.all([
      repository.createSession({ id: '5c0b13a8-2d09-44a0-bd93-fcd80cce8a33', userId: activeKaimahi.id, tokenHash: sha256('owner-history-session'), expiresAt: new Date(Date.now() + 60_000) }),
      repository.createSession({ id: 'fa11d7e8-5800-4c3c-879f-2459d1215a06', userId: supervisor.id, tokenHash: sha256('supervisor-history-session'), expiresAt: new Date(Date.now() + 60_000) }),
      repository.createSession({ id: 'b0c2e2bf-6d89-4c50-a2a2-8b01f01f63cd', userId: anotherKaimahi.id, tokenHash: sha256('another-history-session'), expiresAt: new Date(Date.now() + 60_000) }),
    ])
    const created = await workflows.createDraft({ actor: activeKaimahi, idempotencyKey: 'e35dfb02-c7e7-42b2-92e5-6236eddfbe70' })
    const observationId = '8e1fde30-c4b6-492a-8862-32200b2661a9'
    await workflows.submitCommand({
      actor: activeKaimahi, workflowSessionId: created.workflow.id,
      command: { type: 'safety-observation-confirmed', observationId, idempotencyKey: '69ce5116-7c5b-48b3-bf55-c4649a6729df', expectedVersion: 1, observation: { assessmentContext: 'setup', broadClass: 'whanau_safety', concernLevel: 'urgent' } },
    })
    const app = await createApplication({ config: config(), repository, workflowRepository: workflows, oidcProvider: new FakeOidcProvider() })
    const historyUrl = `/api/workflows/${created.workflow.id}/safety-observations/${observationId}/history`

    expect((await app.inject({ method: 'GET', url: historyUrl })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: historyUrl, headers: { cookie: 'test_session=supervisor-history-session' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: historyUrl, headers: { cookie: 'test_session=another-history-session' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: historyUrl.replace(created.workflow.id, '22b1f80c-2c12-4f82-bdd9-65d7b30712b0'), headers: { cookie: 'test_session=owner-history-session' } })).statusCode).toBe(404)
    const ownerResponse = await app.inject({ method: 'GET', url: historyUrl, headers: { cookie: 'test_session=owner-history-session' } })
    expect(ownerResponse.statusCode).toBe(200)
    expect(ownerResponse.json()).toMatchObject({
      history: {
        observation: { id: observationId, concernLevel: 'urgent', currentRevision: 1 },
        revisions: [{ revision: 1, operation: 'confirmed' }],
        evaluations: [{ ruleCode: 'te-kaupapa.safety.urgent-supervisor-attention', ruleVersion: 1, decisionCode: 'urgent_supervisor_attention_required' }],
        consequenceEpisodes: [{ type: 'supervisor_review_required', state: 'required' }, { type: 'supervisor_notification_required', state: 'required' }],
      },
    })
    await app.close()
  })
})
