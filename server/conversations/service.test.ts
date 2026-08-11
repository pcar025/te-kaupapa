import { describe, expect, it, vi } from 'vitest'

import type { AuthenticatedUser } from '../domain/auth.js'
import type { WorkflowRepository, WorkflowView } from '../workflows/repository.js'
import type { ConversationRecord, ConversationRepository, PrepareConversationInput } from './repository.js'
import { ConversationAuthorizationAlreadyIssuedError, ConversationService, ProviderConversationMismatchError } from './service.js'
import type { ConversationProvider } from './provider.js'

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
  checkpoints: [{ pouId: 'whakapapa', ordinal: 1, progress: 'not_started', userSelectedConcern: null, note: null, referralSuggested: false, supervisorReviewSuggested: false, confirmedAt: null }],
  actions: [],
  referrals: [],
  safety: { observations: [], requiredConsequences: [], supervisorReviewRequests: [], indicators: { activeObservationCount: 0, urgentObservationCount: 0, supervisorReviewRequired: false, supervisorNotificationRequired: false, manualReviewRequestCount: 0, hasRetractedHistory: false } },
  structuredReview: { reference: 'TK-TEST', setup: null, checkpoints: [], actions: [], referrals: [], createdAt: new Date(), updatedAt: new Date(), completedAt: null },
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

describe('ConversationService', () => {
  it('authorizes Whakapapa without changing the workflow and makes a client-connected acknowledgement active', async () => {
    const repository = new FakeConversationRepository()
    const service = new ConversationService(fakeWorkflowRepository, repository, fakeProvider, { agentId: 'agent', branchId: 'branch', environment: 'staging' })
    const started = await service.start(actor, workflow.id, 'whakapapa', 'a65c619a-9f17-4e01-8b7e-64de443d7bca')
    expect(started.conversation.status).toBe('authorized')
    expect(started.conversation.conversationSpecificationCode).toBe('whakapapa-reflection')
    expect(started.conversationToken).toBe('temporary-token')
    await expect(service.acknowledgeClientConnected(actor, started.conversation.id, 'provider-id')).resolves.toMatchObject({ status: 'active' })
  })

  it('does not reissue a token for a repeated start and terminates provider-ID mismatches', async () => {
    const repository = new FakeConversationRepository()
    const service = new ConversationService(fakeWorkflowRepository, repository, fakeProvider, { agentId: 'agent', branchId: 'branch', environment: 'staging' })
    const started = await service.start(actor, workflow.id, 'whakapapa', 'a65c619a-9f17-4e01-8b7e-64de443d7bca')
    await expect(service.start(actor, workflow.id, 'whakapapa', 'a65c619a-9f17-4e01-8b7e-64de443d7bca')).rejects.toEqual(expect.any(ConversationAuthorizationAlreadyIssuedError))
    await expect(service.acknowledgeClientConnected(actor, started.conversation.id, 'wrong-provider-id')).rejects.toEqual(expect.any(ProviderConversationMismatchError))
    expect(repository.current).toMatchObject({ status: 'failed', terminationReason: 'provider_id_mismatch' })
  })

  it('makes a terminal end idempotent without changing workflow state', async () => {
    const repository = new FakeConversationRepository()
    const service = new ConversationService(fakeWorkflowRepository, repository, fakeProvider, { agentId: 'agent', branchId: 'branch', environment: 'staging' })
    const started = await service.start(actor, workflow.id, 'whakapapa', 'a65c619a-9f17-4e01-8b7e-64de443d7bca')
    const ended = await service.end(actor, started.conversation.id, 'user_ended')
    await expect(service.end(actor, started.conversation.id, 'user_ended')).resolves.toEqual(ended)
    expect(workflow).toMatchObject({ currentStage: 'pou-overview', currentPouId: 'whakapapa', version: 2 })
  })

  it('does not return or reissue a provider token when authorization persistence fails', async () => {
    const repository = new AuthorizationWriteFailureRepository()
    const authorizeConversation = vi.fn(async () => ({ providerConversationId: 'provider-id', conversationToken: 'temporary-token' }))
    const service = new ConversationService(fakeWorkflowRepository, repository, { authorizeConversation }, { agentId: 'agent', branchId: 'branch', environment: 'staging' })
    const idempotencyKey = 'a65c619a-9f17-4e01-8b7e-64de443d7bca'
    await expect(service.start(actor, workflow.id, 'whakapapa', idempotencyKey)).rejects.toThrow('authorization persistence failed')
    expect(repository.current).toMatchObject({ status: 'failed', terminationReason: 'startup_failed' })
    await expect(service.start(actor, workflow.id, 'whakapapa', idempotencyKey)).rejects.toEqual(expect.any(ConversationAuthorizationAlreadyIssuedError))
    expect(authorizeConversation).toHaveBeenCalledTimes(1)
  })
})
