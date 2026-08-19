import { randomUUID } from 'node:crypto'

import { z } from 'zod'

export const TRANSCRIPT_SPEAKERS = ['kaimahi', 'assistant', 'unknown'] as const

export const transcriptTurnSchema = z.object({
  id: z.string().uuid(),
  ordinal: z.number().int().positive(),
  speaker: z.enum(TRANSCRIPT_SPEAKERS),
  text: z.string().min(1).max(120_000),
  providerSequence: z.number().int().positive().nullable(),
  providerTimestamp: z.date().nullable(),
}).strict()

export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>

export interface SignedProviderTranscriptTurn {
  role: 'agent' | 'user'
  message: string
}

/**
 * ElevenLabs' signed `transcript` field is accepted as source material, not
 * as application state. Current post-call deliveries provide ordered user and
 * agent turns; the legacy string form is retained as one `unknown` turn rather
 * than inventing speaker attribution.
 */
export function normaliseSignedTranscript(transcript: string | SignedProviderTranscriptTurn[]): TranscriptTurn[] {
  if (typeof transcript === 'string') {
    return [{ id: randomUUID(), ordinal: 1, speaker: 'unknown', text: transcript.trim(), providerSequence: null, providerTimestamp: null }]
  }
  return transcript.map((turn, index) => ({
    id: randomUUID(), ordinal: index + 1, speaker: turn.role === 'user' ? 'kaimahi' : 'assistant',
    text: turn.message.trim(), providerSequence: index + 1, providerTimestamp: null,
  }))
}

export function assessmentTranscriptInput(turns: TranscriptTurn[]): string {
  return JSON.stringify(turns.map(({ id, ordinal, speaker, text }) => ({ id, ordinal, speaker, text })))
}
