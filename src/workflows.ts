import type {
  WorkflowActionStatus,
  WorkflowActionType,
  WorkflowCarryForwardItem,
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
  carryForwards: WorkflowCarryForwardItem[]
  pouReviews: Array<{
    pouId: WorkflowPouId
    overallSummary: string | null
    strengthsSummary: string | null
    areasForAttentionSummary: string | null
    confirmedAt: string
  }>
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

export interface PouAssessmentCandidate {
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
export type WhakapapaAssessmentCandidate = PouAssessmentCandidate

export interface PouReviewDraft {
  id: string
  revisionId: string
  revision: number
  overallSummary: string | null
  strengthsSummary: string | null
  areasForAttentionSummary: string | null
  evidenceTurnIds: string[]
  criterionAssessments?: Array<{
    criterionCode: string
    label: string
    strengthsOrProtective: boolean
    areasForAttention: boolean
    status: 'evidenced' | 'partially_evidenced' | 'not_explored' | 'insufficient_information' | 'not_applicable'
    evidenceTurnIds: string[]
    missingInformationCodes: string[]
  }>
  generatedAt: string
}
export type WhakapapaReviewDraft = PouReviewDraft

export interface PouReviewDraftState {
  status: 'analysing' | 'ready' | 'failed' | 'manual'
  draft: PouReviewDraft | null
  assessmentCompleted: boolean
  hasReviewableCandidate: boolean
}
export type WhakapapaReviewDraftState = PouReviewDraftState

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
  carryForwards: WorkflowCarryForwardItem[]
  pouReviews: Workflow['pouReviews']
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

export async function getPouAssessmentCandidates(workflowId: string, pouId: WorkflowPouId): Promise<PouAssessmentCandidate[]> {
  const payload = await requestJson<{ candidates: PouAssessmentCandidate[] }>(`/api/workflows/${encodeURIComponent(workflowId)}/pou/${encodeURIComponent(pouId)}/assessment-candidates`)
  // An empty response keeps manual Pou review available through interruption.
  return Array.isArray(payload.candidates) ? payload.candidates : []
}

export const getWhakapapaAssessmentCandidates = (workflowId: string) => getPouAssessmentCandidates(workflowId, 'whakapapa')

export async function getPouReviewDraft(workflowId: string, pouId: WorkflowPouId): Promise<PouReviewDraftState> {
  const payload = await requestJson<{ review: PouReviewDraftState }>(`/api/workflows/${encodeURIComponent(workflowId)}/pou/${encodeURIComponent(pouId)}/review-draft`)
  return payload.review
}
export const getWhakapapaReviewDraft = (workflowId: string) => getPouReviewDraft(workflowId, 'whakapapa')

export async function markPouReviewDraftReviewed(workflowId: string, pouId: WorkflowPouId, reviewDraftId: string): Promise<void> {
  await requestJson(`/api/workflows/${encodeURIComponent(workflowId)}/pou/${encodeURIComponent(pouId)}/review-drafts/${encodeURIComponent(reviewDraftId)}/reviewed`, { method: 'POST' })
}
export const markWhakapapaReviewDraftReviewed = (workflowId: string, reviewDraftId: string) => markPouReviewDraftReviewed(workflowId, 'whakapapa', reviewDraftId)

export async function editPouReviewDraft(workflowId: string, pouId: WorkflowPouId, input: { reviewDraftId: string; expectedRevision: number; overallSummary: string | null; strengthsSummary: string | null; areasForAttentionSummary: string | null; evidenceTurnIds: string[] }): Promise<PouReviewDraft> {
  const payload = await requestJson<{ draft: PouReviewDraft }>(`/api/workflows/${encodeURIComponent(workflowId)}/pou/${encodeURIComponent(pouId)}/review-draft`, { method: 'PUT', body: JSON.stringify(input) })
  return payload.draft
}
export const editWhakapapaReviewDraft = (workflowId: string, input: Parameters<typeof editPouReviewDraft>[2]) => editPouReviewDraft(workflowId, 'whakapapa', input)

export async function reviewPouAssessmentCandidate(workflowId: string, assessmentId: string, status: 'dismissed' | 'insufficient_information_acknowledged'): Promise<void> {
  await requestJson(`/api/workflows/${encodeURIComponent(workflowId)}/assessment-candidates/${encodeURIComponent(assessmentId)}/review`, { method: 'POST', body: JSON.stringify({ status }) })
}
/** Historical Phase 5B name retained for existing callers. */
export const reviewWhakapapaAssessmentCandidate = reviewPouAssessmentCandidate

export async function submitWorkflowCommand(workflowId: string, command: WorkflowCommand): Promise<{ workflow: Workflow; replayed: boolean }> {
  const payload = await requestJson<{ workflow: Workflow; acknowledgement: { replayed: boolean } }>(
    `/api/workflows/${encodeURIComponent(workflowId)}/interactions`,
    { method: 'POST', body: JSON.stringify(command) },
  )
  return { workflow: payload.workflow, replayed: payload.acknowledgement.replayed }
}

export async function markCarryForward(workflowId: string, command: Extract<WorkflowCommand, { type: 'carry-forward-marked' }>): Promise<{ workflow: Workflow; replayed: boolean }> {
  return submitWorkflowCommand(workflowId, command)
}
