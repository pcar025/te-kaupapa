import { z } from 'zod'

/**
 * Application-owned, noncanonical Whakapapa synthesis. This is deliberately
 * separate from the bounded safety-assessment contract.
 */
export const whakapapaReviewDraftContentSchema = z.object({
  overallSummary: z.string().trim().min(1).max(1_200).nullable(),
  strengthsSummary: z.string().trim().min(1).max(900).nullable(),
  areasForAttentionSummary: z.string().trim().min(1).max(900).nullable(),
  evidenceTurnIds: z.array(z.string().uuid()).max(8),
}).strict().superRefine((value, context) => {
  if (!value.overallSummary && !value.strengthsSummary && !value.areasForAttentionSummary) {
    context.addIssue({ code: 'custom', message: 'A review draft must contain at least one bounded narrative field.' })
  }
  if (new Set(value.evidenceTurnIds).size !== value.evidenceTurnIds.length) {
    context.addIssue({ code: 'custom', message: 'Review-draft evidence turns must not repeat.' })
  }
})

export type WhakapapaReviewDraftContent = z.infer<typeof whakapapaReviewDraftContentSchema>

export class ReviewDraftValidationError extends Error {}
export class ReviewDraftUnavailableError extends Error {}
export class StaleReviewDraftError extends Error {
  constructor(public readonly currentRevision: number) { super('The Whakapapa review draft has changed.') }
}
