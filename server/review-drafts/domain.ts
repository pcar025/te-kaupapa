import { z } from 'zod'

import { POU_REVIEW_CRITERION_STATUSES, type PouReviewProjection } from '../pou-specifications/domain.js'

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

export const reviewCriterionAssessmentSchema = z.object({
  criterionCode: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{1,119}$/),
  status: z.enum(POU_REVIEW_CRITERION_STATUSES),
  evidenceTurnIds: z.array(z.string().uuid()).max(8),
  missingInformationCodes: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{1,119}$/)).max(12),
}).strict().superRefine((value, context) => {
  if (new Set(value.evidenceTurnIds).size !== value.evidenceTurnIds.length) context.addIssue({ code: 'custom', message: 'Criterion evidence turns must not repeat.' })
  if (new Set(value.missingInformationCodes).size !== value.missingInformationCodes.length) context.addIssue({ code: 'custom', message: 'Criterion missing-information codes must not repeat.' })
})

export type ReviewCriterionAssessment = z.infer<typeof reviewCriterionAssessmentSchema>

/** Enforces absence-of-evidence semantics against the pinned review projection. */
export function validateReviewCriterionAssessments(projection: PouReviewProjection, values: ReviewCriterionAssessment[], permittedEvidenceTurnIds?: ReadonlySet<string>): ReviewCriterionAssessment[] {
  const assessments = z.array(reviewCriterionAssessmentSchema).parse(values)
  const criteria = new Map(projection.criteria.map((criterion) => [criterion.criterionCode, criterion]))
  if (assessments.length !== criteria.size) throw new ReviewDraftValidationError('Review evidence must contain exactly every projected current-conversation criterion.')
  const seen = new Set<string>()
  for (const assessment of assessments) {
    const criterion = criteria.get(assessment.criterionCode)
    if (!criterion || seen.has(assessment.criterionCode)) throw new ReviewDraftValidationError('Review evidence contains an unknown or duplicate criterion.')
    seen.add(assessment.criterionCode)
    if (permittedEvidenceTurnIds && assessment.evidenceTurnIds.some((id) => !permittedEvidenceTurnIds.has(id))) throw new ReviewDraftValidationError('Review evidence references a turn outside the retained conversation transcript.')
    if (assessment.missingInformationCodes.some((code) => !criterion.missingInformationCodes.includes(code))) throw new ReviewDraftValidationError('Review evidence contains an unsupported missing-information code.')
    if (assessment.status === 'not_applicable' && !criterion.applicabilityRule) throw new ReviewDraftValidationError('A review criterion is not applicable only where its approved applicability rule permits it.')
    if (assessment.status === 'evidenced' && assessment.evidenceTurnIds.length === 0) throw new ReviewDraftValidationError('Evidenced requires grounded transcript turns.')
    if (assessment.status === 'partially_evidenced' && assessment.evidenceTurnIds.length === 0) throw new ReviewDraftValidationError('Partially evidenced requires grounded transcript turns.')
    if (assessment.status === 'not_explored' && (assessment.evidenceTurnIds.length !== 0 || assessment.missingInformationCodes.length === 0)) throw new ReviewDraftValidationError('Not explored records an approved missing-information code, not evidence of absence.')
    if (assessment.status === 'insufficient_information' && assessment.missingInformationCodes.length === 0) throw new ReviewDraftValidationError('Insufficient information requires an approved missing-information code.')
    if (assessment.status === 'not_applicable' && (assessment.evidenceTurnIds.length !== 0 || assessment.missingInformationCodes.length !== 0)) throw new ReviewDraftValidationError('Not applicable cannot assert transcript evidence or missing information.')
  }
  return assessments
}

export class ReviewDraftValidationError extends Error {}
export class ReviewDraftUnavailableError extends Error {}
export class StaleReviewDraftError extends Error {
  constructor(public readonly currentRevision: number) { super('The Whakapapa review draft has changed.') }
}
