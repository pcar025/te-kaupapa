import { describe, expect, it } from 'vitest'

import { approvedWhakapapaPilotV01, contentHash, providerProjection } from './domain.js'
import { ConversationAssessmentProviderError, OpenAIConversationAssessmentProvider } from './assessment-provider.js'

const projection = providerProjection(approvedWhakapapaPilotV01({ approvedForPilotBy: '11111111-1111-4111-8111-111111111111', approvedForPilotAt: '2026-08-12T00:00:00.000Z' }), { projectionCode: 'test', projectionVersion: '1' })
const turns = [{ id: '22222222-2222-4222-8222-222222222222', ordinal: 1, speaker: 'unknown' as const, text: 'SYNTHETIC_TRANSCRIPT_ONLY', providerSequence: null, providerTimestamp: null }]
const input = { transcriptTurns: turns, assessmentProjection: projection }
const valid = { assessments: projection.rules.map((rule) => ({ ruleCode: rule.ruleCode, ruleVersion: rule.ruleVersion, outcome: 'no_candidate_concern', candidateConcernLevel: null, matchedProtectiveIndicatorCodes: [rule.protectiveIndicators[0]!.code], matchedConcernIndicatorCodes: [], missingInformationCodes: [], uncertaintyReasonCodes: [], applicabilityReasonCode: null, evidenceTurnIds: [turns[0]!.id] })) }

describe('OpenAIConversationAssessmentProvider', () => {
  it('uses non-stored strict structured output then independently validates bounded results', async () => {
    let request: RequestInit | undefined
    const provider = new OpenAIConversationAssessmentProvider({ apiKey: 'server-only-test-key', model: 'model-test' }, async (_url, init) => { request = init; return new Response(JSON.stringify({ output_text: JSON.stringify(valid) }), { status: 200 }) })
    const result = await provider.assessPouConversation(input)
    expect(result.assessment.assessments).toHaveLength(3)
    expect(result.model).toBe('model-test')
    const body = JSON.parse(String(request?.body))
    expect(body.store).toBe(false); expect(body.background).toBe(false); expect(body.text.format.strict).toBe(true)
    expect(JSON.stringify(body.text.format.schema)).toContain('WHAKAPAPA_CULTURAL_DISTRESS_003')
  })
  it('rejects malformed, unknown, and provider-severity results after strict output', async () => {
    for (const result of [{ assessments: valid.assessments.slice(1) }, { assessments: valid.assessments.map((item, index) => index === 0 ? { ...item, ruleCode: 'unknown.rule' } : item) }, { assessments: valid.assessments.map((item, index) => index === 0 ? { ...item, candidateConcernLevel: 'low' } : item) }]) {
      const provider = new OpenAIConversationAssessmentProvider({ apiKey: 'key', model: 'model' }, async () => new Response(JSON.stringify({ output_text: JSON.stringify(result) }), { status: 200 }))
      await expect(provider.assessPouConversation(input)).rejects.toThrow()
    }
  })
  it('never includes transcript content in provider failures', async () => {
    const provider = new OpenAIConversationAssessmentProvider({ apiKey: 'key', model: 'model' }, async () => new Response('{}', { status: 500 }))
    await expect(provider.assessPouConversation({ ...input, transcriptTurns: [{ ...turns[0]!, text: 'TRANSCRIPT_SENTINEL_MUST_NOT_ESCAPE' }] })).rejects.toBeInstanceOf(ConversationAssessmentProviderError)
  })
  it('returns only the validated bounded result, never an unrestricted provider response', async () => {
    const provider = new OpenAIConversationAssessmentProvider({ apiKey: 'key', model: 'model' }, async () => new Response(JSON.stringify({ output_text: JSON.stringify(valid), rationale: 'MODEL_RATIONALE_SENTINEL_MUST_NOT_ESCAPE', output: [{ hidden: 'RAW_RESPONSE_SENTINEL_MUST_NOT_ESCAPE' }] }), { status: 200 }))
    const result = await provider.assessPouConversation(input)
    expect(JSON.stringify(result)).not.toContain('MODEL_RATIONALE_SENTINEL_MUST_NOT_ESCAPE')
    expect(JSON.stringify(result)).not.toContain('RAW_RESPONSE_SENTINEL_MUST_NOT_ESCAPE')
  })
})
