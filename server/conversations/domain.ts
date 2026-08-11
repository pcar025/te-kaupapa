import type { WorkflowPouId, WorkflowStage } from '../../shared/workflow.js'

export const CONVERSATION_PROVIDER = 'elevenlabs' as const
export const WHAKAPAPA_CONVERSATION_SPECIFICATION = {
  code: 'whakapapa-reflection',
  version: 1,
} as const

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
  constructor(message = 'The workflow is not eligible for a Whakapapa voice conversation.') {
    super(message)
    this.name = 'ConversationEligibilityError'
  }
}

/**
 * Phase 5A deliberately supports Whakapapa only. The first persisted Pou is
 * authoritative at `pou-overview`, not `pou-convo`; the latter is currently a
 * local UI stage before manual confirmation advances the workflow.
 */
export function assertWhakapapaConversationEligibility(workflow: ConversationWorkflowState, pouId: WorkflowPouId): void {
  if (pouId !== 'whakapapa') throw new ConversationEligibilityError()
  if (!['draft', 'in_progress'].includes(workflow.status)) throw new ConversationEligibilityError()
  if (workflow.currentStage !== 'pou-overview' || workflow.currentPouId !== 'whakapapa') {
    throw new ConversationEligibilityError()
  }
  const checkpoint = workflow.checkpoints.find((candidate) => candidate.pouId === 'whakapapa')
  if (!checkpoint || checkpoint.progress === 'confirmed') throw new ConversationEligibilityError()
}

export function isTerminalConversationStatus(status: ConversationStatus): boolean {
  return status === 'ended' || status === 'failed'
}
