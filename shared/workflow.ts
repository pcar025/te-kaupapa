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

export const SAFETY_BROAD_CLASSES = ['whanau_safety', 'practice_quality', 'practitioner_wellbeing'] as const
export type SafetyBroadClass = (typeof SAFETY_BROAD_CLASSES)[number]

export const SAFETY_OBSERVATION_CONTEXTS = ['setup', 'pou'] as const
export type SafetyObservationContext = (typeof SAFETY_OBSERVATION_CONTEXTS)[number]

export const SAFETY_OBSERVATION_CONCERN_LEVELS = ['unsure', 'low', 'watch', 'action', 'urgent'] as const
export type SafetyObservationConcernLevel = (typeof SAFETY_OBSERVATION_CONCERN_LEVELS)[number]

export interface SafetyObservationSnapshotInput {
  assessmentContext: SafetyObservationContext
  pouId?: WorkflowPouId
  broadClass: SafetyBroadClass
  concernLevel: SafetyObservationConcernLevel
  contextNote?: string
}

export const WORKFLOW_STATUSES = ['draft', 'in_progress', 'completed', 'abandoned'] as const
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

export const WORKFLOW_STAGES = [
  'setup',
  'pou-overview',
  'pou-convo',
  'pou-summary',
  'action-planning',
  'referral-planning',
  'structured-review',
  'record-review',
  'complete',
] as const
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number]

export const WORKFLOW_ACTION_TYPES = ['follow-up', 'support', 'other'] as const
export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number]

export const WORKFLOW_ACTION_STATUSES = ['open', 'completed', 'withdrawn'] as const
export type WorkflowActionStatus = (typeof WORKFLOW_ACTION_STATUSES)[number]

export const WORKFLOW_REFERRAL_STATUSES = ['draft', 'prepared', 'declined', 'withdrawn'] as const
export type WorkflowReferralStatus = (typeof WORKFLOW_REFERRAL_STATUSES)[number]

export const WORKFLOW_INTERACTION_TYPES = [
  'workflow_created',
  'setup_confirmed',
  'pou_review_confirmed',
  'pou_summary_confirmed',
  'action_plan_confirmed',
  'referral_plan_confirmed',
  'structured_review_confirmed',
  'workflow_completed',
  'safety_observation_confirmed',
  'safety_observation_corrected',
  'safety_observation_retracted',
  'supervisor_review_requested',
] as const
export type WorkflowInteractionType = (typeof WORKFLOW_INTERACTION_TYPES)[number]

export interface WorkflowActionInput {
  id: string
  title: string
  type: WorkflowActionType
  pouId?: WorkflowPouId
  dueDate?: string
  status: Exclude<WorkflowActionStatus, 'withdrawn'>
  notes?: string
}

export interface WorkflowReferralInput {
  id: string
  destinationCode?: string
  destinationName: string
  reason: string
  pouId?: WorkflowPouId
  handoverNote?: string
  notes?: string
  status: Exclude<WorkflowReferralStatus, 'withdrawn'>
}

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
  | {
      type: 'pou-summary-confirmed'
      idempotencyKey: string
      expectedVersion: number
    }
  | {
      type: 'action-plan-confirmed'
      idempotencyKey: string
      expectedVersion: number
      actions: WorkflowActionInput[]
    }
  | {
      type: 'referral-plan-confirmed'
      idempotencyKey: string
      expectedVersion: number
      referrals: WorkflowReferralInput[]
    }
  | {
      type: 'structured-review-confirmed'
      idempotencyKey: string
      expectedVersion: number
    }
  | {
      type: 'workflow-completed'
      idempotencyKey: string
      expectedVersion: number
    }
  | {
      type: 'safety-observation-confirmed'
      observationId: string
      idempotencyKey: string
      expectedVersion: number
      observation: SafetyObservationSnapshotInput
      /**
       * Optional provenance for an explicitly human-confirmed Phase 5B
       * assessment candidate. The browser never supplies classification source.
       */
      candidateAssessmentId?: string
    }
  | {
      type: 'safety-observation-corrected'
      observationId: string
      expectedObservationRevision: number
      idempotencyKey: string
      expectedVersion: number
      replacement: SafetyObservationSnapshotInput
      reason: string
    }
  | {
      type: 'safety-observation-retracted'
      observationId: string
      expectedObservationRevision: number
      idempotencyKey: string
      expectedVersion: number
      reason: string
    }
  | {
      type: 'supervisor-review-requested'
      requestId: string
      idempotencyKey: string
      expectedVersion: number
      pouId?: WorkflowPouId
      requestNote?: string
    }

export interface WorkflowCheckpoint {
  stage: WorkflowStage
  currentPouId: WorkflowPouId | null
}

export function isWorkflowPouId(value: string): value is WorkflowPouId {
  return (WORKFLOW_POU_IDS as readonly string[]).includes(value)
}
