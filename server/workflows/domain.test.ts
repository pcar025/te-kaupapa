import { describe, expect, it } from 'vitest'

import type { WorkflowCheckpoint } from '../../shared/workflow.js'

import {
  checkpointAfterActionPlan,
  checkpointAfterCompletion,
  checkpointAfterPouReview,
  checkpointAfterPouSummary,
  checkpointAfterReferralPlan,
  checkpointAfterSetup,
  checkpointAfterStructuredReview,
  assertPreReflectionReadiness,
  initialWorkflowCheckpoint,
  WorkflowReadinessError,
  WorkflowTransitionError,
} from './domain.js'

describe('workflow checkpoints', () => {
  it('requires all three explicit pre-reflection confirmations', () => {
    expect(() => assertPreReflectionReadiness({
      verbalConsentConfirmed: true,
      writtenConsentConfirmed: false,
      initialRiskAssessmentCompleted: true,
    })).toThrow(WorkflowReadinessError)
    expect(() => assertPreReflectionReadiness({
      verbalConsentConfirmed: true,
      writtenConsentConfirmed: true,
      initialRiskAssessmentCompleted: true,
    })).not.toThrow()
  })

  it('starts as a draft setup checkpoint and enters the first Pou after setup', () => {
    expect(initialWorkflowCheckpoint()).toEqual({ stage: 'setup', currentPouId: null })
    expect(checkpointAfterSetup()).toEqual({ stage: 'pou-overview', currentPouId: 'kaitiakitanga' })
  })

  it('advances through all seven Pou and stops at the approved pou-summary boundary', () => {
    let checkpoint = checkpointAfterSetup()
    const pou = ['kaitiakitanga', 'tikanga', 'whakapapa', 'manaakitanga', 'puukenga', 'haepapa', 'oranga'] as const

    for (const pouId of pou) checkpoint = checkpointAfterPouReview(checkpoint, pouId, false)

    expect(checkpoint).toEqual({ stage: 'pou-summary', currentPouId: null })
  })

  it('allows a prior acknowledged Pou to be revised without moving the resume checkpoint', () => {
    const checkpoint = { stage: 'pou-convo' as const, currentPouId: 'tikanga' as const }
    expect(checkpointAfterPouReview(checkpoint, 'whakapapa', true)).toEqual(checkpoint)
  })

  it('rejects skipped or out-of-order Pou confirmation', () => {
    expect(() => checkpointAfterPouReview(checkpointAfterSetup(), 'tikanga', false)).toThrow(WorkflowTransitionError)
    expect(() => checkpointAfterPouReview(initialWorkflowCheckpoint(), 'kaitiakitanga', false)).toThrow(WorkflowTransitionError)
  })

  it('continues a historic workflow through its persisted semantic order', () => {
    const historic = ['whakapapa', 'manaakitanga', 'tikanga', 'kaitiakitanga', 'puukenga', 'haepapa', 'oranga'] as const
    expect(checkpointAfterPouReview({ stage: 'pou-convo', currentPouId: 'manaakitanga' }, 'manaakitanga', false, historic)).toEqual({ stage: 'pou-convo', currentPouId: 'tikanga' })
  })

  it('advances through the approved downstream review and completion checkpoints', () => {
    let checkpoint: WorkflowCheckpoint = { stage: 'pou-summary', currentPouId: null }
    checkpoint = checkpointAfterPouSummary(checkpoint)
    expect(checkpoint).toEqual({ stage: 'action-planning', currentPouId: null })
    checkpoint = checkpointAfterActionPlan(checkpoint)
    expect(checkpoint).toEqual({ stage: 'referral-planning', currentPouId: null })
    checkpoint = checkpointAfterReferralPlan(checkpoint)
    expect(checkpoint).toEqual({ stage: 'structured-review', currentPouId: null })
    checkpoint = checkpointAfterStructuredReview(checkpoint)
    expect(checkpoint).toEqual({ stage: 'record-review', currentPouId: null })
    expect(checkpointAfterCompletion(checkpoint)).toEqual({ stage: 'complete', currentPouId: null })
  })

  it('rejects skipped downstream transitions', () => {
    expect(() => checkpointAfterActionPlan({ stage: 'pou-summary', currentPouId: null })).toThrow(WorkflowTransitionError)
    expect(() => checkpointAfterCompletion({ stage: 'structured-review', currentPouId: null })).toThrow(WorkflowTransitionError)
  })
})
