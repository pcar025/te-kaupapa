import { describe, expect, it } from 'vitest'

import { evaluateConfirmedSafetyObservation, SAFETY_RULE_CODE, SAFETY_RULE_VERSION } from './domain.js'

describe('confirmed safety observation evaluation', () => {
  it.each([
    ['setup', 'urgent'],
    ['Pou', 'urgent'],
  ] as const)('creates the two approved consequences for an active urgent %s observation', (_context, concernLevel) => {
    expect(evaluateConfirmedSafetyObservation({ concernLevel, status: 'active' })).toEqual({
      ruleCode: SAFETY_RULE_CODE,
      ruleVersion: SAFETY_RULE_VERSION,
      decisionCode: 'urgent_supervisor_attention_required',
      consequenceTypes: ['supervisor_review_required', 'supervisor_notification_required'],
    })
  })

  it.each(['unsure', 'low', 'watch', 'action'] as const)('does not create an approved consequence for %s', (concernLevel) => {
    expect(evaluateConfirmedSafetyObservation({ concernLevel, status: 'active' })).toMatchObject({
      ruleCode: SAFETY_RULE_CODE,
      ruleVersion: SAFETY_RULE_VERSION,
      decisionCode: 'no_approved_consequence',
      consequenceTypes: [],
    })
  })

  it('does not retain consequences for a retracted urgent observation', () => {
    expect(evaluateConfirmedSafetyObservation({ concernLevel: 'urgent', status: 'retracted' })).toMatchObject({
      decisionCode: 'no_approved_consequence',
      consequenceTypes: [],
    })
  })
})
