import { randomUUID } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as schema from '../db/schema.js'
import { PostgresWorkflowRepository } from '../workflows/repository.js'
import { withPhase5BTestContext } from '../safety-assessments/integration-fixture.js'

function postgresCause(error: unknown): { code?: unknown; message?: unknown } | undefined {
  const seen = new Set<unknown>()
  const visit = (value: unknown): { code?: unknown; message?: unknown } | undefined => {
    if (!value || typeof value !== 'object' || seen.has(value)) return undefined
    seen.add(value)
    const record = value as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown[] }
    if (record.code === 'P0001' && record.message === 'review draft provenance is immutable') return record
    const direct = visit(record.cause)
    if (direct) return direct
    return Array.isArray(record.errors) ? record.errors.map(visit).find(Boolean) : undefined
  }
  return visit(error)
}

describe('Whakapapa review-draft reconciliation', () => {
  it('keeps the generated revision noncanonical, preserves an edit, and creates canonical narrative only on explicit Pou confirmation', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, run, reviewDraftRepository, repository, canonicalSnapshot }: any) => {
      const raw = payload({ transcript: [{ role: 'user', message: 'Synthetic Whakapapa reflection with strength and cultural connection.' }, { role: 'agent', message: 'Thank you for sharing that.' }] })
      expect((await request(raw)).statusCode).toBe(202)
      const before = await canonicalSnapshot()
      expect(before.counts.workflowInteractions).toBe(0)
      expect(await reviewDraftRepository.findForKaimahi(actor, workflowId)).toMatchObject({ status: 'ready', assessmentCompleted: true, draft: { revision: 1, overallSummary: 'Synthetic Whakapapa review draft.' } })
      const [draft] = await connection.db.select().from(schema.conversationReviewDrafts).where(eq(schema.conversationReviewDrafts.assessmentRunId, run.id))
      const generated = await connection.db.select().from(schema.conversationReviewDraftRevisions).where(eq(schema.conversationReviewDraftRevisions.reviewDraftId, draft.id))
      expect(generated).toHaveLength(1)
      const edited = await reviewDraftRepository.edit(actor, workflowId, { reviewDraftId: draft.id, expectedRevision: 1, content: { overallSummary: 'Edited human-visible Whakapapa review.', strengthsSummary: 'Edited strengths.', areasForAttentionSummary: null, evidenceTurnIds: generated[0]!.evidenceTurnIds as string[] } })
      expect(edited.revision).toBe(2)
      expect(await connection.db.select().from(schema.conversationReviewDraftRevisions).where(eq(schema.conversationReviewDraftRevisions.reviewDraftId, draft.id))).toHaveLength(2)
      const workflowRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-13T00:00:00.000Z'), undefined, repository, reviewDraftRepository)
      await workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa', userSelectedConcern: 'watch', referralSuggested: false, supervisorReviewSuggested: false, reviewDraftRevisionId: edited.revisionId } })
      const [canonical] = await connection.db.select().from(schema.workflowPouReviews).where(and(eq(schema.workflowPouReviews.workflowSessionId, workflowId), eq(schema.workflowPouReviews.pouId, 'whakapapa')))
      expect(canonical).toMatchObject({ reviewDraftRevisionId: edited.revisionId, overallSummary: 'Edited human-visible Whakapapa review.', confirmedByUserId: actor.id })
      expect((await canonicalSnapshot()).counts.workflowSafetyObservations).toBe(0)
      const original = await connection.db.select().from(schema.conversationReviewDraftRevisions).where(and(eq(schema.conversationReviewDraftRevisions.reviewDraftId, draft.id), eq(schema.conversationReviewDraftRevisions.revision, 1)))
      expect(original[0]!.overallSummary).toBe('Synthetic Whakapapa review draft.')
      let rejection: unknown
      try {
        await connection.db.execute(sql`update conversation_review_draft_revision set overall_summary = 'forged' where id = ${generated[0]!.id}`)
      } catch (error) { rejection = error }
      expect(rejection).toBeDefined()
      expect(postgresCause(rejection)).toMatchObject({ code: 'P0001', message: 'review draft provenance is immutable' })
      const afterRejectedUpdate = await connection.db.select().from(schema.conversationReviewDraftRevisions).where(eq(schema.conversationReviewDraftRevisions.id, generated[0]!.id))
      expect(afterRejectedUpdate[0]!.overallSummary).toBe('Synthetic Whakapapa review draft.')
    })
  })

  it('does not expose or permit a review draft outside the owning Kaimahi workflow scope', async () => {
    await withPhase5BTestContext(async ({ request, payload, actor, workflowId, reviewDraftRepository }: any) => {
      expect((await request(payload())).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      await expect(reviewDraftRepository.edit({ ...actor, id: randomUUID() }, workflowId, { reviewDraftId: ready.draft.id, expectedRevision: 1, content: { overallSummary: 'Not allowed.', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: ready.draft.evidenceTurnIds } })).rejects.toThrow('review draft')
    })
  })

  it('rejects forged evidence and direct Whakapapa confirmation that omits an available review-draft revision', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, reviewDraftRepository, repository, run }: any) => {
      expect((await request(payload())).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      await expect(reviewDraftRepository.edit(actor, workflowId, { reviewDraftId: ready.draft.id, expectedRevision: ready.draft.revision, content: { overallSummary: 'Forged evidence attempt.', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: [randomUUID()] } })).rejects.toThrow('outside its retained transcript')
      const workflowRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-13T00:00:00.000Z'), undefined, repository, reviewDraftRepository)
      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa', userSelectedConcern: 'watch', referralSuggested: false, supervisorReviewSuggested: false } })).rejects.toThrow('review draft')
      expect((await connection.db.select().from(schema.workflowPouReviews).where(eq(schema.workflowPouReviews.workflowSessionId, workflowId)))).toHaveLength(0)
      expect((await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id)))[0]!.status).toBe('received')
    })
  })

  it('rejects a generated revision after its assessment run is superseded', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, reviewDraftRepository, repository, run }: any) => {
      expect((await request(payload())).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      await connection.db.update(schema.conversationSafetyAssessmentRuns).set({ status: 'superseded', supersededAt: new Date('2026-08-13T01:00:00.000Z') }).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))
      const workflowRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-13T00:00:00.000Z'), undefined, repository, reviewDraftRepository)
      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa', userSelectedConcern: 'watch', referralSuggested: false, supervisorReviewSuggested: false, reviewDraftRevisionId: ready.draft.revisionId } })).rejects.toThrow('review draft')
      expect(await connection.db.select().from(schema.workflowPouReviews).where(eq(schema.workflowPouReviews.workflowSessionId, workflowId))).toHaveLength(0)
    })
  })
})
