import { randomUUID } from 'node:crypto'

import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'

import { pkceChallenge, randomToken, sameToken, sha256 } from './auth/crypto.js'
import type { OidcProvider } from './auth/oidc.js'
import type { AppConfiguration } from './config.js'
import { AuthorizationError, requireRole, toPublicProfile, type ApplicationRole, type AuthenticatedUser } from './domain/auth.js'
import type { AuthRepository } from './db/repository.js'
import {
  IdempotencyKeyReuseError,
  SafetyObservationIdentifierReuseError,
  StaleSafetyObservationError,
  StaleWorkflowError,
  WorkflowValidationError,
  WorkflowNotFoundError,
  type WorkflowRepository,
} from './workflows/repository.js'
import { WorkflowTransitionError } from './workflows/domain.js'
import {
  ConversationAuthorizationAlreadyIssuedError,
  ConversationNotFoundError,
  ConversationStartInProgressError,
  ProviderConversationMismatchError,
  type ConversationApplicationService,
} from './conversations/service.js'
import {
  ConversationEligibilityError,
  TERMINATION_REASONS,
  type ConversationTerminationReason,
} from './conversations/domain.js'
import {
  ConversationProviderAuthorizationError,
  ConversationProviderUnavailableError,
} from './conversations/provider.js'
import {
  ConversationIdempotencyKeyReuseError,
  ConversationRepositoryError,
  OpenConversationExistsError,
  type ConversationRecord,
} from './conversations/repository.js'
import { contentHash } from './safety-assessments/domain.js'
import { AssessmentCandidateUnavailableError, PostgresSafetyAssessmentRepository, ProviderDeliveryConflictError, SafetyAssessmentValidationError } from './safety-assessments/repository.js'
import { ConversationAssessmentProviderError, type ConversationAssessmentProvider } from './safety-assessments/assessment-provider.js'
import { ElevenLabsGuidanceProvenanceMismatchError, ElevenLabsHmacWebhookVerifier, ElevenLabsWebhookEnvelopeError, ElevenLabsWebhookSignatureError, ElevenLabsWebhookUnsupportedEventError, elevenLabsSignatureHeader, parseElevenLabsPostCallTranscript, type ElevenLabsWebhookVerifier } from './safety-assessments/webhook.js'
import { normaliseSignedTranscript } from './transcripts/domain.js'
import { PostgresTranscriptRepository } from './transcripts/repository.js'
import type { ConversationReviewDraftProvider } from './review-drafts/provider.js'
import { PostgresConversationReviewDraftRepository } from './review-drafts/repository.js'
import { ReviewDraftUnavailableError, StaleReviewDraftError } from './review-drafts/domain.js'
import { ConversationGuidanceProjectionError, conversationRuntimeDynamicVariables } from './pou-specifications/domain.js'
import { PouSpecificationUnavailableError } from './pou-specifications/repository.js'
import {
  WORKFLOW_ENGAGEMENT_TYPES,
  WORKFLOW_ACTION_STATUSES,
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_IMMEDIATE_CONCERNS,
  WORKFLOW_POU_CONCERNS,
  WORKFLOW_POU_IDS,
  WORKFLOW_REFERRAL_STATUSES,
  SAFETY_BROAD_CLASSES,
  SAFETY_OBSERVATION_CONCERN_LEVELS,
} from '../shared/workflow.js'

const transactionCookieName = 'te_kaupapa_oidc_transaction'
const transactionSchema = z.object({
  state: z.string().min(32),
  nonce: z.string().min(32),
  verifier: z.string().min(32),
  issuedAt: z.number().int(),
})

function providerWebhookRejectionReason(error: unknown): 'signature' | 'guidance_provenance_mismatch' | 'invalid_json' | 'unsupported_event' | 'schema_validation' | 'assessment_validation' | 'assessment_provider' | 'unexpected' {
  if (error instanceof ElevenLabsWebhookSignatureError) return 'signature'
  if (error instanceof ElevenLabsGuidanceProvenanceMismatchError) return 'guidance_provenance_mismatch'
  if (error instanceof SyntaxError) return 'invalid_json'
  if (error instanceof ElevenLabsWebhookUnsupportedEventError) return 'unsupported_event'
  if (error instanceof ElevenLabsWebhookEnvelopeError) return 'schema_validation'
  if (error instanceof z.ZodError) return 'schema_validation'
  if (error instanceof SafetyAssessmentValidationError) return 'assessment_validation'
  if (error instanceof ConversationAssessmentProviderError) return 'assessment_provider'
  return 'unexpected'
}

export interface AppDependencies {
  config: AppConfiguration
  repository: AuthRepository
  workflowRepository?: WorkflowRepository
  conversationService?: ConversationApplicationService
  safetyAssessmentRepository?: PostgresSafetyAssessmentRepository
  conversationAssessmentProvider?: ConversationAssessmentProvider
  conversationReviewDraftProvider?: ConversationReviewDraftProvider
  reviewDraftRepository?: PostgresConversationReviewDraftRepository
  transcriptRepository?: PostgresTranscriptRepository
  elevenLabsWebhookVerifier?: ElevenLabsWebhookVerifier
  oidcProvider?: OidcProvider
  now?: () => Date
}

declare module 'fastify' {
  interface FastifyRequest {
    authenticatedUser?: AuthenticatedUser
  }
}

