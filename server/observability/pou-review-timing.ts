import type { FastifyBaseLogger } from 'fastify'

export type PouReviewTimingStage =
  | 'conversation_end_acknowledged'
  | 'post_call_webhook_received'
  | 'post_call_webhook_validated'
  | 'transcript_normalized'
  | 'transcript_persisted'
  | 'narrative_review_enqueued'
  | 'narrative_review_started'
  | 'narrative_review_completed'
  | 'structured_assessment_enqueued'
  | 'structured_assessment_started'
  | 'structured_assessment_completed'
  | 'structured_assessment_not_required'
  | 'review_persisted'
  | 'review_ready_available'

export interface PouReviewTimingCorrelation {
  conversationId?: string
  workflowSessionId?: string
  assessmentRunId?: string
  reviewDraftId?: string
  pouId?: string
}

/** Operational-only timing: wall clock supports cross-process correlation;
 * elapsedMs is derived solely from Node's monotonic clock. Never add content,
 * prompts, provider output, tokens, or secrets. */
export function logPouReviewTiming(
  logger: FastifyBaseLogger,
  requestStartedAt: bigint,
  wallClockAt: Date,
  stage: PouReviewTimingStage,
  correlation: PouReviewTimingCorrelation = {},
  measurements: { bodyBytes?: number; turnCount?: number; safetyRuleCount?: number; executionMode?: 'inline' } = {},
): void {
  logger.info({
    event: 'pou_review_timing', stage, wallClockAt: wallClockAt.toISOString(),
    elapsedMs: Number(process.hrtime.bigint() - requestStartedAt) / 1_000_000,
    ...correlation, ...measurements,
  }, 'Pou review timing')
}
