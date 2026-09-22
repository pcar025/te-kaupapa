import { performance } from 'node:perf_hooks'

import { ConversationAssessmentProviderError, OpenAIConversationAssessmentProvider } from '../safety-assessments/assessment-provider.js'
import { providerProjection } from '../safety-assessments/domain.js'
import { pouReviewProjection } from '../pou-specifications/domain.js'
import { ConversationReviewDraftProviderError, OpenAIConversationReviewDraftProvider } from '../review-drafts/provider.js'
import { stagingClientDemoOrdinarySpecificationsV02, stagingClientDemoSafetySpecifications } from '../staging-bootstrap/configuration.js'
import type { TranscriptTurn } from '../transcripts/domain.js'

const apiKey = process.env.OPENAI_API_KEY
const model = process.env.OPENAI_ASSESSMENT_MODEL
const repetitions = Number(process.env.LATENCY_BENCHMARK_REPETITIONS ?? '3')

if (!apiKey || !model || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) {
  throw new Error('OPENAI_API_KEY, OPENAI_ASSESSMENT_MODEL, and LATENCY_BENCHMARK_REPETITIONS (1–10) are required.')
}

const approval = { approvedForPilotBy: '00000000-0000-4000-8000-000000000001', approvedForPilotAt: '2026-09-22T00:00:00.000Z' }
const ordinary = stagingClientDemoOrdinarySpecificationsV02(approval)
const safety = stagingClientDemoSafetySpecifications(approval)
const turn = (ordinal: number, speaker: TranscriptTurn['speaker'], text: string): TranscriptTurn => ({
  id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
  ordinal, speaker, text, providerSequence: ordinal, providerTimestamp: null,
})

const scenarios = [
  { name: 'kaitiakitanga_low_complexity', pouId: 'kaitiakitanga' as const, turns: [turn(1, 'assistant', 'What risk context and supports were discussed?'), turn(2, 'kaimahi', 'Synthetic reflection: no immediate risk was raised. The person named regular whānau contact and a stable routine as supports.'), turn(3, 'assistant', 'What remains to be understood?'), turn(4, 'kaimahi', 'Synthetic reflection: practitioner and team impacts were not explored in this conversation.')] },
  { name: 'kaitiakitanga_richer_evidence', pouId: 'kaitiakitanga' as const, turns: [turn(1, 'assistant', 'What risks, pressures, or supports did you notice?'), turn(2, 'kaimahi', 'Synthetic reflection: I identified pressure around housing and named whānau support as protective.'), turn(3, 'assistant', 'What still needs clarification?'), turn(4, 'kaimahi', 'Synthetic reflection: I need to clarify timing, responsibility, and whether the current plan is workable.')] },
  { name: 'kaitiakitanga_missing_information', pouId: 'kaitiakitanga' as const, turns: [turn(1, 'assistant', 'What risk context, supports, and practitioner impacts were discussed?'), turn(2, 'kaimahi', 'Synthetic reflection: those areas were not discussed enough to reach a view.'), turn(3, 'assistant', 'What information is missing?'), turn(4, 'kaimahi', 'Synthetic reflection: risk context, available supports, and practitioner or team impacts all need further exploration.')] },
  { name: 'kaitiakitanga_follow_up', pouId: 'kaitiakitanga' as const, turns: [turn(1, 'assistant', 'What was discussed about risks, supports, and follow-up?'), turn(2, 'kaimahi', 'Synthetic reflection: a follow-up discussion is planned to clarify support and responsibility. No formal safety concern was identified.'), turn(3, 'assistant', 'What still needs to be understood?'), turn(4, 'kaimahi', 'Synthetic reflection: the timing and who will make contact remain unclear, and practitioner or team impacts were not explored.')] },
  { name: 'whakapapa_with_executable_safety_rules', pouId: 'whakapapa' as const, turns: [turn(1, 'assistant', 'What identity, whānau connection, and strengths were explored?'), turn(2, 'kaimahi', 'Synthetic reflection: identity, whānau connection, and a source of strength were discussed.'), turn(3, 'assistant', 'What remains unclear?'), turn(4, 'kaimahi', 'Synthetic reflection: more context about cultural connections would be useful.')] },
]

