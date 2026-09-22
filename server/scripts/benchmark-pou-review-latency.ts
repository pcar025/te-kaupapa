import { performance } from 'node:perf_hooks'

import { OpenAIConversationAssessmentProvider } from '../safety-assessments/assessment-provider.js'
import { providerProjection } from '../safety-assessments/domain.js'
import { pouReviewProjection } from '../pou-specifications/domain.js'
import { OpenAIConversationReviewDraftProvider } from '../review-drafts/provider.js'
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
const turn = (ordinal: number, text: string): TranscriptTurn => ({
  id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
  ordinal, speaker: ordinal % 2 ? 'kaimahi' : 'assistant', text, providerSequence: ordinal, providerTimestamp: null,
})

const scenarios = [
  { name: 'kaitiakitanga_low_complexity', pouId: 'kaitiakitanga' as const, turns: [turn(1, 'Synthetic reflection: protective supports were discussed and no further detail was available.')] },
  { name: 'kaitiakitanga_richer_evidence', pouId: 'kaitiakitanga' as const, turns: [turn(1, 'Synthetic reflection: I identified pressure around housing and named support from whānau.'), turn(2, 'Synthetic assistant: What remains to be understood?'), turn(3, 'Synthetic reflection: I need to clarify timing and who will follow up.')] },
  { name: 'kaitiakitanga_missing_information', pouId: 'kaitiakitanga' as const, turns: [turn(1, 'Synthetic reflection: I do not yet have enough information about current supports.')] },
  { name: 'kaitiakitanga_follow_up', pouId: 'kaitiakitanga' as const, turns: [turn(1, 'Synthetic reflection: We discussed a follow-up conversation and checking available support.'), turn(2, 'Synthetic assistant: What is clear and what needs clarification?'), turn(3, 'Synthetic reflection: The next step is to clarify who will contact the service.')] },
  { name: 'whakapapa_with_executable_safety_rules', pouId: 'whakapapa' as const, turns: [turn(1, 'Synthetic reflection: Identity, whānau connection, and a source of strength were discussed.'), turn(2, 'Synthetic assistant: Is anything still unclear?'), turn(3, 'Synthetic reflection: More context about cultural connections would be useful.')] },
]

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
  let reviewFailures = 0
  let assessmentFailures = 0
  for (let index = 0; index < repetitions; index += 1) {
    const reviewStartedAt = performance.now()
    try {
      await reviewProvider.generatePouReviewDraft({ transcriptTurns: scenario.turns, reviewProjection })
      reviewSamples.push(performance.now() - reviewStartedAt)
    } catch { reviewFailures += 1 }
    if (scenario.pouId === 'whakapapa') {
      const safetySpecification = safety.find((candidate) => candidate.pouId === scenario.pouId)
      if (!safetySpecification) throw new Error('No synthetic Whakapapa safety specification.')
      const assessmentStartedAt = performance.now()
      try {
        await assessmentProvider.assessPouConversation({ transcriptTurns: scenario.turns, assessmentProjection: providerProjection(safetySpecification, { projectionCode: 'latency-benchmark', projectionVersion: '1' }) })
        assessmentSamples.push(performance.now() - assessmentStartedAt)
      } catch { assessmentFailures += 1 }
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
    quality: reviewFailures || assessmentFailures ? 'not_established' : 'provider_contract_valid',
  })
}

process.stdout.write(`${JSON.stringify({ benchmark: 'pou_review_latency', model, results })}\n`)
if (results.some((result) => result.quality === 'not_established')) process.exitCode = 1
