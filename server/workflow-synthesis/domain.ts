import { z } from 'zod'

/** Bounded, noncanonical narrative returned by a workflow-synthesis provider. */
export const workflowSynthesisContentSchema = z.object({
  overallSummary: z.string().trim().min(1).max(1_800),
  keyThemes: z.string().trim().min(1).max(1_200).nullable(),
  strengthsSummary: z.string().trim().min(1).max(1_200).nullable(),
  areasForAttentionSummary: z.string().trim().min(1).max(1_200).nullable(),
  informationStillToExploreSummary: z.string().trim().min(1).max(1_200).nullable(),
  // Always state the bounded truth, including that no human-confirmed concern exists.
  confirmedSafetyConcernsSummary: z.string().trim().min(1).max(1_200),
}).strict()

export type WorkflowSynthesisContent = z.infer<typeof workflowSynthesisContentSchema>

export const workflowSynthesisInputSchema = z.object({
  pouReviews: z.array(z.object({
    pouName: z.string().trim().min(1).max(160),
    overallSummary: z.string().trim().min(1).max(1_200).nullable(),
    strengthsSummary: z.string().trim().min(1).max(900).nullable(),
    areasForAttentionSummary: z.string().trim().min(1).max(900).nullable(),
    stillToExplore: z.array(z.string().trim().min(1).max(300)).max(24),
  }).strict()).length(7),
  carryForwards: z.array(z.object({
    pouName: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(1_200),
    sourceLabel: z.string().trim().min(1).max(160),
    note: z.string().trim().min(1).max(1_000).nullable(),
  }).strict()).max(100),
  confirmedSafetyConcerns: z.array(z.object({
    context: z.string().trim().min(1).max(160),
    concernLevel: z.string().trim().min(1).max(80),
    contextNote: z.string().trim().min(1).max(4_000).nullable(),
  }).strict()).max(100),
}).strict().superRefine((value, context) => {
  if (JSON.stringify(value).length > 60_000) context.addIssue({ code: 'custom', message: 'The bounded synthesis input is too large.' })
})

export type ConfirmedWorkflowSynthesisInput = z.infer<typeof workflowSynthesisInputSchema>

export class WorkflowSynthesisValidationError extends Error {}
export class WorkflowSynthesisUnavailableError extends Error {}
export class StaleWorkflowSynthesisError extends Error {
  constructor(public readonly currentRevision: number) {
    super('The synthesis draft has changed.')
  }
}
