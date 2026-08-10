import { describe, expect, it } from 'vitest'

import { checkpointAfterPouReview, checkpointAfterSetup, initialWorkflowCheckpoint, WorkflowTransitionError } from './domain.js'

describe('Milestone 2 workflow checkpoints', () => {
  it('starts as a draft setup checkpoint and enters the first Pou after setup', () => {
    expect(initialWorkflowCheckpoint()).toEqual({ stage: 'setup', currentPouId: null })
    expect(checkpointAfterSetup()).toEqual({ stage: 'pou-overview', currentPouId: 'whakapapa' })
  })

  it('advances through all seven Pou and stops at the approved pou-summary boundary', () => {
    let checkpoint = checkpointAfterSetup()
    const pou = ['whakapapa', 'manaakitanga', 'tikanga', 'kaitiakitanga', 'puukenga', 'haepapa', 'oranga'] as const

    for (const pouId of pou) checkpoint = checkpointAfterPouReview(checkpoint, pouId, false)

    expect(checkpoint).toEqual({ stage: 'pou-summary', currentPouId: null })
  })

  it('allows a prior acknowledged Pou to be revised without moving the resume checkpoint', () => {
    const checkpoint = { stage: 'pou-convo' as const, currentPouId: 'manaakitanga' as const }
    expect(checkpointAfterPouReview(checkpoint, 'whakapapa', true)).toEqual(checkpoint)
  })

  it('rejects skipped or out-of-order Pou confirmation', () => {
    expect(() => checkpointAfterPouReview(checkpointAfterSetup(), 'manaakitanga', false)).toThrow(WorkflowTransitionError)
    expect(() => checkpointAfterPouReview(initialWorkflowCheckpoint(), 'whakapapa', false)).toThrow(WorkflowTransitionError)
  })
})
