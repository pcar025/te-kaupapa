import { describe, expect, it } from 'vitest'

import { assertConversationEligibility, assertWhakapapaConversationEligibility, ConversationEligibilityError, isTerminalConversationStatus } from './domain.js'

const eligibleWorkflow = {
  status: 'in_progress' as const,
  currentStage: 'pou-overview' as const,
  currentPouId: 'whakapapa' as const,
  checkpoints: [
    { pouId: 'whakapapa' as const, progress: 'not_started' as const },
  ],
}

describe('Whakapapa conversation eligibility', () => {
  it('accepts the first Pou at its authoritative pou-overview checkpoint', () => {
    expect(() => assertWhakapapaConversationEligibility(eligibleWorkflow, 'whakapapa')).not.toThrow()
  })

  it('uses the authoritative stage for the current Pou', () => {
    expect(() => assertWhakapapaConversationEligibility({ ...eligibleWorkflow, status: 'completed' }, 'whakapapa')).toThrow(ConversationEligibilityError)
    expect(() => assertWhakapapaConversationEligibility({ ...eligibleWorkflow, status: 'abandoned' }, 'whakapapa')).toThrow(ConversationEligibilityError)
    expect(() => assertWhakapapaConversationEligibility({ ...eligibleWorkflow, currentStage: 'pou-convo' }, 'whakapapa')).toThrow(ConversationEligibilityError)
    expect(() => assertWhakapapaConversationEligibility({ ...eligibleWorkflow, checkpoints: [{ pouId: 'whakapapa', progress: 'confirmed' }] }, 'whakapapa')).toThrow(ConversationEligibilityError)

    const manaakitangaWorkflow = {
      ...eligibleWorkflow,
      currentStage: 'pou-convo' as const,
      currentPouId: 'manaakitanga' as const,
      checkpoints: [{ pouId: 'manaakitanga' as const, progress: 'not_started' as const }],
    }
    expect(() => assertConversationEligibility(manaakitangaWorkflow, 'manaakitanga')).not.toThrow()
    expect(() => assertConversationEligibility({ ...manaakitangaWorkflow, currentStage: 'pou-overview' }, 'manaakitanga')).toThrow(ConversationEligibilityError)
    expect(() => assertConversationEligibility({ ...manaakitangaWorkflow, checkpoints: [{ pouId: 'manaakitanga', progress: 'confirmed' }] }, 'manaakitanga')).toThrow(ConversationEligibilityError)
  })

  it('keeps only ended and failed statuses terminal', () => {
    expect(isTerminalConversationStatus('ended')).toBe(true)
    expect(isTerminalConversationStatus('failed')).toBe(true)
    expect(isTerminalConversationStatus('active')).toBe(false)
  })
})
