import { describe, expect, it } from 'vitest'

import { assertConversationEligibility, assertWhakapapaConversationEligibility, ConversationEligibilityError, isTerminalConversationStatus } from './domain.js'

const eligibleWorkflow = {
  status: 'in_progress' as const,
  currentStage: 'pou-overview' as const,
  currentPouId: 'kaitiakitanga' as const,
  checkpoints: [
    { pouId: 'kaitiakitanga' as const, ordinal: 1, progress: 'not_started' as const },
  ],
}

describe('Pou conversation eligibility', () => {
  it('accepts the first Pou at its authoritative pou-overview checkpoint', () => {
    expect(() => assertWhakapapaConversationEligibility(eligibleWorkflow, 'kaitiakitanga')).not.toThrow()
  })

  it('uses the authoritative stage for the current Pou', () => {
    expect(() => assertWhakapapaConversationEligibility({ ...eligibleWorkflow, status: 'completed' }, 'kaitiakitanga')).toThrow(ConversationEligibilityError)
    expect(() => assertWhakapapaConversationEligibility({ ...eligibleWorkflow, status: 'abandoned' }, 'kaitiakitanga')).toThrow(ConversationEligibilityError)
    expect(() => assertWhakapapaConversationEligibility({ ...eligibleWorkflow, currentStage: 'pou-convo' }, 'kaitiakitanga')).toThrow(ConversationEligibilityError)
    expect(() => assertWhakapapaConversationEligibility({ ...eligibleWorkflow, checkpoints: [{ pouId: 'kaitiakitanga', ordinal: 1, progress: 'confirmed' }] }, 'kaitiakitanga')).toThrow(ConversationEligibilityError)

    const manaakitangaWorkflow = {
      ...eligibleWorkflow,
      currentStage: 'pou-convo' as const,
      currentPouId: 'tikanga' as const,
      checkpoints: [{ pouId: 'kaitiakitanga' as const, ordinal: 1, progress: 'confirmed' as const }, { pouId: 'tikanga' as const, ordinal: 2, progress: 'not_started' as const }],
    }
    expect(() => assertConversationEligibility(manaakitangaWorkflow, 'tikanga')).not.toThrow()
    expect(() => assertConversationEligibility({ ...manaakitangaWorkflow, currentStage: 'pou-overview' }, 'tikanga')).toThrow(ConversationEligibilityError)
    expect(() => assertConversationEligibility({ ...manaakitangaWorkflow, checkpoints: [{ pouId: 'kaitiakitanga', ordinal: 1, progress: 'confirmed' }, { pouId: 'tikanga', ordinal: 2, progress: 'confirmed' }] }, 'tikanga')).toThrow(ConversationEligibilityError)
  })

  it('keeps a historic first Whakapapa workflow eligible at its stored overview checkpoint', () => {
    expect(() => assertConversationEligibility({
      status: 'in_progress', currentStage: 'pou-overview', currentPouId: 'whakapapa',
      checkpoints: [{ pouId: 'whakapapa', ordinal: 1, progress: 'not_started' }],
    }, 'whakapapa')).not.toThrow()
  })

  it('keeps only ended and failed statuses terminal', () => {
    expect(isTerminalConversationStatus('ended')).toBe(true)
    expect(isTerminalConversationStatus('failed')).toBe(true)
    expect(isTerminalConversationStatus('active')).toBe(false)
  })
})
