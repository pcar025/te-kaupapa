import type {
  WorkflowActionStatus,
  WorkflowActionType,
  WorkflowCommand,
  WorkflowEngagementType,
  WorkflowImmediateConcern,
  WorkflowPouConcern,
  WorkflowPouId,
  WorkflowStage,
  WorkflowStatus,
  WorkflowReferralStatus,
  SafetyBroadClass,
  SafetyObservationContext,
  SafetyObservationConcernLevel,
} from '../shared/workflow'

export interface WorkflowCheckpoint {
  pouId: WorkflowPouId
  ordinal: number
  progress: 'not_started' | 'confirmed'
  userSelectedConcern: WorkflowPouConcern | null
  note: string | null
  referralSuggested: boolean
  supervisorReviewSuggested: boolean
  confirmedAt: string | null
}

export interface Workflow {
  id: string
  reference: string
  status: WorkflowStatus
  currentStage: WorkflowStage
  currentPouId: WorkflowPouId | null
  version: number
  setup: {
    whanauReference: string
    engagementType: WorkflowEngagementType
    sessionFocus: string
    additionalNotes: string | null
    immediateConcern: WorkflowImmediateConcern
  } | null
  checkpoints: WorkflowCheckpoint[]
  actions: WorkflowAction[]
  referrals: WorkflowReferral[]
  safety: WorkflowSafetyState
  structuredReview: WorkflowStructuredReview
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SafetyObservationCurrentView {
  id: string
  assessmentContext: SafetyObservationContext
  pouId: WorkflowPouId | null
  broadClass: SafetyBroadClass
  concernLevel: SafetyObservationConcernLevel
  contextNote: string | null
  status: 'active' | 'retracted'
  currentRevision: number
  confirmedAt: string
  updatedAt: string
  retractedAt: string | null
}

export interface SafetyConsequenceView {
  id: string
  observationId: string
  type: 'supervisor_review_required' | 'supervisor_notification_required'
  requiredAt: string
}

export interface SupervisorReviewRequestView {
  id: string
  pouId: WorkflowPouId | null
  requestNote: string | null
  requestedAt: string
}

export interface WorkflowSafetyIndicators {
  activeObservationCount: number
  urgentObservationCount: number
  supervisorReviewRequired: boolean
  supervisorNotificationRequired: boolean
  manualReviewRequestCount: number
  hasRetractedHistory: boolean
}

export interface WorkflowSafetyState {
  observations: SafetyObservationCurrentView[]
  requiredConsequences: SafetyConsequenceView[]
  supervisorReviewRequests: SupervisorReviewRequestView[]
  indicators: WorkflowSafetyIndicators
}

export interface WhakapapaAssessmentCandidate {
  id: string
  outcome: 'possible_concern' | 'insufficient_information' | 'no_candidate_concern' | 'not_applicable'
  title: string
  description: string
  ruleCode: string
  ruleVersion: number
  matchedProtectiveIndicatorCodes: string[]
  matchedConcernIndicatorCodes: string[]
  missingInformationCodes: string[]
  permittedHumanConcernLevels: SafetyObservationConcernLevel[]
  canonicalBroadClass: SafetyBroadClass | null
}

export interface WhakapapaReviewDraft {
  id: string
  revisionId: string
  revision: number
  overallSummary: string | null
  strengthsSummary: string | null
  areasForAttentionSummary: string | null
  evidenceTurnIds: string[]
  generatedAt: string
}

export interface WhakapapaReviewDraftState {
  status: 'analysing' | 'ready' | 'failed' | 'manual'
  draft: WhakapapaReviewDraft | null
  assessmentCompleted: boolean
  hasReviewableCandidate: boolean
}

export interface WorkflowAction {
  id: string
  pouId: WorkflowPouId | null
  title: string
  type: WorkflowActionType
  dueDate: string | null
  status: WorkflowActionStatus
  notes: string | null
  withdrawnAt: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkflowReferral {
  id: string
  pouId: WorkflowPouId | null
  destinationCode: string | null
  destinationName: string
  reason: string
  handoverNote: string | null
  notes: string | null
  status: WorkflowReferralStatus
  withdrawnAt: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkflowStructuredReview {
  reference: string
  setup: Workflow['setup']
  checkpoints: WorkflowCheckpoint[]
  actions: WorkflowAction[]
  referrals: WorkflowReferral[]
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface WorkflowListItem {
  id: string
  reference: string
  whanauReference: string | null
  status: 'draft' | 'in_progress'
  currentStage: WorkflowStage
  currentPouId: WorkflowPouId | null
  version: number
  updatedAt: string
  safetyIndicators: WorkflowSafetyIndicators
}

export interface CompletedWorkflowListItem {
  id: string
  reference: string
  whanauReference: string | null
  completedAt: string
  updatedAt: string
  safetyIndicators: WorkflowSafetyIndicators
}

export type WorkflowPersistenceState = 'idle' | 'saving' | 'retrying' | 'saved' | 'failed' | 'failed-safety' | 'stale' | 'stale-safety'

export class WorkflowApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly currentVersion?: number,
    public readonly currentRevision?: number,
  ) {
    super(code)
    this.name = 'WorkflowApiError'
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  })
  const payload = await response.json().catch(() => ({})) as { error?: string; currentVersion?: number; currentRevision?: number }
  if (!response.ok) throw new WorkflowApiError(payload.error ?? 'request_failed', response.status, payload.currentVersion, payload.currentRevision)
  return payload as T
}

export async function createWorkflow(idempotencyKey: string): Promise<{ workflow: Workflow; replayed: boolean }> {
  const payload = await requestJson<{ workflow: Workflow; acknowledgement: { replayed: boolean } }>('/api/workflows', {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey }),
  })
  return { workflow: payload.workflow, replayed: payload.acknowledgement.replayed }
}

