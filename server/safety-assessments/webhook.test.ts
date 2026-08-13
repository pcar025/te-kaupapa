import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { ElevenLabsHmacWebhookVerifier, parseElevenLabsPostCallTranscript } from './webhook.js'
import { normaliseSignedTranscript } from '../transcripts/domain.js'

const now = new Date('2026-08-12T00:00:00.000Z')
const secret = 'test-webhook-secret-with-sufficient-length'
const payload = Buffer.from(JSON.stringify({
  type: 'post_call_transcription', event_timestamp: Math.floor(now.getTime() / 1000),
  data: { conversation_id: 'provider-conversation-1', agent_id: 'agent-test', branch_id: 'branch-test', version_id: 'version-test', environment: 'test', transcript: 'synthetic test transcript' },
}))

describe('ElevenLabs post-call webhook boundary', () => {
  it('verifies an untouched signed body and extracts a transient transcript only after authentication', () => {
    const timestamp = Math.floor(now.getTime() / 1000)
    const signature = createHmac('sha256', secret).update(`${timestamp}.${payload.toString('utf8')}`).digest('hex')
    expect(() => new ElevenLabsHmacWebhookVerifier(secret, 300).verify(payload, `t=${timestamp},v0=${signature}`, now)).not.toThrow()
    const parsed = parseElevenLabsPostCallTranscript(payload)
    expect(parsed.transientTranscript).toBe('synthetic test transcript')
    expect(parsed.deliveryId).toBe(`post_call_transcription:provider-conversation-1:${Math.floor(now.getTime() / 1000)}`)
  })

  it('rejects invalid and stale signatures', () => {
    const verifier = new ElevenLabsHmacWebhookVerifier(secret, 30)
    expect(() => verifier.verify(payload, 't=0,v0=00', now)).toThrow()
    expect(() => verifier.verify(payload, `t=${Math.floor(now.getTime() / 1000)},v0=00`, now)).toThrow()
  })

  it('accepts the documented string timestamp variant when event_id is absent', () => {
    const event = JSON.parse(payload.toString('utf8'))
    event.event_timestamp = '2026-08-12T00:00:00Z'
    const parsed = parseElevenLabsPostCallTranscript(Buffer.from(JSON.stringify(event)))
    expect(parsed.deliveryId).toBe('post_call_transcription:provider-conversation-1:2026-08-12T00:00:00Z')
  })

  it('accepts the current ordered ElevenLabs transcript array and retains only role/message fields', () => {
    const event = JSON.parse(payload.toString('utf8'))
    event.data.transcript = [
      { role: 'agent', message: 'Synthetic guide turn', ignored_provider_field: 'must-not-escape' },
      { role: 'user', message: 'Synthetic Kaimahi turn', reasoning: 'must-not-escape' },
    ]

    const parsed = parseElevenLabsPostCallTranscript(Buffer.from(JSON.stringify(event)))
    expect(parsed.transientTranscript).toEqual([
      { role: 'agent', message: 'Synthetic guide turn' },
      { role: 'user', message: 'Synthetic Kaimahi turn' },
    ])
    expect(normaliseSignedTranscript(parsed.transientTranscript)).toEqual([
      expect.objectContaining({ ordinal: 1, speaker: 'assistant', text: 'Synthetic guide turn', providerSequence: 1 }),
      expect.objectContaining({ ordinal: 2, speaker: 'kaimahi', text: 'Synthetic Kaimahi turn', providerSequence: 2 }),
    ])
  })
})
