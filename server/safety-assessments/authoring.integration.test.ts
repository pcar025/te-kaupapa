import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as schema from '../db/schema.js'
import { withMigratedTestDatabase } from '../db/test-harness.js'
import type { DatabaseConnection } from '../db/repository.js'
import { AuthorizationError, type AuthenticatedUser } from '../domain/auth.js'
import { approvedWhakapapaOrganisationPouV01 } from '../pou-specifications/domain.js'
import { OrganisationPouSpecificationProvisioningService } from '../pou-specifications/provisioning.js'
import { PostgresOrganisationPouSpecificationRepository } from '../pou-specifications/repository.js'
import { PostgresConversationRepository } from '../conversations/repository.js'
import { PostgresTranscriptRepository } from '../transcripts/repository.js'
import { approvedWhakapapaPilotV01, validateProviderAssessmentSet } from './domain.js'
import { PostgresSafetyPolicyAuthoringService, safetyPolicyDraftContentSchema } from './authoring.js'
import { SafetyProvisioningService } from './provisioning.js'
import { PostgresSafetyAssessmentRepository } from './repository.js'

async function fixture(connection: DatabaseConnection) {
  const organisationId = randomUUID(); const userId = randomUUID(); const now = new Date('2026-08-19T01:00:00.000Z')
  await connection.db.insert(schema.organisations).values({ id: organisationId, slug: `safety-author-${organisationId}`, name: 'Safety author fixture' })
  await connection.db.insert(schema.appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: 'Supervisor editor' })
  const actor: AuthenticatedUser = { id: userId, displayName: 'Supervisor editor', status: 'active', organisation: { id: organisationId, slug: `safety-author-${organisationId}`, name: 'Safety author fixture' }, roles: ['SPECIFICATION_EDITOR', 'SUPERVISOR'] }
  const approval = { approvedForPilotBy: userId, approvedForPilotAt: now.toISOString() }
  await new SafetyProvisioningService(connection.db, () => now).provisionAndActivate({ organisationId, operatorUserId: userId, specification: approvedWhakapapaPilotV01(approval), projection: { projectionCode: 'fixture-safety', projectionVersion: '0.1' }, conversationProvider: { provider: 'elevenlabs', agentReference: 'fixture-agent', branchReference: 'fixture-branch', environment: 'test' } })
  await new OrganisationPouSpecificationProvisioningService(connection.db, () => now).provisionAndActivate({ organisationId, operatorUserId: userId, specification: approvedWhakapapaOrganisationPouV01(approval), guidanceProjection: { projectionCode: 'fixture-guidance', projectionVersion: '0.1' }, reviewProjection: { projectionCode: 'fixture-review', projectionVersion: '0.1' } })
  return { organisationId, userId, now, actor }
}

async function cleanup(connection: DatabaseConnection) {
  const ids = sql`select id from organisation where slug like 'safety-author-%'`
  const immutable = ['safety_specification_version', 'provider_assessment_projection', 'organisation_pou_specification_version', 'conversation_guidance_projection', 'pou_review_projection', 'organisation_pou_safety_specification_link', 'workflow_conversation_pou_specification_pin']
  try {
    for (const table of immutable) await connection.db.execute(sql.raw(`alter table ${table} disable trigger ${table}_immutable`))
    await connection.db.execute(sql`delete from conversation_provider_rule_assessment where assessment_run_id in (select id from conversation_safety_assessment_run where organisation_id in (${ids}))`)
    await connection.db.execute(sql`delete from provider_assessment_delivery where assessment_run_id in (select id from conversation_safety_assessment_run where organisation_id in (${ids}))`)
    await connection.db.execute(sql`delete from conversation_transcript_turn where transcript_id in (select id from conversation_transcript where organisation_id in (${ids}))`)
    await connection.db.execute(sql`delete from conversation_transcript where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from workflow_conversation_pou_specification_pin where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from conversation_safety_assessment_run where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from workflow_conversation where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from workflow_pou_checkpoint where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from workflow_session where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from organisation_pou_safety_policy_draft where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from organisation_pou_specification_activation where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from organisation_pou_safety_specification_link where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from conversation_guidance_projection where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from pou_review_projection where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from organisation_pou_specification_version where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from safety_specification_activation where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from provider_assessment_projection where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from safety_specification_version where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from app_user where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from organisation where slug like 'safety-author-%'`)
  } finally { for (const table of immutable) await connection.db.execute(sql.raw(`alter table ${table} enable trigger ${table}_immutable`)) }
}

