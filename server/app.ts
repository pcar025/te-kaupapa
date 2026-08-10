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
  ActiveWorkflowError,
  IdempotencyKeyReuseError,
  StaleWorkflowError,
  WorkflowNotFoundError,
  type WorkflowRepository,
} from './workflows/repository.js'
import { WorkflowTransitionError } from './workflows/domain.js'
import {
  WORKFLOW_ENGAGEMENT_TYPES,
  WORKFLOW_IMMEDIATE_CONCERNS,
  WORKFLOW_POU_CONCERNS,
  WORKFLOW_POU_IDS,
} from '../shared/workflow.js'

const transactionCookieName = 'te_kaupapa_oidc_transaction'
const transactionSchema = z.object({
  state: z.string().min(32),
  nonce: z.string().min(32),
  verifier: z.string().min(32),
  issuedAt: z.number().int(),
})

export interface AppDependencies {
  config: AppConfiguration
  repository: AuthRepository
  workflowRepository?: WorkflowRepository
  oidcProvider?: OidcProvider
  now?: () => Date
}

declare module 'fastify' {
  interface FastifyRequest {
    authenticatedUser?: AuthenticatedUser
  }
}

export async function createApplication(dependencies: AppDependencies): Promise<FastifyInstance> {
  const { config, repository, workflowRepository, oidcProvider, now = () => new Date() } = dependencies
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
    if (error instanceof ActiveWorkflowError) return reply.code(409).send({ error: 'active_workflow_exists' })
    if (error instanceof IdempotencyKeyReuseError) return reply.code(409).send({ error: 'idempotency_key_reused' })
    if (error instanceof StaleWorkflowError) return reply.code(409).send({ error: 'stale_workflow', currentVersion: error.currentVersion })
    if (error instanceof WorkflowTransitionError) return reply.code(409).send({ error: 'invalid_transition' })
    if (error instanceof WorkflowNotFoundError) return reply.code(404).send({ error: 'not_found' })
    request.log.error({ err: error instanceof Error ? error.name : 'unknown' }, 'Workflow persistence unavailable')
    return reply.code(503).send({ error: 'persistence_unavailable' })
  }

  const idempotencySchema = z.object({ idempotencyKey: z.string().uuid() })
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
    userSelectedConcern: z.enum(WORKFLOW_POU_CONCERNS),
    note: z.string().trim().max(4_000).optional(),
    referralSuggested: z.boolean(),
    supervisorReviewSuggested: z.boolean(),
  })
  const workflowCommandSchema = z.discriminatedUnion('type', [setupCommandSchema, pouReviewCommandSchema])

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
    const parsed = z.object({ status: z.literal('resumable').optional() }).safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' })
    try {
      return { workflows: await workflowRepository.listResumable(user) }
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

  return app
}
