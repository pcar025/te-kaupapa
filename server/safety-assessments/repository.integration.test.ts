import { eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import * as schema from '../db/schema.js'
import { createDatabaseConnection } from '../db/repository.js'
import { getTestDatabaseUrl, hasTestDatabaseUrl } from '../db/test-harness.js'
import { withPhase5BTestContext } from './integration-fixture.js'
import { PostgresConversationRepository } from '../conversations/repository.js'
import { ConversationService } from '../conversations/service.js'
import { ConversationEligibilityError } from '../conversations/domain.js'
import { PostgresSafetyAssessmentRepository } from './repository.js'
import { SafetyProvisioningService } from './provisioning.js'
import { PostgresWorkflowRepository } from '../workflows/repository.js'
import { contentHash } from './domain.js'
import { PostgresOrganisationPouSpecificationRepository } from '../pou-specifications/repository.js'

const POU_CONFIRMATION_GATE_LOCK_ID = 549012684

function postgresImmutableCause(error: unknown): { code?: unknown; message?: unknown } | undefined {
  const seen = new Set<unknown>()
  const visit = (value: unknown): { code?: unknown; message?: unknown } | undefined => {
    if (!value || typeof value !== 'object' || seen.has(value)) return undefined
    seen.add(value)
    const record = value as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown[] }
    if (record.code === 'P0001' && record.message === 'organisation Pou specification provenance is immutable') return record
    const nested = visit(record.cause)
    return nested ?? (Array.isArray(record.errors) ? record.errors.map(visit).find(Boolean) : undefined)
  }
  return visit(error)
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForBlockedDatabaseWork(connection: ReturnType<typeof createDatabaseConnection>, count: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await connection.db.execute(sql`select count(*)::int as count from pg_locks where not granted`)
    if (Number((result.rows[0] as { count?: number | string } | undefined)?.count ?? 0) >= count) return
    await pause(10)
  }
  throw new Error(`Expected ${count} database operation(s) to be blocked at the test gate.`)
}

function pouReviewCommand(expectedVersion: number, reviewDraftRevisionId?: string) {
  return { type: 'pou-review-confirmed' as const, idempotencyKey: randomUUID(), expectedVersion, pouId: 'whakapapa' as const, userSelectedConcern: 'watch' as const, note: 'Ordinary Kaimahi Pou review.', referralSuggested: false, supervisorReviewSuggested: false, ...(reviewDraftRevisionId ? { reviewDraftRevisionId } : {}) }
}

function candidateConfirmationCommand(assessmentId: string, expectedVersion: number) {
  return { type: 'safety-observation-confirmed' as const, observationId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion, candidateAssessmentId: assessmentId, observation: { assessmentContext: 'pou' as const, pouId: 'whakapapa' as const, broadClass: 'practice_quality' as const, concernLevel: 'low' as const } }
}