describe('formal safety-policy workshop authoring', () => {
  it('keeps a draft non-executable, then explicitly materialises and pins an approved current-conversation rule', async () => {
    await withMigratedTestDatabase(async (connection) => {
      const { organisationId, actor, now } = await fixture(connection)
      const service = new PostgresSafetyPolicyAuthoringService(connection.db, () => now)
      await expect(service.createDraft({ ...actor, roles: ['SUPERVISOR'] }, 'whakapapa')).rejects.toBeInstanceOf(AuthorizationError)
      const repository = new PostgresSafetyAssessmentRepository(connection.db)
      const before = await repository.resolveActivePin(organisationId, 'whakapapa', { provider: 'elevenlabs', agentReference: 'fixture-agent', branchReference: 'fixture-branch', environment: 'test' })
      if (!before) throw new Error('Expected active safety policy.')
      const draft = await service.createDraft(actor, 'whakapapa')
      expect(draft.policy.rules).toEqual([])
      expect((await repository.resolveActivePin(organisationId, 'whakapapa', { provider: 'elevenlabs', agentReference: 'fixture-agent', branchReference: 'fixture-branch', environment: 'test' }))?.specificationHash).toBe(before.specificationHash)
      const ruleId = randomUUID()
      const saved = await service.saveDraft(actor, draft.id, draft.revision, { rules: [{ id: ruleId, safetyIndicator: 'Synthetic bounded concern', whyThisMatters: 'Synthetic test policy only.', evidenceRequired: ['The relevant context is established.'], possibleConcernIndicators: ['The concern is explicitly described.'], noCandidateEvidence: ['The concern was explicitly explored and not present.'], missingInformation: ['Clarify the relevant context.'], appliesWhen: ['The reflection concerns the synthetic topic.'], doesNotApplyWhen: ['The synthetic topic is not relevant.'], candidateOutcomes: ['possible_concern', 'no_candidate_concern', 'insufficient_information', 'not_applicable'], humanJudgement: { reportOnly: false, permittedLevels: ['low', 'watch'], broadClass: 'whanau_safety' }, evidenceScope: 'current_conversation', sourceNotes: ['Synthetic workshop source'] }] })
      await expect(service.approveAndActivate(actor, saved.id, saved.revision - 1)).rejects.toMatchObject({ currentRevision: saved.revision })
      const activated = await service.approveAndActivate(actor, saved.id, saved.revision)
      expect(activated.draft.activatedAt).not.toBeNull()
      const after = await repository.resolveActivePin(organisationId, 'whakapapa', { provider: 'elevenlabs', agentReference: 'fixture-agent', branchReference: 'fixture-branch', environment: 'test' })
      expect(after?.projection.rules).toHaveLength(1)
      expect(after?.projection.rules[0]?.title).toBe('Synthetic bounded concern')
      expect(after?.projection.rules[0]?.candidateLevelMode).toBe('human_only')
      expect(after?.specification.rules[0]?.permittedHumanConcernLevels).toEqual(['low', 'watch'])
      expect(after?.specificationHash).not.toBe(before.specificationHash)
      await expect(new PostgresOrganisationPouSpecificationRepository(connection.db).resolveActivePin(organisationId, 'whakapapa', after!)).resolves.toMatchObject({ specification: { pouId: 'whakapapa' } })
      const projectedRule = after!.projection.rules[0]!
      const evidenceTurnId = randomUUID()
      const candidate = (outcome: 'possible_concern' | 'no_candidate_concern' | 'insufficient_information' | 'not_applicable') => ({ ruleCode: projectedRule.ruleCode, ruleVersion: projectedRule.ruleVersion, outcome, candidateConcernLevel: null, matchedProtectiveIndicatorCodes: outcome === 'no_candidate_concern' ? [projectedRule.protectiveIndicators[0]!.code] : [], matchedConcernIndicatorCodes: outcome === 'possible_concern' ? [projectedRule.concernIndicators[0]!.code] : [], missingInformationCodes: outcome === 'insufficient_information' ? [projectedRule.requiredInformation[1]!.code] : [], uncertaintyReasonCodes: [], applicabilityReasonCode: outcome === 'not_applicable' ? projectedRule.applicabilityReasonCodes[0]! : null, evidenceTurnIds: outcome === 'possible_concern' || outcome === 'no_candidate_concern' ? [evidenceTurnId] : [] })
      for (const outcome of ['possible_concern', 'no_candidate_concern', 'insufficient_information', 'not_applicable'] as const) {
        expect(validateProviderAssessmentSet(after!.projection, [candidate(outcome)], new Set([evidenceTurnId]))).toHaveLength(1)
      }
      expect(() => safetyPolicyDraftContentSchema.parse({ rules: [{
        id: randomUUID(), safetyIndicator: 'Evidence-free rule', whyThisMatters: 'Synthetic only.', evidenceRequired: ['Bounded context.'], possibleConcernIndicators: [], noCandidateEvidence: [], missingInformation: [], appliesWhen: [], doesNotApplyWhen: [], candidateOutcomes: ['no_candidate_concern'], humanJudgement: { reportOnly: true, permittedLevels: [], broadClass: null }, evidenceScope: 'current_conversation', sourceNotes: ['Synthetic source'],
      }] })).toThrow('adequately explored')

      // A formal policy activated independently of ordinary Pou prose must
      // remain a valid exact pin all the way to post-call delivery resolution.
      const workflowId = randomUUID()
      await connection.db.insert(schema.workflowSessions).values({ id: workflowId, organisationId, kaimahiUserId: actor.id, reference: `TK-${workflowId.slice(0, 8)}`, status: 'in_progress', currentStage: 'pou-overview', currentPouId: 'whakapapa', version: 1 })
      await connection.db.insert(schema.workflowPouCheckpoints).values({ workflowSessionId: workflowId, organisationId, pouId: 'whakapapa', ordinal: 1 })
      const pouPin = await new PostgresOrganisationPouSpecificationRepository(connection.db).resolveActivePin(organisationId, 'whakapapa', after!)
      const conversations = new PostgresConversationRepository(connection.db, () => now, repository)
      const prepared = await conversations.prepare({
        actor, workflowSessionId: workflowId, pouId: 'whakapapa', provider: 'elevenlabs', providerAgentReference: 'fixture-agent', providerBranchReference: 'fixture-branch', providerEnvironment: 'test',
        conversationSpecificationCode: 'whakapapa-reflection', conversationSpecificationVersion: 1, idempotencyKey: randomUUID(), requestFingerprint: `formal-policy-${randomUUID()}`, assessmentPin: after!, pouSpecificationPin: pouPin,
      })
      const providerConversationId = `provider-${randomUUID()}`
      await conversations.authorize(prepared.conversation.id, providerConversationId)
      await conversations.terminate(prepared.conversation.id, 'ended', 'user_ended')
      await expect(repository.resolveActivePinForConversation({ providerConversationId, agentReference: 'fixture-agent', branchReference: 'fixture-branch', environment: 'test' })).resolves.toMatchObject({ runId: expect.any(String), workflowConversationId: prepared.conversation.id, requiresAssessment: true })
      const transcript = await new PostgresTranscriptRepository(connection.db, () => now).retainForConversation({ organisationId, workflowSessionId: workflowId, pouId: 'whakapapa', workflowConversationId: prepared.conversation.id, provider: 'elevenlabs', providerConversationId, turns: [{ id: evidenceTurnId, ordinal: 1, speaker: 'unknown', text: 'Synthetic bounded policy evidence.', providerSequence: null, providerTimestamp: null }] })
      const [run] = await connection.db.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.workflowConversationId, prepared.conversation.id))
      if (!run) throw new Error('Expected a policy-pinned assessment run.')
      const deliveryId = `delivery-${randomUUID()}`
      await repository.reserveDelivery({ provider: 'elevenlabs', deliveryId, payloadHash: 'b'.repeat(64), assessmentRunId: run.id })
      await expect(repository.ingest({ deliveryProvider: 'elevenlabs', deliveryId, payloadHash: 'b'.repeat(64), providerConversationId, agentReference: 'fixture-agent', branchReference: 'fixture-branch', environment: 'test', transcriptId: transcript.transcriptId, transcriptReceivedAt: now, assessments: [candidate('possible_concern')] })).resolves.toEqual({ replayed: false, superseded: false })
      expect(await connection.db.select().from(schema.conversationProviderRuleAssessments).where(eq(schema.conversationProviderRuleAssessments.assessmentRunId, run.id))).toHaveLength(1)
      expect(await connection.db.select().from(schema.workflowSafetyObservations).where(eq(schema.workflowSafetyObservations.workflowSessionId, workflowId))).toHaveLength(0)
      expect((await connection.db.select().from(schema.safetySpecificationVersions).where(eq(schema.safetySpecificationVersions.organisationId, organisationId))).length).toBe(2)
    }, cleanup)
  })
})
