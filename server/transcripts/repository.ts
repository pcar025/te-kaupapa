import { and, asc, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from '../db/schema.js'
import { transcriptTurnSchema, type TranscriptTurn } from './domain.js'

type TranscriptDatabase = NodePgDatabase<typeof schema>

export class TranscriptRepositoryError extends Error {}

export class PostgresTranscriptRepository {
  constructor(private readonly db: TranscriptDatabase, private readonly now: () => Date = () => new Date()) {}

  async retainForConversation(input: {
    organisationId: string
    workflowSessionId: string
    pouId: 'whakapapa'
    workflowConversationId: string
    provider: string
    providerConversationId: string
    turns: TranscriptTurn[]
  }): Promise<{ transcriptId: string; turns: TranscriptTurn[] }> {
    const normalised = input.turns.map((turn) => transcriptTurnSchema.parse(turn))
    if (normalised.length === 0 || normalised.length > 200) throw new TranscriptRepositoryError('Transcript turn count is outside the bounded contract.')
    return this.db.transaction(async (tx) => {
      const conversations = await tx.select().from(schema.workflowConversations).where(and(
        eq(schema.workflowConversations.id, input.workflowConversationId),
        eq(schema.workflowConversations.organisationId, input.organisationId),
        eq(schema.workflowConversations.workflowSessionId, input.workflowSessionId),
        eq(schema.workflowConversations.pouId, input.pouId),
      )).limit(1)
      const conversation = conversations[0]
      if (!conversation || conversation.provider !== input.provider || conversation.providerConversationId !== input.providerConversationId) {
        throw new TranscriptRepositoryError('Transcript provider provenance does not match the conversation.')
      }
      const existing = await tx.select().from(schema.conversationTranscripts).where(eq(schema.conversationTranscripts.workflowConversationId, input.workflowConversationId)).limit(1)
      const transcript = existing[0] ?? (await tx.insert(schema.conversationTranscripts).values({
        organisationId: input.organisationId, workflowSessionId: input.workflowSessionId, pouId: input.pouId,
        workflowConversationId: input.workflowConversationId, provider: input.provider, providerConversationId: input.providerConversationId, createdAt: this.now(),
      }).returning())[0]
      if (!transcript) throw new TranscriptRepositoryError('Transcript retention failed.')
      if (transcript.organisationId !== input.organisationId || transcript.workflowSessionId !== input.workflowSessionId || transcript.pouId !== input.pouId || transcript.provider !== input.provider || transcript.providerConversationId !== input.providerConversationId) {
        throw new TranscriptRepositoryError('Existing transcript provenance does not match the conversation.')
      }
      const storedTurns = await tx.select().from(schema.conversationTranscriptTurns).where(eq(schema.conversationTranscriptTurns.transcriptId, transcript.id)).orderBy(asc(schema.conversationTranscriptTurns.ordinal))
      if (storedTurns.length > 0) return { transcriptId: transcript.id, turns: storedTurns.map((turn) => transcriptTurnSchema.parse({ id: turn.id, ordinal: turn.ordinal, speaker: turn.speaker, text: turn.text, providerSequence: turn.providerSequence ?? null, providerTimestamp: turn.providerTimestamp ?? null })) }
      await tx.insert(schema.conversationTranscriptTurns).values(normalised.map((turn) => ({
        id: turn.id, transcriptId: transcript.id, ordinal: turn.ordinal, speaker: turn.speaker, text: turn.text,
        providerSequence: turn.providerSequence, providerTimestamp: turn.providerTimestamp, createdAt: this.now(),
      })))
      return { transcriptId: transcript.id, turns: normalised }
    })
  }

  async turnsForAssessment(input: { transcriptId: string; workflowConversationId: string; organisationId: string; workflowSessionId: string; pouId: 'whakapapa' }): Promise<TranscriptTurn[]> {
    const transcripts = await this.db.select().from(schema.conversationTranscripts).where(and(
      eq(schema.conversationTranscripts.id, input.transcriptId), eq(schema.conversationTranscripts.workflowConversationId, input.workflowConversationId),
      eq(schema.conversationTranscripts.organisationId, input.organisationId), eq(schema.conversationTranscripts.workflowSessionId, input.workflowSessionId), eq(schema.conversationTranscripts.pouId, input.pouId),
    )).limit(1)
    if (!transcripts[0]) throw new TranscriptRepositoryError('Transcript is outside the assessment scope.')
    const turns = await this.db.select().from(schema.conversationTranscriptTurns).where(eq(schema.conversationTranscriptTurns.transcriptId, input.transcriptId)).orderBy(asc(schema.conversationTranscriptTurns.ordinal))
    return turns.map((turn) => transcriptTurnSchema.parse({ id: turn.id, ordinal: turn.ordinal, speaker: turn.speaker, text: turn.text, providerSequence: turn.providerSequence ?? null, providerTimestamp: turn.providerTimestamp ?? null }))
  }
}
