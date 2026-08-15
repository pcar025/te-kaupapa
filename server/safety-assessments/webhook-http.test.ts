import { createHmac } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { createApplication } from '../app.js'
import type { AppConfiguration } from '../config.js'
import type { AuthRepository } from '../db/repository.js'
import type { PostgresSafetyAssessmentRepository } from './repository.js'
import type { ConversationAssessmentProvider } from './assessment-provider.js'
import { ElevenLabsWebhookSignatureError } from './webhook.js'
import { approvedWhakapapaOrganisationPouV01, conversationGuidanceProjection, pouReviewProjection } from '../pou-specifications/domain.js'

const now = new Date('2026-08-12T00:00:00.000Z')
const secret = 'test-webhook-secret-with-sufficient-length'
const config: AppConfiguration = {
  nodeEnv: 'test', port: 3011, host: '127.0.0.1', databaseUrl: 'postgresql://localhost/te_kaupapa_test', appOrigin: 'http://api.test', frontendOrigin: 'http://web.test', allowedOrigins: ['http://api.test', 'http://web.test'], cookieName: 'test', cookieSigningSecret: 'a-test-cookie-secret-that-is-long-enough', sessionTtlHours: 12, sessionIdleTimeoutMinutes: 60,
  elevenlabsWebhook: { signingSecret: secret, maximumAgeSeconds: 300, maximumBodyBytes: 131072 },
}
const auth: AuthRepository = { findUserByExternalIdentity: async () => null, createSession: async () => {}, findUserBySessionHash: async () => null, touchSession: async () => {}, invalidateSession: async () => {}, isSupervisorOf: async () => false }

function body(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'post_call_transcription', event_timestamp: Math.floor(now.getTime() / 1000),
    data: {
      conversation_id: 'provider-conversation-1', agent_id: 'agent', branch_id: 'branch', version_id: 'version', environment: 'test', transcript: 'HTTP_TRANSCRIPT_SENTINEL',
    },
    ...extra,
  })
}
function signature(raw: string) { const timestamp = Math.floor(now.getTime() / 1000); return `t=${timestamp},v0=${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}` }
function webhookDependencies(ingest: ReturnType<typeof vi.fn>, assess = vi.fn(async () => ({ assessment: { assessments: [] }, provider: 'openai', model: 'test-model', configurationHash: 'a'.repeat(64), schemaVersion: '1', assessmentStartedAt: now, assessmentCompletedAt: now }))) {
  const specification = approvedWhakapapaOrganisationPouV01({ approvedForPilotBy: '11111111-1111-4111-8111-111111111111', approvedForPilotAt: now.toISOString() })
  const guidanceProjection = conversationGuidanceProjection(specification, { projectionCode: 'test-guidance', projectionVersion: '1' })
  const transcriptRepository = {
    retainForConversation: vi.fn(async (input: { turns: Array<{ id: string; ordinal: number; speaker: 'unknown'; text: string }> }) => ({ transcriptId: '33333333-3333-4333-8333-333333333333', turns: input.turns })),
  }
  return {
    safetyAssessmentRepository: { resolveActivePinForConversation: async () => ({ runId: 'run', workflowConversationId: '44444444-4444-4444-8444-444444444444', organisationId: '55555555-5555-4555-8555-555555555555', workflowSessionId: '66666666-6666-4666-8666-666666666666', pouId: 'whakapapa', projection: { rules: [] }, guidanceProjection, superseded: false, requiresAssessment: true }), reserveDelivery: async () => ({ replayed: false, conflict: false, reserved: true, inFlight: false, superseded: false }), releaseReservedDelivery: async () => {}, ingest } as unknown as PostgresSafetyAssessmentRepository,
    transcriptRepository: transcriptRepository as any,
    conversationAssessmentProvider: { assessPouConversation: assess } as unknown as ConversationAssessmentProvider,
  }
}

