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
import { PostgresSafetyAssessmentRepository, UnresolvedSafetyCandidateError, type SafetyTransaction } from './repository.js'
import { SafetyProvisioningService } from './provisioning.js'
import { PostgresWorkflowRepository } from '../workflows/repository.js'
import { contentHash } from './domain.js'
import { PostgresOrganisationPouSpecificationRepository } from '../pou-specifications/repository.js'
import { OrganisationPouSpecificationProvisioningService } from '../pou-specifications/provisioning.js'
import { organisationPouSpecificationFromRegistry } from '../pou-specifications/registry.js'
import { safetySpecificationFromRegistry } from './registry.js'
import { PHASE_5D_DRAFT_POU_SPECIFICATIONS } from '../pou-specifications/phase5d-specifications.js'
import { PostgresTranscriptRepository } from '../transcripts/repository.js'
import { conversationGuidanceProjection, pouReviewProjection } from '../pou-specifications/domain.js'

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
  return { type: 'pou-review-confirmed' as const, idempotencyKey: randomUUID(), expectedVersion, pouId: 'whakapapa' as const, note: 'Ordinary Kaimahi Pou review.', ...(reviewDraftRevisionId ? { reviewDraftRevisionId } : {}) }
}

function candidateConfirmationCommand(assessmentId: string, expectedVersion: number) {
  return { type: 'safety-observation-confirmed' as const, observationId: randomUUID(), idempotencyKey: randomUUID(), expectedVersion, candidateAssessmentId: assessmentId, observation: { assessmentContext: 'pou' as const, pouId: 'whakapapa' as const, broadClass: 'practice_quality' as const, concernLevel: 'low' as const } }
}

