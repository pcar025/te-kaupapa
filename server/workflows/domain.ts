import {
  WORKFLOW_POU_IDS,
  type WorkflowCheckpoint,
  type WorkflowPouId,
  type WorkflowStage,
} from '../../shared/workflow.js'

export class WorkflowTransitionError extends Error {
  constructor(message = 'The workflow is not at the required checkpoint.') {
    super(message)
    this.name = 'WorkflowTransitionError'
  }
}

export function initialWorkflowCheckpoint(): WorkflowCheckpoint {
  return { stage: 'setup', currentPouId: null }
}

export function checkpointAfterSetup(): WorkflowCheckpoint {
  return { stage: 'pou-overview', currentPouId: WORKFLOW_POU_IDS[0] }
}

export function checkpointAfterPouReview(
  checkpoint: WorkflowCheckpoint,
  pouId: WorkflowPouId,
  alreadyConfirmed: boolean,
): WorkflowCheckpoint {
  const pouIndex = WORKFLOW_POU_IDS.indexOf(pouId)
  if (pouIndex === -1) throw new WorkflowTransitionError('The Pou is not recognised.')

  if (alreadyConfirmed) return checkpoint

  const expectedStage: WorkflowStage = pouIndex === 0 ? 'pou-overview' : 'pou-convo'
  if (checkpoint.stage !== expectedStage || checkpoint.currentPouId !== pouId) {
    throw new WorkflowTransitionError()
  }

  const nextPouId = WORKFLOW_POU_IDS[pouIndex + 1]
  return nextPouId
    ? { stage: 'pou-convo', currentPouId: nextPouId }
    : { stage: 'pou-summary', currentPouId: null }
}
