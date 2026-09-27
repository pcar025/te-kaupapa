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
    if (record.code === 'P0001') return record
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
      const confirmation = { type: 'pou-review-confirmed' as const, idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa' as const, reviewDraftRevisionId: edited.revisionId }
      await workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: confirmation })
      const [canonical] = await connection.db.select().from(schema.workflowPouReviews).where(and(eq(schema.workflowPouReviews.workflowSessionId, workflowId), eq(schema.workflowPouReviews.pouId, 'whakapapa')))
      expect(canonical).toMatchObject({ reviewDraftRevisionId: edited.revisionId, criterionSnapshotsVersion: 1, overallSummary: 'Edited human-visible Whakapapa review.', confirmedByUserId: actor.id })
      const sourceCriteria = await connection.db.select().from(schema.conversationReviewDraftCriterionAssessments).where(eq(schema.conversationReviewDraftCriterionAssessments.reviewDraftRevisionId, edited.revisionId))
      const snapshots = await connection.db.select().from(schema.workflowPouReviewCriterionSnapshots).where(eq(schema.workflowPouReviewCriterionSnapshots.workflowPouReviewId, canonical.id))
      expect(snapshots).toHaveLength(sourceCriteria.length)
      expect(snapshots.map((snapshot: any) => ({
        sourceCriterionAssessmentId: snapshot.sourceCriterionAssessmentId,
        criterionCode: snapshot.criterionCode,
        availabilityStatus: snapshot.availabilityStatus,
        evidenceTurnIds: snapshot.evidenceTurnIds,
        missingInformationCodes: snapshot.missingInformationCodes,
      }))).toEqual(sourceCriteria.map((criterion: any) => ({
        sourceCriterionAssessmentId: criterion.id,
        criterionCode: criterion.criterionCode,
        availabilityStatus: criterion.status,
        evidenceTurnIds: criterion.evidenceTurnIds,
        missingInformationCodes: criterion.missingInformationCodes,
      })))
      expect(Object.keys(snapshots[0]!)).not.toContain('text')
      const read = await workflowRepository.findById(actor, workflowId)
      expect(read?.pouReviews[0]?.criterionEvidence).toMatchObject({ status: 'canonical_snapshot' })
      expect(read?.pouReviews[0]?.criterionEvidence.status === 'canonical_snapshot' && read.pouReviews[0].criterionEvidence.snapshots.some((snapshot) => snapshot.sourceCriterionAssessmentId === sourceCriteria[0]!.id)).toBe(true)
      expect((await canonicalSnapshot()).counts).toMatchObject({ workflowSafetyObservations: 0, workflowActions: 0, workflowReferrals: 0, workflowSupervisorReviewRequests: 0 })
      expect((await workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: confirmation })).replayed).toBe(true)
      expect(await connection.db.select().from(schema.workflowPouReviewCriterionSnapshots).where(eq(schema.workflowPouReviewCriterionSnapshots.workflowPouReviewId, canonical.id))).toHaveLength(sourceCriteria.length)
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
      for (const statement of [
        sql`update workflow_pou_review_criterion_snapshot set availability_status = 'not_explored' where id = ${snapshots[0]!.id}`,
        sql`delete from workflow_pou_review_criterion_snapshot where id = ${snapshots[0]!.id}`,
      ]) {
        let snapshotRejection: unknown
        try { await connection.db.execute(statement) } catch (error) { snapshotRejection = error }
        expect(postgresCause(snapshotRejection)).toMatchObject({ code: 'P0001', message: 'confirmed Pou criterion snapshots are immutable' })
      }
    })
  })

  it('does not expose or permit a review draft outside the owning Kaimahi workflow scope', async () => {
    await withPhase5BTestContext(async ({ request, payload, actor, workflowId, reviewDraftRepository }: any) => {
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:all-no-concern]' }))).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      await expect(reviewDraftRepository.edit({ ...actor, id: randomUUID() }, workflowId, { reviewDraftId: ready.draft.id, expectedRevision: 1, content: { overallSummary: 'Not allowed.', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: ready.draft.evidenceTurnIds } })).rejects.toThrow('review draft')
    })
  })

  it('rejects incomplete, wrong-revision, and wrong-Pou criterion snapshot sources without persisting a canonical review', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, reviewDraftRepository }: any) => {
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:all-no-concern]' }))).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      const sourceCriteria = await connection.db.select().from(schema.conversationReviewDraftCriterionAssessments).where(eq(schema.conversationReviewDraftCriterionAssessments.reviewDraftRevisionId, ready.draft.revisionId))
      const source = sourceCriteria[0]!
      const reviewValues = (reviewDraftRevisionId: string, pouId: 'whakapapa' | 'manaakitanga') => ({
        workflowSessionId: workflowId,
        organisationId: actor.organisation.id,
        pouId,
        reviewDraftRevisionId,
        overallSummary: 'Synthetic canonical review.',
        strengthsSummary: null,
        areasForAttentionSummary: null,
        criterionSnapshotsVersion: 1,
        confirmedByUserId: actor.id,
        confirmedAt: new Date('2026-08-13T00:00:00.000Z'),
      })
      const snapshotValues = (reviewId: string, criterion = source) => ({
        workflowPouReviewId: reviewId,
        sourceCriterionAssessmentId: criterion.id,
        criterionCode: criterion.criterionCode,
        availabilityStatus: criterion.status,
        evidenceTurnIds: criterion.evidenceTurnIds,
        missingInformationCodes: criterion.missingInformationCodes,
      })

      let incompleteRejection: unknown
      try { await connection.db.transaction(async (tx: any) => {
        const [review] = await tx.insert(schema.workflowPouReviews).values(reviewValues(ready.draft.revisionId, 'whakapapa')).returning()
        await tx.insert(schema.workflowPouReviewCriterionSnapshots).values(snapshotValues(review!.id))
      }) } catch (error) { incompleteRejection = error }
      expect(postgresCause(incompleteRejection)).toMatchObject({ message: 'canonical Pou review criterion snapshot set is incomplete or mismatched' })

      const edited = await reviewDraftRepository.edit(actor, workflowId, {
        reviewDraftId: ready.draft.id,
        expectedRevision: ready.draft.revision,
        content: { overallSummary: 'Edited revision.', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: ready.draft.evidenceTurnIds },
      })
      let wrongRevisionRejection: unknown
      try { await connection.db.transaction(async (tx: any) => {
        const [review] = await tx.insert(schema.workflowPouReviews).values(reviewValues(edited.revisionId, 'whakapapa')).returning()
        await tx.insert(schema.workflowPouReviewCriterionSnapshots).values(snapshotValues(review!.id, source))
      }) } catch (error) { wrongRevisionRejection = error }
      expect(postgresCause(wrongRevisionRejection)).toMatchObject({ message: 'canonical criterion snapshot provenance is invalid' })

      let wrongPouRejection: unknown
      try { await connection.db.transaction(async (tx: any) => {
        const [review] = await tx.insert(schema.workflowPouReviews).values(reviewValues(ready.draft.revisionId, 'manaakitanga')).returning()
        await tx.insert(schema.workflowPouReviewCriterionSnapshots).values(snapshotValues(review!.id, source))
      }) } catch (error) { wrongPouRejection = error }
      expect(postgresCause(wrongPouRejection)).toMatchObject({ message: 'canonical criterion snapshot provenance is invalid' })
      expect(await connection.db.select().from(schema.workflowPouReviews).where(eq(schema.workflowPouReviews.workflowSessionId, workflowId))).toHaveLength(0)
    })
  })

  it('keeps a pre-6D confirmed review readable as legacy-unavailable without manufacturing evidence', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, reviewDraftRepository, workflowRepository }: any) => {
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:all-no-concern]' }))).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      await connection.db.insert(schema.workflowPouReviews).values({
        workflowSessionId: workflowId,
        organisationId: actor.organisation.id,
        pouId: 'whakapapa',
        reviewDraftRevisionId: ready.draft.revisionId,
        overallSummary: 'Historic confirmed review.',
        strengthsSummary: null,
        areasForAttentionSummary: null,
        confirmedByUserId: actor.id,
        confirmedAt: new Date('2026-08-13T00:00:00.000Z'),
      })
      const workflow = await workflowRepository.findById(actor, workflowId)
      expect(workflow?.pouReviews).toMatchObject([{ pouId: 'whakapapa', criterionEvidence: { status: 'legacy_unavailable' } }])
      expect(workflow?.pouReviews[0]?.criterionEvidence).not.toHaveProperty('snapshots')
      expect(await connection.db.select().from(schema.workflowPouReviewCriterionSnapshots)).toHaveLength(0)
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
      const [assessment] = await connection.db.select().from(schema.conversationProviderRuleAssessments).where(and(
        eq(schema.conversationProviderRuleAssessments.assessmentRunId, run.id),
        eq(schema.conversationProviderRuleAssessments.outcome, 'possible_concern'),
      ))
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

  it('keeps a selected review need noncanonical until confirmation, then pins one candidate without creating an action or referral', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, reviewDraftRepository, repository, canonicalSnapshot }: any) => {
      expect((await request(payload({ transcript: [{ role: 'user', message: 'Synthetic Whakapapa reflection with strength and cultural connection. [scenario:all-no-concern]' }] }))).statusCode).toBe(202)
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
      expect(await connection.db.select().from(schema.workflowActionCandidates).where(eq(schema.workflowActionCandidates.workflowSessionId, workflowId))).toHaveLength(0)

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

      await workflowRepository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'pou-review-confirmed',
          idempotencyKey: randomUUID(),
          expectedVersion: 3,
          pouId: 'whakapapa',
          reviewDraftRevisionId: edited.revisionId,
        },
      })
      const [review] = await connection.db.select().from(schema.workflowPouReviews).where(and(
        eq(schema.workflowPouReviews.workflowSessionId, workflowId),
        eq(schema.workflowPouReviews.pouId, 'whakapapa'),
      ))
      const [candidate] = await connection.db.select().from(schema.workflowActionCandidates).where(eq(schema.workflowActionCandidates.workflowSessionId, workflowId))
      const [snapshot] = await connection.db.select().from(schema.workflowPouReviewCriterionSnapshots).where(and(
        eq(schema.workflowPouReviewCriterionSnapshots.workflowPouReviewId, review!.id),
        eq(schema.workflowPouReviewCriterionSnapshots.criterionCode, reviewNeed!.criterionCode),
      ))
      expect(candidate).toMatchObject({
        workflowPouReviewId: review!.id,
        reviewDraftRevisionId: edited.revisionId,
        criterionSnapshotId: snapshot!.id,
        originKind: 'kaimahi_carry_forward',
        disposition: 'pending',
        sourceSafetyObservationId: null,
        createdByUserId: actor.id,
      })
      expect(candidate!.proposedDescription).not.toContain('Synthetic Whakapapa reflection')
      let immutableOriginRejection: unknown
      try {
        await connection.db.execute(sql`update workflow_action_candidate set proposed_description = 'Forged replacement' where id = ${candidate!.id}`)
      } catch (error) { immutableOriginRejection = error }
      expect(postgresCause(immutableOriginRejection)).toMatchObject({ code: 'P0001', message: 'action candidate origin is immutable' })
      expect(await connection.db.select().from(schema.workflowActions).where(eq(schema.workflowActions.workflowSessionId, workflowId))).toHaveLength(0)
      expect(await connection.db.select().from(schema.workflowReferrals).where(eq(schema.workflowReferrals.workflowSessionId, workflowId))).toHaveLength(0)
    })
  })

  it('does not promote a selection from a superseded unconfirmed review revision', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, reviewDraftRepository, repository }: any) => {
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:all-no-concern]' }))).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      const reviewNeed = ready.draft.criterionAssessments.find((assessment: { status: string }) => assessment.status === 'not_explored')
      const workflowRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-13T00:00:00.000Z'), undefined, repository, reviewDraftRepository)
      await workflowRepository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'carry-forward-marked', itemId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa',
          source: { kind: 'review_criterion', reviewDraftRevisionId: ready.draft.revisionId, criterionCode: reviewNeed!.criterionCode },
        },
      })
      const revised = await reviewDraftRepository.edit(actor, workflowId, {
        reviewDraftId: ready.draft.id,
        expectedRevision: ready.draft.revision,
        content: {
          overallSummary: 'Revised canonical review.', strengthsSummary: ready.draft.strengthsSummary,
          areasForAttentionSummary: ready.draft.areasForAttentionSummary, evidenceTurnIds: ready.draft.evidenceTurnIds,
        },
      })
      await workflowRepository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 3, pouId: 'whakapapa', reviewDraftRevisionId: revised.revisionId },
      })
      expect(await connection.db.select().from(schema.workflowActionCandidates).where(eq(schema.workflowActionCandidates.workflowSessionId, workflowId))).toHaveLength(0)
      expect(await connection.db.select().from(schema.workflowActions).where(eq(schema.workflowActions.workflowSessionId, workflowId))).toHaveLength(0)
      expect(await connection.db.select().from(schema.workflowReferrals).where(eq(schema.workflowReferrals.workflowSessionId, workflowId))).toHaveLength(0)
    })
  })

  it('pins a selected active formal-safety observation as supplementary ordinary follow-up without changing safety or creating an action', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, reviewDraftRepository, repository }: any) => {
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:all-no-concern]' }))).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      const observationId = randomUUID()
      await connection.db.insert(schema.workflowSafetyObservations).values({
        id: observationId, workflowSessionId: workflowId, organisationId: actor.organisation.id,
        assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'practice_quality', concernLevel: 'low',
        status: 'active', currentRevision: 1, confirmedByUserId: actor.id,
        confirmedAt: new Date('2026-08-13T00:00:00.000Z'), updatedAt: new Date('2026-08-13T00:00:00.000Z'),
      })
      const workflowRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-13T00:00:00.000Z'), undefined, repository, reviewDraftRepository)
      await workflowRepository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'carry-forward-marked', itemId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa',
          source: { kind: 'safety_observation', observationId },
        },
      })
      await workflowRepository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 3, pouId: 'whakapapa', reviewDraftRevisionId: ready.draft.revisionId },
      })
      const [candidate] = await connection.db.select().from(schema.workflowActionCandidates).where(eq(schema.workflowActionCandidates.workflowSessionId, workflowId))
      const [observation] = await connection.db.select().from(schema.workflowSafetyObservations).where(eq(schema.workflowSafetyObservations.id, observationId))
      expect(candidate).toMatchObject({
        originKind: 'kaimahi_carry_forward', sourceSafetyObservationId: observationId, criterionSnapshotId: null,
        proposedDescription: 'Additional ordinary follow-up alongside a formal safety observation.', disposition: 'pending',
      })
      expect(observation).toMatchObject({ status: 'active', currentRevision: 1 })
      expect(await connection.db.select().from(schema.workflowActions).where(eq(schema.workflowActions.workflowSessionId, workflowId))).toHaveLength(0)
      expect(await connection.db.select().from(schema.workflowReferrals).where(eq(schema.workflowReferrals.workflowSessionId, workflowId))).toHaveLength(0)
    })
  })

  it('fails closed when a selected formal-safety observation is retracted before Pou confirmation', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, reviewDraftRepository, repository }: any) => {
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:all-no-concern]' }))).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      const observationId = randomUUID()
      await connection.db.insert(schema.workflowSafetyObservations).values({
        id: observationId, workflowSessionId: workflowId, organisationId: actor.organisation.id,
        assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'practice_quality', concernLevel: 'low',
        status: 'active', currentRevision: 1, confirmedByUserId: actor.id,
        confirmedAt: new Date('2026-08-13T00:00:00.000Z'), updatedAt: new Date('2026-08-13T00:00:00.000Z'),
      })
      const workflowRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-13T00:00:00.000Z'), undefined, repository, reviewDraftRepository)
      await workflowRepository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'carry-forward-marked', itemId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa',
          source: { kind: 'safety_observation', observationId },
        },
      })
      await workflowRepository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: {
          type: 'safety-observation-retracted', observationId, idempotencyKey: randomUUID(), expectedVersion: 3,
          expectedObservationRevision: 1, reason: 'Synthetic retraction before confirmation.',
        },
      })
      await expect(workflowRepository.submitCommand({
        actor,
        workflowSessionId: workflowId,
        command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: 4, pouId: 'whakapapa', reviewDraftRevisionId: ready.draft.revisionId },
      })).rejects.toThrow('no longer active')
      expect(await connection.db.select().from(schema.workflowActionCandidates).where(eq(schema.workflowActionCandidates.workflowSessionId, workflowId))).toHaveLength(0)
      expect(await connection.db.select().from(schema.workflowPouReviews).where(eq(schema.workflowPouReviews.workflowSessionId, workflowId))).toHaveLength(0)
      expect(await connection.db.select().from(schema.workflowActions).where(eq(schema.workflowActions.workflowSessionId, workflowId))).toHaveLength(0)
      expect(await connection.db.select().from(schema.workflowReferrals).where(eq(schema.workflowReferrals.workflowSessionId, workflowId))).toHaveLength(0)
    })
  })

  it('converts an explicitly accepted candidate atomically while preserving proposal provenance and routing another candidate without a referral', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, reviewDraftRepository, repository }: any) => {
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:all-no-concern]' }))).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      const criterion = ready.draft.criterionAssessments.find((assessment: { status: string }) => assessment.status === 'not_explored')
      expect(criterion).toBeDefined()
      const workflows = new PostgresWorkflowRepository(connection.db, () => new Date('2026-09-28T00:00:00.000Z'), undefined, repository, reviewDraftRepository)
      const edited = await reviewDraftRepository.edit(actor, workflowId, {
        reviewDraftId: ready.draft.id,
        expectedRevision: ready.draft.revision,
        content: {
          overallSummary: ready.draft.overallSummary,
          strengthsSummary: ready.draft.strengthsSummary,
          areasForAttentionSummary: 'Kaimahi-confirmed area for ordinary follow-up.',
          evidenceTurnIds: ready.draft.evidenceTurnIds,
        },
      })
      let version = 2
      for (const source of [
        { kind: 'review_criterion' as const, reviewDraftRevisionId: edited.revisionId, criterionCode: criterion!.criterionCode },
        { kind: 'areas_for_attention' as const, reviewDraftRevisionId: edited.revisionId },
      ]) {
        const carried = await workflows.submitCommand({ actor, workflowSessionId: workflowId, command: {
          type: 'carry-forward-marked', itemId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion: version,
          pouId: 'whakapapa', source,
        } })
        version = carried.workflow.version
      }
      const confirmed = await workflows.submitCommand({ actor, workflowSessionId: workflowId, command: {
        type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: version, pouId: 'whakapapa', reviewDraftRevisionId: edited.revisionId,
      } })
      await connection.db.update(schema.workflowSessions).set({ currentStage: 'action-planning', currentPouId: null }).where(eq(schema.workflowSessions.id, workflowId))
      const candidates = await workflows.listPendingActionCandidates(actor, workflowId)
      expect(candidates).toHaveLength(2)
      expect(candidates?.every((candidate: any) => !JSON.stringify(candidate).includes('Synthetic Whakapapa reflection'))).toBe(true)
      expect(await workflows.listPendingActionCandidates({ ...actor, id: randomUUID() }, workflowId)).toBeNull()
      const accepted = candidates!.find((candidate: any) => candidate.sourceCriterionCode === criterion!.criterionCode)!
      const routed = candidates!.find((candidate: any) => candidate.id !== accepted.id)!
      const actionId = randomUUID()
      const command = {
        type: 'action-plan-confirmed' as const,
        idempotencyKey: randomUUID(),
        expectedVersion: confirmed.workflow.version,
        actions: [{ id: actionId, sourceCandidateId: accepted.id, title: 'Kaimahi-edited follow-up wording.', type: 'follow-up' as const, pouId: 'whakapapa' as const, dueDate: '2026-10-05', status: 'open' as const }],
        candidateDecisions: [{ candidateId: routed.id, disposition: 'routed_to_referral' as const }],
      }
      const result = await workflows.submitCommand({ actor, workflowSessionId: workflowId, command })
      expect(result.workflow).toMatchObject({ currentStage: 'referral-planning', actions: [{ id: actionId, sourceCandidateId: accepted.id, title: 'Kaimahi-edited follow-up wording.', pouId: 'whakapapa', status: 'open' }], referrals: [] })
      expect((await workflows.submitCommand({ actor, workflowSessionId: workflowId, command })).replayed).toBe(true)
      const storedCandidates = await connection.db.select().from(schema.workflowActionCandidates).where(eq(schema.workflowActionCandidates.workflowSessionId, workflowId))
      expect(storedCandidates.find((candidate: any) => candidate.id === accepted.id)).toMatchObject({ disposition: 'accepted_as_action', proposedDescription: accepted.proposedDescription, dispositionedByUserId: actor.id })
      expect(storedCandidates.find((candidate: any) => candidate.id === routed.id)).toMatchObject({ disposition: 'routed_to_referral', dispositionedByUserId: actor.id })
      const [storedAction] = await connection.db.select().from(schema.workflowActions).where(eq(schema.workflowActions.id, actionId))
      expect(storedAction).toMatchObject({ sourceCandidateId: accepted.id, title: 'Kaimahi-edited follow-up wording.', status: 'open' })
      await expect(connection.db.insert(schema.workflowActions).values({
        id: randomUUID(), workflowSessionId: workflowId, organisationId: actor.organisation.id, pouId: 'manaakitanga',
        title: 'Forged cross-Pou candidate action.', type: 'follow-up', status: 'open',
        sourceCandidateId: accepted.id, createdByUserId: actor.id, ownerUserId: actor.id,
      })).rejects.toSatisfy((error: unknown) => postgresCause(error)?.message === 'candidate-derived action must match its source workflow, organisation, and Pou')
      await expect(connection.db.execute(sql`update workflow_action set source_candidate_id = null where id = ${actionId}`)).rejects.toSatisfy((error: unknown) => postgresCause(error)?.message === 'canonical action candidate provenance is immutable')
      await expect(connection.db.transaction(async (tx: any) => {
        await tx.insert(schema.workflowActions).values({
          id: randomUUID(), workflowSessionId: workflowId, organisationId: actor.organisation.id, pouId: 'whakapapa',
          title: 'Forged routed-candidate action.', type: 'follow-up', status: 'open',
          sourceCandidateId: routed.id, createdByUserId: actor.id, ownerUserId: actor.id,
        })
      })).rejects.toSatisfy((error: unknown) => postgresCause(error)?.message === 'candidate-derived action requires an accepted candidate')
      await expect(connection.db.transaction(async (tx: any) => {
        await tx.update(schema.workflowActionCandidates).set({
          disposition: 'routed_to_referral', dispositionedAt: new Date('2026-09-28T00:00:00.000Z'), dispositionedByUserId: actor.id,
        }).where(eq(schema.workflowActionCandidates.id, accepted.id))
      })).rejects.toSatisfy((error: unknown) => postgresCause(error)?.message === 'candidate linked to a canonical action must remain accepted')
      await expect(connection.db.transaction(async (tx: any) => {
        await tx.delete(schema.workflowActions).where(eq(schema.workflowActions.id, actionId))
      })).rejects.toSatisfy((error: unknown) => postgresCause(error)?.message === 'accepted candidate requires its canonical action')
      expect(await connection.db.select().from(schema.workflowReferrals).where(eq(schema.workflowReferrals.workflowSessionId, workflowId))).toHaveLength(0)
    })
  })

  it('requires a terminal decision for every candidate and retains rejection without creating an action', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, reviewDraftRepository, repository }: any) => {
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:all-no-concern]' }))).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      const criterion = ready.draft.criterionAssessments.find((assessment: { status: string }) => assessment.status === 'not_explored')
      const workflows = new PostgresWorkflowRepository(connection.db, () => new Date('2026-09-28T00:00:00.000Z'), undefined, repository, reviewDraftRepository)
      const carried = await workflows.submitCommand({ actor, workflowSessionId: workflowId, command: {
        type: 'carry-forward-marked', itemId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa',
        source: { kind: 'review_criterion', reviewDraftRevisionId: ready.draft.revisionId, criterionCode: criterion!.criterionCode },
      } })
      await expect(workflows.submitCommand({ actor, workflowSessionId: workflowId, command: {
        type: 'carry-forward-marked', itemId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion: carried.workflow.version, pouId: 'whakapapa',
        source: { kind: 'review_criterion', reviewDraftRevisionId: ready.draft.revisionId, criterionCode: criterion!.criterionCode },
      } })).rejects.toThrow('already been selected')
      const confirmed = await workflows.submitCommand({ actor, workflowSessionId: workflowId, command: {
        type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: carried.workflow.version, pouId: 'whakapapa', reviewDraftRevisionId: ready.draft.revisionId,
      } })
      await connection.db.update(schema.workflowSessions).set({ currentStage: 'action-planning', currentPouId: null }).where(eq(schema.workflowSessions.id, workflowId))
      await expect(workflows.submitCommand({ actor, workflowSessionId: workflowId, command: {
        type: 'action-plan-confirmed', idempotencyKey: randomUUID(), expectedVersion: confirmed.workflow.version, actions: [], candidateDecisions: [],
      } })).rejects.toThrow('Every pending action candidate')
      const [candidate] = await connection.db.select().from(schema.workflowActionCandidates).where(eq(schema.workflowActionCandidates.workflowSessionId, workflowId))
      await expect(connection.db.transaction(async (tx: any) => {
        await tx.insert(schema.workflowActions).values({
          id: randomUUID(), workflowSessionId: workflowId, organisationId: actor.organisation.id, pouId: 'whakapapa',
          title: 'Forged pending-candidate action.', type: 'follow-up', status: 'open',
          sourceCandidateId: candidate!.id, createdByUserId: actor.id, ownerUserId: actor.id,
        })
      })).rejects.toSatisfy((error: unknown) => postgresCause(error)?.message === 'candidate-derived action requires an accepted candidate')
      const rejected = await workflows.submitCommand({ actor, workflowSessionId: workflowId, command: {
        type: 'action-plan-confirmed', idempotencyKey: randomUUID(), expectedVersion: confirmed.workflow.version, actions: [], candidateDecisions: [{ candidateId: candidate!.id, disposition: 'rejected' }],
      } })
      expect(rejected.workflow).toMatchObject({ currentStage: 'referral-planning', actions: [], referrals: [] })
      const [storedCandidate] = await connection.db.select().from(schema.workflowActionCandidates).where(eq(schema.workflowActionCandidates.id, candidate!.id))
      expect(storedCandidate).toMatchObject({ disposition: 'rejected', dispositionedByUserId: actor.id })
      await expect(connection.db.transaction(async (tx: any) => {
        await tx.insert(schema.workflowActions).values({
          id: randomUUID(), workflowSessionId: workflowId, organisationId: actor.organisation.id, pouId: 'whakapapa',
          title: 'Forged rejected-candidate action.', type: 'follow-up', status: 'open',
          sourceCandidateId: candidate!.id, createdByUserId: actor.id, ownerUserId: actor.id,
        })
      })).rejects.toSatisfy((error: unknown) => postgresCause(error)?.message === 'candidate-derived action requires an accepted candidate')
      expect(await connection.db.select().from(schema.workflowActions).where(eq(schema.workflowActions.workflowSessionId, workflowId))).toHaveLength(0)
    })
  })

  it('caps distinct carry-forward sources at the Action Plan decision capacity', async () => {
    await withPhase5BTestContext(async ({ request, payload, connection, actor, workflowId, reviewDraftRepository, repository }: any) => {
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:all-no-concern]' }))).statusCode).toBe(202)
      const ready = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      const criterion = ready.draft.criterionAssessments.find((assessment: { status: string }) => assessment.status === 'not_explored')
      const now = new Date('2026-09-28T00:00:00.000Z')
      const observations = Array.from({ length: 100 }, () => randomUUID())
      await connection.db.insert(schema.workflowSafetyObservations).values(observations.map((id) => ({
        id, workflowSessionId: workflowId, organisationId: actor.organisation.id,
        assessmentContext: 'pou' as const, pouId: 'whakapapa' as const, broadClass: 'practice_quality' as const, concernLevel: 'low' as const,
        status: 'active' as const, currentRevision: 1, confirmedByUserId: actor.id, confirmedAt: now, updatedAt: now,
      })))
      await connection.db.insert(schema.workflowCarryForwards).values(observations.map((safetyObservationId) => ({
        id: randomUUID(), workflowSessionId: workflowId, organisationId: actor.organisation.id, pouId: 'whakapapa' as const,
        source: 'safety_observation' as const, reviewDraftRevisionId: null, criterionCode: null, safetyObservationId,
        note: null, createdByUserId: actor.id, createdAt: now,
      })))
      const workflows = new PostgresWorkflowRepository(connection.db, () => now, undefined, repository, reviewDraftRepository)
      await expect(workflows.submitCommand({ actor, workflowSessionId: workflowId, command: {
        type: 'carry-forward-marked', itemId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion: 2, pouId: 'whakapapa',
        source: { kind: 'review_criterion', reviewDraftRevisionId: ready.draft.revisionId, criterionCode: criterion!.criterionCode },
      } })).rejects.toThrow('at most 100 carry-forward candidates')
      expect(await connection.db.select().from(schema.workflowCarryForwards).where(eq(schema.workflowCarryForwards.workflowSessionId, workflowId))).toHaveLength(100)
    })
  })

})
