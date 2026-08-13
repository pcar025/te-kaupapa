import { createHmac, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

const signatureHeader = 'elevenlabs-signature'

export interface ElevenLabsTranscriptTurn {
  role: 'agent' | 'user'
  message: string
}

export interface ElevenLabsWebhookVerifier {
  verify(rawBody: Buffer, signature: string | undefined, now: Date): void
}

/**
 * A safe operational category for a rejected provider request. It deliberately
 * carries no signature, payload, transcript, or provider detail.
 */
export class ElevenLabsWebhookSignatureError extends Error {}
export class ElevenLabsWebhookUnsupportedEventError extends Error {}
export class ElevenLabsWebhookEnvelopeError extends Error {}
export class ElevenLabsGuidanceProvenanceMismatchError extends Error {}

export class ElevenLabsHmacWebhookVerifier implements ElevenLabsWebhookVerifier {
  constructor(private readonly secret: string, private readonly maximumAgeSeconds: number) {}

  verify(rawBody: Buffer, signature: string | undefined, now: Date): void {
    if (!signature) throw new ElevenLabsWebhookSignatureError('Missing webhook signature.')
    const parts = Object.fromEntries(signature.split(',').map((part) => part.trim().split('=', 2)).filter(([key, value]) => key && value))
    const timestamp = Number(parts.t)
    const received = parts.v0
    if (!Number.isInteger(timestamp) || !received || Math.abs(now.getTime() / 1000 - timestamp) > this.maximumAgeSeconds) throw new ElevenLabsWebhookSignatureError('Webhook signature is stale or malformed.')
    const expected = createHmac('sha256', this.secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex')
    const expectedBytes = Buffer.from(expected, 'hex')
    const receivedBytes = Buffer.from(received, 'hex')
    if (expectedBytes.length !== receivedBytes.length || !timingSafeEqual(expectedBytes, receivedBytes)) throw new ElevenLabsWebhookSignatureError('Webhook signature is invalid.')
  }
}

const providerTranscriptTurnSchema = z.object({
  role: z.enum(['agent', 'user']),
  message: z.string().min(1).max(120_000),
}).passthrough()

const eventSchema = z.object({
  type: z.string(),
  // Current ElevenLabs post-call examples identify the event with a Unix
  // timestamp. Some API surfaces also include event_id, so accept either and
  // derive a stable delivery identity when only the documented timestamp is
  // available.
  event_id: z.string().min(1).max(255).optional(),
  event_timestamp: z.union([z.number().finite().nonnegative(), z.string().min(1).max(128)]).optional(),
  conversation_initiation_client_data: z.unknown().optional(),
  data: z.object({
    conversation_id: z.string().min(1).max(255),
    agent_id: z.string().min(1).max(255),
    branch_id: z.string().min(1).max(255).nullable().optional(),
    version_id: z.string().min(1).max(255).optional(),
    environment: z.string().min(1).max(80),
    /**
     * This is transient processing material only.  It never reaches the
     * repository, log fields, error response, or browser response.
     */
    // ElevenLabs' current post-call contract provides ordered turns. Retain
    // only their bounded role/message source material; other provider fields
    // stay transient and are neither logged nor persisted.
    transcript: z.union([
      z.string().min(1).max(120_000),
      z.array(providerTranscriptTurnSchema).min(1).max(200),
    ]),
    conversation_initiation_client_data: z.unknown().optional(),
  }).passthrough(),
}).passthrough()

function dynamicVariableProvenance(value: unknown): { pou_name: string; pou_guidance: string } | null {
  if (value === undefined) return null
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ElevenLabsGuidanceProvenanceMismatchError('Conversation initiation provenance is malformed.')
  }
  const dynamicVariables = (value as { dynamic_variables?: unknown }).dynamic_variables
  if (typeof dynamicVariables !== 'object' || dynamicVariables === null || Array.isArray(dynamicVariables)) {
    throw new ElevenLabsGuidanceProvenanceMismatchError('Conversation initiation dynamic variables are unavailable.')
  }
  const pouName = (dynamicVariables as { pou_name?: unknown }).pou_name
  const pouGuidance = (dynamicVariables as { pou_guidance?: unknown }).pou_guidance
  if (typeof pouName !== 'string' || pouName.length === 0 || pouName.length > 240 || typeof pouGuidance !== 'string' || pouGuidance.length === 0 || pouGuidance.length > 4_000) {
    throw new ElevenLabsGuidanceProvenanceMismatchError('Conversation initiation dynamic variables are invalid.')
  }
  return { pou_name: pouName, pou_guidance: pouGuidance }
}

export function parseElevenLabsPostCallTranscript(rawBody: Buffer) {
  const event = eventSchema.parse(JSON.parse(rawBody.toString('utf8')))
  if (event.type !== 'post_call_transcription') throw new ElevenLabsWebhookUnsupportedEventError('Unsupported provider event type.')
  const deliveryId = event.event_id ?? (event.event_timestamp === undefined
    ? undefined
    : `post_call_transcription:${event.data.conversation_id}:${event.event_timestamp}`)
  if (!deliveryId) throw new ElevenLabsWebhookEnvelopeError('Provider delivery identity is missing.')
  // The post-call contract has surfaced this value under both the event and
  // data envelope across provider interfaces. It remains transient: retain
  // only the two expected values long enough to verify their hash.
  const initiation = event.data.conversation_initiation_client_data ?? event.conversation_initiation_client_data
  return {
    deliveryId,
    providerConversationId: event.data.conversation_id,
    agentReference: event.data.agent_id,
    branchReference: event.data.branch_id ?? null,
    environment: event.data.environment,
    dynamicVariableProvenance: dynamicVariableProvenance(initiation),
    transientTranscript: typeof event.data.transcript === 'string'
      ? event.data.transcript
      : event.data.transcript.map((turn): ElevenLabsTranscriptTurn => ({ role: turn.role, message: turn.message })),
  }
}

export const elevenLabsSignatureHeader = signatureHeader