export async function listResumableWorkflows(): Promise<WorkflowListItem[]> {
  const payload = await requestJson<{ workflows: WorkflowListItem[] }>('/api/workflows?status=resumable')
  return payload.workflows
}

export async function listCompletedWorkflows(): Promise<CompletedWorkflowListItem[]> {
  const payload = await requestJson<{ workflows: CompletedWorkflowListItem[] }>('/api/workflows?status=completed')
  return payload.workflows
}

export async function getWorkflow(workflowId: string): Promise<Workflow> {
  const payload = await requestJson<{ workflow: Workflow }>(`/api/workflows/${encodeURIComponent(workflowId)}`)
  return payload.workflow
}

export async function getWhakapapaAssessmentCandidates(workflowId: string): Promise<WhakapapaAssessmentCandidate[]> {
  const payload = await requestJson<{ candidates: WhakapapaAssessmentCandidate[] }>(`/api/workflows/${encodeURIComponent(workflowId)}/pou/whakapapa/assessment-candidates`)
  // An empty response is treated as no completed assessment. This keeps the
  // manual Whakapapa review available through an interrupted/older response.
  return Array.isArray(payload.candidates) ? payload.candidates : []
}

export async function getWhakapapaReviewDraft(workflowId: string): Promise<WhakapapaReviewDraftState> {
  const payload = await requestJson<{ review: WhakapapaReviewDraftState }>(`/api/workflows/${encodeURIComponent(workflowId)}/pou/whakapapa/review-draft`)
  return payload.review
}

export async function markWhakapapaReviewDraftReviewed(workflowId: string, reviewDraftId: string): Promise<void> {
  await requestJson(`/api/workflows/${encodeURIComponent(workflowId)}/pou/whakapapa/review-drafts/${encodeURIComponent(reviewDraftId)}/reviewed`, { method: 'POST' })
}

export async function editWhakapapaReviewDraft(workflowId: string, input: { reviewDraftId: string; expectedRevision: number; overallSummary: string | null; strengthsSummary: string | null; areasForAttentionSummary: string | null; evidenceTurnIds: string[] }): Promise<WhakapapaReviewDraft> {
  const payload = await requestJson<{ draft: WhakapapaReviewDraft }>(`/api/workflows/${encodeURIComponent(workflowId)}/pou/whakapapa/review-draft`, { method: 'PUT', body: JSON.stringify(input) })
  return payload.draft
}

export async function reviewWhakapapaAssessmentCandidate(workflowId: string, assessmentId: string, status: 'dismissed' | 'insufficient_information_acknowledged'): Promise<void> {
  await requestJson(`/api/workflows/${encodeURIComponent(workflowId)}/assessment-candidates/${encodeURIComponent(assessmentId)}/review`, { method: 'POST', body: JSON.stringify({ status }) })
}

export async function submitWorkflowCommand(workflowId: string, command: WorkflowCommand): Promise<{ workflow: Workflow; replayed: boolean }> {
  const payload = await requestJson<{ workflow: Workflow; acknowledgement: { replayed: boolean } }>(
    `/api/workflows/${encodeURIComponent(workflowId)}/interactions`,
    { method: 'POST', body: JSON.stringify(command) },
  )
  return { workflow: payload.workflow, replayed: payload.acknowledgement.replayed }
}
