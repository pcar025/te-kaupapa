import { createHmac, randomUUID } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'

import { createApplication } from '../app.js'
import type { AppConfiguration } from '../config.js'
import type { AuthRepository, DatabaseConnection } from '../db/repository.js'
import * as schema from '../db/schema.js'
import { withMigratedTestDatabase } from '../db/test-harness.js'
import type { AuthenticatedUser } from '../domain/auth.js'
import { approvedWhakapapaPilotV01, contentHash, providerProjection, type ProviderRuleAssessment } from './domain.js'
import { PostgresSafetyAssessmentRepository } from './repository.js'
import { PostgresTranscriptRepository } from '../transcripts/repository.js'
import { PostgresWorkflowRepository } from '../workflows/repository.js'
import { PostgresConversationReviewDraftRepository } from '../review-drafts/repository.js'

const now = new Date('2026-08-12T00:00:00.000Z')
const secret = 'integration-webhook-secret-with-sufficient-length'
const auth: AuthRepository = { findUserByExternalIdentity: async () => null, createSession: async () => {}, findUserBySessionHash: async () => null, touchSession: async () => {}, invalidateSession: async () => {}, isSupervisorOf: async () => false }
const configuration: AppConfiguration = { nodeEnv: 'test', port: 3011, host: '127.0.0.1', databaseUrl: 'postgresql://localhost/te_kaupapa_m2_test', appOrigin: 'http://api.test', frontendOrigin: 'http://web.test', allowedOrigins: ['http://api.test', 'http://web.test'], cookieName: 'test', cookieSigningSecret: 'a-test-cookie-secret-that-is-long-enough', sessionTtlHours: 12, sessionIdleTimeoutMinutes: 60, elevenlabsWebhook: { signingSecret: secret, maximumAgeSeconds: 300, maximumBodyBytes: 131072 } }

function specification(approver: string) {
  return { ...approvedWhakapapaPilotV01({ approvedForPilotBy: approver, approvedForPilotAt: now.toISOString() }), specificationCode: `fixture-${randomUUID()}`, specificationVersion: '1.0' }
}

export async function canonicalSnapshot(db: any, workflowId: string) {
  const count = async (query: ReturnType<typeof sql>) => Number((await db.execute(query)).rows[0]?.count ?? 0)
  const [workflowInteractions, workflowSafetyObservations, workflowSafetyObservationRevisions, workflowSafetyRuleEvaluations, workflowSafetyConsequences, workflowActions, workflowReferrals, workflowSupervisorReviewRequests] = await Promise.all([count(sql`select count(*)::int as count from workflow_interaction where workflow_session_id = ${workflowId}`), count(sql`select count(*)::int as count from workflow_safety_observation where workflow_session_id = ${workflowId}`), count(sql`select count(*)::int as count from workflow_safety_observation_revision where workflow_session_id = ${workflowId}`), count(sql`select count(*)::int as count from workflow_safety_rule_evaluation e join workflow_safety_observation_revision r on r.observation_id=e.observation_id and r.revision=e.observation_revision where r.workflow_session_id=${workflowId}`), count(sql`select count(*)::int as count from workflow_safety_consequence c join workflow_safety_observation o on o.id=c.observation_id where o.workflow_session_id=${workflowId}`), count(sql`select count(*)::int as count from workflow_action where workflow_session_id=${workflowId}`), count(sql`select count(*)::int as count from workflow_referral where workflow_session_id=${workflowId}`), count(sql`select count(*)::int as count from workflow_supervisor_review_request where workflow_session_id=${workflowId}`)])
  const [session] = await db.select().from(schema.workflowSessions).where(eq(schema.workflowSessions.id, workflowId)).limit(1)
  const [checkpoint] = await db.select().from(schema.workflowPouCheckpoints).where(and(eq(schema.workflowPouCheckpoints.workflowSessionId, workflowId), eq(schema.workflowPouCheckpoints.pouId, 'whakapapa'))).limit(1)
  return { session: session && { version: session.version, status: session.status, stage: session.currentStage, pou: session.currentPouId }, checkpoint: checkpoint && { progress: checkpoint.progress, concern: checkpoint.userSelectedConcern, confirmedAt: checkpoint.confirmedAt }, counts: { workflowInteractions, workflowSafetyObservations, workflowSafetyObservationRevisions, workflowSafetyRuleEvaluations, workflowSafetyConsequences, workflowActions, workflowReferrals, workflowSupervisorReviewRequests } }
}

