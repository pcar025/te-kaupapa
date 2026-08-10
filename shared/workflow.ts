export const WORKFLOW_POU_IDS = [
  'whakapapa',
  'manaakitanga',
  'tikanga',
  'kaitiakitanga',
  'puukenga',
  'haepapa',
  'oranga',
] as const

export type WorkflowPouId = (typeof WORKFLOW_POU_IDS)[number]

export const WORKFLOW_ENGAGEMENT_TYPES = [
  'home-visit',
  'phone',
  'office',
  'hui',
  'outreach',
] as const

export type WorkflowEngagementType = (typeof WORKFLOW_ENGAGEMENT_TYPES)[number]

export const WORKFLOW_IMMEDIATE_CONCERNS = ['none', 'unsure', 'urgent'] as const
export type WorkflowImmediateConcern = (typeof WORKFLOW_IMMEDIATE_CONCERNS)[number]

export const WORKFLOW_POU_CONCERNS = ['low', 'watch', 'action', 'urgent'] as const
export type WorkflowPouConcern = (typeof WORKFLOW_POU_CONCERNS)[number]

export const WORKFLOW_STATUSES = ['draft', 'in_progress', 'completed', 'abandoned'] as const
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

export const WORKFLOW_STAGES = ['setup', 'pou-overview', 'pou-convo', 'pou-summary'] as const
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number]

export const WORKFLOW_INTERACTION_TYPES = [
  'workflow_created',
  'setup_confirmed',
  'pou_review_confirmed',
] as const
export type WorkflowInteractionType = (typeof WORKFLOW_INTERACTION_TYPES)[number]

export type WorkflowCommand =
  | {
      type: 'setup-confirmed'
      idempotencyKey: string
      expectedVersion: number
      whanauReference: string
      engagementType: WorkflowEngagementType
      sessionFocus: string
      additionalNotes?: string
      immediateConcern: WorkflowImmediateConcern
    }
  | {
      type: 'pou-review-confirmed'
      idempotencyKey: string
      expectedVersion: number
      pouId: WorkflowPouId
      userSelectedConcern: WorkflowPouConcern
      note?: string
      referralSuggested: boolean
      supervisorReviewSuggested: boolean
    }

export interface WorkflowCheckpoint {
  stage: WorkflowStage
  currentPouId: WorkflowPouId | null
}

export function isWorkflowPouId(value: string): value is WorkflowPouId {
  return (WORKFLOW_POU_IDS as readonly string[]).includes(value)
}
