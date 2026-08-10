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
  structuredReview: WorkflowStructuredReview
  completedAt: string | null
  createdAt: string
  updatedAt: string
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
}

export interface CompletedWorkflowListItem {
  id: string
  reference: string
  whanauReference: string | null
  completedAt: string
  updatedAt: string
}

export type WorkflowPersistenceState = 'idle' | 'saving' | 'retrying' | 'saved' | 'failed' | 'stale'

export class WorkflowApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly currentVersion?: number,
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
  const payload = await response.json().catch(() => ({})) as { error?: string; currentVersion?: number }
  if (!response.ok) throw new WorkflowApiError(payload.error ?? 'request_failed', response.status, payload.currentVersion)
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

export async function submitWorkflowCommand(workflowId: string, command: WorkflowCommand): Promise<{ workflow: Workflow; replayed: boolean }> {
  const payload = await requestJson<{ workflow: Workflow; acknowledgement: { replayed: boolean } }>(
    `/api/workflows/${encodeURIComponent(workflowId)}/interactions`,
    { method: 'POST', body: JSON.stringify(command) },
  )
  return { workflow: payload.workflow, replayed: payload.acknowledgement.replayed }
}