export async function withPhase5BTestContext<T>(body: (context: any) => Promise<T>): Promise<T> {
  const organisationId = randomUUID(); const userId = randomUUID(); const workflowId = randomUUID(); const conversationId = randomUUID(); const providerConversationId = `provider-${randomUUID()}`
  const actor: AuthenticatedUser = { id: userId, displayName: 'Fixture Kaimahi', status: 'active', organisation: { id: organisationId, slug: `safety-${organisationId}`, name: 'Safety fixture' }, roles: ['KAIMAHI'] }
  return withMigratedTestDatabase(async (connection: DatabaseConnection) => {
    const spec = specification(userId); const projection = providerProjection(spec, { projectionCode: `projection-${randomUUID()}`, projectionVersion: '1' }); const specHash = contentHash(spec); const projectionHash = contentHash(projection)
    await connection.db.insert(schema.organisations).values({ id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name }); await connection.db.insert(schema.appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName }); await connection.db.insert(schema.workflowSessions).values({ id: workflowId, organisationId, kaimahiUserId: userId, reference: `TK-${workflowId.slice(0, 8)}`, status: 'in_progress', currentStage: 'pou-overview', currentPouId: 'whakapapa', version: 2 }); await connection.db.insert(schema.workflowPouCheckpoints).values({ workflowSessionId: workflowId, organisationId, pouId: 'whakapapa', ordinal: 1 })
    const [storedSpec] = await connection.db.insert(schema.safetySpecificationVersions).values({ organisationId, specificationCode: spec.specificationCode, specificationVersion: spec.specificationVersion, pouId: 'whakapapa', approvalStatus: spec.approvalStatus, contentHash: specHash, ruleManifestHash: contentHash(projection.rules), specification: spec, sourceDocumentCode: spec.sourceDocumentCode, sourceDocumentStatus: spec.sourceDocumentStatus, sourceReference: spec.sourceReference, sourceDocumentHash: spec.sourceDocumentHash, derivedAt: now, approvedForPilotBy: userId, approvedForPilotAt: now }).returning(); const [storedProjection] = await connection.db.insert(schema.providerAssessmentProjections).values({ organisationId, pouId: 'whakapapa', specificationId: storedSpec!.id, projectionCode: projection.projectionCode, projectionVersion: projection.projectionVersion, projectionHash, provider: 'elevenlabs', providerAgentReference: 'agent-test', providerBranchReference: 'branch-test', providerEnvironment: 'test', projection }).returning()
    await connection.db.insert(schema.workflowConversations).values({ id: conversationId, organisationId, workflowSessionId: workflowId, pouId: 'whakapapa', startedByUserId: userId, provider: 'elevenlabs', providerConversationId, providerAgentReference: 'agent-test', providerBranchReference: 'branch-test', providerEnvironment: 'test', conversationSpecificationCode: 'whakapapa-reflection', conversationSpecificationVersion: 1, status: 'ended', startIdempotencyKey: randomUUID(), requestFingerprint: 'fixture', authorizedAt: now, endedAt: now, terminationReason: 'user_ended' })
    const [run] = await connection.db.insert(schema.conversationSafetyAssessmentRuns).values({ workflowConversationId: conversationId, organisationId, workflowSessionId: workflowId, pouId: 'whakapapa', specificationId: storedSpec!.id, specificationCode: spec.specificationCode, specificationVersion: spec.specificationVersion, specificationHash: specHash, ruleManifestHash: contentHash(projection.rules), projectionId: storedProjection!.id, projectionCode: projection.projectionCode, projectionVersion: projection.projectionVersion, projectionHash, provider: 'elevenlabs', providerAgentReference: 'agent-test', providerBranchReference: 'branch-test', providerEnvironment: 'test', specificationSnapshot: spec, projectionSnapshot: projection }).returning()
    const repository = new PostgresSafetyAssessmentRepository(connection.db, () => now); const transcriptRepository = new PostgresTranscriptRepository(connection.db, () => now); const reviewDraftRepository = new PostgresConversationReviewDraftRepository(connection.db, () => now); const workflowRepository = new PostgresWorkflowRepository(connection.db, () => now, undefined, repository, reviewDraftRepository)
    let assessmentCalls = 0
    const assessmentResult = (evidenceTurnId: string) => ({ assessments: projection.rules.map((rule, index): ProviderRuleAssessment => ({ ruleCode: rule.ruleCode, ruleVersion: rule.ruleVersion, outcome: index === 0 ? 'possible_concern' : 'no_candidate_concern', candidateConcernLevel: null, matchedProtectiveIndicatorCodes: [], matchedConcernIndicatorCodes: index === 0 ? [rule.concernIndicators[0]!.code] : [], missingInformationCodes: [], uncertaintyReasonCodes: [], applicabilityReasonCode: null, evidenceTurnIds: index === 0 ? [evidenceTurnId] : [] })) })
    const conversationAssessmentProvider = {
      assessPouConversation: async ({ transcriptTurns }: { transcriptTurns: Array<{ id: string; text: string }> }) => {
        assessmentCalls += 1
        const transientTranscript = transcriptTurns.map((turn) => turn.text).join('\n')
        if (!transientTranscript.startsWith('Synthetic Whakapapa reflection')) throw new Error('Expected ordinary synthetic transcript input.')
        let assessment = assessmentResult(transcriptTurns[0]!.id)
        if (transientTranscript.includes('[scenario:insufficient]')) assessment = { assessments: assessment.assessments.map((item, index) => index === 0 ? { ...item, outcome: 'insufficient_information', matchedConcernIndicatorCodes: [], missingInformationCodes: ['identity_or_whanau_context'] } : item) }
        if (transientTranscript.includes('[scenario:no-concern]')) assessment = { assessments: assessment.assessments.map((item, index) => index === 0 ? { ...item, outcome: 'no_candidate_concern', matchedConcernIndicatorCodes: [], evidenceTurnIds: [] } : item) }
        if (transientTranscript.includes('[scenario:not-applicable]')) assessment = { assessments: assessment.assessments.map((item) => item.ruleCode === 'WHAKAPAPA_CULTURAL_DISTRESS_003' ? { ...item, outcome: 'not_applicable', matchedConcernIndicatorCodes: [], applicabilityReasonCode: 'no_explicit_cultural_identity_distress', evidenceTurnIds: [] } : item) }
        if (transientTranscript.includes('[scenario:partial]')) assessment = { assessments: assessment.assessments.slice(1) }
        return { assessment, provider: 'test-assessment-provider', model: 'test-assessment-model', configurationHash: 'a'.repeat(64), schemaVersion: '1', assessmentStartedAt: now, assessmentCompletedAt: now }
      },
    }
    const conversationReviewDraftProvider = {
      generateWhakapapaReviewDraft: async ({ transcriptTurns }: { transcriptTurns: Array<{ id: string; text: string }> }) => ({ draft: { overallSummary: 'Synthetic Whakapapa review draft.', strengthsSummary: transcriptTurns[0]?.text.includes('strength') ? 'A strength was explored.' : null, areasForAttentionSummary: transcriptTurns[0]?.text.includes('ambiguous') ? 'Further exploration may be useful.' : null, evidenceTurnIds: transcriptTurns.length ? [transcriptTurns[0]!.id] : [] }, provider: 'test-review-provider', model: 'test-review-model', configurationHash: 'b'.repeat(64), schemaVersion: '1', generatedAt: now }),
    }
    const app = await createApplication({ config: configuration, repository: auth, workflowRepository, safetyAssessmentRepository: repository, transcriptRepository, conversationAssessmentProvider, conversationReviewDraftProvider, reviewDraftRepository, now: () => now })
    const payload = (overrides: Record<string, unknown> = {}) => {
      return JSON.stringify({ type: 'post_call_transcription', event_id: `delivery-${randomUUID()}`, event_timestamp: Math.floor(now.getTime() / 1000), data: { conversation_id: providerConversationId, agent_id: 'agent-test', branch_id: 'branch-test', version_id: 'version-test', environment: 'test', transcript: 'Synthetic Whakapapa reflection with no identifiable content.', ...overrides } })
    }
    const request = (raw: string) => app.inject({ method: 'POST', url: '/api/integrations/elevenlabs/post-call', headers: { 'content-type': 'application/json', 'elevenlabs-signature': `t=${Math.floor(now.getTime() / 1000)},v0=${createHmac('sha256', secret).update(`${Math.floor(now.getTime() / 1000)}.${raw}`).digest('hex')}` }, payload: raw })
    try { return await body({ connection, app, actor, workflowId, conversationId, providerConversationId, specification: spec, projection, storedSpec, storedProjection, run, repository, transcriptRepository, reviewDraftRepository, workflowRepository, payload, request, assessmentCallCount: () => assessmentCalls, canonicalSnapshot: () => canonicalSnapshot(connection.db, workflowId) }) } finally { await app.close() }
  }, async (connection) => {
    const ids = sql`select id from organisation where slug like 'safety-%'`
    await connection.db.execute(sql`alter table safety_specification_version disable trigger safety_specification_version_immutable`)
    await connection.db.execute(sql`alter table provider_assessment_projection disable trigger provider_assessment_projection_immutable`)
    await connection.db.execute(sql`alter table conversation_review_draft disable trigger conversation_review_draft_immutable`)
    await connection.db.execute(sql`alter table conversation_review_draft_revision disable trigger conversation_review_draft_revision_immutable`)
    await connection.db.execute(sql`alter table workflow_pou_review disable trigger workflow_pou_review_immutable`)
    try {
      await connection.db.execute(sql`delete from workflow_pou_review where organisation_id in (${ids})`)
      await connection.db.execute(sql`delete from conversation_review_draft_view where review_draft_id in (select id from conversation_review_draft where organisation_id in (${ids}))`)
      await connection.db.execute(sql`delete from conversation_review_draft_revision where review_draft_id in (select id from conversation_review_draft where organisation_id in (${ids}))`)
      await connection.db.execute(sql`delete from conversation_review_draft where organisation_id in (${ids})`)
      await connection.db.execute(sql`delete from provider_assessment_review where organisation_id in (${ids})`)
      await connection.db.execute(sql`delete from conversation_provider_rule_assessment where assessment_run_id in (select id from conversation_safety_assessment_run where organisation_id in (${ids}))`)
      await connection.db.execute(sql`delete from provider_assessment_delivery where assessment_run_id in (select id from conversation_safety_assessment_run where organisation_id in (${ids}))`)
      await connection.db.execute(sql`delete from conversation_safety_assessment_run where organisation_id in (${ids})`)
      await connection.db.execute(sql`delete from conversation_transcript_turn where transcript_id in (select id from conversation_transcript where organisation_id in (${ids}))`)
      await connection.db.execute(sql`delete from conversation_transcript where organisation_id in (${ids})`)
      await connection.db.execute(sql`delete from safety_specification_activation where organisation_id in (${ids})`)
      await connection.db.execute(sql`delete from provider_assessment_projection where organisation_id in (${ids})`)
      await connection.db.execute(sql`delete from safety_specification_version where organisation_id in (${ids})`)
      await connection.db.execute(sql`delete from workflow_safety_consequence where observation_id in (select id from workflow_safety_observation where organisation_id in (${ids}))`)
      await connection.db.execute(sql`delete from workflow_safety_rule_evaluation where observation_id in (select id from workflow_safety_observation where organisation_id in (${ids}))`)
      await connection.db.execute(sql`delete from workflow_safety_observation_revision where observation_id in (select id from workflow_safety_observation where organisation_id in (${ids}))`)
      await connection.db.execute(sql`delete from workflow_safety_observation where organisation_id in (${ids})`)
      await connection.db.execute(sql`delete from workflow_interaction where organisation_id in (${ids})`)
      await connection.db.execute(sql`delete from workflow_conversation where organisation_id in (${ids})`)
      await connection.db.execute(sql`delete from workflow_pou_checkpoint where organisation_id in (${ids})`)
      await connection.db.execute(sql`delete from workflow_session where organisation_id in (${ids})`)
      await connection.db.execute(sql`delete from app_user where organisation_id in (${ids})`)
      await connection.db.execute(sql`delete from organisation where slug like 'safety-%'`)
    } finally {
      await connection.db.execute(sql`alter table safety_specification_version enable trigger safety_specification_version_immutable`)
      await connection.db.execute(sql`alter table provider_assessment_projection enable trigger provider_assessment_projection_immutable`)
      await connection.db.execute(sql`alter table conversation_review_draft enable trigger conversation_review_draft_immutable`)
      await connection.db.execute(sql`alter table conversation_review_draft_revision enable trigger conversation_review_draft_revision_immutable`)
      await connection.db.execute(sql`alter table workflow_pou_review enable trigger workflow_pou_review_immutable`)
    }
  })
}