describe('post-call HTTP raw-body boundary', () => {
  it('verifies the exact injected bytes before passing only parsed fields to ingestion', async () => {
    const ingest = vi.fn(async (_input: unknown) => ({ replayed: false, superseded: false }))
    const app = await createApplication({ config, repository: auth, ...webhookDependencies(ingest), now: () => now })
    const raw = body()
    const response = await app.inject({ method: 'POST', url: '/api/integrations/elevenlabs/post-call', headers: { 'content-type': 'application/json', 'elevenlabs-signature': signature(raw) }, payload: raw })
    expect(response.statusCode).toBe(202)
    expect(response.body).not.toContain('HTTP_TRANSCRIPT_SENTINEL')
    expect(ingest.mock.calls[0]?.[0]).not.toHaveProperty('transcript')
    expect(JSON.stringify(ingest.mock.calls[0]?.[0])).not.toContain('HTTP_TRANSCRIPT_SENTINEL')
    await app.close()
  })

  it('does not emit raw provider transcript or audio through application request logs', async () => {
    const transcriptSentinel = 'HTTP_TRANSCRIPT_SENTINEL_MUST_NOT_LOG'
    const audioSentinel = 'HTTP_AUDIO_SENTINEL_MUST_NOT_LOG'
    const ingest = vi.fn(async (_input: unknown) => ({ replayed: false, superseded: false }))
    const writes: string[] = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    const app = await createApplication({ config: { ...config, nodeEnv: 'development' }, repository: auth, ...webhookDependencies(ingest), now: () => now })
    const event = JSON.parse(body())
    event.data.transcript = transcriptSentinel
    event.data.audio = audioSentinel
    const raw = JSON.stringify(event)
    try {
      expect((await app.inject({ method: 'POST', url: '/api/integrations/elevenlabs/post-call', headers: { 'content-type': 'application/json', 'elevenlabs-signature': signature(raw) }, payload: raw })).statusCode).toBe(202)
      await app.close()
      expect(JSON.stringify(ingest.mock.calls[0]?.[0])).not.toContain(transcriptSentinel)
      expect(JSON.stringify(ingest.mock.calls[0]?.[0])).not.toContain(audioSentinel)
      expect(writes.join('')).not.toContain(transcriptSentinel)
      expect(writes.join('')).not.toContain(audioSentinel)
    } finally {
      await app.close()
      write.mockRestore()
    }
  })

  it('rejects provider-exposed dynamic variables that differ from the server-pinned guidance before persistence or assessment', async () => {
    const ingest = vi.fn(async (_input: unknown) => ({ replayed: false, superseded: false }))
    const assess = vi.fn()
    const app = await createApplication({ config, repository: auth, ...webhookDependencies(ingest, assess), now: () => now })
    const event = JSON.parse(body())
    event.data.conversation_initiation_client_data = { dynamic_variables: { pou_name: 'Whakapapa', pou_guidance: 'tampered browser value' } }
    const raw = JSON.stringify(event)
    try {
      expect((await app.inject({ method: 'POST', url: '/api/integrations/elevenlabs/post-call', headers: { 'content-type': 'application/json', 'elevenlabs-signature': signature(raw) }, payload: raw })).statusCode).toBe(400)
      expect(ingest).not.toHaveBeenCalled()
      expect(assess).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('logs only a bounded rejection category when signature verification fails', async () => {
    const ingest = vi.fn(async (_input: unknown) => ({ replayed: false, superseded: false }))
    const writes: string[] = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    const verifier = { verify: () => { throw new ElevenLabsWebhookSignatureError('do not log this detail') } }
    const app = await createApplication({ config: { ...config, nodeEnv: 'development' }, repository: auth, ...webhookDependencies(ingest), elevenLabsWebhookVerifier: verifier, now: () => now })
    const event = JSON.parse(body())
    event.data.transcript = 'HTTP_TRANSCRIPT_SENTINEL_MUST_NOT_LOG'
    const raw = JSON.stringify(event)
    try {
      expect((await app.inject({ method: 'POST', url: '/api/integrations/elevenlabs/post-call', headers: { 'content-type': 'application/json', 'elevenlabs-signature': 'invalid' }, payload: raw })).statusCode).toBe(400)
      await app.close()
      const output = writes.join('')
      expect(output).toContain('"providerWebhookRejection":"signature"')
      expect(output).not.toContain('HTTP_TRANSCRIPT_SENTINEL_MUST_NOT_LOG')
      expect(output).not.toContain('do not log this detail')
      expect(ingest).not.toHaveBeenCalled()
    } finally {
      await app.close()
      write.mockRestore()
    }
  })

  it('does not send a superseded delivery transcript to the assessment provider', async () => {
    const ingest = vi.fn(async () => ({ replayed: false, superseded: true }))
    const assess = vi.fn()
    const app = await createApplication({ config, repository: auth, ...webhookDependencies(ingest, assess), now: () => now })
    const repository = app as unknown as { }
    // Replace the standard mock dependency with a superseded pin through the
    // supplied repository double; no transcript may cross the provider edge.
    await app.close()
    const supersededRepository = { resolveActivePinForConversation: async () => ({ runId: 'run', workflowConversationId: '44444444-4444-4444-8444-444444444444', organisationId: '55555555-5555-4555-8555-555555555555', workflowSessionId: '66666666-6666-4666-8666-666666666666', pouId: 'whakapapa', projection: {}, superseded: true, requiresAssessment: false }), reserveDelivery: async () => ({ replayed: false, conflict: false, reserved: true, inFlight: false, superseded: true }), releaseReservedDelivery: async () => {}, ingest } as unknown as PostgresSafetyAssessmentRepository
    const retryApp = await createApplication({ config, repository: auth, safetyAssessmentRepository: supersededRepository, transcriptRepository: { retainForConversation: vi.fn(async (input: { turns: any[] }) => ({ transcriptId: '33333333-3333-4333-8333-333333333333', turns: input.turns })) } as any, conversationAssessmentProvider: { assessPouConversation: assess } as unknown as ConversationAssessmentProvider, now: () => now })
    const raw = body()
    try {
      expect((await retryApp.inject({ method: 'POST', url: '/api/integrations/elevenlabs/post-call', headers: { 'content-type': 'application/json', 'elevenlabs-signature': signature(raw) }, payload: raw })).statusCode).toBe(202)
      expect(assess).not.toHaveBeenCalled()
    } finally { await retryApp.close() }
  })

  it('generates a noncanonical review for an approved Pou with an empty safety manifest without calling a safety provider', async () => {
    const ingest = vi.fn(async () => ({ replayed: false, superseded: false }))
    const specification = approvedWhakapapaOrganisationPouV01({ approvedForPilotBy: '11111111-1111-4111-8111-111111111111', approvedForPilotAt: now.toISOString() })
    const guidanceProjection = conversationGuidanceProjection(specification, { projectionCode: 'test-guidance', projectionVersion: '1' })
    const reviewProjection = pouReviewProjection(specification, { projectionCode: 'test-review', projectionVersion: '1' })
    const generatePouReviewDraft = vi.fn(async () => ({
      draft: { overallSummary: 'Bounded noncanonical review.', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: [] },
      criterionAssessments: reviewProjection.criteria.map((criterion) => ({ criterionCode: criterion.criterionCode, status: 'not_explored' as const, evidenceTurnIds: [], missingInformationCodes: [criterion.missingInformationCodes[0]!] })),
      provider: 'test-review-provider', model: 'test-review-model', configurationHash: 'b'.repeat(64), schemaVersion: '1', generatedAt: now,
    }))
    const recordGenerated = vi.fn(async () => {})
    const repository = {
      resolveActivePinForConversation: async () => ({ runId: 'run', workflowConversationId: '44444444-4444-4444-8444-444444444444', organisationId: '55555555-5555-4555-8555-555555555555', workflowSessionId: '66666666-6666-4666-8666-666666666666', pouId: 'whakapapa', projection: { rules: [] }, guidanceProjection, reviewProjection, superseded: false, requiresAssessment: true }),
      reserveDelivery: async () => ({ replayed: false, conflict: false, reserved: true, inFlight: false, superseded: false }),
      releaseReservedDelivery: async () => {}, ingest,
    } as unknown as PostgresSafetyAssessmentRepository
    const app = await createApplication({
      config, repository: auth, safetyAssessmentRepository: repository,
      transcriptRepository: { retainForConversation: vi.fn(async (input: { turns: any[] }) => ({ transcriptId: '33333333-3333-4333-8333-333333333333', turns: input.turns })) } as any,
      conversationReviewDraftProvider: { generatePouReviewDraft } as any,
      reviewDraftRepository: { recordGenerated } as any,
      now: () => now,
    })
    const raw = body()
    try {
      expect((await app.inject({ method: 'POST', url: '/api/integrations/elevenlabs/post-call', headers: { 'content-type': 'application/json', 'elevenlabs-signature': signature(raw) }, payload: raw })).statusCode).toBe(202)
      expect(generatePouReviewDraft).toHaveBeenCalledOnce()
      expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ assessments: [] }))
      expect(recordGenerated).toHaveBeenCalledOnce()
    } finally { await app.close() }
  })

  it('accepts a bounded signed post-call envelope larger than 32 KiB without passing its transcript to ingestion', async () => {
    const ingest = vi.fn(async (_input: unknown) => ({ replayed: false, superseded: false }))
    const app = await createApplication({ config, repository: auth, ...webhookDependencies(ingest), now: () => now })
    const event = JSON.parse(body())
    event.data.transcript = 'x'.repeat(64 * 1024)
    const raw = JSON.stringify(event)
    try {
      expect(Buffer.byteLength(raw)).toBeGreaterThan(32768)
      expect((await app.inject({ method: 'POST', url: '/api/integrations/elevenlabs/post-call', headers: { 'content-type': 'application/json', 'elevenlabs-signature': signature(raw) }, payload: raw })).statusCode).toBe(202)
      expect(JSON.stringify(ingest.mock.calls[0]?.[0])).not.toContain(event.data.transcript)
    } finally {
      await app.close()
    }
  })

  it('rejects altered, stale, unsigned, malformed, wrong-type, and oversized requests before ingestion', async () => {
    const ingest = vi.fn(async (_input: unknown) => ({ replayed: false, superseded: false }))
    const app = await createApplication({ config, repository: auth, ...webhookDependencies(ingest), now: () => now })
    const raw = body()
    const attempts = [
      { headers: { 'content-type': 'application/json', 'elevenlabs-signature': signature(raw) }, payload: `${raw} ` },
      { headers: { 'content-type': 'application/json', 'elevenlabs-signature': 't=0,v0=00' }, payload: raw },
      { headers: { 'content-type': 'application/json' }, payload: raw },
      { headers: { 'content-type': 'application/json', 'elevenlabs-signature': signature('{') }, payload: '{' },
      { headers: { 'content-type': 'text/plain', 'elevenlabs-signature': signature(raw) }, payload: raw },
    ]
    for (const attempt of attempts) expect((await app.inject({ method: 'POST', url: '/api/integrations/elevenlabs/post-call', ...attempt })).statusCode).toBeGreaterThanOrEqual(400)
    const oversized = 'x'.repeat(131073)
    expect((await app.inject({ method: 'POST', url: '/api/integrations/elevenlabs/post-call', headers: { 'content-type': 'application/json', 'elevenlabs-signature': signature(oversized) }, payload: oversized })).statusCode).toBe(413)
    expect(ingest).not.toHaveBeenCalled()
    await app.close()
  })
})