describe.skipIf(!hasTestDatabaseUrl())('PostgreSQL Phase 5B assessment boundary integration', () => {
  it('resolves an approved active policy and starts a Whakapapa conversation with its exact pin', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, specification, projection, repository, workflowRepository, storedSpec, storedProjection, organisationSpecification, storedOrganisationSpecification }) => {
      const pin = await repository.resolveActivePin(actor.organisation.id, 'whakapapa', { provider: 'elevenlabs', agentReference: 'agent-test', branchReference: 'branch-test', environment: 'test' })
      expect(pin).toMatchObject({ specificationId: storedSpec.id, projectionId: storedProjection.id, specificationHash: contentHash(specification) })

      const conversations = new PostgresConversationRepository(connection.db, () => new Date('2026-08-12T00:00:00.000Z'), repository)
      const service = new ConversationService(workflowRepository, conversations, { authorizeConversation: async () => ({ providerConversationId: `provider-${randomUUID()}`, conversationToken: 'test-only-token' }) }, { agentId: 'agent-test', branchId: 'branch-test', environment: 'test' }, repository, new PostgresOrganisationPouSpecificationRepository(connection.db))
      const started = await service.start(actor, workflowId, 'whakapapa', randomUUID())
      const [run] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.workflowConversationId, started.conversation.id))

      expect(started.conversation).toMatchObject({ status: 'authorized', pouId: 'whakapapa' })
      expect(run).toMatchObject({ specificationId: storedSpec.id, projectionId: storedProjection.id, status: 'pending' })

      // The accepted Whakapapa v0.1 activation predates the redundant
      // projection-level Pou identifier. A conversation already pinned to its
      // exact historic shape must remain eligible for signed delivery.
      await connection.db.update(schema.workflowConversations).set({ status: 'ended', endedAt: new Date('2026-08-12T00:00:01.000Z'), terminationReason: 'user_ended' }).where(eq(schema.workflowConversations.id, started.conversation.id))
      const { pouId: _guidancePouId, ...historicGuidance } = conversationGuidanceProjection(organisationSpecification, {
        projectionCode: 'TE_WAHAROA_WHAKAPAPA-conversation-guidance', projectionVersion: '0.1',
      })
      const { pouId: _reviewPouId, ...historicReview } = pouReviewProjection(organisationSpecification, {
        projectionCode: 'TE_WAHAROA_WHAKAPAPA-review', projectionVersion: '0.1',
      })
      const [storedHistoricGuidance] = await connection.db.insert(schema.conversationGuidanceProjections).values({
        organisationId: actor.organisation.id, pouId: 'whakapapa', specificationId: storedOrganisationSpecification.id,
        projectionCode: historicGuidance.projectionCode, projectionVersion: historicGuidance.projectionVersion, projectionHash: contentHash(historicGuidance), projection: historicGuidance,
      }).returning()
      const [storedHistoricReview] = await connection.db.insert(schema.pouReviewProjections).values({
        organisationId: actor.organisation.id, pouId: 'whakapapa', specificationId: storedOrganisationSpecification.id,
        projectionCode: historicReview.projectionCode, projectionVersion: historicReview.projectionVersion, projectionHash: contentHash(historicReview), projection: historicReview,
      }).returning()
      const historicConversationId = randomUUID()
      const historicProviderConversationId = `provider-${randomUUID()}`
      await connection.db.insert(schema.workflowConversations).values({
        id: historicConversationId, organisationId: actor.organisation.id, workflowSessionId: workflowId, pouId: 'whakapapa', startedByUserId: actor.id,
        provider: 'elevenlabs', providerConversationId: historicProviderConversationId, providerAgentReference: 'agent-test', providerBranchReference: 'branch-test', providerEnvironment: 'test',
        conversationSpecificationCode: 'whakapapa-reflection', conversationSpecificationVersion: 1, status: 'ended', startIdempotencyKey: randomUUID(), requestFingerprint: 'historic-whakapapa-v01', authorizedAt: new Date('2026-08-12T00:00:02.000Z'), endedAt: new Date('2026-08-12T00:00:02.000Z'), terminationReason: 'user_ended',
      })
      await connection.db.insert(schema.workflowConversationPouSpecificationPins).values({
        workflowConversationId: historicConversationId, organisationId: actor.organisation.id, workflowSessionId: workflowId, pouId: 'whakapapa', specificationId: storedOrganisationSpecification.id, specificationHash: contentHash(organisationSpecification),
        conversationGuidanceProjectionId: storedHistoricGuidance!.id, conversationGuidanceProjectionHash: contentHash(historicGuidance), pouReviewProjectionId: storedHistoricReview!.id, pouReviewProjectionHash: contentHash(historicReview),
        specificationSnapshot: organisationSpecification, conversationGuidanceProjectionSnapshot: historicGuidance, pouReviewProjectionSnapshot: historicReview,
      })
      const [historicRun] = await connection.db.insert(schema.conversationSafetyAssessmentRuns).values({
        workflowConversationId: historicConversationId, organisationId: actor.organisation.id, workflowSessionId: workflowId, pouId: 'whakapapa', specificationId: storedSpec.id, specificationCode: specification.specificationCode, specificationVersion: specification.specificationVersion, specificationHash: contentHash(specification), ruleManifestHash: contentHash(projection.rules), projectionId: storedProjection.id, projectionCode: storedProjection.projectionCode, projectionVersion: storedProjection.projectionVersion, projectionHash: storedProjection.projectionHash, provider: 'elevenlabs', providerAgentReference: 'agent-test', providerBranchReference: 'branch-test', providerEnvironment: 'test', specificationSnapshot: specification, projectionSnapshot: projection,
      }).returning()
      await expect(repository.resolveActivePinForConversation({ providerConversationId: historicProviderConversationId, agentReference: 'agent-test', branchReference: 'branch-test', environment: 'test' })).resolves.toMatchObject({ runId: historicRun!.id, workflowConversationId: historicConversationId, pouId: 'whakapapa' })
    })
  }, 15_000)

  it('completes a real PostgreSQL ingestion for an approved Manaakitanga empty safety manifest', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, repository }) => {
      const now = new Date('2026-08-14T00:00:00.000Z')
      const draft = PHASE_5D_DRAFT_POU_SPECIFICATIONS.find((specification) => specification.pouId === 'manaakitanga')
      if (!draft) throw new Error('Expected the reviewed Manaakitanga draft specification.')
      const approval = { approvedForPilotBy: actor.id, approvedForPilotAt: now.toISOString() }
      const safetySpecification = safetySpecificationFromRegistry(`${draft.specificationCode}_SAFETY`, draft.specificationVersion, approval)
      await new SafetyProvisioningService(connection.db, () => now).provisionAndActivate({
        organisationId: actor.organisation.id, operatorUserId: actor.id, specification: safetySpecification,
        projection: { projectionCode: `mana-safety-${randomUUID()}`, projectionVersion: '1' },
        conversationProvider: { provider: 'elevenlabs', agentReference: 'agent-test', branchReference: 'branch-test', environment: 'test' },
      })
      const organisationSpecification = organisationPouSpecificationFromRegistry(draft.specificationCode, draft.specificationVersion, approval)
      await new OrganisationPouSpecificationProvisioningService(connection.db, () => now).provisionAndActivate({
        organisationId: actor.organisation.id, operatorUserId: actor.id, specification: organisationSpecification,
        guidanceProjection: { projectionCode: `mana-guidance-${randomUUID()}`, projectionVersion: '1' },
        reviewProjection: { projectionCode: `mana-review-${randomUUID()}`, projectionVersion: '1' },
      })
      const safetyPin = await repository.resolveActivePin(actor.organisation.id, 'manaakitanga', { provider: 'elevenlabs', agentReference: 'agent-test', branchReference: 'branch-test', environment: 'test' })
      if (!safetyPin) throw new Error('Expected the active Manaakitanga safety pin.')
      expect(safetyPin.projection.rules).toEqual([])
      await expect(new PostgresOrganisationPouSpecificationRepository(connection.db).resolveActivePin(actor.organisation.id, 'manaakitanga', safetyPin)).resolves.toMatchObject({ specification: { pouId: 'manaakitanga' } })

      const conversationId = randomUUID()
      const providerConversationId = `provider-${randomUUID()}`
      await connection.db.insert(schema.workflowConversations).values({
        id: conversationId, organisationId: actor.organisation.id, workflowSessionId: workflowId, pouId: 'manaakitanga', startedByUserId: actor.id,
        provider: 'elevenlabs', providerConversationId, providerAgentReference: 'agent-test', providerBranchReference: 'branch-test', providerEnvironment: 'test',
        conversationSpecificationCode: 'te-waharoa-pou-reflection', conversationSpecificationVersion: 1, status: 'ended', startIdempotencyKey: randomUUID(), requestFingerprint: 'empty-manifest', authorizedAt: now, endedAt: now, terminationReason: 'user_ended',
      })
      await connection.db.transaction((tx: SafetyTransaction) => repository.createRun(tx, { id: conversationId, organisationId: actor.organisation.id, workflowSessionId: workflowId, pouId: 'manaakitanga', provider: 'elevenlabs', providerAgentReference: 'agent-test', providerBranchReference: 'branch-test', providerEnvironment: 'test' }, safetyPin))
      const [run] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.workflowConversationId, conversationId))
      if (!run) throw new Error('Expected a Manaakitanga assessment run.')
      const turnId = randomUUID()
      const transcript = await new PostgresTranscriptRepository(connection.db, () => now).retainForConversation({
        organisationId: actor.organisation.id, workflowSessionId: workflowId, pouId: 'manaakitanga', workflowConversationId: conversationId, provider: 'elevenlabs', providerConversationId,
        turns: [{ id: turnId, ordinal: 1, speaker: 'kaimahi', text: 'Synthetic Manaakitanga reflection.', providerSequence: null, providerTimestamp: null }],
      })
      const deliveryId = `delivery-${randomUUID()}`
      await expect(repository.reserveDelivery({ provider: 'elevenlabs', deliveryId, payloadHash: 'a'.repeat(64), assessmentRunId: run.id })).resolves.toMatchObject({ reserved: true })
      await expect(repository.ingest({
        deliveryProvider: 'elevenlabs', deliveryId, payloadHash: 'a'.repeat(64), providerConversationId,
        agentReference: 'agent-test', branchReference: 'branch-test', environment: 'test', transcriptId: transcript.transcriptId, transcriptReceivedAt: now, assessments: [],
      })).resolves.toEqual({ replayed: false, superseded: false })
      const [storedRun] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))
      const deliveries = await connection.db.select().from(schema.providerAssessmentDeliveries).where(eq(schema.providerAssessmentDeliveries.assessmentRunId, run.id))
      const assessments = await connection.db.select().from(schema.conversationProviderRuleAssessments).where(eq(schema.conversationProviderRuleAssessments.assessmentRunId, run.id))
      expect(storedRun).toMatchObject({ status: 'received' })
      expect(deliveries).toMatchObject([{ status: 'completed' }])
      expect(assessments).toEqual([])
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
      const active = await repository.resolveActivePin(actor.organisation.id, 'whakapapa', { provider: 'elevenlabs', agentReference: 'agent-test', branchReference: 'branch-test', environment: 'test' })
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
        expect(await canonicalSnapshot()).toMatchObject({ session: { version: 3, stage: 'pou-convo', pou: 'manaakitanga' }, checkpoint: { progress: 'confirmed', concern: null }, counts: { workflowInteractions: 1, workflowSafetyObservations: 0, workflowSafetyObservationRevisions: 0, workflowSafetyRuleEvaluations: 0, workflowSafetyConsequences: 0, workflowActions: 0, workflowReferrals: 0, workflowSupervisorReviewRequests: 0 } })
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
      const assessments = projection.rules.map((rule: any, index: number) => ({ ruleCode: rule.ruleCode, ruleVersion: rule.ruleVersion, outcome: index === 0 ? 'possible_concern' as const : 'no_candidate_concern' as const, candidateConcernLevel: null, matchedProtectiveIndicatorCodes: index === 0 ? [] : [rule.protectiveIndicators[0]!.code], matchedConcernIndicatorCodes: index === 0 ? [rule.concernIndicators[0]!.code] : [], missingInformationCodes: [], uncertaintyReasonCodes: [], applicabilityReasonCode: null, evidenceTurnIds: [foreign.turns[0]!.id] }))
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

  it('blocks direct Pou confirmation for an unresolved possible concern without changing canonical state, then permits the explicit dismissal path', async () => {
    await withPhase5BTestContext(async ({ actor, workflowId, repository, workflowRepository, payload, request, canonicalSnapshot, connection, run }) => {
      const confirmationRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-12T00:00:00.000Z'), undefined, repository)
      expect((await request(payload())).statusCode).toBe(202)
      const [candidate] = await repository.listReviewable(actor, workflowId)
      const before = await canonicalSnapshot()

      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2) })).rejects.toBeInstanceOf(UnresolvedSafetyCandidateError)
      expect(await canonicalSnapshot()).toEqual(before)
      expect(await repository.listReviewable(actor, workflowId)).toHaveLength(1)
      expect((await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id)))[0]).toMatchObject({ status: 'received' })

      await repository.acknowledge(actor, workflowId, candidate!.id, 'dismissed')
      await expect(confirmationRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2) })).resolves.toMatchObject({ workflow: { currentPouId: 'manaakitanga' } })
      expect((await connection.db.select().from(schema.workflowSafetyObservations))).toHaveLength(0)
    })
  })

  it('permits Pou confirmation only after an explicit possible-concern confirmation', async () => {
    await withPhase5BTestContext(async ({ actor, workflowId, repository, workflowRepository, payload, request, connection }) => {
      const confirmationRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-12T00:00:00.000Z'), undefined, repository)
      expect((await request(payload())).statusCode).toBe(202)
      const [candidate] = await repository.listReviewable(actor, workflowId)
      await workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: candidateConfirmationCommand(candidate!.id, 2) })

      await expect(confirmationRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(3) })).resolves.toMatchObject({ workflow: { currentPouId: 'manaakitanga' } })
      expect(await connection.db.select().from(schema.workflowSafetyObservations)).toHaveLength(1)
    })
  })

  it('blocks insufficient information until it is explicitly acknowledged, without creating a safety observation', async () => {
    await withPhase5BTestContext(async ({ actor, workflowId, repository, workflowRepository, payload, request, canonicalSnapshot, connection }) => {
      const confirmationRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-12T00:00:00.000Z'), undefined, repository)
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:insufficient]' }))).statusCode).toBe(202)
      const [candidate] = await repository.listReviewable(actor, workflowId)
      const before = await canonicalSnapshot()

      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2) })).rejects.toBeInstanceOf(UnresolvedSafetyCandidateError)
      expect(await canonicalSnapshot()).toEqual(before)
      await repository.acknowledge(actor, workflowId, candidate!.id, 'insufficient_information_acknowledged')
      await expect(confirmationRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2) })).resolves.toMatchObject({ workflow: { currentPouId: 'manaakitanga' } })
      expect(await connection.db.select().from(schema.workflowSafetyObservations)).toHaveLength(0)
      expect(await connection.db.select().from(schema.providerAssessmentReviews)).toMatchObject([{ status: 'insufficient_information_acknowledged', canonicalObservationId: null }])
    })
  })

  it('allows no-candidate outcomes to continue without an unnecessary human safety review', async () => {
    await withPhase5BTestContext(async ({ actor, workflowId, repository, connection, payload, request }) => {
      const confirmationRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-12T00:00:00.000Z'), undefined, repository)
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:all-no-concern]' }))).statusCode).toBe(202)
      expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0)
      await expect(confirmationRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2) })).resolves.toMatchObject({ workflow: { currentPouId: 'manaakitanga' } })
    })
  }, 15_000)

  it('requires every reviewable assessment to resolve and preserves the invariant when acknowledgement races confirmation', async () => {
    await withPhase5BTestContext(async ({ actor, workflowId, repository, workflowRepository, payload, request, connection }) => {
      const directConfirmation = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-12T00:00:00.000Z'), undefined, repository)
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:multiple]' }))).statusCode).toBe(202)
      const candidates = await repository.listReviewable(actor, workflowId)
      expect(candidates).toHaveLength(2)
      await repository.acknowledge(actor, workflowId, candidates[0]!.id, 'dismissed')
      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2) })).rejects.toBeInstanceOf(UnresolvedSafetyCandidateError)

      const acknowledgementConnection = createDatabaseConnection(getTestDatabaseUrl())
      const confirmationConnection = createDatabaseConnection(getTestDatabaseUrl())
      try {
        const acknowledgement = new PostgresSafetyAssessmentRepository(acknowledgementConnection.db, () => new Date('2026-08-12T00:00:00.000Z'))
        const confirmation = new PostgresWorkflowRepository(confirmationConnection.db, () => new Date('2026-08-12T00:00:00.000Z'), undefined, new PostgresSafetyAssessmentRepository(confirmationConnection.db, () => new Date('2026-08-12T00:00:00.000Z')))
        const outcomes = await Promise.allSettled([
          acknowledgement.acknowledge(actor, workflowId, candidates[1]!.id, 'dismissed'),
          confirmation.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2) }),
        ])
        // If acknowledgement wins the lock, confirmation can legitimately
        // follow it.  If confirmation wins, it must reject and leave the
        // candidate reviewable until acknowledgement commits.
        expect(outcomes[0]!.status).toBe('fulfilled')
        expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0)
        const [workflow] = await connection.db.select().from(schema.workflowSessions).where(eq(schema.workflowSessions.id, workflowId))
        if (workflow!.currentPouId === 'whakapapa') {
          await expect(directConfirmation.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(workflow!.version) })).resolves.toMatchObject({ workflow: { currentPouId: 'manaakitanga' } })
        }
        const [confirmedWorkflow] = await connection.db.select().from(schema.workflowSessions).where(eq(schema.workflowSessions.id, workflowId))
        expect(confirmedWorkflow).toMatchObject({ currentPouId: 'manaakitanga' })
        expect(await connection.db.select().from(schema.workflowSafetyObservations)).toHaveLength(0)
      } finally {
        await Promise.all([acknowledgementConnection.close(), confirmationConnection.close()])
      }
    })
  })

  it('requires both a possible concern and insufficient information to resolve before continuation', async () => {
    await withPhase5BTestContext(async ({ actor, workflowId, repository, workflowRepository, payload, request, canonicalSnapshot, connection }) => {
      const confirmationRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-12T00:00:00.000Z'), undefined, repository)
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:mixed]' }))).statusCode).toBe(202)
      const candidates = await repository.listReviewable(actor, workflowId)
      expect(candidates.map((candidate: { outcome: string }) => candidate.outcome).sort()).toEqual(['insufficient_information', 'possible_concern'])
      const possibleConcern = candidates.find((candidate: { outcome: string }) => candidate.outcome === 'possible_concern')!
      const insufficientInformation = candidates.find((candidate: { outcome: string }) => candidate.outcome === 'insufficient_information')!
      const before = await canonicalSnapshot()

      await repository.acknowledge(actor, workflowId, possibleConcern.id, 'dismissed')
      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2) })).rejects.toBeInstanceOf(UnresolvedSafetyCandidateError)
      expect(await canonicalSnapshot()).toEqual(before)
      await repository.acknowledge(actor, workflowId, insufficientInformation.id, 'insufficient_information_acknowledged')
      await expect(confirmationRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2) })).resolves.toMatchObject({ workflow: { currentPouId: 'manaakitanga' } })
      expect(await connection.db.select().from(schema.workflowSafetyObservations)).toHaveLength(0)
    })
  })

  it('keeps a second possible concern reviewable after the first is confirmed', async () => {
    await withPhase5BTestContext(async ({ actor, workflowId, repository, workflowRepository, payload, request, canonicalSnapshot, connection }) => {
      const confirmationRepository = new PostgresWorkflowRepository(connection.db, () => new Date('2026-08-12T00:00:00.000Z'), undefined, repository)
      expect((await request(payload({ transcript: 'Synthetic Whakapapa reflection [scenario:multiple]' }))).statusCode).toBe(202)
      const candidates = await repository.listReviewable(actor, workflowId)
      expect(candidates).toHaveLength(2)
      const confirmedCandidate = candidates[0]!
      const remainingCandidate = candidates[1]!

      await workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: candidateConfirmationCommand(confirmedCandidate.id, 2) })
      expect(await connection.db.select().from(schema.workflowSafetyObservations)).toHaveLength(1)
      expect(await repository.listReviewable(actor, workflowId)).toMatchObject([{ id: remainingCandidate.id, outcome: 'possible_concern' }])
      const afterFirstConfirmation = await canonicalSnapshot()
      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(3) })).rejects.toBeInstanceOf(UnresolvedSafetyCandidateError)
      expect(await canonicalSnapshot()).toEqual(afterFirstConfirmation)

      await repository.acknowledge(actor, workflowId, remainingCandidate.id, 'dismissed')
      await expect(confirmationRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(3) })).resolves.toMatchObject({ workflow: { currentPouId: 'manaakitanga' } })
    })
  })

  it('5. no-candidate-concern is persisted but cannot confirm canonical safety', async () => {
    await withPhase5BTestContext(async ({ actor, workflowId, repository, payload, request, canonicalSnapshot, connection }) => {
      const raw = payload({ transcript: 'Synthetic Whakapapa reflection [scenario:no-concern]' })
      const before = await canonicalSnapshot(); expect((await request(raw)).statusCode).toBe(202)
      const [stored] = await connection.db.select().from(schema.conversationProviderRuleAssessments); expect(stored).toMatchObject({ outcome: 'no_candidate_concern', candidateConcernLevel: null })
      expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0)
      await expect(repository.prepareConfirmation(connection.db as any, actor, workflowId, stored!.id, 'whakapapa', 'practice_quality', 'low')).rejects.toThrow()
      expect(await canonicalSnapshot()).toEqual(before)
    })
  })

  it('6. not-applicable is noncanonical', async () => {
    await withPhase5BTestContext(async ({ actor, workflowId, repository, payload, request, canonicalSnapshot, connection }) => {
      const raw = payload({ transcript: 'Synthetic Whakapapa reflection [scenario:not-applicable]' })
      const before = await canonicalSnapshot(); expect((await request(raw)).statusCode).toBe(202)
      const stored = (await connection.db.select().from(schema.conversationProviderRuleAssessments)).find((assessment: typeof schema.conversationProviderRuleAssessments.$inferSelect) => assessment.ruleCode === 'WHAKAPAPA_CULTURAL_DISTRESS_003'); expect(stored).toMatchObject({ outcome: 'not_applicable', applicabilityReasonCode: 'no_explicit_cultural_identity_distress', candidateConcernLevel: null })
      await expect(repository.prepareConfirmation(connection.db as any, actor, workflowId, stored!.id, 'whakapapa', 'practice_quality', 'low')).rejects.toThrow()
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

  it('12B. ordinary Whakapapa Pou confirmation supersedes an explicitly dismissed candidate without creating candidate-derived canonical state', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, run, repository, reviewDraftRepository, workflowRepository, payload, request, canonicalSnapshot }) => {
      expect((await request(payload())).statusCode).toBe(202)
      const [candidate] = await repository.listReviewable(actor, workflowId)
      await repository.acknowledge(actor, workflowId, candidate!.id, 'dismissed')
      const before = await canonicalSnapshot()
      const draft = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      const confirmed = await workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2, draft.draft!.revisionId) })
      const [supersededRun] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))
      const after = await canonicalSnapshot()

      expect(confirmed.workflow).toMatchObject({ version: 3, currentStage: 'pou-convo', currentPouId: 'manaakitanga' })
      expect(supersededRun).toMatchObject({ status: 'superseded' })
      expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0)
      await expect(repository.acknowledge(actor, workflowId, candidate!.id, 'dismissed')).rejects.toThrow()
      expect(after).toMatchObject({ session: { version: 3, stage: 'pou-convo', pou: 'manaakitanga' }, checkpoint: { progress: 'confirmed', concern: null }, counts: { ...before.counts, workflowInteractions: before.counts.workflowInteractions + 1, workflowSafetyObservations: 0, workflowSafetyObservationRevisions: 0, workflowSafetyRuleEvaluations: 0, workflowSafetyConsequences: 0, workflowActions: 0, workflowReferrals: 0, workflowSupervisorReviewRequests: 0 } })
    })
  })

  it('12C. late provider delivery and direct stale-ID confirmation cannot resurrect a Pou-confirmed run after explicit candidate dismissal', async () => {
    await withPhase5BTestContext(async ({ connection, actor, workflowId, run, repository, reviewDraftRepository, workflowRepository, payload, request, canonicalSnapshot }) => {
      expect((await request(payload())).statusCode).toBe(202)
      const [retainedBeforeConfirmation] = await connection.db.select().from(schema.conversationTranscripts)
      const [retainedTurnBeforeConfirmation] = await connection.db.select().from(schema.conversationTranscriptTurns)
      const [candidate] = await repository.listReviewable(actor, workflowId)
      await repository.acknowledge(actor, workflowId, candidate!.id, 'dismissed')
      const draft = await reviewDraftRepository.findForKaimahi(actor, workflowId)
      await workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: pouReviewCommand(2, draft.draft!.revisionId) })
      const afterPouConfirmation = await canonicalSnapshot()
      const beforeDeliveries = await connection.db.select().from(schema.providerAssessmentDeliveries).where(eq(schema.providerAssessmentDeliveries.assessmentRunId, run.id))
      const late = await request(payload())
      const afterDeliveries = await connection.db.select().from(schema.providerAssessmentDeliveries).where(eq(schema.providerAssessmentDeliveries.assessmentRunId, run.id))
      const retainedAfterLateDelivery = await connection.db.select().from(schema.conversationTranscripts)
      const retainedTurnsAfterLateDelivery = await connection.db.select().from(schema.conversationTranscriptTurns)
      const [supersededRun] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))

      expect(late.statusCode).toBe(202)
      expect(late.json()).toMatchObject({ accepted: true, replayed: false, superseded: true })
      expect(afterDeliveries).toHaveLength(beforeDeliveries.length + 1)
      expect(retainedAfterLateDelivery).toEqual([retainedBeforeConfirmation])
      expect(retainedTurnsAfterLateDelivery).toEqual([retainedTurnBeforeConfirmation])
      expect(supersededRun).toMatchObject({ status: 'superseded' })
      expect(await repository.listReviewable(actor, workflowId)).toHaveLength(0)
      await expect(workflowRepository.submitCommand({ actor, workflowSessionId: workflowId, command: candidateConfirmationCommand(candidate!.id, 3) })).rejects.toThrow()
      await expect(repository.acknowledge(actor, workflowId, candidate!.id, 'dismissed')).rejects.toThrow()
      expect(await canonicalSnapshot()).toEqual(afterPouConfirmation)
      expect(await connection.db.select().from(schema.providerAssessmentReviews)).toMatchObject([{ status: 'dismissed', canonicalObservationId: null }])
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
        expect(await canonicalSnapshot()).toMatchObject({ session: { version: 3, stage: 'pou-convo', pou: 'manaakitanga' }, checkpoint: { progress: 'confirmed', concern: null }, counts: { workflowInteractions: 1, workflowSafetyObservations: 0, workflowSafetyObservationRevisions: 0, workflowSafetyRuleEvaluations: 0, workflowSafetyConsequences: 0, workflowActions: 0, workflowReferrals: 0, workflowSupervisorReviewRequests: 0 } })
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
      const [receivedRun] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))

      expect(confirmed.workflow).toMatchObject({ version: 3, currentStage: 'pou-overview', currentPouId: 'whakapapa' })
      expect(observation).toMatchObject({ assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'practice_quality', concernLevel: 'low', status: 'active' })
      expect(review).toMatchObject({ status: 'confirmed', classificationSource: 'human_selected', canonicalObservationId: observation!.id })
      expect(receivedRun).toMatchObject({ status: 'received' })
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
