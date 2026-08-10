import { describe, expect, it } from 'vitest'

import { createApplication } from './app.js'
import { sha256 } from './auth/crypto.js'
import type { OidcProvider } from './auth/oidc.js'
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
import { WORKFLOW_POU_IDS, type WorkflowCommand } from '../shared/workflow.js'
import type { CompletedWorkflowListItem, WorkflowListItem } from './workflows/repository.js'

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

  async findUserBySessionHash(tokenHash: string, now: Date, idleTimeoutMinutes: number) {
    const session = this.sessions.get(tokenHash)
    if (!session) return null
    const lastActivityAt = session.lastActivityAt ?? session.expiresAt
    if (session.invalidatedAt || session.expiresAt <= now || lastActivityAt <= new Date(now.getTime() - idleTimeoutMinutes * 60 * 1000)) return null
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
      checkpoint.userSelectedConcern = command.userSelectedConcern
      checkpoint.note = command.note || null
      checkpoint.referralSuggested = command.referralSuggested
      checkpoint.supervisorReviewSuggested = command.supervisorReviewSuggested
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
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        completedAt: workflow.completedAt,
      },
    })
  }
}

function config(): AppConfiguration {
  return {
    nodeEnv: 'test',
    port: 3011,
    databaseUrl: 'postgresql://not-used',
    appOrigin: 'http://api.test',
    frontendOrigin: 'http://web.test',
    allowedOrigins: ['http://api.test', 'http://web.test'],
    cookieName: 'test_session',
    cookieSigningSecret: 'a-test-cookie-secret-that-is-long-enough',
    sessionTtlHours: 12,
    sessionIdleTimeoutMinutes: 60,
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

  it('enforces server-side idle expiry without extending the absolute session lifetime', async () => {
    const repository = new MemoryRepository()
    repository.identities.set('cognito:kaimahi', activeKaimahi)
    const now = new Date('2026-08-09T04:00:00.000Z')
    const idleToken = 'idle-session'
    await repository.createSession({
      id: '9f49620a-6a90-4739-934d-44c487c51d04',
      userId: activeKaimahi.id,
      tokenHash: sha256(idleToken),
      expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
      lastActivityAt: new Date(now.getTime() - 61 * 60 * 1000),
    })
    const app = await createApplication({ config: config(), repository, oidcProvider: new FakeOidcProvider(), now: () => now })
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `test_session=${idleToken}` } })).statusCode).toBe(401)

    const activeToken = 'active-session'
    await repository.createSession({
      id: '12834aa0-8e1e-4d43-a57f-ddecae4b95f9',
      userId: activeKaimahi.id,
      tokenHash: sha256(activeToken),
      expiresAt: new Date(now.getTime() + 1),
      lastActivityAt: now,
    })
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `test_session=${activeToken}` } })).statusCode).toBe(200)
    const afterAbsoluteExpiry = new Date(now.getTime() + 2)
    const expiredApp = await createApplication({ config: config(), repository, oidcProvider: new FakeOidcProvider(), now: () => afterAbsoluteExpiry })
    expect((await expiredApp.inject({ method: 'GET', url: '/api/me', headers: { cookie: `test_session=${activeToken}` } })).statusCode).toBe(401)
    await app.close()
    await expiredApp.close()
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

    const stale = await app.inject({
      method: 'POST',
      url: '/api/workflows/22b1f80c-2c12-4f82-bdd9-65d7b30712bb/interactions',
      headers: { cookie: sessionCookie, origin: 'http://web.test' },
      payload: {
        type: 'pou-review-confirmed',
        idempotencyKey: '99bd1f2c-4528-4fab-8bfa-96c4a11b0c07',
        expectedVersion: 1,
        pouId: 'whakapapa',
        userSelectedConcern: 'watch',
        referralSuggested: false,
        supervisorReviewSuggested: false,
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'stale_workflow', currentVersion: 2 })
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
