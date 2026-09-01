import { describe, expect, it, vi } from 'vitest'

import type { AuthenticatedUser } from '../domain/auth.js'
import type { WorkflowRepository, WorkflowView } from '../workflows/repository.js'
import type { ConversationRecord, ConversationRepository, PrepareConversationInput } from './repository.js'
import { ConversationAuthorizationAlreadyIssuedError, ConversationService, ProviderConversationMismatchError } from './service.js'
import type { ConversationProvider } from './provider.js'
import { PouSpecificationUnavailableError } from '../pou-specifications/repository.js'
import { approvedWhakapapaOrganisationPouV01, conversationGuidanceProjection, pouReviewProjection } from '../pou-specifications/domain.js'
import { approvedWhakapapaPilotV01, contentHash, providerProjection } from '../safety-assessments/domain.js'
import type { PostgresSafetyAssessmentRepository } from '../safety-assessments/repository.js'
import type { PostgresOrganisationPouSpecificationRepository } from '../pou-specifications/repository.js'
import { organisationPouSpecificationFromRegistry } from '../pou-specifications/registry.js'
import { safetySpecificationFromRegistry } from '../safety-assessments/registry.js'
import { PHASE_5D_DRAFT_POU_SPECIFICATIONS } from '../pou-specifications/phase5d-specifications.js'

const actor: AuthenticatedUser = {
  id: '0a7e65f8-3f45-4a2b-b837-7891aeff2ec4',
  displayName: 'Test Kaimahi',
  status: 'active',
  organisation: { id: 'fe750d03-3a1e-48c1-a8c0-d1c3855bb2f1', slug: 'test', name: 'Test organisation' },
  roles: ['KAIMAHI'],
}