describe.skipIf(!hasTestDatabaseUrl())('PostgreSQL Phase 5B assessment boundary integration', () => {
  it('resolves an approved active policy and starts a Whakapapa conversation with its exact pin', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, specification, repository, workflowRepository, storedSpec, storedProjection }) => {
      const pin = await repository.resolveActivePin(actor.organisation.id, { provider: 'elevenlabs', agentReference: 'agent-test', branchReference: 'branch-test', environment: 'test' })
      expect(pin).toMatchObject({ specificationId: storedSpec.id, projectionId: storedProjection.id, specificationHash: contentHash(specification) })

      const conversations = new PostgresConversationRepository(connection.db, () => new Date('2026-08-12T00:00:00.000Z'), repository)
      const service = new ConversationService(workflowRepository, conversations, { authorizeConversation: async () => ({ providerConversationId: `provider-${randomUUID()}`, conversationToken: 'test-only-token' }) }, { agentId: 'agent-test', branchId: 'branch-test', environment: 'test' }, repository, new PostgresOrganisationPouSpecificationRepository(connection.db))
      const started = await service.start(actor, workflowId, 'whakapapa', randomUUID())
      const [run] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.workflowConversationId, started.conversation.id))

      expect(started.conversation).toMatchObject({ status: 'authorized', pouId: 'whakapapa' })
      expect(run).toMatchObject({ specificationId: storedSpec.id, projectionId: storedProjection.id, status: 'pending' })
    })
  })

  it('reprojects an existing approved specification without changing its approval provenance', async () => {
    await withPhase5BTestContext(async ({ connection, actor, specification, repository }) => {
      const activeSpecification = { ...specification, specificationCode: `reproject-${randomUUID()}` }
      const provisioning = new SafetyProvisioningService(connection.db, () => new Date('2026-08-12T00:00:00.000Z'))
      const initial = await provisioning.provisionAndActivate({
        organisationId: actor.organisation.id, specification: activeSpecification,
        projection: { projectionCode: `reproject-projection-${randomUUID()}`, projectionVersion: '1' },
        conversationProvider: { provider: 'elevenlabs', agentReference: 'agent-test', branchReference: 'branch-test', environment: 'test' }, operatorUserId: actor.id,
      })

      const replacement = await provisioning.reprojectAndActivateExisting({
        organisationId: actor.organisation.id, specificationId: initial.specificationId,
        projection: { projectionCode: `reproject-projection-${randomUUID()}`, projectionVersion: '2' },
        conversationProvider: { provider: 'elevenlabs', agentReference: 'agent-test', branchReference: 'branch-test', environment: 'test' }, operatorUserId: actor.id,
      })

      expect(replacement.specificationId).toBe(initial.specificationId)
      const active = await repository.resolveActivePin(actor.organisation.id, { provider: 'elevenlabs', agentReference: 'agent-test', branchReference: 'branch-test', environment: 'test' })
      expect(active).toMatchObject({ specificationId: initial.specificationId, projectionId: replacement.projectionId, specificationHash: contentHash(activeSpecification) })
      const activations: Array<{ projectionId: string; deactivatedAt: Date | null }> = await connection.db.select({ projectionId: schema.safetySpecificationActivations.projectionId, deactivatedAt: schema.safetySpecificationActivations.deactivatedAt })
        .from(schema.safetySpecificationActivations)
        .where(eq(schema.safetySpecificationActivations.organisationId, actor.organisation.id))
      expect(activations.filter((activation) => activation.deactivatedAt === null)).toHaveLength(1)
      expect(activations.find((activation) => activation.projectionId === initial.projectionId)?.deactivatedAt).toBeInstanceOf(Date)
    })
  })

  it('rejects a conversation start that becomes ineligible before it acquires the workflow lock', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, workflowRepository, repository, canonicalSnapshot }) => {
      let releaseInitialRead: (() => void) | undefined
      let signalInitialRead: (() => void) | undefined
      const initialRead = new Promise<void>((resolve) => { signalInitialRead = resolve })
      const delayedWorkflowRepository = {
        findById: async (...args: Parameters<typeof workflowRepository.findById>) => {
          const workflow = await workflowRepository.findById(...args)
          signalInitialRead?.()
          await new Promise<void>((resolve) => { releaseInitialRead = resolve })
          return workflow
        },
      } as typeof workflowRepository
      let authorizationCalls = 0
      const authorizeConversation = async () => { authorizationCalls += 1; return { providerConversationId: `provider-${randomUUID()}`, conversationToken: 'test-only-token' } }
      const service = new ConversationService(delayedWorkflowRepository, new PostgresConversationRepository(connection.db, () => new Date('2026-08-12T00:00:00.000Z'), repository), { authorizeConversation }, { agentId: 'agent-test', branchId: 'branch-test', environment: 'test' }, repository, new PostgresOrganisationPouSpecificationRepository(connection.db))
      const started = service.start(actor, workflowId, 'whakapapa', randomUUID())
      try {
        await initialRead
        await workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2) })
        releaseInitialRead?.()
        await expect(started).rejects.toEqual(expect.any(ConversationEligibilityError))
        expect(authorizationCalls).toBe(0)
        expect(await connection.db.select().from(schema.workflowConversations).where(eq(schema.workflowConversations.workflowSessionId, workflowId))).toHaveLength(1)
        expect(await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.workflowSessionId, workflowId))).toHaveLength(1)
        expect(await canonicalSnapshot()).toMatchObject({ session: { version: 3, stage: 'pou-convo', pou: 'manaakitanga' }, checkpoint: { progress: 'confirmed', concern: 'watch' }, counts: { workflowInteractions: 1, workflowSafetyObservations: 0, workflowSafetyObservationRevisions: 0, workflowSafetyRuleEvaluations: 0, workflowSafetyConsequences: 0, workflowActions: 0, workflowReferrals: 0, workflowSupervisorReviewRequests: 0 } })
      } finally {
        releaseInitialRead?.()
        await started.catch(() => undefined)
      }
    })
  })

  it('keeps a signed provider delivery noncanonical, private, idempotent, and conflict-safe', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, run, repository, payload, request, assessmentCallCount, canonicalSnapshot, storedSpec, storedProjection, storedOrganisationSpecification, storedGuidance, storedReview }) => {
      const raw = payload()
      const before = await canonicalSnapshot()
      const [first, duplicate] = await Promise.all([request(raw), request(raw)])
      expect([first.statusCode, duplicate.statusCode].sort()).toEqual([202, 503])
      expect(assessmentCallCount()).toBe(1)
      expect(await canonicalSnapshot()).toEqual(before)
      const assessments = await connection.db.select().from(schema.conversationProviderRuleAssessments).where(eq(schema.conversationProviderRuleAssessments.assessmentRunId, run.id))
      expect(assessments).toHaveLength(3)
      const [storedRun] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))
      expect(storedRun).toMatchObject({ assessmentProvider: 'test-assessment-provider', assessmentProviderModel: 'test-assessment-model', assessmentProviderConfigHash: 'a'.repeat(64), assessmentSchemaVersion: '1' })
      expect(storedRun?.transcriptReceivedAt).toBeInstanceOf(Date)
      expect(storedRun?.assessmentStartedAt).toBeInstanceOf(Date)
      expect(storedRun?.assessmentCompletedAt).toBeInstanceOf(Date)
      await expect(connection.db.insert(schema.conversationProviderRuleAssessments).values({
        assessmentRunId: run.id, ruleCode: 'DB_PROVIDER_LEVEL_REJECTION', ruleVersion: 1,
        evidenceScope: 'current_conversation', outcome: 'possible_concern', candidateConcernLevel: 'low',
        matchedProtectiveIndicatorCodes: [], matchedConcernIndicatorCodes: [], missingInformationCodes: [], uncertaintyReasonCodes: [], applicabilityReasonCode: null, evidenceTurnIds: [],
      })).rejects.toThrow()
      const changed = raw.replace('Synthetic', 'Changed')
      expect((await request(changed)).statusCode).toBe(409)
      expect(await canonicalSnapshot()).toEqual(before)
      expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0)
      await expect(connection.db.execute(sql`update safety_specification_version set specification_code = 'mutated' where id = ${storedSpec.id}`)).rejects.toThrow()
      await expect(connection.db.execute(sql`delete from safety_specification_version where id = ${storedSpec.id}`)).rejects.toThrow()
      await expect(connection.db.execute(sql`update provider_assessment_projection set projection_code = 'mutated' where id = ${storedProjection.id}`)).rejects.toThrow()
      await expect(connection.db.execute(sql`delete from provider_assessment_projection where id = ${storedProjection.id}`)).rejects.toThrow()
      for (const rejection of [
        connection.db.execute(sql`update organisation_pou_specification_version set specification_code = 'mutated' where id = ${storedOrganisationSpecification.id}`),
        connection.db.execute(sql`update conversation_guidance_projection set projection_code = 'mutated' where id = ${storedGuidance.id}`),
        connection.db.execute(sql`update pou_review_projection set projection_code = 'mutated' where id = ${storedReview.id}`),
      ]) {
        let error: unknown
        try { await rejection } catch (caught) { error = caught }
        expect(postgresImmutableCause(error)).toMatchObject({ code: 'P0001', message: 'organisation Pou specification provenance is immutable' })
      }
      const [unchangedSpecification] = await connection.db.select().from(schema.organisationPouSpecificationVersions).where(eq(schema.organisationPouSpecificationVersions.id, storedOrganisationSpecification.id))
      expect(unchangedSpecification?.specificationCode).toBe(storedOrganisationSpecification.specificationCode)
      const triggers = await connection.db.execute(sql`select count(*)::int as count from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relname in ('conversation_provider_rule_assessment','conversation_safety_assessment_run','provider_assessment_delivery')`)
      expect(Number(triggers.rows[0]?.count ?? 0)).toBe(0)
    })
  })

  it('2. candidate read is nonmutating', async () => {
    await withPhase5BTestContext(async ({ actor, workflowId, repository, payload, request, canonicalSnapshot, connection }) => {
      expect((await request(payload())).statusCode).toBe(202)
      const diagnostic = await connection.db.execute(sql`select r.status, r.superseded_at, c.created_at, p.progress, count(a.id)::int as assessments from conversation_safety_assessment_run r join workflow_conversation c on c.id=r.workflow_conversation_id join workflow_pou_checkpoint p on p.workflow_session_id=r.workflow_session_id and p.pou_id=r.pou_id left join conversation_provider_rule_assessment a on a.assessment_run_id=r.id where r.workflow_session_id=${workflowId} group by r.status,r.superseded_at,c.created_at,p.progress`)
      expect(diagnostic.rows).toEqual([expect.objectContaining({ status: 'received', superseded_at: null, progress: 'not_started', assessments: 3 })])
      const before = await canonicalSnapshot(); const candidates = await repository.listReviewable(actor, workflowId)
      expect(candidates).toHaveLength(1)
      expect(candidates[0]).toMatchObject({ outcome: 'possible_concern', canonicalBroadClass: 'practice_quality' })
      expect(await connection.db.select().from(schema.providerAssessmentReviews)).toHaveLength(0)
      expect(await canonicalSnapshot()).toEqual(before)
    })
  })

  it('retains ordered noncanonical transcript turns only inside the scoped repository boundary', async () => {
    await withPhase5BTestContext(async ({ connection, conversationId, workflowId, actor, transcriptRepository, workflowRepository, payload, request }) => {
      const transcriptSentinel = 'P5B_TRANSCRIPT_SENTINEL_MUST_NOT_PERSIST'
      const audioSentinel = 'P5B_AUDIO_SENTINEL_MUST_NOT_PERSIST'
      const event = JSON.parse(payload())
      event.data.transcript = `Synthetic Whakapapa reflection ${transcriptSentinel}`
      event.data.audio = audioSentinel
      event.data.raw_provider_payload = `${transcriptSentinel}:${audioSentinel}`
      const response = await request(JSON.stringify(event))
      const persisted = await Promise.all([
        connection.db.select().from(schema.conversationSafetyAssessmentRuns),
        connection.db.select().from(schema.providerAssessmentDeliveries),
        connection.db.select().from(schema.conversationProviderRuleAssessments),
        connection.db.select().from(schema.providerAssessmentReviews),
      ])
      const transcripts = await connection.db.select().from(schema.conversationTranscripts)
      const turns = await connection.db.select().from(schema.conversationTranscriptTurns)

      expect(response.statusCode).toBe(202)
      expect(JSON.stringify(persisted)).not.toContain(transcriptSentinel)
      expect(JSON.stringify(persisted)).not.toContain(audioSentinel)
      expect(transcripts).toHaveLength(1)
      expect(turns).toHaveLength(1)
      expect(turns[0]).toMatchObject({ ordinal: 1, speaker: 'unknown', text: `Synthetic Whakapapa reflection ${transcriptSentinel}` })
      expect(JSON.stringify(transcripts)).not.toContain(audioSentinel)
      expect(JSON.stringify(turns)).not.toContain(audioSentinel)
      expect(JSON.stringify(await workflowRepository.findById(actor, workflowId))).not.toContain(transcriptSentinel)
      await expect(transcriptRepository.turnsForAssessment({ transcriptId: transcripts[0]!.id, workflowConversationId: conversationId, organisationId: actor.organisation.id, workflowSessionId: workflowId, pouId: 'whakapapa' })).resolves.toMatchObject([{ id: turns[0]!.id }])
      await expect(transcriptRepository.turnsForAssessment({ transcriptId: transcripts[0]!.id, workflowConversationId: randomUUID(), organisationId: actor.organisation.id, workflowSessionId: workflowId, pouId: 'whakapapa' })).rejects.toThrow('outside the assessment scope')
    })
  })

  it('database-binds transcript scope and rejects a real foreign transcript turn as assessment evidence', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, conversationId, providerConversationId, run, projection, repository, transcriptRepository, canonicalSnapshot }) => {
      const fixtureNow = new Date('2026-08-12T00:00:00.000Z')
      const foreignWorkflowId = randomUUID()
      const foreignConversationId = randomUUID()
      const foreignProviderConversationId = `foreign-${randomUUID()}`
      await connection.db.insert(schema.workflowSessions).values({ id: foreignWorkflowId, organisationId: actor.organisation.id, kaimahiUserId: actor.id, reference: `TK-${foreignWorkflowId.slice(0, 8)}`, status: 'in_progress', currentStage: 'pou-overview', currentPouId: 'whakapapa', version: 1 })
      await connection.db.insert(schema.workflowPouCheckpoints).values({ workflowSessionId: foreignWorkflowId, organisationId: actor.organisation.id, pouId: 'whakapapa', ordinal: 1 })
      await connection.db.insert(schema.workflowConversations).values({ id: foreignConversationId, organisationId: actor.organisation.id, workflowSessionId: foreignWorkflowId, pouId: 'whakapapa', startedByUserId: actor.id, provider: 'elevenlabs', providerConversationId: foreignProviderConversationId, providerAgentReference: 'agent-test', providerBranchReference: 'branch-test', providerEnvironment: 'test', conversationSpecificationCode: 'whakapapa-reflection', conversationSpecificationVersion: 1, status: 'ended', startIdempotencyKey: randomUUID(), requestFingerprint: 'foreign-transcript-fixture', authorizedAt: fixtureNow, endedAt: fixtureNow, terminationReason: 'user_ended' })
      const original = await transcriptRepository.retainForConversation({ organisationId: actor.organisation.id, workflowSessionId: workflowId, pouId: 'whakapapa', workflowConversationId: conversationId, provider: 'elevenlabs', providerConversationId, turns: [{ id: randomUUID(), ordinal: 1, speaker: 'unknown', text: 'Synthetic owning transcript.', providerSequence: null, providerTimestamp: null }] })
      const foreign = await transcriptRepository.retainForConversation({ organisationId: actor.organisation.id, workflowSessionId: foreignWorkflowId, pouId: 'whakapapa', workflowConversationId: foreignConversationId, provider: 'elevenlabs', providerConversationId: foreignProviderConversationId, turns: [{ id: randomUUID(), ordinal: 1, speaker: 'unknown', text: 'Synthetic foreign transcript.', providerSequence: null, providerTimestamp: null }] })
      await expect(transcriptRepository.retainForConversation({ organisationId: actor.organisation.id, workflowSessionId: workflowId, pouId: 'whakapapa', workflowConversationId: conversationId, provider: 'elevenlabs', providerConversationId: `wrong-${randomUUID()}`, turns: [{ id: randomUUID(), ordinal: 1, speaker: 'unknown', text: 'Synthetic mismatched provider reference.', providerSequence: null, providerTimestamp: null }] })).rejects.toThrow('provider provenance')
      await expect(connection.db.insert(schema.conversationTranscripts).values({ organisationId: actor.organisation.id, workflowSessionId: foreignWorkflowId, pouId: 'whakapapa', workflowConversationId: conversationId, provider: 'elevenlabs', providerConversationId })).rejects.toThrow()
      const assessments = projection.rules.map((rule: any, index: number) => ({ ruleCode: rule.ruleCode, ruleVersion: rule.ruleVersion, outcome: index === 0 ? 'possible_concern' as const : 'no_candidate_concern' as const, candidateConcernLevel: null, matchedProtectiveIndicatorCodes: [], matchedConcernIndicatorCodes: index === 0 ? [rule.concernIndicators[0]!.code] : [], missingInformationCodes: [], uncertaintyReasonCodes: [], applicabilityReasonCode: null, evidenceTurnIds: index === 0 ? [foreign.turns[0]!.id] : [] }))
      const deliveryId = `foreign-evidence-${randomUUID()}`
      const payloadHash = 'b'.repeat(64)
      await repository.reserveDelivery({ provider: 'elevenlabs', deliveryId, payloadHash, assessmentRunId: run.id })
      const before = await canonicalSnapshot()
      await expect(repository.ingest({ deliveryProvider: 'elevenlabs', deliveryId, payloadHash, providerConversationId, agentReference: 'agent-test', branchReference: 'branch-test', environment: 'test', transcriptId: original.transcriptId, transcriptReceivedAt: fixtureNow, assessments })).rejects.toThrow('outside the retained conversation transcript')
      expect(await connection.db.select().from(schema.conversationProviderRuleAssessments).where(eq(schema.conversationProviderRuleAssessments.assessmentRunId, run.id))).toHaveLength(0)
      expect(await canonicalSnapshot()).toEqual(before)
    })
  })

  it('3. possible-concern dismissal is noncanonical', async () => {
    await withPhase5BTestContext(async ({ actor, workflowId, repository, payload, request, canonicalSnapshot, connection }) => {
      await request(payload()); const [candidate] = await repository.listReviewable(actor, workflowId); const before = await canonicalSnapshot()
      await repository.acknowledge(actor, workflowId, candidate!.id, 'dismissed')
      expect(await connection.db.select().from(schema.providerAssessmentReviews)).toHaveLength(1)
      expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0)
      expect(await canonicalSnapshot()).toEqual(before)
    })
  })

  it('4. insufficient-information acknowledgement is noncanonical', async () => {
    await withPhase5BTestContext(async ({ actor, workflowId, repository, payload, request, canonicalSnapshot, connection }) => {
      const raw = payload({ transcript: 'Synthetic Whakapapa reflection [scenario:insufficient]' })
      expect((await request(raw)).statusCode).toBe(202); const [candidate] = await repository.listReviewable(actor, workflowId); const before = await canonicalSnapshot()
      await repository.acknowledge(actor, workflowId, candidate!.id, 'insufficient_information_acknowledged')
      const [review] = await connection.db.select().from(schema.providerAssessmentReviews); expect(review).toMatchObject({ status: 'insufficient_information_acknowledged', canonicalObservationId: null })
      expect(await canonicalSnapshot()).toEqual(before)
    })
  })

  it('5. no-candidate-concern is persisted but cannot confirm canonical safety', async () => {
    await withPhase5BTestContext(async ({ actor, workflowId, repository, payload, request, canonicalSnapshot, connection }) => {
      const raw = payload({ transcript: 'Synthetic Whakapapa reflection [scenario:no-concern]' })
      const before = await canonicalSnapshot(); expect((await request(raw)).statusCode).toBe(202)
      const [stored] = await connection.db.select().from(schema.conversationProviderRuleAssessments); expect(stored).toMatchObject({ outcome: 'no_candidate_concern', candidateConcernLevel: null })
      expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0)
      await expect(repository.prepareConfirmation(connection.db as any, actor, workflowId, stored!.id, 'practice_quality', 'low')).rejects.toThrow()
      expect(await canonicalSnapshot()).toEqual(before)
    })
  })

  it('6. not-applicable is noncanonical', async () => {
    await withPhase5BTestContext(async ({ actor, workflowId, repository, payload, request, canonicalSnapshot, connection }) => {
      const raw = payload({ transcript: 'Synthetic Whakapapa reflection [scenario:not-applicable]' })
      const before = await canonicalSnapshot(); expect((await request(raw)).statusCode).toBe(202)
      const stored = (await connection.db.select().from(schema.conversationProviderRuleAssessments)).find((assessment: typeof schema.conversationProviderRuleAssessments.$inferSelect) => assessment.ruleCode === 'WHAKAPAPA_CULTURAL_DISTRESS_003'); expect(stored).toMatchObject({ outcome: 'not_applicable', applicabilityReasonCode: 'no_explicit_cultural_identity_distress', candidateConcernLevel: null })
      await expect(repository.prepareConfirmation(connection.db as any, actor, workflowId, stored!.id, 'practice_quality', 'low')).rejects.toThrow()
      expect(await canonicalSnapshot()).toEqual(before)
    })
  })

  it('7. malformed signed result is safely rejected without canonical mutation', async () => {
    await withPhase5BTestContext(async ({ payload, request, canonicalSnapshot, repository, actor, workflowId }) => {
      const event = JSON.parse(payload()); delete event.data.transcript; const before = await canonicalSnapshot()
      expect((await request(JSON.stringify(event))).statusCode).toBe(400)
      expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0); expect(await canonicalSnapshot()).toEqual(before)
    })
  })

  it('8. semantically partial result is rejected as a whole', async () => {
    await withPhase5BTestContext(async ({ payload, request, canonicalSnapshot, repository, actor, workflowId, connection }) => {
      const raw = payload({ transcript: 'Synthetic Whakapapa reflection [scenario:partial]' }); const before = await canonicalSnapshot()
      expect((await request(raw)).statusCode).toBe(400)
      expect(await connection.db.select().from(schema.conversationProviderRuleAssessments)).toHaveLength(0); expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0); expect(await canonicalSnapshot()).toEqual(before)
    })
  })

  it('9. invalid signature is rejected before semantic ingestion', async () => {
    await withPhase5BTestContext(async ({ app, payload, canonicalSnapshot, repository, actor, workflowId, connection }) => {
      const raw = payload(); const before = await canonicalSnapshot()
      const response = await app.inject({ method: 'POST', url: '/api/integrations/elevenlabs/post-call', headers: { 'content-type': 'application/json', 'elevenlabs-signature': 't=0,v0=00' }, payload: raw })
      expect(response.statusCode).toBe(400); expect(await connection.db.select().from(schema.conversationProviderRuleAssessments)).toHaveLength(0); expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0); expect(await canonicalSnapshot()).toEqual(before)
    })
  })

  it('12A. newer conversation supersedes older run without canonical mutation', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, repository, payload, request, canonicalSnapshot, specification, projection, storedSpec, storedProjection, run }) => {
      await request(payload()); const [oldCandidate] = await repository.listReviewable(actor, workflowId); const before = await canonicalSnapshot()
      const conversations = new PostgresConversationRepository(connection.db, () => new Date('2026-08-12T00:00:01.000Z'), repository)
      const next = await conversations.prepare({ actor, workflowSessionId: workflowId, pouId: 'whakapapa', provider: 'elevenlabs', providerAgentReference: 'agent-test', providerBranchReference: 'branch-test', providerEnvironment: 'test', conversationSpecificationCode: 'whakapapa-reflection', conversationSpecificationVersion: 1, idempotencyKey: randomUUID(), requestFingerprint: 'newer', assessmentPin: { specificationId: storedSpec.id, specification, specificationHash: specification ? (await import('./domain.js')).contentHash(specification) : '', ruleManifestHash: (await import('./domain.js')).contentHash(projection.rules), projectionId: storedProjection.id, projection, projectionHash: (await import('./domain.js')).contentHash(projection) } })
      const [oldRun] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id)); const [newRun] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.workflowConversationId, next.conversation.id))
      expect(oldRun).toMatchObject({ status: 'superseded' }); expect(newRun).toMatchObject({ status: 'pending' }); expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0)
      await expect(repository.acknowledge(actor, workflowId, oldCandidate!.id, 'dismissed')).rejects.toThrow()
      expect(await canonicalSnapshot()).toEqual(before)
    })
  })

  it('12B. ordinary Whakapapa Pou confirmation supersedes candidates without creating candidate-derived canonical state', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, run, repository, reviewDraftRepository, workflowRepository, payload, request, canonicalSnapshot }) => {
      expect((await request(payload())).statusCode).toBe(202)
      const [candidate] = await repository.listReviewable(actor, workflowId)
      const before = await canonicalSnapshot()
      const draft = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      const confirmed = await workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2, draft.draft!.revisionId) })
      const [superseded] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))
      const after = await canonicalSnapshot()

      expect(confirmed.workflow).toMatchObject({ version: 3, currentStage: 'pou-convo', currentPouId: 'manaakitanga' })
      expect(superseded).toMatchObject({ status: 'superseded' })
      expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0)
      await expect(repository.acknowledge(actor, workflowId, candidate!.id, 'dismissed')).rejects.toThrow()
      expect(after).toMatchObject({ session: { version: 3, stage: 'pou-convo', pou: 'manaakitanga' }, checkpoint: { progress: 'confirmed', concern: 'watch' }, counts: { ...before.counts, workflowInteractions: before.counts.workflowInteractions + 1, workflowSafetyObservations: 0, workflowSafetyObservationRevisions: 0, workflowSafetyRuleEvaluations: 0, workflowSafetyConsequences: 0, workflowActions: 0, workflowReferrals: 0, workflowSupervisorReviewRequests: 0 } })
    })
  })

  it('12C. late provider delivery and direct stale-ID confirmation cannot resurrect a Pou-confirmed run', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, run, repository, reviewDraftRepository, workflowRepository, payload, request, canonicalSnapshot }) => {
      expect((await request(payload())).statusCode).toBe(202)
      const [retainedBeforeConfirmation] = await connection.db.select().from(schema.conversationTranscripts)
      const [retainedTurnBeforeConfirmation] = await connection.db.select().from(schema.conversationTranscriptTurns)
      const [candidate] = await repository.listReviewable(actor, workflowId)
      const draft = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      await workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2, draft.draft!.revisionId) })
      const afterPouConfirmation = await canonicalSnapshot()
      const beforeDeliveries = await connection.db.select().from(schema.providerAssessmentDeliveries).where(eq(schema.providerAssessmentDeliveries.assessmentRunId, run.id))
      const late = await request(payload())
      const afterDeliveries = await connection.db.select().from(schema.providerAssessmentDeliveries).where(eq(schema.providerAssessmentDeliveries.assessmentRunId, run.id))
      const retainedAfterLateDelivery = await connection.db.select().from(schema.conversationTranscripts)
      const retainedTurnsAfterLateDelivery = await connection.db.select().from(schema.conversationTranscriptTurns)
      const [superseded] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))

      expect(late.statusCode).toBe(202)
      expect(late.json()).toMatchObject({ accepted: true, replayed: false, superseded: true })
      expect(afterDeliveries).toHaveLength(beforeDeliveries.length + 1)
      expect(retainedAfterLateDelivery).toEqual([retainedBeforeConfirmation])
      expect(retainedTurnsAfterLateDelivery).toEqual([retainedTurnBeforeConfirmation])
      expect(superseded).toMatchObject({ status: 'superseded' })
      expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0)
      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: candidateConfirmationCommand(candidate!.id, 3) })).rejects.toThrow()
      await expect(repository.acknowledge(actor, workflowId, candidate!.id, 'dismissed')).rejects.toThrow()
      expect(await canonicalSnapshot()).toEqual(afterPouConfirmation)
      expect(await connection.db.select().from(schema.providerAssessmentReviews)).toHaveLength(0)
    })
  })

  it('serializes ordinary Pou confirmation ahead of a concurrent provider delivery without resurrecting a run', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, run, workflowRepository, payload, request, canonicalSnapshot }) => {
      const holderConnection = createDatabaseConnection(getTestDatabaseUrl())
      const confirmationConnection = createDatabaseConnection(getTestDatabaseUrl())
      let releaseGate: (() => void) | undefined
      let signalGateHeld: (() => void) | undefined
      const gateHeld = new Promise<void>((resolve) => { signalGateHeld = resolve })
      const holder = holderConnection.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${POU_CONFIRMATION_GATE_LOCK_ID})`)
        signalGateHeld?.()
        await new Promise<void>((resolve) => { releaseGate = resolve })
      })
      await connection.db.execute(sql.raw(`
        create or replace function te_kaupapa_p5b_pou_confirmation_gate() returns trigger language plpgsql as $$
        begin
          perform pg_advisory_xact_lock(${POU_CONFIRMATION_GATE_LOCK_ID});
          return new;
        end;
        $$
      `))
      await connection.db.execute(sql`create trigger te_kaupapa_p5b_pou_confirmation_gate before update on workflow_pou_checkpoint for each row execute function te_kaupapa_p5b_pou_confirmation_gate()`)
      try {
        await gateHeld
        const confirmationRepository = new PostgresWorkflowRepository(confirmationConnection.db, () => new Date('2026-08-12T00:00:00.000Z'), undefined, new PostgresSafetyAssessmentRepository(confirmationConnection.db, () => new Date('2026-08-12T00:00:00.000Z')))
        const confirmation = confirmationRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2) })
        await waitForBlockedDatabaseWork(connection, 1)
        const delivery = request(payload())
        await waitForBlockedDatabaseWork(connection, 2)
        releaseGate?.()
        await holder
        const [confirmed, delivered] = await Promise.all([confirmation, delivery])
        const [storedRun] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))
        const assessments = await connection.db.select().from(schema.conversationProviderRuleAssessments).where(eq(schema.conversationProviderRuleAssessments.assessmentRunId, run.id))

        expect(confirmed.workflow).toMatchObject({ version: 3, currentStage: 'pou-convo', currentPouId: 'manaakitanga' })
        expect(delivered.statusCode).toBe(202)
        expect(delivered.json()).toMatchObject({ accepted: true, replayed: false, superseded: true })
        expect(storedRun).toMatchObject({ status: 'superseded' })
        expect(assessments).toHaveLength(0)
        expect(await canonicalSnapshot()).toMatchObject({ session: { version: 3, stage: 'pou-convo', pou: 'manaakitanga' }, checkpoint: { progress: 'confirmed', concern: 'watch' }, counts: { workflowInteractions: 1, workflowSafetyObservations: 0, workflowSafetyObservationRevisions: 0, workflowSafetyRuleEvaluations: 0, workflowSafetyConsequences: 0, workflowActions: 0, workflowReferrals: 0, workflowSupervisorReviewRequests: 0 } })
      } finally {
        releaseGate?.()
        await holder.catch(() => undefined)
        await connection.db.execute(sql`drop trigger if exists te_kaupapa_p5b_pou_confirmation_gate on workflow_pou_checkpoint`)
        await connection.db.execute(sql`drop function if exists te_kaupapa_p5b_pou_confirmation_gate()`)
        await Promise.all([holderConnection.close(), confirmationConnection.close()])
      }
    })
  })

  it('confirms a candidate only through an explicit human classification and existing deterministic safety rules', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, run, repository, workflowRepository, payload, request, canonicalSnapshot }) => {
      expect((await request(payload())).statusCode).toBe(202)
      const [candidate] = await repository.listReviewable(actor, workflowId)
      const before = await canonicalSnapshot()
      const confirmed = await workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: candidateConfirmationCommand(candidate!.id, 2) })
      const after = await canonicalSnapshot()
      const [review] = await connection.db.select().from(schema.providerAssessmentReviews)
      const [observation] = await connection.db.select().from(schema.workflowSafetyObservations)
      const [superseded] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))

      expect(confirmed.workflow).toMatchObject({ version: 3, currentStage: 'pou-overview', currentPouId: 'whakapapa' })
      expect(observation).toMatchObject({ assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'practice_quality', concernLevel: 'low', status: 'active' })
      expect(review).toMatchObject({ status: 'confirmed', classificationSource: 'human_selected', canonicalObservationId: observation!.id })
      expect(superseded).toMatchObject({ status: 'superseded' })
      expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0)
      expect(after).toMatchObject({ session: { version: 3, stage: 'pou-overview', pou: 'whakapapa' }, checkpoint: { progress: 'not_started' }, counts: { ...before.counts, workflowInteractions: before.counts.workflowInteractions + 1, workflowSafetyObservations: 1, workflowSafetyObservationRevisions: 1, workflowSafetyRuleEvaluations: 1, workflowSafetyConsequences: 0, workflowActions: 0, workflowReferrals: 0, workflowSupervisorReviewRequests: 0 } })
    })
  })

  it('allows only one concurrent human confirmation for a candidate', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, repository, payload, request, canonicalSnapshot }) => {
      expect((await request(payload())).statusCode).toBe(202)
      const [candidate] = await repository.listReviewable(actor, workflowId)
      const firstConnection = createDatabaseConnection(getTestDatabaseUrl())
      const secondConnection = createDatabaseConnection(getTestDatabaseUrl())
      try {
        const firstRepository = new PostgresWorkflowRepository(firstConnection.db, () => new Date('2026-08-12T00:00:00.000Z'), undefined, new PostgresSafetyAssessmentRepository(firstConnection.db, () => new Date('2026-08-12T00:00:00.000Z')))
        const secondRepository = new PostgresWorkflowRepository(secondConnection.db, () => new Date('2026-08-12T00:00:00.000Z'), undefined, new PostgresSafetyAssessmentRepository(secondConnection.db, () => new Date('2026-08-12T00:00:00.000Z')))
        const outcomes = await Promise.allSettled([
          firstRepository.submitCommand({ actor, workflowSessionId: workflowId, command: candidateConfirmationCommand(candidate!.id, 2) }),
          secondRepository.submitCommand({ actor, workflowSessionId: workflowId, command: candidateConfirmationCommand(candidate!.id, 2) }),
        ])
        const after = await canonicalSnapshot()

        expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
        expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1)
        expect(await connection.db.select().from(schema.providerAssessmentReviews)).toHaveLength(1)
        expect(await connection.db.select().from(schema.workflowSafetyObservations)).toHaveLength(1)
        expect(after.counts).toMatchObject({ workflowInteractions: 1, workflowSafetyObservations: 1, workflowSafetyObservationRevisions: 1, workflowSafetyRuleEvaluations: 1, workflowSafetyConsequences: 0, workflowActions: 0, workflowReferrals: 0, workflowSupervisorReviewRequests: 0 })
      } finally {
        await Promise.all([firstConnection.close(), secondConnection.close()])
      }
    })
  })

  it('serializes concurrent confirmation and dismissal into one coherent human outcome', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, repository, payload, request, canonicalSnapshot }) => {
      expect((await request(payload())).statusCode).toBe(202)
      const [candidate] = await repository.listReviewable(actor, workflowId)
      const confirmationConnection = createDatabaseConnection(getTestDatabaseUrl())
      const dismissalConnection = createDatabaseConnection(getTestDatabaseUrl())
      try {
        const confirmationRepository = new PostgresWorkflowRepository(confirmationConnection.db, () => new Date('2026-08-12T00:00:00.000Z'), undefined, new PostgresSafetyAssessmentRepository(confirmationConnection.db, () => new Date('2026-08-12T00:00:00.000Z')))
        const dismissalRepository = new PostgresSafetyAssessmentRepository(dismissalConnection.db, () => new Date('2026-08-12T00:00:00.000Z'))
        const outcomes = await Promise.allSettled([
          confirmationRepository.submitCommand({ actor, workflowSessionId: workflowId, command: candidateConfirmationCommand(candidate!.id, 2) }),
          dismissalRepository.acknowledge(actor, workflowId, candidate!.id, 'dismissed'),
        ])
        const [review] = await connection.db.select().from(schema.providerAssessmentReviews)
        const after = await canonicalSnapshot()

        expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
        expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1)
        expect(review).toBeDefined()
        expect(['confirmed', 'dismissed']).toContain(review!.status)
        expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0)
        if (review!.status === 'confirmed') {
          expect(after.counts).toMatchObject({ workflowInteractions: 1, workflowSafetyObservations: 1, workflowSafetyObservationRevisions: 1, workflowSafetyRuleEvaluations: 1, workflowSafetyConsequences: 0 })
        } else {
          expect(after.counts).toMatchObject({ workflowInteractions: 0, workflowSafetyObservations: 0, workflowSafetyObservationRevisions: 0, workflowSafetyRuleEvaluations: 0, workflowSafetyConsequences: 0 })
        }
      } finally {
        await Promise.all([confirmationConnection.close(), dismissalConnection.close()])
      }
    })
  })

  it('rejects candidate access outside the owning Kaimahi, organisation, workflow, Pou, or assessment run', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, repository, workflowRepository, payload, request, canonicalSnapshot }) => {
      expect((await request(payload())).statusCode).toBe(202)
      const [candidate] = await repository.listReviewable(actor, workflowId)
      const colleague = { ...actor, id: randomUUID(), displayName: 'Same organisation colleague' }
      const foreignOrganisationId = randomUUID()
      const foreignActor = { ...actor, id: randomUUID(), displayName: 'Foreign Kaimahi', organisation: { id: foreignOrganisationId, slug: `foreign-${foreignOrganisationId}`, name: 'Foreign organisation' } }
      await connection.db.insert(schema.appUsers).values({ id: colleague.id, organisationId: actor.organisation.id, email: `${colleague.id}@example.invalid`, displayName: colleague.displayName })
      await connection.db.insert(schema.organisations).values({ id: foreignOrganisationId, slug: foreignActor.organisation.slug, name: foreignActor.organisation.name })
      await connection.db.insert(schema.appUsers).values({ id: foreignActor.id, organisationId: foreignOrganisationId, email: `${foreignActor.id}@example.invalid`, displayName: foreignActor.displayName })
      const before = await canonicalSnapshot()

      expect(await repository.listReviewable(colleague, workflowId)).toHaveLength(0)
      expect(await repository.listReviewable(foreignActor, workflowId)).toHaveLength(0)
      await expect(repository.acknowledge(colleague, workflowId, candidate!.id, 'dismissed')).rejects.toThrow()
      await expect(repository.acknowledge(foreignActor, workflowId, candidate!.id, 'dismissed')).rejects.toThrow()
      await expect(repository.acknowledge(actor, randomUUID(), candidate!.id, 'dismissed')).rejects.toThrow()
      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: { ...candidateConfirmationCommand(candidate!.id, 2), observation: { assessmentContext: 'pou', pouId: 'manaakitanga', broadClass: 'practice_quality', concernLevel: 'low' } } })).rejects.toThrow()
      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: candidateConfirmationCommand(randomUUID(), 2) })).rejects.toThrow()
      expect(await connection.db.select().from(schema.providerAssessmentReviews)).toHaveLength(0)
      expect(await canonicalSnapshot()).toEqual(before)
    })
  })
})