export async function createApplication(dependencies: AppDependencies): Promise<FastifyInstance> {
  const { config, repository, workflowRepository, conversationService, safetyAssessmentRepository, conversationAssessmentProvider, conversationReviewDraftProvider, reviewDraftRepository, transcriptRepository, elevenLabsWebhookVerifier, oidcProvider, now = () => new Date() } = dependencies
  const app = Fastify({ logger: config.nodeEnv !== 'test' })
  const secureCookie = config.nodeEnv === 'production'

  await app.register(cookie, { secret: config.cookieSigningSecret })
  await app.register(cors, {
    credentials: true,
    origin: (origin, callback) => callback(null, !origin || config.allowedOrigins.includes(origin)),
  })

  const sessionCookie = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: secureCookie,
    maxAge: config.sessionTtlHours * 60 * 60,
  }
  const transactionCookie = {
    path: '/api/auth',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: secureCookie,
    maxAge: 10 * 60,
  }

  function redirectUri(): string {
    return new URL('/api/auth/callback', config.appOrigin).toString()
  }

  function frontendRedirect(status: 'unprovisioned' | 'inactive' | 'failed'): string {
    const destination = new URL(config.frontendOrigin)
    destination.searchParams.set('auth', status)
    return destination.toString()
  }

  function cognitoLogoutUrl(): string | undefined {
    if (!config.cognito) return undefined
    const destination = new URL('/logout', config.cognito.managedLoginDomain)
    destination.search = new URLSearchParams({
      client_id: config.cognito.clientId,
      logout_uri: config.frontendOrigin,
    }).toString()
    return destination.toString()
  }

  async function authenticate(request: FastifyRequest): Promise<AuthenticatedUser | null> {
    if (request.authenticatedUser) return request.authenticatedUser
    const token = request.cookies[config.cookieName]
    if (!token) return null
    const tokenHash = sha256(token)
    const user = await repository.findUserBySessionHash(tokenHash, now(), config.sessionIdleTimeoutMinutes)
    if (!user || user.status !== 'active') return null
    await repository.touchSession(tokenHash, now())
    request.authenticatedUser = user
    return user
  }

  function requireTrustedOrigin(request: FastifyRequest, reply: FastifyReply): boolean {
    const candidate = request.headers.origin ?? request.headers.referer
    if (!candidate) {
      reply.code(403).send({ error: 'invalid_request' })
      return false
    }
    try {
      if (config.allowedOrigins.includes(new URL(candidate).origin)) return true
    } catch {
      // Do not reveal parser details to a browser client.
    }
    reply.code(403).send({ error: 'invalid_request' })
    return false
  }

  app.get('/api/health', async () => ({ status: 'ok' }))

  app.get('/api/me', async (request, reply) => {
    const user = await authenticate(request)
    if (!user) return reply.code(401).send({ error: 'unauthenticated' })
    return { profile: toPublicProfile(user) }
  })

  app.get('/api/auth/login', async (_request, reply) => {
    if (!oidcProvider) return reply.code(503).send({ error: 'authentication_unavailable' })
    const transaction = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(),
      issuedAt: now().getTime(),
    }
    const encoded = Buffer.from(JSON.stringify(transaction)).toString('base64url')
    reply.setCookie(transactionCookieName, reply.signCookie(encoded), transactionCookie)
    return reply.redirect(oidcProvider.authorizationUrl({
      state: transaction.state,
      nonce: transaction.nonce,
      codeChallenge: pkceChallenge(transaction.verifier),
      redirectUri: redirectUri(),
    }))
  })

  app.get('/api/auth/callback', async (request, reply) => {
    reply.clearCookie(transactionCookieName, transactionCookie)
    if (!oidcProvider) return reply.redirect(frontendRedirect('failed'))
    const query = z.object({ code: z.string().min(1), state: z.string().min(32) }).safeParse(request.query)
    const signedTransaction = request.cookies[transactionCookieName]
    if (!query.success || !signedTransaction) return reply.redirect(frontendRedirect('failed'))
    const unsigned = request.unsignCookie(signedTransaction)
    if (!unsigned.valid) return reply.redirect(frontendRedirect('failed'))
    let transaction: z.infer<typeof transactionSchema>
    try {
      transaction = transactionSchema.parse(JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8')))
    } catch {
      return reply.redirect(frontendRedirect('failed'))
    }
    if (now().getTime() - transaction.issuedAt > 10 * 60 * 1000 || !sameToken(query.data.state, transaction.state)) {
      return reply.redirect(frontendRedirect('failed'))
    }

    try {
      const identity = await oidcProvider.exchangeCode({
        code: query.data.code,
        codeVerifier: transaction.verifier,
        nonce: transaction.nonce,
        redirectUri: redirectUri(),
      })
      const user = await repository.findUserByExternalIdentity(identity.provider, identity.subject)
      if (!user) return reply.redirect(frontendRedirect('unprovisioned'))
      if (user.status !== 'active') return reply.redirect(frontendRedirect('inactive'))

      const token = randomToken()
      await repository.createSession({
        id: randomUUID(),
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(now().getTime() + config.sessionTtlHours * 60 * 60 * 1000),
        lastActivityAt: now(),
      })
      reply.setCookie(config.cookieName, token, sessionCookie)
      return reply.redirect(config.frontendOrigin)
    } catch (error) {
      request.log.warn({ err: error instanceof Error ? error.name : 'unknown' }, 'OIDC callback failed')
      return reply.redirect(frontendRedirect('failed'))
    }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    if (!requireTrustedOrigin(request, reply)) return reply
    const token = request.cookies[config.cookieName]
    if (token) await repository.invalidateSession(sha256(token), now())
    reply.clearCookie(config.cookieName, sessionCookie)
    return { logoutUrl: cognitoLogoutUrl() }
  })

  app.get('/api/entry/:role', async (request, reply) => {
    const user = await authenticate(request)
    if (!user) return reply.code(401).send({ error: 'unauthenticated' })
    const parsed = z.object({ role: z.enum(['KAIMAHI', 'SUPERVISOR']) }).safeParse(request.params)
    if (!parsed.success) return reply.code(404).send({ error: 'not_found' })
    try {
      requireRole(user, parsed.data.role as ApplicationRole)
      return { profile: toPublicProfile(user), role: parsed.data.role }
    } catch (error) {
      if (error instanceof AuthorizationError) return reply.code(403).send({ error: 'forbidden' })
      throw error
    }
  })

  app.get('/api/supervision/:kaimahiUserId', async (request, reply) => {
    const user = await authenticate(request)
    if (!user) return reply.code(401).send({ error: 'unauthenticated' })
    const parsed = z.object({ kaimahiUserId: z.string().uuid() }).safeParse(request.params)
    if (!parsed.success) return reply.code(404).send({ error: 'not_found' })
    try {
      requireRole(user, 'SUPERVISOR')
      if (!await repository.isSupervisorOf(user.id, parsed.data.kaimahiUserId)) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      return reply.code(204).send()
    } catch (error) {
      if (error instanceof AuthorizationError) return reply.code(403).send({ error: 'forbidden' })
      throw error
    }
  })

  async function requireKaimahi(request: FastifyRequest, reply: FastifyReply): Promise<AuthenticatedUser | null> {
    const user = await authenticate(request)
    if (!user) {
      reply.code(401).send({ error: 'unauthenticated' })
      return null
    }
    try {
      requireRole(user, 'KAIMAHI')
      return user
    } catch (error) {
      if (error instanceof AuthorizationError) {
        reply.code(403).send({ error: 'forbidden' })
        return null
      }
      throw error
    }
  }

  function workflowFailure(error: unknown, request: FastifyRequest, reply: FastifyReply) {
    if (error instanceof IdempotencyKeyReuseError) return reply.code(409).send({ error: 'idempotency_key_reused' })
    if (error instanceof StaleWorkflowError) return reply.code(409).send({ error: 'stale_workflow', currentVersion: error.currentVersion })
    if (error instanceof StaleSafetyObservationError) return reply.code(409).send({ error: 'stale_safety_observation', currentRevision: error.currentRevision })
    if (error instanceof SafetyObservationIdentifierReuseError) return reply.code(409).send({ error: 'safety_observation_identifier_reused' })
    if (error instanceof WorkflowTransitionError) return reply.code(409).send({ error: 'invalid_transition' })
    if (error instanceof WorkflowValidationError) return reply.code(400).send({ error: 'invalid_request' })
    if (error instanceof WorkflowNotFoundError) return reply.code(404).send({ error: 'not_found' })
    request.log.error({ err: error instanceof Error ? error.name : 'unknown' }, 'Workflow persistence unavailable')
    return reply.code(503).send({ error: 'persistence_unavailable' })
  }

  function publicConversation(conversation: ConversationRecord) {
    return {
      id: conversation.id,
      pouId: conversation.pouId,
      status: conversation.status,
      providerConversationId: conversation.providerConversationId,
      authorizedAt: conversation.authorizedAt,
      connectedAt: conversation.connectedAt,
      endedAt: conversation.endedAt,
      terminationReason: conversation.terminationReason,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    }
  }

  function conversationFailure(error: unknown, request: FastifyRequest, reply: FastifyReply) {
    if (error instanceof ConversationNotFoundError) return reply.code(404).send({ error: 'not_found' })
    if (error instanceof ConversationEligibilityError) return reply.code(409).send({ error: 'conversation_ineligible' })
    if (error instanceof ConversationIdempotencyKeyReuseError) return reply.code(409).send({ error: 'idempotency_key_reused' })
    if (error instanceof OpenConversationExistsError || error instanceof ConversationStartInProgressError) return reply.code(409).send({ error: 'conversation_start_in_progress' })
    if (error instanceof ConversationAuthorizationAlreadyIssuedError) return reply.code(409).send({ error: 'authorization_already_issued', conversation: publicConversation(error.conversation) })
    if (error instanceof ProviderConversationMismatchError) return reply.code(409).send({ error: 'provider_id_mismatch' })
    if (error instanceof ConversationProviderUnavailableError) return reply.code(503).send({ error: 'provider_unavailable' })
    if (error instanceof ConversationProviderAuthorizationError) return reply.code(502).send({ error: 'provider_authorization_failed' })
    if (error instanceof PouSpecificationUnavailableError) {
      request.log.error({ category: 'pou_specification_invalid' }, 'Conversation operation failed')
      return reply.code(503).send({ error: 'pou_specification_invalid' })
    }
    if (error instanceof ConversationGuidanceProjectionError) {
      request.log.error({ category: 'guidance_projection_invalid' }, 'Conversation operation failed')
      return reply.code(503).send({ error: 'guidance_projection_invalid' })
    }
    if (error instanceof ConversationRepositoryError) {
      request.log.error({ category: 'conversation_persistence_unavailable' }, 'Conversation operation failed')
      return reply.code(503).send({ error: 'conversation_persistence_unavailable' })
    }
    if (error instanceof SafetyAssessmentValidationError) {
      request.log.error({ category: 'assessment_activation_invalid' }, 'Conversation operation failed')
      return reply.code(503).send({ error: 'assessment_activation_invalid' })
    }
    request.log.error({ category: 'unexpected', err: error instanceof Error ? error.name : 'unknown' }, 'Conversation operation failed')
    return reply.code(503).send({ error: 'conversation_unavailable' })
  }

  const idempotencySchema = z.object({ idempotencyKey: z.string().uuid() })
  const conversationStartSchema = z.object({ idempotencyKey: z.string().uuid() }).strict()
  const conversationParamsSchema = z.object({
    workflowSessionId: z.string().uuid(),
    pouId: z.enum(WORKFLOW_POU_IDS),
  })
  const conversationIdParamsSchema = z.object({ conversationId: z.string().uuid() })
  const clientConnectedSchema = z.object({ providerConversationId: z.string().trim().min(1).max(255) }).strict()
  const conversationEndSchema = z.object({ reason: z.enum(TERMINATION_REASONS) }).strict()
  const assessmentParamsSchema = z.object({ workflowSessionId: z.string().uuid(), assessmentId: z.string().uuid() })
  const assessmentReviewSchema = z.object({ status: z.enum(['dismissed', 'insufficient_information_acknowledged']) }).strict()
  const reviewDraftParamsSchema = z.object({ workflowSessionId: z.string().uuid(), reviewDraftId: z.string().uuid() })
  const reviewDraftEditSchema = z.object({
    reviewDraftId: z.string().uuid(), expectedRevision: z.number().int().positive(),
    overallSummary: z.string().trim().min(1).max(1_200).nullable(),
    strengthsSummary: z.string().trim().min(1).max(900).nullable(),
    areasForAttentionSummary: z.string().trim().min(1).max(900).nullable(),
    evidenceTurnIds: z.array(z.string().uuid()).max(8),
  }).strict()
  const setupCommandSchema = z.object({
    type: z.literal('setup-confirmed'),
    idempotencyKey: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    whanauReference: z.string().trim().min(1).max(64),
    engagementType: z.enum(WORKFLOW_ENGAGEMENT_TYPES),
    sessionFocus: z.string().trim().min(3).max(4_000),
    additionalNotes: z.string().trim().max(4_000).optional(),
    immediateConcern: z.enum(WORKFLOW_IMMEDIATE_CONCERNS),
  })
  const pouReviewCommandSchema = z.object({
    type: z.literal('pou-review-confirmed'),
    idempotencyKey: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    pouId: z.enum(WORKFLOW_POU_IDS),
    // Legacy checkpoint fields are deliberately not part of an ordinary
    // narrative confirmation. Formal safety uses safety-observation-confirmed.
    userSelectedConcern: z.never().optional(),
    note: z.string().trim().max(4_000).optional(),
    referralSuggested: z.never().optional(),
    supervisorReviewSuggested: z.never().optional(),
    reviewDraftRevisionId: z.string().uuid().optional(),
  }).strict()
  const carryForwardSourceSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('review_criterion'), reviewDraftRevisionId: z.string().uuid(), criterionCode: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{1,119}$/) }).strict(),
    z.object({ kind: z.literal('areas_for_attention'), reviewDraftRevisionId: z.string().uuid() }).strict(),
    z.object({ kind: z.literal('safety_observation'), observationId: z.string().uuid() }).strict(),
  ])
  const downstreamCommandSchema = z.object({
    idempotencyKey: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
  })
  const actionInputSchema = z.object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(300),
    type: z.enum(WORKFLOW_ACTION_TYPES),
    pouId: z.enum(WORKFLOW_POU_IDS).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(WORKFLOW_ACTION_STATUSES).exclude(['withdrawn']),
    notes: z.string().trim().max(4_000).optional(),
  })
  const referralInputSchema = z.object({
    id: z.string().uuid(),
    destinationCode: z.string().trim().min(1).max(100).optional(),
    destinationName: z.string().trim().min(1).max(300),
    reason: z.string().trim().min(1).max(4_000),
    pouId: z.enum(WORKFLOW_POU_IDS).optional(),
    handoverNote: z.string().trim().max(4_000).optional(),
    notes: z.string().trim().max(4_000).optional(),
    status: z.enum(WORKFLOW_REFERRAL_STATUSES).exclude(['withdrawn']),
  })
  const safetyObservationSnapshotSchema = z.discriminatedUnion('assessmentContext', [
    z.object({
      assessmentContext: z.literal('setup'),
      broadClass: z.enum(SAFETY_BROAD_CLASSES),
      concernLevel: z.enum(SAFETY_OBSERVATION_CONCERN_LEVELS).extract(['unsure', 'urgent']),
      contextNote: z.string().trim().max(4_000).optional(),
    }).strict(),
    z.object({
      assessmentContext: z.literal('pou'),
      pouId: z.enum(WORKFLOW_POU_IDS),
      broadClass: z.enum(SAFETY_BROAD_CLASSES),
      concernLevel: z.enum(SAFETY_OBSERVATION_CONCERN_LEVELS).extract(['low', 'watch', 'action', 'urgent']),
      contextNote: z.string().trim().max(4_000).optional(),
    }).strict(),
  ])
  const workflowCommandSchema = z.discriminatedUnion('type', [
    setupCommandSchema,
    pouReviewCommandSchema,
    downstreamCommandSchema.extend({ type: z.literal('pou-summary-confirmed') }),
    downstreamCommandSchema.extend({ type: z.literal('action-plan-confirmed'), actions: z.array(actionInputSchema).max(100) }),
    downstreamCommandSchema.extend({ type: z.literal('referral-plan-confirmed'), referrals: z.array(referralInputSchema).max(100) }),
    downstreamCommandSchema.extend({ type: z.literal('structured-review-confirmed') }),
    downstreamCommandSchema.extend({ type: z.literal('workflow-completed') }),
    z.object({
      type: z.literal('safety-observation-confirmed'),
      observationId: z.string().uuid(),
      idempotencyKey: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      observation: safetyObservationSnapshotSchema,
      candidateAssessmentId: z.string().uuid().optional(),
    }).strict(),
    z.object({
      type: z.literal('safety-observation-corrected'),
      observationId: z.string().uuid(),
      expectedObservationRevision: z.number().int().positive(),
      idempotencyKey: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      replacement: safetyObservationSnapshotSchema,
      reason: z.string().trim().min(1).max(4_000),
    }).strict(),
    z.object({
      type: z.literal('safety-observation-retracted'),
      observationId: z.string().uuid(),
      expectedObservationRevision: z.number().int().positive(),
      idempotencyKey: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      reason: z.string().trim().min(1).max(4_000),
    }).strict(),
    z.object({
      type: z.literal('supervisor-review-requested'),
      requestId: z.string().uuid(),
      idempotencyKey: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      pouId: z.enum(WORKFLOW_POU_IDS).optional(),
      requestNote: z.string().trim().max(4_000).optional(),
    }).strict(),
    z.object({
      type: z.literal('carry-forward-marked'),
      itemId: z.string().uuid(),
      idempotencyKey: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      pouId: z.enum(WORKFLOW_POU_IDS),
      source: carryForwardSourceSchema,
      note: z.string().trim().min(1).max(1_000).optional(),
    }).strict(),
  ])

  app.post('/api/workflows', async (request, reply) => {
    if (!requireTrustedOrigin(request, reply)) return reply
    const user = await requireKaimahi(request, reply)
    if (!user) return reply
    if (!workflowRepository) return reply.code(503).send({ error: 'persistence_unavailable' })
    const parsed = idempotencySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' })
    try {
      const result = await workflowRepository.createDraft({ actor: user, idempotencyKey: parsed.data.idempotencyKey })
      return reply.code(result.replayed ? 200 : 201).send({ workflow: result.workflow, acknowledgement: { interactionId: result.interactionId, replayed: result.replayed } })
    } catch (error) {
      return workflowFailure(error, request, reply)
    }
  })

  app.get('/api/workflows', async (request, reply) => {
    const user = await requireKaimahi(request, reply)
    if (!user) return reply
    if (!workflowRepository) return reply.code(503).send({ error: 'persistence_unavailable' })
    const parsed = z.object({ status: z.enum(['resumable', 'completed']).optional() }).safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' })
    try {
      return { workflows: parsed.data.status === 'completed'
        ? await workflowRepository.listCompleted(user)
        : await workflowRepository.listResumable(user) }
    } catch (error) {
      return workflowFailure(error, request, reply)
    }
  })

  app.get('/api/workflows/:workflowSessionId', async (request, reply) => {
    const user = await requireKaimahi(request, reply)
    if (!user) return reply
    if (!workflowRepository) return reply.code(503).send({ error: 'persistence_unavailable' })
    const parsed = z.object({ workflowSessionId: z.string().uuid() }).safeParse(request.params)
    if (!parsed.success) return reply.code(404).send({ error: 'not_found' })
    try {
      const workflow = await workflowRepository.findById(user, parsed.data.workflowSessionId)
      if (!workflow) return reply.code(404).send({ error: 'not_found' })
      return { workflow }
    } catch (error) {
      return workflowFailure(error, request, reply)
    }
  })

  app.get('/api/workflows/:workflowSessionId/safety-observations/:observationId/history', async (request, reply) => {
    const user = await requireKaimahi(request, reply)
    if (!user) return reply
    if (!workflowRepository) return reply.code(503).send({ error: 'persistence_unavailable' })
    const parsed = z.object({ workflowSessionId: z.string().uuid(), observationId: z.string().uuid() }).safeParse(request.params)
    if (!parsed.success) return reply.code(404).send({ error: 'not_found' })
    try {
      const history = await workflowRepository.findSafetyObservationHistory(user, parsed.data.workflowSessionId, parsed.data.observationId)
      if (!history) return reply.code(404).send({ error: 'not_found' })
      return { history }
    } catch (error) {
      return workflowFailure(error, request, reply)
    }
  })

  app.post('/api/workflows/:workflowSessionId/interactions', async (request, reply) => {
    if (!requireTrustedOrigin(request, reply)) return reply
    const user = await requireKaimahi(request, reply)
    if (!user) return reply
    if (!workflowRepository) return reply.code(503).send({ error: 'persistence_unavailable' })
    const params = z.object({ workflowSessionId: z.string().uuid() }).safeParse(request.params)
    const command = workflowCommandSchema.safeParse(request.body)
    if (!params.success || !command.success) return reply.code(400).send({ error: 'invalid_request' })
    try {
      const result = await workflowRepository.submitCommand({ actor: user, workflowSessionId: params.data.workflowSessionId, command: command.data })
      return { workflow: result.workflow, acknowledgement: { interactionId: result.interactionId, replayed: result.replayed } }
    } catch (error) {
      return workflowFailure(error, request, reply)
    }
  })

  app.get('/api/workflows/:workflowSessionId/pou/:pouId/assessment-candidates', async (request, reply) => {
    const user = await requireKaimahi(request, reply)
    if (!user) return reply
    if (!workflowRepository || !safetyAssessmentRepository) return reply.code(503).send({ error: 'persistence_unavailable' })
    const params = z.object({ workflowSessionId: z.string().uuid(), pouId: z.enum(WORKFLOW_POU_IDS) }).safeParse(request.params)
    if (!params.success) return reply.code(404).send({ error: 'not_found' })
    if (!await workflowRepository.findById(user, params.data.workflowSessionId)) return reply.code(404).send({ error: 'not_found' })
    try {
      reply.header('cache-control', 'no-store')
      return { candidates: await safetyAssessmentRepository.listReviewable(user, params.data.workflowSessionId, params.data.pouId) }
    } catch (error) {
      request.log.error({ err: error instanceof Error ? error.name : 'unknown' }, 'Safety assessment candidate lookup failed')
      return reply.code(503).send({ error: 'persistence_unavailable' })
    }
  })

  app.post('/api/workflows/:workflowSessionId/assessment-candidates/:assessmentId/review', async (request, reply) => {
    if (!requireTrustedOrigin(request, reply)) return reply
    const user = await requireKaimahi(request, reply)
    if (!user) return reply
    if (!workflowRepository || !safetyAssessmentRepository) return reply.code(503).send({ error: 'persistence_unavailable' })
    const params = assessmentParamsSchema.safeParse(request.params)
    const body = assessmentReviewSchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' })
    if (!await workflowRepository.findById(user, params.data.workflowSessionId)) return reply.code(404).send({ error: 'not_found' })
    try {
      await safetyAssessmentRepository.acknowledge(user, params.data.workflowSessionId, params.data.assessmentId, body.data.status)
      return reply.code(204).send()
    } catch (error) {
      if (error instanceof AssessmentCandidateUnavailableError) return reply.code(409).send({ error: 'assessment_unavailable' })
      return reply.code(503).send({ error: 'persistence_unavailable' })
    }
  })

  app.get('/api/workflows/:workflowSessionId/pou/:pouId/review-draft', async (request, reply) => {
    const user = await requireKaimahi(request, reply)
    if (!user) return reply
    if (!reviewDraftRepository) return reply.code(503).send({ error: 'review_draft_unavailable' })
    const params = z.object({ workflowSessionId: z.string().uuid(), pouId: z.enum(WORKFLOW_POU_IDS) }).safeParse(request.params)
    if (!params.success) return reply.code(404).send({ error: 'not_found' })
    try {
      reply.header('cache-control', 'no-store')
      return { review: await reviewDraftRepository.findForKaimahi(user, params.data.workflowSessionId, params.data.pouId) }
    } catch (error) {
      if (error instanceof ReviewDraftUnavailableError) return reply.code(404).send({ error: 'not_found' })
      request.log.warn({ category: 'review_draft_lookup_failed' }, 'Whakapapa review draft lookup failed')
      return reply.code(503).send({ error: 'review_draft_unavailable' })
    }
  })

  app.post('/api/workflows/:workflowSessionId/pou/:pouId/review-drafts/:reviewDraftId/reviewed', async (request, reply) => {
    if (!requireTrustedOrigin(request, reply)) return reply
    const user = await requireKaimahi(request, reply)
    if (!user) return reply
    if (!reviewDraftRepository) return reply.code(503).send({ error: 'review_draft_unavailable' })
    const params = reviewDraftParamsSchema.extend({ pouId: z.enum(WORKFLOW_POU_IDS) }).safeParse(request.params)
    if (!params.success) return reply.code(404).send({ error: 'not_found' })
    try {
      await reviewDraftRepository.markReviewed(user, params.data.workflowSessionId, params.data.reviewDraftId)
      return reply.code(204).send()
    } catch (error) {
      if (error instanceof ReviewDraftUnavailableError) return reply.code(409).send({ error: 'review_draft_unavailable' })
      return reply.code(503).send({ error: 'review_draft_unavailable' })
    }
  })

  app.put('/api/workflows/:workflowSessionId/pou/:pouId/review-draft', async (request, reply) => {
    if (!requireTrustedOrigin(request, reply)) return reply
    const user = await requireKaimahi(request, reply)
    if (!user) return reply
    if (!reviewDraftRepository) return reply.code(503).send({ error: 'review_draft_unavailable' })
    const params = z.object({ workflowSessionId: z.string().uuid(), pouId: z.enum(WORKFLOW_POU_IDS) }).safeParse(request.params)
    const body = reviewDraftEditSchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' })
    try {
      const { reviewDraftId, expectedRevision, ...content } = body.data
      const draft = await reviewDraftRepository.edit(user, params.data.workflowSessionId, { reviewDraftId, expectedRevision, content })
      return { draft }
    } catch (error) {
      if (error instanceof StaleReviewDraftError) return reply.code(409).send({ error: 'stale_review_draft', currentRevision: error.currentRevision })
      if (error instanceof ReviewDraftUnavailableError) return reply.code(409).send({ error: 'review_draft_unavailable' })
      return reply.code(503).send({ error: 'review_draft_unavailable' })
    }
  })

  app.post('/api/workflows/:workflowSessionId/pou/:pouId/conversations', async (request, reply) => {
    if (!requireTrustedOrigin(request, reply)) return reply
    const user = await requireKaimahi(request, reply)
    if (!user) return reply
    if (!conversationService) return reply.code(503).send({ error: 'provider_unavailable' })
    const params = conversationParamsSchema.safeParse(request.params)
    const body = conversationStartSchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' })
    try {
      const result = await conversationService.start(user, params.data.workflowSessionId, params.data.pouId, body.data.idempotencyKey)
      reply.header('cache-control', 'no-store')
      return reply.code(201).send({
        conversation: publicConversation(result.conversation),
        authorization: { transport: 'webrtc', conversationToken: result.conversationToken, dynamicVariables: result.dynamicVariables },
      })
    } catch (error) {
      return conversationFailure(error, request, reply)
    }
  })

  app.post('/api/conversations/:conversationId/client-connected', async (request, reply) => {
    if (!requireTrustedOrigin(request, reply)) return reply
    const user = await requireKaimahi(request, reply)
    if (!user) return reply
    if (!conversationService) return reply.code(503).send({ error: 'provider_unavailable' })
    const params = conversationIdParamsSchema.safeParse(request.params)
    const body = clientConnectedSchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' })
    try {
      const conversation = await conversationService.acknowledgeClientConnected(user, params.data.conversationId, body.data.providerConversationId)
      reply.header('cache-control', 'no-store')
      return { conversation: publicConversation(conversation) }
    } catch (error) {
      return conversationFailure(error, request, reply)
    }
  })

  app.post('/api/conversations/:conversationId/end', async (request, reply) => {
    if (!requireTrustedOrigin(request, reply)) return reply
    const user = await requireKaimahi(request, reply)
    if (!user) return reply
    if (!conversationService) return reply.code(503).send({ error: 'provider_unavailable' })
    const params = conversationIdParamsSchema.safeParse(request.params)
    const body = conversationEndSchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' })
    try {
      const conversation = await conversationService.end(user, params.data.conversationId, body.data.reason as ConversationTerminationReason)
      reply.header('cache-control', 'no-store')
      return { conversation: publicConversation(conversation) }
    } catch (error) {
      return conversationFailure(error, request, reply)
    }
  })

  app.get('/api/workflows/:workflowSessionId/pou/:pouId/conversation', async (request, reply) => {
    const user = await requireKaimahi(request, reply)
    if (!user) return reply
    if (!conversationService) return reply.code(503).send({ error: 'provider_unavailable' })
    const params = conversationParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(404).send({ error: 'not_found' })
    try {
      const conversation = await conversationService.current(user, params.data.workflowSessionId, params.data.pouId)
      reply.header('cache-control', 'no-store')
      return { conversation: conversation ? publicConversation(conversation) : null }
    } catch (error) {
      return conversationFailure(error, request, reply)
    }
  })

  if (config.elevenlabsWebhook && safetyAssessmentRepository && transcriptRepository) {
    const verifier = elevenLabsWebhookVerifier ?? new ElevenLabsHmacWebhookVerifier(config.elevenlabsWebhook.signingSecret, config.elevenlabsWebhook.maximumAgeSeconds)
    await app.register(async (webhookApp) => {
      webhookApp.removeContentTypeParser('application/json')
      webhookApp.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: config.elevenlabsWebhook!.maximumBodyBytes }, (_request, body, done) => done(null, body))
      webhookApp.post('/api/integrations/elevenlabs/post-call', async (request, reply) => {
        if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'unsupported_media_type' })
        try {
          verifier.verify(request.body, request.headers[elevenLabsSignatureHeader] as string | undefined, now())
          const event = parseElevenLabsPostCallTranscript(request.body)
          const payloadHash = contentHash(request.body.toString('utf8'))
          const transcriptReceivedAt = now()
          const pin = await safetyAssessmentRepository.resolveActivePinForConversation({
            providerConversationId: event.providerConversationId,
            agentReference: event.agentReference,
            branchReference: event.branchReference,
            environment: event.environment,
          })
          if (event.dynamicVariableProvenance) {
            if (!pin.guidanceProjection) throw new ElevenLabsGuidanceProvenanceMismatchError('No pinned conversation guidance exists for provenance verification.')
            const expectedDynamicVariables = conversationRuntimeDynamicVariables(pin.guidanceProjection, pin.pouId)
            if (contentHash(event.dynamicVariableProvenance) !== contentHash(expectedDynamicVariables)) {
              throw new ElevenLabsGuidanceProvenanceMismatchError('Provider conversation guidance did not match the server-pinned projection.')
            }
          }
          const reservation = await safetyAssessmentRepository.reserveDelivery({ provider: 'elevenlabs', deliveryId: event.deliveryId, payloadHash, assessmentRunId: pin.runId })
          if (reservation.conflict) return reply.code(409).send({ error: 'delivery_conflict' })
          if (reservation.replayed) return reply.code(200).send({ accepted: true, replayed: true, superseded: pin.superseded })
          if (reservation.inFlight) return reply.code(503).send({ error: 'delivery_in_progress' })
          try {
            const retainedTranscript = await transcriptRepository.retainForConversation({
              organisationId: pin.organisationId, workflowSessionId: pin.workflowSessionId, pouId: pin.pouId,
              workflowConversationId: pin.workflowConversationId, provider: 'elevenlabs', providerConversationId: event.providerConversationId,
              turns: normaliseSignedTranscript(event.transientTranscript),
            })
            if (!pin.requiresAssessment || reservation.superseded) {
              const outcome = await safetyAssessmentRepository.ingest({
                deliveryProvider: 'elevenlabs', deliveryId: event.deliveryId, payloadHash, providerConversationId: event.providerConversationId,
                agentReference: event.agentReference, branchReference: event.branchReference, environment: event.environment,
                transcriptReceivedAt, transcriptId: retainedTranscript.transcriptId, assessments: [],
              })
              return reply.code(202).send({ accepted: true, replayed: false, superseded: outcome.superseded })
            }
            // Narrative synthesis has its own bounded, noncanonical contract.
            // Its failure cannot discard a valid Phase 5B assessment result.
            let reviewResult: Awaited<ReturnType<ConversationReviewDraftProvider['generatePouReviewDraft']>> | undefined
            let reviewFailure: 'provider_unavailable' | 'invalid_output' | undefined
            if (!conversationReviewDraftProvider) reviewFailure = 'provider_unavailable'
            else if (!pin.reviewProjection) reviewFailure = 'invalid_output'
            else {
              try { reviewResult = await conversationReviewDraftProvider.generatePouReviewDraft({ transcriptTurns: retainedTranscript.turns, reviewProjection: pin.reviewProjection }) }
              catch { reviewFailure = 'invalid_output' }
            }
            // A source-derived Pou with no approved bounded safety rule must
            // still produce its review draft. It must not require a safety
            // provider call merely because it has a pinned empty rule manifest.
            const shouldAssessSafety = pin.projection.rules.length > 0
            let assessment: Awaited<ReturnType<ConversationAssessmentProvider['assessPouConversation']>> | undefined
            if (shouldAssessSafety) {
              if (!conversationAssessmentProvider) throw new ConversationAssessmentProviderError('Assessment provider is unavailable.')
              try {
                assessment = await conversationAssessmentProvider.assessPouConversation({ transcriptTurns: retainedTranscript.turns, assessmentProjection: pin.projection })
              } catch (error) {
                // A usable narrative remains explicitly noncanonical even where a
                // separate safety interpretation was unavailable.
                if (reviewResult && reviewDraftRepository) await reviewDraftRepository.recordGenerated({ assessmentRunId: pin.runId, workflowConversationId: pin.workflowConversationId, organisationId: pin.organisationId, workflowSessionId: pin.workflowSessionId, pouId: pin.pouId, transcriptId: retainedTranscript.transcriptId, result: reviewResult })
                throw error
              }
            }
            const outcome = await safetyAssessmentRepository.ingest({
              deliveryProvider: 'elevenlabs', deliveryId: event.deliveryId, payloadHash, providerConversationId: event.providerConversationId,
              agentReference: event.agentReference, branchReference: event.branchReference, environment: event.environment,
              ...(assessment ? {
                assessmentProvider: assessment.provider, assessmentProviderModel: assessment.model,
                assessmentProviderConfigHash: assessment.configurationHash, assessmentSchemaVersion: assessment.schemaVersion,
                assessmentStartedAt: assessment.assessmentStartedAt, assessmentCompletedAt: assessment.assessmentCompletedAt,
              } : {}),
              transcriptReceivedAt, transcriptId: retainedTranscript.transcriptId,
              assessments: assessment?.assessment.assessments ?? [],
            })
            if (outcome.conflict) return reply.code(409).send({ error: 'delivery_conflict' })
            if (reviewDraftRepository) {
              if (reviewResult) await reviewDraftRepository.recordGenerated({ assessmentRunId: pin.runId, workflowConversationId: pin.workflowConversationId, organisationId: pin.organisationId, workflowSessionId: pin.workflowSessionId, pouId: pin.pouId, transcriptId: retainedTranscript.transcriptId, result: reviewResult })
              else if (reviewFailure) await reviewDraftRepository.recordFailed({ assessmentRunId: pin.runId, workflowConversationId: pin.workflowConversationId, organisationId: pin.organisationId, workflowSessionId: pin.workflowSessionId, pouId: pin.pouId, category: reviewFailure })
            }
            return reply.code(outcome.replayed ? 200 : 202).send({ accepted: true, replayed: outcome.replayed, superseded: outcome.superseded })
          } catch (error) {
            await safetyAssessmentRepository.releaseReservedDelivery({ provider: 'elevenlabs', deliveryId: event.deliveryId, payloadHash })
            throw error
          }
        } catch (error) {
          if (error instanceof ProviderDeliveryConflictError) return reply.code(409).send({ error: 'delivery_conflict' })
          if (error instanceof ConversationAssessmentProviderError) {
            request.log.warn({ providerWebhookRejection: providerWebhookRejectionReason(error), bodyBytes: request.body.length }, 'ElevenLabs webhook assessment temporarily unavailable')
            return reply.code(502).send({ error: 'assessment_provider_unavailable' })
          }
          // Keep the public response and persisted data deliberately opaque.
          // This bounded category lets an operator distinguish delivery-path
          // failures without ever logging raw provider content or credentials.
          request.log.warn({ providerWebhookRejection: providerWebhookRejectionReason(error), bodyBytes: request.body.length }, 'ElevenLabs webhook rejected')
          if (error instanceof SafetyAssessmentValidationError || error instanceof z.ZodError || error instanceof SyntaxError || error instanceof Error) return reply.code(400).send({ error: 'invalid_provider_event' })
          return reply.code(400).send({ error: 'invalid_provider_event' })
        }
      })
    })
  }

  return app
}