const workflow: WorkflowView = {
  id: '22b1f80c-2c12-4f82-bdd9-65d7b30712bb',
  reference: 'TK-TEST',
  status: 'in_progress',
  currentStage: 'pou-overview',
  currentPouId: 'whakapapa',
  version: 2,
  setup: null,
  readiness: { verbalConsentConfirmed: true, writtenConsentConfirmed: true, initialRiskAssessmentCompleted: true },
  checkpoints: [{ pouId: 'whakapapa', ordinal: 1, progress: 'not_started', userSelectedConcern: null, note: null, referralSuggested: false, supervisorReviewSuggested: false, confirmedAt: null }],
  actions: [],
  referrals: [],
  carryForwards: [],
  pouReviews: [],
  safety: { observations: [], requiredConsequences: [], supervisorReviewRequests: [], indicators: { activeObservationCount: 0, urgentObservationCount: 0, supervisorReviewRequired: false, supervisorNotificationRequired: false, manualReviewRequestCount: 0, hasRetractedHistory: false } },
  structuredReview: { reference: 'TK-TEST', setup: null, checkpoints: [], actions: [], referrals: [], carryForwards: [], pouReviews: [], createdAt: new Date(), updatedAt: new Date(), completedAt: null },
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

function record(input: PrepareConversationInput, status: ConversationRecord['status'] = 'preparing'): ConversationRecord {
  return {
    id: '8e1fde30-c4b6-492a-8862-32200b2661a9', organisationId: input.actor.organisation.id, workflowSessionId: input.workflowSessionId, pouId: input.pouId,
    startedByUserId: input.actor.id, provider: input.provider, providerConversationId: null, providerAgentReference: input.providerAgentReference,
    providerBranchReference: input.providerBranchReference ?? null, providerEnvironment: input.providerEnvironment,
    conversationSpecificationCode: input.conversationSpecificationCode, conversationSpecificationVersion: input.conversationSpecificationVersion,
    status, startIdempotencyKey: input.idempotencyKey, requestFingerprint: input.requestFingerprint,
    authorizedAt: null, connectedAt: null, endedAt: null, terminationReason: null, createdAt: new Date(), updatedAt: new Date(),
  }
}

class FakeConversationRepository implements ConversationRepository {
  current: ConversationRecord | null = null
  async prepare(input: PrepareConversationInput) {
    if (this.current) return { conversation: this.current, created: false }
    this.current = record(input)
    return { conversation: this.current, created: true }
  }
  async findById(_actor: AuthenticatedUser, id: string) { return this.current?.id === id ? this.current : null }
  async findCurrent() { return this.current }
  async authorize(id: string, providerConversationId: string) {
    if (!this.current || this.current.id !== id) throw new Error('not found')
    this.current = { ...this.current, providerConversationId, status: 'authorized', authorizedAt: new Date() }
    return this.current
  }
  async markActive(id: string) {
    if (!this.current || this.current.id !== id) throw new Error('not found')
    this.current = { ...this.current, status: 'active', connectedAt: new Date() }
    return this.current
  }
  async terminate(id: string, status: 'ended' | 'failed', reason: ConversationRecord['terminationReason'] & string) {
    if (!this.current || this.current.id !== id) throw new Error('not found')
    this.current = { ...this.current, status, endedAt: new Date(), terminationReason: reason }
    return this.current
  }
}

class AuthorizationWriteFailureRepository extends FakeConversationRepository {
  override async authorize(): Promise<ConversationRecord> {
    throw new Error('authorization persistence failed')
  }
}

const fakeWorkflowRepository = { findById: async () => workflow } as unknown as WorkflowRepository
const fakeProvider: ConversationProvider = { authorizeConversation: async () => ({ providerConversationId: 'provider-id', conversationToken: 'temporary-token' }) }
const approvedPouSpecification = approvedWhakapapaOrganisationPouV01({ approvedForPilotBy: actor.id, approvedForPilotAt: '2026-08-13T00:00:00.000Z' })
const guidanceProjection = conversationGuidanceProjection(approvedPouSpecification, { projectionCode: 'test-guidance', projectionVersion: '1' })
const reviewProjection = pouReviewProjection(approvedPouSpecification, { projectionCode: 'test-review', projectionVersion: '1' })
const approvedSafetySpecification = approvedWhakapapaPilotV01({ approvedForPilotBy: actor.id, approvedForPilotAt: '2026-08-13T00:00:00.000Z' })
const safetyProjection = providerProjection(approvedSafetySpecification, { projectionCode: 'test-safety', projectionVersion: '1' })
const safetyAssessments = {
  resolveActivePin: async () => ({ specificationId: 'da60ad9e-8f8d-4d9d-a565-0da571850337', specification: approvedSafetySpecification, specificationHash: contentHash(approvedSafetySpecification), ruleManifestHash: contentHash(safetyProjection.rules), projectionId: 'd0c07164-6d8f-4ee0-a087-ea7fc36f38e9', projection: safetyProjection, projectionHash: contentHash(safetyProjection) }),
} as unknown as PostgresSafetyAssessmentRepository
const pouSpecifications = {
  resolveActivePin: async () => ({ specificationId: 'ccf4b2cf-e3f7-4a97-a242-ac6053644e42', specification: approvedPouSpecification, specificationHash: contentHash(approvedPouSpecification), conversationGuidanceProjectionId: 'c86a610d-e6d7-499d-9192-30f174f43a23', conversationGuidanceProjection: guidanceProjection, conversationGuidanceProjectionHash: contentHash(guidanceProjection), pouReviewProjectionId: 'dff5cce8-8ec0-4cd4-936a-b0e24c1b269c', pouReviewProjection: reviewProjection, pouReviewProjectionHash: contentHash(reviewProjection) }),
} as unknown as PostgresOrganisationPouSpecificationRepository

function service(repository: ConversationRepository, provider: ConversationProvider = fakeProvider) {
  return new ConversationService(fakeWorkflowRepository, repository, provider, { agentId: 'agent', branchId: 'branch', environment: 'staging' }, safetyAssessments, pouSpecifications)
}

describe('ConversationService', () => {
  it('authorizes Whakapapa without changing the workflow and makes a client-connected acknowledgement active', async () => {
    const repository = new FakeConversationRepository()
    const application = service(repository)
    const started = await application.start(actor, workflow.id, 'whakapapa', 'a65c619a-9f17-4e01-8b7e-64de443d7bca')
    expect(started.conversation.status).toBe('authorized')
    expect(started.conversation.conversationSpecificationCode).toBe('whakapapa-reflection')
    expect(started.conversationToken).toBe('temporary-token')
    expect(started.dynamicVariables).toEqual({ pou_name: 'Whakapapa', pou_opening: '', pou_guidance: expect.stringContaining('AREAS TO EXPLORE') })
    await expect(application.acknowledgeClientConnected(actor, started.conversation.id, 'provider-id')).resolves.toMatchObject({ status: 'active' })
  })

  it('does not reissue a token for a repeated start and terminates provider-ID mismatches', async () => {
    const repository = new FakeConversationRepository()
    const application = service(repository)
    const started = await application.start(actor, workflow.id, 'whakapapa', 'a65c619a-9f17-4e01-8b7e-64de443d7bca')
    await expect(application.start(actor, workflow.id, 'whakapapa', 'a65c619a-9f17-4e01-8b7e-64de443d7bca')).rejects.toEqual(expect.any(ConversationAuthorizationAlreadyIssuedError))
    await expect(application.acknowledgeClientConnected(actor, started.conversation.id, 'wrong-provider-id')).rejects.toEqual(expect.any(ProviderConversationMismatchError))
    expect(repository.current).toMatchObject({ status: 'failed', terminationReason: 'provider_id_mismatch' })
  })

  it('makes a terminal end idempotent without changing workflow state', async () => {
    const repository = new FakeConversationRepository()
    const application = service(repository)
    const started = await application.start(actor, workflow.id, 'whakapapa', 'a65c619a-9f17-4e01-8b7e-64de443d7bca')
    const ended = await application.end(actor, started.conversation.id, 'user_ended')
    await expect(application.end(actor, started.conversation.id, 'user_ended')).resolves.toEqual(ended)
    expect(workflow).toMatchObject({ currentStage: 'pou-overview', currentPouId: 'whakapapa', version: 2 })
  })

  it('does not return or reissue a provider token when authorization persistence fails', async () => {
    const repository = new AuthorizationWriteFailureRepository()
    const authorizeConversation = vi.fn(async () => ({ providerConversationId: 'provider-id', conversationToken: 'temporary-token' }))
    const application = service(repository, { authorizeConversation })
    const idempotencyKey = 'a65c619a-9f17-4e01-8b7e-64de443d7bca'
    await expect(application.start(actor, workflow.id, 'whakapapa', idempotencyKey)).rejects.toThrow('authorization persistence failed')
    expect(repository.current).toMatchObject({ status: 'failed', terminationReason: 'startup_failed' })
    await expect(application.start(actor, workflow.id, 'whakapapa', idempotencyKey)).rejects.toEqual(expect.any(ConversationAuthorizationAlreadyIssuedError))
    expect(authorizeConversation).toHaveBeenCalledTimes(1)
  })

  it('authorizes an independently pinned Manaakitanga conversation with generic Pou guidance and no formal safety rules', async () => {
    const repository = new FakeConversationRepository()
    const approval = { approvedForPilotBy: actor.id, approvedForPilotAt: '2026-08-14T00:00:00.000Z' }
    const draft = PHASE_5D_DRAFT_POU_SPECIFICATIONS.find((specification) => specification.pouId === 'manaakitanga')!
    const manaSpecification = organisationPouSpecificationFromRegistry(draft.specificationCode, draft.specificationVersion, approval)
    const manaSafetySpecification = safetySpecificationFromRegistry(`${draft.specificationCode}_SAFETY`, draft.specificationVersion, approval)
    const manaGuidance = conversationGuidanceProjection(manaSpecification, { projectionCode: 'mana-guidance', projectionVersion: '1' })
    const manaReview = pouReviewProjection(manaSpecification, { projectionCode: 'mana-review', projectionVersion: '1' })
    const manaSafety = providerProjection(manaSafetySpecification, { projectionCode: 'mana-safety', projectionVersion: '1' })
    const manaWorkflow = {
      ...workflow,
      currentStage: 'pou-convo' as const,
      currentPouId: 'manaakitanga' as const,
      checkpoints: [
        { pouId: 'kaitiakitanga' as const, ordinal: 1, progress: 'confirmed' as const, userSelectedConcern: null, note: null, referralSuggested: false, supervisorReviewSuggested: false, confirmedAt: new Date() },
        { pouId: 'tikanga' as const, ordinal: 2, progress: 'confirmed' as const, userSelectedConcern: null, note: null, referralSuggested: false, supervisorReviewSuggested: false, confirmedAt: new Date() },
        { pouId: 'whakapapa' as const, ordinal: 3, progress: 'confirmed' as const, userSelectedConcern: null, note: null, referralSuggested: false, supervisorReviewSuggested: false, confirmedAt: new Date() },
        { pouId: 'manaakitanga' as const, ordinal: 4, progress: 'not_started' as const, userSelectedConcern: null, note: null, referralSuggested: false, supervisorReviewSuggested: false, confirmedAt: null },
      ],
    }
    const application = new ConversationService(
      { findById: async () => manaWorkflow } as unknown as WorkflowRepository,
      repository,
      fakeProvider,
      { agentId: 'agent', branchId: 'branch', environment: 'staging' },
      { resolveActivePin: async () => ({ specificationId: 'safety-id', specification: manaSafetySpecification, specificationHash: contentHash(manaSafetySpecification), ruleManifestHash: contentHash(manaSafety.rules), projectionId: 'safety-projection-id', projection: manaSafety, projectionHash: contentHash(manaSafety) }) } as unknown as PostgresSafetyAssessmentRepository,
      { resolveActivePin: async () => ({ specificationId: 'pou-id', specification: manaSpecification, specificationHash: contentHash(manaSpecification), conversationGuidanceProjectionId: 'guidance-id', conversationGuidanceProjection: manaGuidance, conversationGuidanceProjectionHash: contentHash(manaGuidance), pouReviewProjectionId: 'review-id', pouReviewProjection: manaReview, pouReviewProjectionHash: contentHash(manaReview) }) } as unknown as PostgresOrganisationPouSpecificationRepository,
    )
    const started = await application.start(actor, workflow.id, 'manaakitanga', '65c619a0-9f17-4e01-8b7e-64de443d7bca')
    expect(started.conversation).toMatchObject({ pouId: 'manaakitanga', conversationSpecificationCode: 'te-waharoa-pou-reflection', conversationSpecificationVersion: 1 })
    expect(started.dynamicVariables).toEqual({ pou_name: 'Manaakitanga & Duty of Care', pou_opening: '', pou_guidance: expect.stringContaining('AREAS TO EXPLORE') })
    expect(manaSafety.rules).toEqual([])
  })

  it('fails closed before provider authorization when a current Pou has no active safety specification', async () => {
    const authorization = vi.fn(async () => ({ providerConversationId: 'provider-id', conversationToken: 'temporary-token' }))
    const manaWorkflow = {
      ...workflow,
      currentStage: 'pou-convo' as const,
      currentPouId: 'manaakitanga' as const,
      checkpoints: [
        { pouId: 'kaitiakitanga' as const, ordinal: 1, progress: 'confirmed' as const, userSelectedConcern: null, note: null, referralSuggested: false, supervisorReviewSuggested: false, confirmedAt: new Date() },
        { pouId: 'tikanga' as const, ordinal: 2, progress: 'confirmed' as const, userSelectedConcern: null, note: null, referralSuggested: false, supervisorReviewSuggested: false, confirmedAt: new Date() },
        { pouId: 'whakapapa' as const, ordinal: 3, progress: 'confirmed' as const, userSelectedConcern: null, note: null, referralSuggested: false, supervisorReviewSuggested: false, confirmedAt: new Date() },
        { pouId: 'manaakitanga' as const, ordinal: 4, progress: 'not_started' as const, userSelectedConcern: null, note: null, referralSuggested: false, supervisorReviewSuggested: false, confirmedAt: null },
      ],
    }
    const application = new ConversationService(
      { findById: async () => manaWorkflow } as unknown as WorkflowRepository,
      new FakeConversationRepository(),
      { authorizeConversation: authorization },
      { agentId: 'agent', branchId: 'branch', environment: 'staging' },
      { resolveActivePin: async () => null } as unknown as PostgresSafetyAssessmentRepository,
      pouSpecifications,
    )

    await expect(application.start(actor, workflow.id, 'manaakitanga', 'e6dc16bb-4df0-4ffd-9517-7004c7d3d4e3')).rejects.toEqual(expect.any(PouSpecificationUnavailableError))
    expect(authorization).not.toHaveBeenCalled()
  })
})
