import type { SafetyObservationConcernLevel } from '../../shared/workflow.js'

export const SAFETY_RULE_CODE = 'te-kaupapa.safety.urgent-supervisor-attention'
export const SAFETY_RULE_VERSION = 1
export const SAFETY_DECISIONS = ['no_approved_consequence', 'urgent_supervisor_attention_required'] as const
export type SafetyDecisionCode = (typeof SAFETY_DECISIONS)[number]

export const SAFETY_CONSEQUENCE_TYPES = ['supervisor_review_required', 'supervisor_notification_required'] as const
export type SafetyConsequenceType = (typeof SAFETY_CONSEQUENCE_TYPES)[number]

export interface SafetyObservationForEvaluation {
  concernLevel: SafetyObservationConcernLevel
  status: 'active' | 'retracted'
}

export interface SafetyPolicyEvaluation {
  ruleCode: typeof SAFETY_RULE_CODE
  ruleVersion: typeof SAFETY_RULE_VERSION
  decisionCode: SafetyDecisionCode
  consequenceTypes: SafetyConsequenceType[]
}

export function evaluateConfirmedSafetyObservation(observation: SafetyObservationForEvaluation): SafetyPolicyEvaluation {
  if (observation.status === 'active' && observation.concernLevel === 'urgent') {
    return {
      ruleCode: SAFETY_RULE_CODE,
      ruleVersion: SAFETY_RULE_VERSION,
      decisionCode: 'urgent_supervisor_attention_required',
      consequenceTypes: ['supervisor_review_required', 'supervisor_notification_required'],
    }
  }

  return {
    ruleCode: SAFETY_RULE_CODE,
    ruleVersion: SAFETY_RULE_VERSION,
    decisionCode: 'no_approved_consequence',
    consequenceTypes: [],
  }
}
