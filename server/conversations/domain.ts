import type { WorkflowPouId, WorkflowStage } from '../../shared/workflow.js'

export const CONVERSATION_PROVIDER = 'elevenlabs' as const
export const CONVERSATION_SPECIFICATION = {
  code: 'te-waharoa-pou-reflection',
  version: 1,
} as const
/** Historical Phase 5A provenance remains unchanged for Whakapapa rows. */
export const WHAKAPAPA_CONVERSATION_SPECIFICATION = {
  code: 'whakapapa-reflection',
  version: 1,
} as const

export function conversationSpecificationForPou(pouId: WorkflowPouId) {
  return pouId === 'whakapapa' ? WHAKAPAPA_CONVERSATION_SPECIFICATION : CONVERSATION_SPECIFICATION
}

export const CONVERSATION_STATUSES = ['preparing', 'authorized', 'active', 'ended', 'failed'] as const
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number]

export const TERMINATION_REASONS = [
  'user_ended',
  'navigation',
  'connection_lost',
  'startup_failed',
  'provider_error',
  'provider_id_mismatch',
] as const
export type ConversationTerminationReason = (typeof TERMINATION_REASONS)[number]

export interface ConversationWorkflowState {
  status: 'draft' | 'in_progress' | 'completed' | 'abandoned'
  currentStage: WorkflowStage
  currentPouId: WorkflowPouId | null
  checkpoints: Array<{ pouId: WorkflowPouId; progress: 'not_started' | 'confirmed' }>
}

export class ConversationEligibilityError extends Error {
  constructor(message = 'The workflow is not eligible for a voice conversation at this Pou.') {
    super(message)
    this.name = 'ConversationEligibilityError'
  }
}

/**
 * The first Pou is authoritative at `pou-overview`; every following Pou is
 * authoritative at `pou-convo` after the previous explicit confirmation.
 * Conversation-start eligibility must use the same stage boundary as normal
 * Pou confirmation, rather than retaining the Phase 5A Whakapapa-only stage.
 */
export function assertConversationEligibility(workflow: ConversationWorkflowState, pouId: WorkflowPouId): void {
  if (!['draft', 'in_progress'].includes(workflow.status)) throw new ConversationEligibilityError()
  const expectedStage: WorkflowStage = pouId === 'whakapapa' ? 'pou-overview' : 'pou-convo'
  if (workflow.currentStage !== expectedStage || workflow.currentPouId !== pouId) {
    throw new ConversationEligibilityError()
  }
  const checkpoint = workflow.checkpoints.find((candidate) => candidate.pouId === pouId)
  if (!checkpoint || checkpoint.progress === 'confirmed') throw new ConversationEligibilityError()
}

/** @deprecated Kept for Phase 5A call sites while seven-Pou rollout is introduced. */
export const assertWhakapapaConversationEligibility = assertConversationEligibility

export function isTerminalConversationStatus(status: ConversationStatus): boolean {
  return status === 'ended' || status === 'failed'
}
