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
      await workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa', reviewDraftRevisionId: edited.revisionId } })
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
      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa' } })).rejects.toThrow('review draft')
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
      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa', reviewDraftRevisionId: ready.draft.revisionId } })).rejects.toThrow('review draft')
      expect(await connection.db.select().from(schema.workflowPouReviews).where(eq(schema.workflowPouReviews.workflowSessionId, workflowId))).toHaveLength(0)
    })
  })

  it('lets the Kaimahi carry forward only a current scoped review need without creating an action or confirming the Pou', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, reviewDraftRepository, repository, canonicalSnapshot }: any) => {
      expect((await request(payload({ transcript: [{ role: 'user', message: 'Synthetic Whakapapa reflection with strength and cultural connection.' }] }))).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      const reviewNeed = ready.draft.criterionAssessments.find((assessment: { status: string }) => assessment.status === 'not_explored')
      expect(reviewNeed).toBeDefined()
      const workflowRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-13T00:00:00.000Z'), undefined, repository, reviewDraftRepository)
      const edited = await reviewDraftRepository.edit(actor, workflowId, {
        reviewDraftId: ready.draft.id,
        expectedRevision: ready.draft.revision,
        content: {
          overallSummary: 'Kaimahi-edited review, with the same structured source assessment.',
          strengthsSummary: ready.draft.strengthsSummary,
          areasForAttentionSummary: ready.draft.areasForAttentionSummary,
          evidenceTurnIds: ready.draft.evidenceTurnIds,
        },
      })

      await expect(workflowRepository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'carry-forward-marked',
          itemId: randomUUID(),
          idempotencyKey: randomUUID(),
          expectedVersion: 2,
          pouId: 'whakapapa',
          source: { kind: 'review_criterion', reviewDraftRevisionId: ready.draft.revisionId, criterionCode: reviewNeed!.criterionCode },
        },
      })).rejects.toThrow('current review revision')

      const carried = await workflowRepository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'carry-forward-marked',
          itemId: randomUUID(),
          idempotencyKey: randomUUID(),
          expectedVersion: 2,
          pouId: 'whakapapa',
          source: { kind: 'review_criterion', reviewDraftRevisionId: edited.revisionId, criterionCode: reviewNeed!.criterionCode },
        },
      })

      expect(carried.workflow).toMatchObject({
        version: 3,
        currentStage: 'pou-overview',
        currentPouId: 'whakapapa',
        carryForwards: [{
          pouId: 'whakapapa',
          source: { kind: 'review_criterion', reviewDraftRevisionId: edited.revisionId, criterionCode: reviewNeed!.criterionCode },
          presentation: {
            title: `${reviewNeed!.label} was not explored in this reflection`,
            sourceLabel: 'Still to explore / information needed',
          },
        }],
        actions: [],
        referrals: [],
      })
      expect((await canonicalSnapshot()).checkpoint).toMatchObject({ progress: 'not_started', confirmedAt: null })
      expect((await canonicalSnapshot()).counts).toMatchObject({ workflowSafetyObservations: 0, workflowActions: 0, workflowReferrals: 0, workflowSupervisorReviewRequests: 0 })
      expect(JSON.stringify(carried.workflow.carryForwards)).not.toContain('Synthetic Whakapapa reflection with strength and cultural connection.')

      // The source revision is scoped to its exact workflow, organisation and
      // Pou. Possessing its opaque UUID must not make it reusable elsewhere.
      await expect(reviewDraftRepository.assertCarryForwardReviewSource(connection.db, {
        actor,
        workflowSessionId: randomUUID(),
        pouId: 'whakapapa',
        source: { kind: 'review_criterion', reviewDraftRevisionId: edited.revisionId, criterionCode: reviewNeed!.criterionCode },
      })).rejects.toThrow('carry-forward source')
      await expect(reviewDraftRepository.assertCarryForwardReviewSource(connection.db, {
        actor: { ...actor, organisation: { ...actor.organisation, id: randomUUID() } },
        workflowSessionId: workflowId,
        pouId: 'whakapapa',
        source: { kind: 'review_criterion', reviewDraftRevisionId: edited.revisionId, criterionCode: reviewNeed!.criterionCode },
      })).rejects.toThrow('carry-forward source')

      await expect(workflowRepository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'carry-forward-marked',
          itemId: randomUUID(),
          idempotencyKey: randomUUID(),
          expectedVersion: 3,
          pouId: 'whakapapa',
          source: { kind: 'review_criterion', reviewDraftRevisionId: edited.revisionId, criterionCode: 'forged-or-cross-pou-criterion' },
        },
      })).rejects.toThrow('review criterion')

      await expect(workflowRepository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'carry-forward-marked',
          itemId: randomUUID(),
          idempotencyKey: randomUUID(),
          expectedVersion: 3,
          pouId: 'manaakitanga',
          source: { kind: 'review_criterion', reviewDraftRevisionId: edited.revisionId, criterionCode: reviewNeed!.criterionCode },
        },
      })).rejects.toThrow('current Pou')
      await expect(workflowRepository.submitCommand({
        actor: { ...actor, id: randomUUID() },
        workflowSessionId: workflowId,
        command: {
          type: 'carry-forward-marked',
          itemId: randomUUID(),
          idempotencyKey: randomUUID(),
          expectedVersion: 3,
          pouId: 'whakapapa',
          source: { kind: 'review_criterion', reviewDraftRevisionId: edited.revisionId, criterionCode: reviewNeed!.criterionCode },
        },
      })).rejects.toThrow('workflow')
      await expect(workflowRepository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'carry-forward-marked',
          itemId: randomUUID(),
          idempotencyKey: randomUUID(),
          expectedVersion: 3,
          pouId: 'whakapapa',
          source: { kind: 'safety_observation', observationId: randomUUID() },
        },
      })).rejects.toThrow('safety concern')
      expect(await connection.db.select().from(schema.workflowCarryForwards).where(eq(schema.workflowCarryForwards.workflowSessionId, workflowId))).toHaveLength(1)
    })
  })
})
