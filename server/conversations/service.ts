import type { WorkflowPouId } from '../../shared/workflow.js'
import type { AuthenticatedUser } from '../domain/auth.js'
import { workflowRequestFingerprint, type WorkflowRepository } from '../workflows/repository.js'
import {
  assertWhakapapaConversationEligibility,
  CONVERSATION_PROVIDER,
  isTerminalConversationStatus,
  type ConversationTerminationReason,
  WHAKAPAPA_CONVERSATION_SPECIFICATION,
} from './domain.js'
import {
  ConversationProviderAuthorizationError,
  ConversationProviderUnavailableError,
  type ConversationProvider,
} from './provider.js'
import {
  type ConversationRecord,
  type ConversationRepository,
  ConversationRepositoryError,
} from './repository.js'
import type { PostgresSafetyAssessmentRepository } from '../safety-assessments/repository.js'
import { PouSpecificationUnavailableError, type PostgresOrganisationPouSpecificationRepository } from '../pou-specifications/repository.js'
import { conversationRuntimeDynamicVariables, type ConversationRuntimeDynamicVariables } from '../pou-specifications/domain.js'

export interface ElevenLabsConversationConfiguration {
  agentId: string
  branchId: string
  environment: string
}

export interface ConversationStartResult {
  kind: 'authorized'
  conversation: ConversationRecord
  conversationToken: string
  dynamicVariables: ConversationRuntimeDynamicVariables
}

export interface ConversationApplicationService {
  start(actor: AuthenticatedUser, workflowSessionId: string, pouId: WorkflowPouId, idempotencyKey: string): Promise<ConversationStartResult>
  acknowledgeClientConnected(actor: AuthenticatedUser, conversationId: string, providerConversationId: string): Promise<ConversationRecord>
  end(actor: AuthenticatedUser, conversationId: string, reason: ConversationTerminationReason): Promise<ConversationRecord>
  current(actor: AuthenticatedUser, workflowSessionId: string, pouId: WorkflowPouId): Promise<ConversationRecord | null>
}

export class ConversationNotFoundError extends Error {
  constructor() {
    super('The conversation could not be found.')
    this.name = 'ConversationNotFoundError'
  }
}

export class ConversationAuthorizationAlreadyIssuedError extends Error {
  constructor(public readonly conversation: ConversationRecord) {
    super('Conversation authorization was already issued and cannot be safely replayed.')
    this.name = 'ConversationAuthorizationAlreadyIssuedError'
  }
}

export class ConversationStartInProgressError extends Error {
  constructor() {
    super('Conversation authorization is already in progress.')
    this.name = 'ConversationStartInProgressError'
  }
}

export class ProviderConversationMismatchError extends Error {
  constructor() {
    super('The provider conversation did not match the authorized attempt.')
    this.name = 'ProviderConversationMismatchError'
  }
}

export class ConversationService implements ConversationApplicationService {
  constructor(
    private readonly workflowRepository: WorkflowRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly provider: ConversationProvider | undefined,
    private readonly elevenlabs: ElevenLabsConversationConfiguration | undefined,
    private readonly safetyAssessments?: PostgresSafetyAssessmentRepository,
    private readonly pouSpecifications?: PostgresOrganisationPouSpecificationRepository,
  ) {}