type FailureCategory = 'provider_unavailable' | 'provider_rejected' | 'malformed_output' | 'schema_validation' | 'evidence_validation' | 'unexpected'
function failureCategory(error: unknown): FailureCategory {
  if (error instanceof ConversationReviewDraftProviderError || error instanceof ConversationAssessmentProviderError) {
    if (error.message.includes('request failed')) return 'provider_unavailable'
    if (error.message.includes('rejected')) return 'provider_rejected'
    if (error.message.includes('no structured output') || error.message.includes('not JSON')) return 'malformed_output'
    if (error.message.includes('bounded contract')) return 'schema_validation'
    if (error.message.includes('evidence did not match')) return 'evidence_validation'
  }
  return 'unexpected'
}
const failureCounts = (): Record<FailureCategory, number> => ({ provider_unavailable: 0, provider_rejected: 0, malformed_output: 0, schema_validation: 0, evidence_validation: 0, unexpected: 0 })

const reviewProvider = new OpenAIConversationReviewDraftProvider({ apiKey, model })
const assessmentProvider = new OpenAIConversationAssessmentProvider({ apiKey, model })
const median = (samples: number[]) => {
  const ordered = [...samples].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2
}

const results: Array<Record<string, unknown>> = []
for (const scenario of scenarios) {
  const specification = ordinary.find((candidate) => candidate.pouId === scenario.pouId)
  if (!specification) throw new Error(`No synthetic ordinary specification for ${scenario.pouId}.`)
  const reviewProjection = pouReviewProjection(specification, { projectionCode: 'latency-benchmark', projectionVersion: '1' })
  const reviewSamples: number[] = []
  const assessmentSamples: number[] = []
  const reviewFailures = failureCounts()
  const assessmentFailures = failureCounts()
  for (let index = 0; index < repetitions; index += 1) {
    const reviewStartedAt = performance.now()
    try {
      await reviewProvider.generatePouReviewDraft({ transcriptTurns: scenario.turns, reviewProjection })
      reviewSamples.push(performance.now() - reviewStartedAt)
    } catch (error) { reviewFailures[failureCategory(error)] += 1 }
    if (scenario.pouId === 'whakapapa') {
      const safetySpecification = safety.find((candidate) => candidate.pouId === scenario.pouId)
      if (!safetySpecification) throw new Error('No synthetic Whakapapa safety specification.')
      const assessmentStartedAt = performance.now()
      try {
        await assessmentProvider.assessPouConversation({ transcriptTurns: scenario.turns, assessmentProjection: providerProjection(safetySpecification, { projectionCode: 'latency-benchmark', projectionVersion: '1' }) })
        assessmentSamples.push(performance.now() - assessmentStartedAt)
      } catch (error) { assessmentFailures[failureCategory(error)] += 1 }
    }
  }
  results.push({
    scenario: scenario.name, pouId: scenario.pouId, turnCount: scenario.turns.length, samples: repetitions,
    reviewMedianMs: reviewSamples.length ? median(reviewSamples) : null,
    reviewRangeMs: reviewSamples.length ? [Math.min(...reviewSamples), Math.max(...reviewSamples)] : null,
    reviewFailures,
    assessmentMedianMs: assessmentSamples.length ? median(assessmentSamples) : null,
    assessmentRangeMs: assessmentSamples.length ? [Math.min(...assessmentSamples), Math.max(...assessmentSamples)] : null,
    assessmentFailures,
    quality: Object.values(reviewFailures).some(Boolean) || Object.values(assessmentFailures).some(Boolean) ? 'not_established' : 'provider_contract_valid',
  })
}

process.stdout.write(`${JSON.stringify({ benchmark: 'pou_review_latency', model, results })}\n`)
if (results.some((result) => result.quality === 'not_established')) process.exitCode = 1
