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
      const raw = payload({ transcript: [{ role: 'user', message: 'Synthetic Whakapapa reflection with strength and cultural connection. [scenario:all-no-concern]' }, { role: 'agent', message: 'Thank you for sharing that.' }] })
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
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:all-no-concern]' }))).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      await expect(reviewDraftRepository.edit({ ...actor, id: randomUUID() }, workflowId, { reviewDraftId: ready.draft.id, expectedRevision: 1, content: { overallSummary: 'Not allowed.', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: ready.draft.evidenceTurnIds } })).rejects.toThrow('review draft')
    })
  })

  it('rejects forged evidence and direct Whakapapa confirmation that omits an available review-draft revision', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, reviewDraftRepository, repository, run }: any) => {
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:all-no-concern]' }))).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      await expect(reviewDraftRepository.edit(actor, workflowId, { reviewDraftId: ready.draft.id, expectedRevision: ready.draft.revision, content: { overallSummary: 'Forged evidence attempt.', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: [randomUUID()] } })).rejects.toThrow('outside its retained transcript')
      const workflowRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-13T00:00:00.000Z'), undefined, repository, reviewDraftRepository)
      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa' } })).rejects.toThrow('review draft')
      expect((await connection.db.select().from(schema.workflowPouReviews).where(eq(schema.workflowPouReviews.workflowSessionId, workflowId)))).toHaveLength(0)
      expect((await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id)))[0]!.status).toBe('received')
    })
  })

  it('keeps an ordinary superseded run unavailable for canonical Pou confirmation', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, reviewDraftRepository, repository, run }: any) => {
      expect((await request(payload())).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      await connection.db.update(schema.conversationSafetyAssessmentRuns).set({ status: 'superseded', supersededAt: new Date('2026-08-13T01:00:00.000Z') }).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))
      const workflowRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-13T00:00:00.000Z'), undefined, repository, reviewDraftRepository)
      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa', reviewDraftRevisionId: ready.draft.revisionId } })).rejects.toThrow('review draft')
      expect(await connection.db.select().from(schema.workflowPouReviews).where(eq(schema.workflowPouReviews.workflowSessionId, workflowId))).toHaveLength(0)
    })
  })

  it('reads only the narrowly eligible historic generated review without mutating superseded provenance', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, conversationId, run, reviewDraftRepository, repository }: any) => {
      expect((await request(payload())).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      const [draft] = await connection.db.select().from(schema.conversationReviewDrafts).where(eq(schema.conversationReviewDrafts.assessmentRunId, run.id))
      const [revision] = await connection.db.select().from(schema.conversationReviewDraftRevisions).where(eq(schema.conversationReviewDraftRevisions.reviewDraftId, draft.id))
      const [assessment] = await connection.db.select().from(schema.conversationProviderRuleAssessments).where(eq(schema.conversationProviderRuleAssessments.assessmentRunId, run.id))
      const observationId = randomUUID()
      const historicAt = new Date('2026-08-13T01:00:00.000Z')
      await connection.db.insert(schema.workflowSafetyObservations).values({ id: observationId, workflowSessionId: workflowId, organisationId: actor.organisation.id, assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'practice_quality', concernLevel: 'low', status: 'active', currentRevision: 1, confirmedByUserId: actor.id, confirmedAt: historicAt, updatedAt: historicAt })
      await connection.db.insert(schema.providerAssessmentReviews).values({ providerRuleAssessmentId: assessment.id, assessmentRunId: run.id, workflowSessionId: workflowId, organisationId: actor.organisation.id, reviewedByUserId: actor.id, status: 'confirmed', classificationSource: 'human_selected', canonicalObservationId: observationId, reviewedAt: historicAt })
      await connection.db.update(schema.conversationSafetyAssessmentRuns).set({ status: 'superseded', supersededAt: historicAt }).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))
      const before = {
        run: (await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id)))[0],
        revision: (await connection.db.select().from(schema.conversationReviewDraftRevisions).where(eq(schema.conversationReviewDraftRevisions.id, revision.id)))[0],
        workflow: (await connection.db.select().from(schema.workflowSessions).where(eq(schema.workflowSessions.id, workflowId)))[0],
      }

      expect(await reviewDraftRepository.findForKaimahi(actor, workflowId)).toMatchObject({ status: 'ready', assessmentCompleted: true, hasReviewableCandidate: false, draft: { id: draft.id, revisionId: revision.id, revision: 1 } })
      expect(await reviewDraftRepository.findForKaimahi({ ...actor, id: randomUUID() }, workflowId)).toMatchObject({ status: 'manual', draft: null })
      expect(await reviewDraftRepository.findForKaimahi(actor, randomUUID())).toMatchObject({ status: 'manual', draft: null })
      expect(await reviewDraftRepository.findForKaimahi(actor, workflowId, 'manaakitanga')).toMatchObject({ status: 'manual', draft: null })
      expect((await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id)))[0]).toEqual(before.run)
      expect((await connection.db.select().from(schema.conversationReviewDraftRevisions).where(eq(schema.conversationReviewDraftRevisions.id, revision.id)))[0]).toEqual(before.revision)
      expect((await connection.db.select().from(schema.workflowSessions).where(eq(schema.workflowSessions.id, workflowId)))[0]).toEqual(before.workflow)
      expect(ready.draft?.id).toBe(draft.id)
      expect(conversationId).toBeDefined()

      const workflowRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-13T02:00:00.000Z'), undefined, repository, reviewDraftRepository)
      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa', reviewDraftRevisionId: revision.id } })).resolves.toMatchObject({ workflow: { currentPouId: 'manaakitanga' } })
      expect(await connection.db.select().from(schema.workflowPouReviews).where(and(eq(schema.workflowPouReviews.workflowSessionId, workflowId), eq(schema.workflowPouReviews.reviewDraftRevisionId, revision.id)))).toHaveLength(1)
    })
  }, 15_000)

  it('keeps a normally received review available after a candidate is explicitly confirmed', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, run, reviewDraftRepository, workflowRepository, repository, assessmentCallCount }: any) => {
      expect((await request(payload())).statusCode).toBe(202)
      const before = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      const [candidate] = await repository.listReviewable(actor, workflowId)
      if (!candidate || candidate.outcome !== 'possible_concern' || !candidate.canonicalBroadClass) throw new Error('Expected the fixture possible-concern candidate.')
      await workflowRepository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'safety-observation-confirmed',
          observationId: randomUUID(),
          idempotencyKey: randomUUID(),
          expectedVersion: 2,
          candidateAssessmentId: candidate.id,
          observation: {
            assessmentContext: 'pou',
            pouId: 'whakapapa',
            broadClass: candidate.canonicalBroadClass,
            concernLevel: candidate.permittedHumanConcernLevels[0]!,
          },
        },
      })
      const after = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      expect(after).toMatchObject({ status: 'ready', assessmentCompleted: true, hasReviewableCandidate: false, draft: { id: before.draft!.id, revisionId: before.draft!.revisionId } })
      expect((await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id)))[0]).toMatchObject({ status: 'received', supersededAt: null })
      expect(assessmentCallCount()).toBe(1)
    })
  }, 15_000)

  it('does not use historic compatibility after a later ended conversation or canonical Pou review', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, conversationId, run, reviewDraftRepository }: any) => {
      expect((await request(payload())).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      const [draft] = await connection.db.select().from(schema.conversationReviewDrafts).where(eq(schema.conversationReviewDrafts.assessmentRunId, run.id))
      const [revision] = await connection.db.select().from(schema.conversationReviewDraftRevisions).where(eq(schema.conversationReviewDraftRevisions.reviewDraftId, draft.id))
      const [assessment] = await connection.db.select().from(schema.conversationProviderRuleAssessments).where(eq(schema.conversationProviderRuleAssessments.assessmentRunId, run.id))
      const observationId = randomUUID()
      const historicAt = new Date('2026-08-13T01:00:00.000Z')
      await connection.db.insert(schema.workflowSafetyObservations).values({ id: observationId, workflowSessionId: workflowId, organisationId: actor.organisation.id, assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'practice_quality', concernLevel: 'low', status: 'active', currentRevision: 1, confirmedByUserId: actor.id, confirmedAt: historicAt, updatedAt: historicAt })
      await connection.db.insert(schema.providerAssessmentReviews).values({ providerRuleAssessmentId: assessment.id, assessmentRunId: run.id, workflowSessionId: workflowId, organisationId: actor.organisation.id, reviewedByUserId: actor.id, status: 'confirmed', classificationSource: 'human_selected', canonicalObservationId: observationId, reviewedAt: historicAt })
      await connection.db.update(schema.conversationSafetyAssessmentRuns).set({ status: 'superseded', supersededAt: historicAt }).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))
      await connection.db.insert(schema.workflowConversations).values({ id: randomUUID(), organisationId: actor.organisation.id, workflowSessionId: workflowId, pouId: 'whakapapa', startedByUserId: actor.id, provider: 'elevenlabs', providerConversationId: `later-${randomUUID()}`, providerAgentReference: 'agent-test', providerBranchReference: 'branch-test', providerEnvironment: 'test', conversationSpecificationCode: 'whakapapa-reflection', conversationSpecificationVersion: 1, status: 'ended', startIdempotencyKey: randomUUID(), requestFingerprint: 'later-fixture', authorizedAt: historicAt, endedAt: new Date('2026-08-13T02:00:00.000Z'), terminationReason: 'user_ended', createdAt: historicAt, updatedAt: historicAt })
      expect(await reviewDraftRepository.findForKaimahi(actor, workflowId)).toMatchObject({ status: 'manual', draft: null })
      await connection.db.delete(schema.workflowConversations).where(sql`${schema.workflowConversations.providerConversationId} like 'later-%'`)
      await connection.db.insert(schema.workflowPouReviews).values({ workflowSessionId: workflowId, organisationId: actor.organisation.id, pouId: 'whakapapa', reviewDraftRevisionId: revision.id, overallSummary: 'Canonical narrative review.', strengthsSummary: null, areasForAttentionSummary: null, confirmedByUserId: actor.id, confirmedAt: historicAt })
      expect(await reviewDraftRepository.findForKaimahi(actor, workflowId)).toMatchObject({ status: 'manual', draft: null })
      expect(ready.draft?.id).toBe(draft.id)
      expect(conversationId).toBeDefined()
    })
  }, 15_000)

  it('fails closed when equal timestamps make historic conversation or generated-review ordering ambiguous', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, conversationId, run, reviewDraftRepository }: any) => {
      expect((await request(payload())).statusCode).toBe(202)
      const [draft] = await connection.db.select().from(schema.conversationReviewDrafts).where(eq(schema.conversationReviewDrafts.assessmentRunId, run.id))
      const [assessment] = await connection.db.select().from(schema.conversationProviderRuleAssessments).where(eq(schema.conversationProviderRuleAssessments.assessmentRunId, run.id))
      const [conversation] = await connection.db.select().from(schema.workflowConversations).where(eq(schema.workflowConversations.id, conversationId))
      const observationId = randomUUID()
      const historicAt = new Date('2026-08-13T01:00:00.000Z')
      await connection.db.insert(schema.workflowSafetyObservations).values({ id: observationId, workflowSessionId: workflowId, organisationId: actor.organisation.id, assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'practice_quality', concernLevel: 'low', status: 'active', currentRevision: 1, confirmedByUserId: actor.id, confirmedAt: historicAt, updatedAt: historicAt })
      await connection.db.insert(schema.providerAssessmentReviews).values({ providerRuleAssessmentId: assessment.id, assessmentRunId: run.id, workflowSessionId: workflowId, organisationId: actor.organisation.id, reviewedByUserId: actor.id, status: 'confirmed', classificationSource: 'human_selected', canonicalObservationId: observationId, reviewedAt: historicAt })
      await connection.db.update(schema.conversationSafetyAssessmentRuns).set({ status: 'superseded', supersededAt: historicAt }).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))

      const equalConversationId = randomUUID()
      await connection.db.insert(schema.workflowConversations).values({
        id: equalConversationId,
        organisationId: actor.organisation.id,
        workflowSessionId: workflowId,
        pouId: 'whakapapa',
        startedByUserId: actor.id,
        provider: 'elevenlabs',
        providerConversationId: `equal-ended-${randomUUID()}`,
        providerAgentReference: 'agent-test',
        providerBranchReference: 'branch-test',
        providerEnvironment: 'test',
        conversationSpecificationCode: 'whakapapa-reflection',
        conversationSpecificationVersion: 1,
        status: 'ended',
        startIdempotencyKey: randomUUID(),
        requestFingerprint: 'equal-ended-fixture',
        authorizedAt: conversation.authorizedAt,
        endedAt: conversation.endedAt,
        terminationReason: 'user_ended',
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      })
      expect(await reviewDraftRepository.findForKaimahi(actor, workflowId)).toMatchObject({ status: 'manual', draft: null })
      await connection.db.delete(schema.workflowConversations).where(eq(schema.workflowConversations.id, equalConversationId))

      const equalRunConversationId = randomUUID()
      await connection.db.insert(schema.workflowConversations).values({
        id: equalRunConversationId,
        organisationId: actor.organisation.id,
        workflowSessionId: workflowId,
        pouId: 'whakapapa',
        startedByUserId: actor.id,
        provider: 'elevenlabs',
        providerConversationId: `equal-run-${randomUUID()}`,
        providerAgentReference: 'agent-test',
        providerBranchReference: 'branch-test',
        providerEnvironment: 'test',
        conversationSpecificationCode: 'whakapapa-reflection',
        conversationSpecificationVersion: 1,
        status: 'ended',
        startIdempotencyKey: randomUUID(),
        requestFingerprint: 'equal-run-fixture',
        authorizedAt: conversation.authorizedAt,
        endedAt: new Date(conversation.endedAt.getTime() - 1),
        terminationReason: 'user_ended',
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      })
      const [currentRun] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))
      const equalRunId = randomUUID()
      await connection.db.insert(schema.conversationSafetyAssessmentRuns).values({ ...currentRun, id: equalRunId, workflowConversationId: equalRunConversationId, status: 'superseded', supersededAt: historicAt })
      await connection.db.insert(schema.conversationReviewDrafts).values({ ...draft, id: randomUUID(), assessmentRunId: equalRunId, workflowConversationId: equalRunConversationId })
      const [equalRun] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, equalRunId))
      expect(equalRun.createdAt).toEqual(currentRun.createdAt)
      expect(await reviewDraftRepository.findForKaimahi(actor, workflowId)).toMatchObject({ status: 'manual', draft: null })
    })
  }, 15_000)

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