  async start(actor: AuthenticatedUser, workflowSessionId: string, pouId: WorkflowPouId, idempotencyKey: string): Promise<ConversationStartResult> {
    if (!this.provider || !this.elevenlabs) throw new ConversationProviderUnavailableError()
    const workflow = await this.workflowRepository.findById(actor, workflowSessionId)
    if (!workflow) throw new ConversationNotFoundError()
    assertWhakapapaConversationEligibility(workflow, pouId)

    const fingerprint = workflowRequestFingerprint({
      type: 'whakapapa-conversation-started',
      workflowSessionId,
      pouId,
      conversationSpecification: WHAKAPAPA_CONVERSATION_SPECIFICATION,
    })
    const assessmentPin = this.safetyAssessments
      ? await this.safetyAssessments.resolveActivePin(actor.organisation.id, {
          provider: CONVERSATION_PROVIDER,
          agentReference: this.elevenlabs.agentId,
          branchReference: this.elevenlabs.branchId,
          environment: this.elevenlabs.environment,
        })
      : null
    if (!assessmentPin || !this.pouSpecifications) throw new PouSpecificationUnavailableError('An approved organisation Pou specification is required before starting this reflection.')
    const pouSpecificationPin = await this.pouSpecifications.resolveActivePin(actor.organisation.id, assessmentPin)
    const dynamicVariables = conversationRuntimeDynamicVariables(pouSpecificationPin.conversationGuidanceProjection)
    const prepared = await this.conversationRepository.prepare({
      actor,
      workflowSessionId,
      pouId,
      provider: CONVERSATION_PROVIDER,
      providerAgentReference: this.elevenlabs.agentId,
      providerBranchReference: this.elevenlabs.branchId,
      providerEnvironment: this.elevenlabs.environment,
      conversationSpecificationCode: WHAKAPAPA_CONVERSATION_SPECIFICATION.code,
      conversationSpecificationVersion: WHAKAPAPA_CONVERSATION_SPECIFICATION.version,
      idempotencyKey,
      requestFingerprint: fingerprint,
      assessmentPin,
      pouSpecificationPin,
    })
    if (!prepared.created) {
      if (prepared.conversation.status === 'preparing') throw new ConversationStartInProgressError()
      throw new ConversationAuthorizationAlreadyIssuedError(prepared.conversation)
    }

    try {
      const authorization = await this.provider.authorizeConversation(this.elevenlabs)
      const conversation = await this.conversationRepository.authorize(prepared.conversation.id, authorization.providerConversationId)
      return { kind: 'authorized', conversation, conversationToken: authorization.conversationToken, dynamicVariables }
    } catch (error) {
      try {
        await this.conversationRepository.terminate(prepared.conversation.id, 'failed', 'startup_failed')
      } catch (terminationError) {
        if (!(terminationError instanceof ConversationRepositoryError)) throw terminationError
      }
      if (error instanceof ConversationProviderAuthorizationError) throw error
      throw error
    }
  }

  async acknowledgeClientConnected(actor: AuthenticatedUser, conversationId: string, providerConversationId: string): Promise<ConversationRecord> {
    const conversation = await this.requireOwnedConversation(actor, conversationId)
    if (conversation.providerConversationId !== providerConversationId) {
      if (!isTerminalConversationStatus(conversation.status)) {
        await this.conversationRepository.terminate(conversation.id, 'failed', 'provider_id_mismatch')
      }
      throw new ProviderConversationMismatchError()
    }
    if (conversation.status === 'active' || isTerminalConversationStatus(conversation.status)) return conversation
    return this.conversationRepository.markActive(conversation.id)
  }

  async end(actor: AuthenticatedUser, conversationId: string, reason: ConversationTerminationReason): Promise<ConversationRecord> {
    const conversation = await this.requireOwnedConversation(actor, conversationId)
    if (isTerminalConversationStatus(conversation.status)) return conversation
    return this.conversationRepository.terminate(conversation.id, ['startup_failed', 'provider_error', 'provider_id_mismatch'].includes(reason) ? 'failed' : 'ended', reason)
  }

  async current(actor: AuthenticatedUser, workflowSessionId: string, pouId: WorkflowPouId): Promise<ConversationRecord | null> {
    const workflow = await this.workflowRepository.findById(actor, workflowSessionId)
    if (!workflow) throw new ConversationNotFoundError()
    if (pouId !== 'whakapapa') return null
    return this.conversationRepository.findCurrent(actor, workflowSessionId, pouId)
  }

  private async requireOwnedConversation(actor: AuthenticatedUser, conversationId: string): Promise<ConversationRecord> {
    const conversation = await this.conversationRepository.findById(actor, conversationId)
    if (!conversation) throw new ConversationNotFoundError()
    return conversation
  }
}
