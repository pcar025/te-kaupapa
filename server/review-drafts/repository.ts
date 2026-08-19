import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import type { AuthenticatedUser } from '../domain/auth.js'
import type { WorkflowCarryForwardSource, WorkflowPouId } from '../../shared/workflow.js'
import * as schema from '../db/schema.js'
import type { SafetyTransaction } from '../safety-assessments/repository.js'
import { validateReviewCriterionAssessments, whakapapaReviewDraftContentSchema, ReviewDraftUnavailableError, StaleReviewDraftError, type ReviewCriterionAssessment, type WhakapapaReviewDraftContent } from './domain.js'
import type { PouReviewProjection } from '../pou-specifications/domain.js'
import type { ConversationReviewDraftResult } from './provider.js'

type ReviewDatabase = NodePgDatabase<typeof schema>

export interface PouReviewDraftView {
  status: 'analysing' | 'ready' | 'failed' | 'manual'
  draft: null | {
    id: string
    revisionId: string
    revision: number
    overallSummary: string | null
    strengthsSummary: string | null
    areasForAttentionSummary: string | null
    evidenceTurnIds: string[]
    criterionAssessments: Array<ReviewCriterionAssessment & { label: string; strengthsOrProtective: boolean; areasForAttention: boolean }>
    generatedAt: Date
  }
  assessmentCompleted: boolean
  hasReviewableCandidate: boolean
  /** Bounded, human-review state only; no provider content or evidence is exposed. */
  resolvedSafetyReview: {
    confirmedCount: number
    dismissedCount: number
    insufficientInformationAcknowledgedCount: number
  }
}
export type WhakapapaReviewDraftView = PouReviewDraftView

const emptyResolvedSafetyReview = {
  confirmedCount: 0,
  dismissedCount: 0,
  insufficientInformationAcknowledgedCount: 0,
} as const

function readContent(row: { overallSummary: string | null; strengthsSummary: string | null; areasForAttentionSummary: string | null; evidenceTurnIds: unknown }): WhakapapaReviewDraftContent {
  return whakapapaReviewDraftContentSchema.parse({
    overallSummary: row.overallSummary,
    strengthsSummary: row.strengthsSummary,
    areasForAttentionSummary: row.areasForAttentionSummary,
    evidenceTurnIds: row.evidenceTurnIds,
  })
}

export class PostgresConversationReviewDraftRepository {
  constructor(private readonly db: ReviewDatabase, private readonly now: () => Date = () => new Date()) {}

  async recordGenerated(input: {
    assessmentRunId: string
    workflowConversationId: string
    organisationId: string
    workflowSessionId: string
    transcriptId: string
    pouId: WorkflowPouId
    result: ConversationReviewDraftResult
  }): Promise<void> {
    const content = whakapapaReviewDraftContentSchema.parse(input.result.draft)
    await this.db.transaction(async (tx) => {
      const runs = await tx.select().from(schema.conversationSafetyAssessmentRuns).where(and(
        eq(schema.conversationSafetyAssessmentRuns.id, input.assessmentRunId),
        eq(schema.conversationSafetyAssessmentRuns.organisationId, input.organisationId),
        eq(schema.conversationSafetyAssessmentRuns.workflowSessionId, input.workflowSessionId),
      )).limit(1)
      const run = runs[0]
      if (!run || run.workflowConversationId !== input.workflowConversationId || run.pouId !== input.pouId) throw new ReviewDraftUnavailableError('The review draft is outside the pinned workflow scope.')
      const turns = await tx.select({ id: schema.conversationTranscriptTurns.id })
        .from(schema.conversationTranscriptTurns)
        .innerJoin(schema.conversationTranscripts, eq(schema.conversationTranscriptTurns.transcriptId, schema.conversationTranscripts.id))
        .where(and(eq(schema.conversationTranscripts.id, input.transcriptId), eq(schema.conversationTranscripts.workflowConversationId, input.workflowConversationId), eq(schema.conversationTranscripts.organisationId, input.organisationId), eq(schema.conversationTranscripts.workflowSessionId, input.workflowSessionId), eq(schema.conversationTranscripts.pouId, input.pouId)))
      const permitted = new Set(turns.map((turn) => turn.id))
      if (content.evidenceTurnIds.some((id) => !permitted.has(id))) throw new ReviewDraftUnavailableError('The review draft references a turn outside its retained transcript.')
      const pins = await tx.select().from(schema.workflowConversationPouSpecificationPins).where(eq(schema.workflowConversationPouSpecificationPins.workflowConversationId, input.workflowConversationId)).limit(1)
      const pin = pins[0]
      if (!pin) throw new ReviewDraftUnavailableError('The review draft has no pinned organisation Pou review projection.')
      const criterionAssessments = validateReviewCriterionAssessments(pin.pouReviewProjectionSnapshot as PouReviewProjection, input.result.criterionAssessments, permitted)
      const existing = await tx.select().from(schema.conversationReviewDrafts).where(eq(schema.conversationReviewDrafts.assessmentRunId, run.id)).limit(1)
      if (existing[0]) {
        if (existing[0].status === 'generated') return
        throw new ReviewDraftUnavailableError('A failed review generation cannot be silently overwritten.')
      }
      const [draft] = await tx.insert(schema.conversationReviewDrafts).values({
        assessmentRunId: run.id, workflowConversationId: run.workflowConversationId, organisationId: run.organisationId, workflowSessionId: run.workflowSessionId, pouId: input.pouId,
        status: 'generated', provider: input.result.provider, providerModel: input.result.model, providerConfigHash: input.result.configurationHash, schemaVersion: input.result.schemaVersion,
        generatedAt: input.result.generatedAt, specificationHash: run.specificationHash, projectionHash: run.projectionHash, createdAt: this.now(),
      }).returning()
      if (!draft) throw new ReviewDraftUnavailableError('Review draft persistence failed.')
      await tx.insert(schema.conversationReviewDraftRevisions).values({
        reviewDraftId: draft.id, revision: 1, source: 'generated', overallSummary: content.overallSummary,
        strengthsSummary: content.strengthsSummary, areasForAttentionSummary: content.areasForAttentionSummary,
        evidenceTurnIds: content.evidenceTurnIds, createdAt: input.result.generatedAt,
      }).returning()
      const revision = await tx.select().from(schema.conversationReviewDraftRevisions).where(and(eq(schema.conversationReviewDraftRevisions.reviewDraftId, draft.id), eq(schema.conversationReviewDraftRevisions.revision, 1))).limit(1)
      if (!revision[0]) throw new ReviewDraftUnavailableError('Review draft provenance persistence failed.')
      await tx.insert(schema.conversationReviewDraftCriterionAssessments).values(criterionAssessments.map((assessment) => ({ reviewDraftRevisionId: revision[0]!.id, criterionCode: assessment.criterionCode, status: assessment.status, evidenceTurnIds: assessment.evidenceTurnIds, missingInformationCodes: assessment.missingInformationCodes, createdAt: input.result.generatedAt })))
    })
  }

  async recordFailed(input: { assessmentRunId: string; workflowConversationId: string; organisationId: string; workflowSessionId: string; pouId: WorkflowPouId; category: 'provider_unavailable' | 'invalid_output' }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const runs = await tx.select().from(schema.conversationSafetyAssessmentRuns).where(and(eq(schema.conversationSafetyAssessmentRuns.id, input.assessmentRunId), eq(schema.conversationSafetyAssessmentRuns.organisationId, input.organisationId), eq(schema.conversationSafetyAssessmentRuns.workflowSessionId, input.workflowSessionId))).limit(1)
      const run = runs[0]
      if (!run || run.workflowConversationId !== input.workflowConversationId || run.pouId !== input.pouId) return
      const existing = await tx.select().from(schema.conversationReviewDrafts).where(eq(schema.conversationReviewDrafts.assessmentRunId, run.id)).limit(1)
      if (existing[0]) return
      await tx.insert(schema.conversationReviewDrafts).values({ assessmentRunId: run.id, workflowConversationId: run.workflowConversationId, organisationId: run.organisationId, workflowSessionId: run.workflowSessionId, pouId: input.pouId, status: 'failed', failedAt: this.now(), failureCategory: input.category, specificationHash: run.specificationHash, projectionHash: run.projectionHash, createdAt: this.now() })
    })
  }

  async findForKaimahi(actor: AuthenticatedUser, workflowSessionId: string, pouId: WorkflowPouId = 'whakapapa'): Promise<PouReviewDraftView> {
    const runs = await this.db.select({ run: schema.conversationSafetyAssessmentRuns })
      .from(schema.conversationSafetyAssessmentRuns)
      .innerJoin(schema.workflowSessions, and(eq(schema.workflowSessions.id, schema.conversationSafetyAssessmentRuns.workflowSessionId), eq(schema.workflowSessions.organisationId, schema.conversationSafetyAssessmentRuns.organisationId)))
      .where(and(eq(schema.conversationSafetyAssessmentRuns.organisationId, actor.organisation.id), eq(schema.workflowSessions.kaimahiUserId, actor.id), eq(schema.conversationSafetyAssessmentRuns.workflowSessionId, workflowSessionId), eq(schema.conversationSafetyAssessmentRuns.pouId, pouId), sql`${schema.conversationSafetyAssessmentRuns.status} <> 'superseded'`))
      .orderBy(desc(schema.conversationSafetyAssessmentRuns.createdAt)).limit(1)
    let run = runs[0]?.run
    let historicCompatibility = false
    if (!run) {
      // Earlier candidate-confirmation code superseded its own current run.
      // Preserve that immutable audit state, but allow its generated narrative
      // review to be read only when it is still the latest completed
      // conversation, is the only generated review for this Pou, and no
      // canonical Pou review has replaced it. Ambiguous ordering fails closed.
      const historicRuns = await this.db.select({ run: schema.conversationSafetyAssessmentRuns })
        .from(schema.conversationSafetyAssessmentRuns)
        .innerJoin(schema.workflowSessions, and(eq(schema.workflowSessions.id, schema.conversationSafetyAssessmentRuns.workflowSessionId), eq(schema.workflowSessions.organisationId, schema.conversationSafetyAssessmentRuns.organisationId)))
        .innerJoin(schema.workflowConversations, eq(schema.workflowConversations.id, schema.conversationSafetyAssessmentRuns.workflowConversationId))
        .innerJoin(schema.workflowPouCheckpoints, and(eq(schema.workflowPouCheckpoints.workflowSessionId, schema.conversationSafetyAssessmentRuns.workflowSessionId), eq(schema.workflowPouCheckpoints.organisationId, schema.conversationSafetyAssessmentRuns.organisationId), eq(schema.workflowPouCheckpoints.pouId, schema.conversationSafetyAssessmentRuns.pouId)))
        .innerJoin(schema.conversationReviewDrafts, eq(schema.conversationReviewDrafts.assessmentRunId, schema.conversationSafetyAssessmentRuns.id))
        .where(and(
          eq(schema.conversationSafetyAssessmentRuns.organisationId, actor.organisation.id),
          eq(schema.workflowSessions.kaimahiUserId, actor.id),
          eq(schema.conversationSafetyAssessmentRuns.workflowSessionId, workflowSessionId),
          eq(schema.conversationSafetyAssessmentRuns.pouId, pouId),
          eq(schema.conversationSafetyAssessmentRuns.status, 'superseded'),
          eq(schema.workflowConversations.status, 'ended'),
          sql`${schema.workflowPouCheckpoints.progress} <> 'confirmed'`,
          eq(schema.conversationReviewDrafts.status, 'generated'),
          sql`exists (
            select 1 from provider_assessment_review resolved_review
            where resolved_review.assessment_run_id = ${schema.conversationSafetyAssessmentRuns.id}
          )`,
          sql`not exists (
            select 1
            from conversation_provider_rule_assessment unresolved_assessment
            where unresolved_assessment.assessment_run_id = ${schema.conversationSafetyAssessmentRuns.id}
              and unresolved_assessment.outcome in ('possible_concern', 'insufficient_information')
              and not exists (
                select 1 from provider_assessment_review unresolved_review
                where unresolved_review.provider_rule_assessment_id = unresolved_assessment.id
              )
          )`,
          sql`not exists (
            select 1 from workflow_pou_review canonical_review
            where canonical_review.workflow_session_id = ${schema.conversationSafetyAssessmentRuns.workflowSessionId}
              and canonical_review.organisation_id = ${schema.conversationSafetyAssessmentRuns.organisationId}
              and canonical_review.pou_id = ${schema.conversationSafetyAssessmentRuns.pouId}
          )`,
          sql`not exists (
            select 1 from workflow_conversation later_conversation
            where later_conversation.workflow_session_id = ${schema.conversationSafetyAssessmentRuns.workflowSessionId}
              and later_conversation.organisation_id = ${schema.conversationSafetyAssessmentRuns.organisationId}
              and later_conversation.pou_id = ${schema.conversationSafetyAssessmentRuns.pouId}
              and later_conversation.status = 'ended'
              and (
                later_conversation.ended_at > ${schema.workflowConversations.endedAt}
                or (
                  later_conversation.ended_at = ${schema.workflowConversations.endedAt}
                  and later_conversation.id <> ${schema.workflowConversations.id}
                )
              )
          )`,
          sql`not exists (
            select 1
            from conversation_review_draft later_draft
            join conversation_safety_assessment_run later_run on later_run.id = later_draft.assessment_run_id
            where later_run.workflow_session_id = ${schema.conversationSafetyAssessmentRuns.workflowSessionId}
              and later_run.organisation_id = ${schema.conversationSafetyAssessmentRuns.organisationId}
              and later_run.pou_id = ${schema.conversationSafetyAssessmentRuns.pouId}
              and later_draft.status = 'generated'
              and later_run.id <> ${schema.conversationSafetyAssessmentRuns.id}
          )`,
        ))
        .orderBy(desc(schema.conversationSafetyAssessmentRuns.createdAt)).limit(1)
      run = historicRuns[0]?.run
      historicCompatibility = Boolean(run)
    }
    if (!run) return { status: 'manual', draft: null, assessmentCompleted: false, hasReviewableCandidate: false, resolvedSafetyReview: emptyResolvedSafetyReview }
    const candidateCount = await this.db.execute(sql`
      select count(*)::int as count
      from conversation_provider_rule_assessment assessment
      where assessment.assessment_run_id = ${run.id}
        and assessment.outcome in ('possible_concern', 'insufficient_information')
        and not exists (
          select 1 from provider_assessment_review review
          where review.provider_rule_assessment_id = assessment.id
        )
    `)
    const hasReviewableCandidate = Number(candidateCount.rows[0]?.count ?? 0) > 0
    const resolvedReviews = await this.db.execute(sql`
      select
        count(*) filter (where review.status = 'confirmed')::int as confirmed_count,
        count(*) filter (where review.status = 'dismissed')::int as dismissed_count,
        count(*) filter (where review.status = 'insufficient_information_acknowledged')::int as insufficient_information_acknowledged_count
      from provider_assessment_review review
      where review.assessment_run_id = ${run.id}
    `)
    const resolvedSafetyReview = {
      confirmedCount: Number(resolvedReviews.rows[0]?.confirmed_count ?? 0),
      dismissedCount: Number(resolvedReviews.rows[0]?.dismissed_count ?? 0),
      insufficientInformationAcknowledgedCount: Number(resolvedReviews.rows[0]?.insufficient_information_acknowledged_count ?? 0),
    }
    const draftRows = await this.db.select({ draft: schema.conversationReviewDrafts, revision: schema.conversationReviewDraftRevisions })
      .from(schema.conversationReviewDrafts)
      .leftJoin(schema.conversationReviewDraftRevisions, eq(schema.conversationReviewDraftRevisions.reviewDraftId, schema.conversationReviewDrafts.id))
      .where(eq(schema.conversationReviewDrafts.assessmentRunId, run.id)).orderBy(desc(schema.conversationReviewDraftRevisions.revision)).limit(1)
    const row = draftRows[0]
    if (!row?.draft) return { status: 'analysing', draft: null, assessmentCompleted: run.status === 'received', hasReviewableCandidate, resolvedSafetyReview }
    if (row.draft.status === 'failed') return { status: 'failed', draft: null, assessmentCompleted: run.status === 'received', hasReviewableCandidate, resolvedSafetyReview }
    if (!row.revision || !row.draft.generatedAt) throw new ReviewDraftUnavailableError('Generated review draft is incomplete.')
    const content = readContent(row.revision)
    const criterionRows = await this.db.select().from(schema.conversationReviewDraftCriterionAssessments).where(eq(schema.conversationReviewDraftCriterionAssessments.reviewDraftRevisionId, row.revision.id))
    const [pin] = await this.db.select({ projection: schema.workflowConversationPouSpecificationPins.pouReviewProjectionSnapshot })
      .from(schema.workflowConversationPouSpecificationPins)
      .where(eq(schema.workflowConversationPouSpecificationPins.workflowConversationId, run.workflowConversationId))
      .limit(1)
    if (!pin) throw new ReviewDraftUnavailableError('The review draft has no pinned Pou review projection.')
    const projection = pin.projection as PouReviewProjection
    const criteriaByCode = new Map(projection.criteria.map((criterion) => [criterion.criterionCode, criterion]))
    return { status: 'ready', assessmentCompleted: run.status === 'received' || historicCompatibility, hasReviewableCandidate, resolvedSafetyReview, draft: { id: row.draft.id, revisionId: row.revision.id, revision: row.revision.revision, ...content, criterionAssessments: criterionRows.map((assessment) => {
      const criterion = criteriaByCode.get(assessment.criterionCode)
      if (!criterion) throw new ReviewDraftUnavailableError('The review draft contains an unknown pinned criterion.')
      return { criterionCode: assessment.criterionCode, label: criterion.label, strengthsOrProtective: criterion.strengthsOrProtective, areasForAttention: criterion.areasForAttention, status: assessment.status as ReviewCriterionAssessment['status'], evidenceTurnIds: assessment.evidenceTurnIds as string[], missingInformationCodes: assessment.missingInformationCodes as string[] }
    }), generatedAt: row.draft.generatedAt } }
  }

  async markReviewed(actor: AuthenticatedUser, workflowSessionId: string, reviewDraftId: string): Promise<void> {
    const view = await this.requireOwnedDraft(actor, workflowSessionId, reviewDraftId)
    if (view.status !== 'generated') throw new ReviewDraftUnavailableError('The review draft is not available.')
    await this.db.insert(schema.conversationReviewDraftViews).values({ reviewDraftId, viewedByUserId: actor.id, viewedAt: this.now() }).onConflictDoNothing()
  }

  async edit(actor: AuthenticatedUser, workflowSessionId: string, input: { reviewDraftId: string; expectedRevision: number; content: WhakapapaReviewDraftContent }): Promise<PouReviewDraftView['draft']> {
    const content = whakapapaReviewDraftContentSchema.parse(input.content)
    return this.db.transaction(async (tx) => {
      const draft = await this.requireOwnedDraftTx(tx, actor, workflowSessionId, input.reviewDraftId)
      if (draft.status !== 'generated') throw new ReviewDraftUnavailableError('The review draft is not available.')
      const turns = await tx.select({ id: schema.conversationTranscriptTurns.id })
        .from(schema.conversationTranscriptTurns)
        .innerJoin(schema.conversationTranscripts, eq(schema.conversationTranscriptTurns.transcriptId, schema.conversationTranscripts.id))
        .where(and(
          eq(schema.conversationTranscripts.workflowConversationId, draft.workflowConversationId),
          eq(schema.conversationTranscripts.organisationId, draft.organisationId),
          eq(schema.conversationTranscripts.workflowSessionId, draft.workflowSessionId),
          eq(schema.conversationTranscripts.pouId, draft.pouId),
        ))
      const permitted = new Set(turns.map((turn) => turn.id))
      if (content.evidenceTurnIds.some((id) => !permitted.has(id))) {
        throw new ReviewDraftUnavailableError('The review draft references a turn outside its retained transcript.')
      }
      const revisions = await tx.select().from(schema.conversationReviewDraftRevisions).where(eq(schema.conversationReviewDraftRevisions.reviewDraftId, draft.id)).orderBy(desc(schema.conversationReviewDraftRevisions.revision)).limit(1)
      const latest = revisions[0]
      if (!latest) throw new ReviewDraftUnavailableError('The generated review revision is unavailable.')
      if (latest.revision !== input.expectedRevision) throw new StaleReviewDraftError(latest.revision)
      const [revision] = await tx.insert(schema.conversationReviewDraftRevisions).values({ reviewDraftId: draft.id, revision: latest.revision + 1, source: 'edited', overallSummary: content.overallSummary, strengthsSummary: content.strengthsSummary, areasForAttentionSummary: content.areasForAttentionSummary, evidenceTurnIds: content.evidenceTurnIds, createdByUserId: actor.id, createdAt: this.now() }).returning()
      if (!revision || !draft.generatedAt) throw new ReviewDraftUnavailableError('Review draft editing failed.')
      const priorCriteria = await tx.select().from(schema.conversationReviewDraftCriterionAssessments).where(eq(schema.conversationReviewDraftCriterionAssessments.reviewDraftRevisionId, latest.id))
      if (priorCriteria.length === 0) throw new ReviewDraftUnavailableError('The review evidence is unavailable.')
      await tx.insert(schema.conversationReviewDraftCriterionAssessments).values(priorCriteria.map((assessment) => ({ reviewDraftRevisionId: revision.id, criterionCode: assessment.criterionCode, status: assessment.status, evidenceTurnIds: assessment.evidenceTurnIds, missingInformationCodes: assessment.missingInformationCodes, createdAt: this.now() })))
      const [pin] = await tx.select({ projection: schema.workflowConversationPouSpecificationPins.pouReviewProjectionSnapshot })
        .from(schema.workflowConversationPouSpecificationPins)
        .where(eq(schema.workflowConversationPouSpecificationPins.workflowConversationId, draft.workflowConversationId))
        .limit(1)
      if (!pin) throw new ReviewDraftUnavailableError('The review draft has no pinned Pou review projection.')
      const criteriaByCode = new Map((pin.projection as PouReviewProjection).criteria.map((criterion) => [criterion.criterionCode, criterion]))
      return { id: draft.id, revisionId: revision.id, revision: revision.revision, ...content, criterionAssessments: priorCriteria.map((assessment) => {
        const criterion = criteriaByCode.get(assessment.criterionCode)
        if (!criterion) throw new ReviewDraftUnavailableError('The review draft contains an unknown pinned criterion.')
        return { criterionCode: assessment.criterionCode, label: criterion.label, strengthsOrProtective: criterion.strengthsOrProtective, areasForAttention: criterion.areasForAttention, status: assessment.status as ReviewCriterionAssessment['status'], evidenceTurnIds: assessment.evidenceTurnIds as string[], missingInformationCodes: assessment.missingInformationCodes as string[] }
      }), generatedAt: draft.generatedAt }
    })
  }

  async confirmCanonical(tx: SafetyTransaction, input: { actor: AuthenticatedUser; workflowSessionId: string; pouId: WorkflowPouId; reviewDraftRevisionId: string; timestamp: Date }): Promise<void> {
    const existing = await tx.select().from(schema.workflowPouReviews).where(and(eq(schema.workflowPouReviews.workflowSessionId, input.workflowSessionId), eq(schema.workflowPouReviews.pouId, input.pouId))).limit(1)
    if (existing[0]) {
      if (existing[0].reviewDraftRevisionId === input.reviewDraftRevisionId) return
      throw new ReviewDraftUnavailableError('The Pou review has already been confirmed.')
    }
    const rows = await tx.select({ draft: schema.conversationReviewDrafts, revision: schema.conversationReviewDraftRevisions })
      .from(schema.conversationReviewDraftRevisions)
      .innerJoin(schema.conversationReviewDrafts, eq(schema.conversationReviewDraftRevisions.reviewDraftId, schema.conversationReviewDrafts.id))
      .innerJoin(schema.conversationSafetyAssessmentRuns, eq(schema.conversationReviewDrafts.assessmentRunId, schema.conversationSafetyAssessmentRuns.id))
      .innerJoin(schema.workflowConversations, eq(schema.workflowConversations.id, schema.conversationSafetyAssessmentRuns.workflowConversationId))
      .innerJoin(schema.workflowPouCheckpoints, and(eq(schema.workflowPouCheckpoints.workflowSessionId, schema.conversationSafetyAssessmentRuns.workflowSessionId), eq(schema.workflowPouCheckpoints.organisationId, schema.conversationSafetyAssessmentRuns.organisationId), eq(schema.workflowPouCheckpoints.pouId, schema.conversationSafetyAssessmentRuns.pouId)))
      .where(and(
        eq(schema.conversationReviewDraftRevisions.id, input.reviewDraftRevisionId),
        eq(schema.conversationReviewDrafts.organisationId, input.actor.organisation.id),
        eq(schema.conversationReviewDrafts.workflowSessionId, input.workflowSessionId),
        eq(schema.conversationReviewDrafts.pouId, input.pouId),
        eq(schema.conversationReviewDrafts.status, 'generated'),
        this.confirmableRunPredicate(),
      )).limit(1)
    const row = rows[0]
    if (!row) throw new ReviewDraftUnavailableError('The final review draft is unavailable.')
    const content = readContent(row.revision)
    await tx.insert(schema.workflowPouReviews).values({ workflowSessionId: input.workflowSessionId, organisationId: input.actor.organisation.id, pouId: input.pouId, reviewDraftRevisionId: row.revision.id, overallSummary: content.overallSummary, strengthsSummary: content.strengthsSummary, areasForAttentionSummary: content.areasForAttentionSummary, confirmedByUserId: input.actor.id, confirmedAt: input.timestamp })
  }

  /** A ready draft cannot be bypassed by a direct ordinary workflow command. */
  async requireRevisionForConfirmation(tx: SafetyTransaction, input: { actor: AuthenticatedUser; workflowSessionId: string; pouId: WorkflowPouId; reviewDraftRevisionId?: string }): Promise<void> {
    const drafts = await tx.select({ draft: schema.conversationReviewDrafts })
      .from(schema.conversationReviewDrafts)
      .innerJoin(schema.conversationSafetyAssessmentRuns, eq(schema.conversationReviewDrafts.assessmentRunId, schema.conversationSafetyAssessmentRuns.id))
      .innerJoin(schema.workflowConversations, eq(schema.workflowConversations.id, schema.conversationSafetyAssessmentRuns.workflowConversationId))
      .innerJoin(schema.workflowPouCheckpoints, and(eq(schema.workflowPouCheckpoints.workflowSessionId, schema.conversationSafetyAssessmentRuns.workflowSessionId), eq(schema.workflowPouCheckpoints.organisationId, schema.conversationSafetyAssessmentRuns.organisationId), eq(schema.workflowPouCheckpoints.pouId, schema.conversationSafetyAssessmentRuns.pouId)))
      .where(and(eq(schema.conversationReviewDrafts.organisationId, input.actor.organisation.id), eq(schema.conversationReviewDrafts.workflowSessionId, input.workflowSessionId), eq(schema.conversationReviewDrafts.pouId, input.pouId), eq(schema.conversationReviewDrafts.status, 'generated'), this.confirmableRunPredicate()))
      .limit(1)
    const draft = drafts[0]?.draft
    if (!draft) return
    if (!input.reviewDraftRevisionId) throw new ReviewDraftUnavailableError('The current Pou review draft must be explicitly confirmed or the manual fallback used.')
    const revisions = await tx.select().from(schema.conversationReviewDraftRevisions).where(and(eq(schema.conversationReviewDraftRevisions.id, input.reviewDraftRevisionId), eq(schema.conversationReviewDraftRevisions.reviewDraftId, draft.id))).limit(1)
    if (!revisions[0]) throw new ReviewDraftUnavailableError('The supplied review draft revision is unavailable.')
  }

  /**
   * A carry-forward record can reference only the current user's scoped,
   * non-superseded review material. It does not create canonical action state.
   */
  async assertCarryForwardReviewSource(tx: SafetyTransaction, input: {
    actor: AuthenticatedUser
    workflowSessionId: string
    pouId: WorkflowPouId
    source: Extract<WorkflowCarryForwardSource, { kind: 'review_criterion' | 'areas_for_attention' }>
  }): Promise<void> {
    const [row] = await tx
      .select({ revision: schema.conversationReviewDraftRevisions, draft: schema.conversationReviewDrafts })
      .from(schema.conversationReviewDraftRevisions)
      .innerJoin(schema.conversationReviewDrafts, eq(schema.conversationReviewDraftRevisions.reviewDraftId, schema.conversationReviewDrafts.id))
      .innerJoin(schema.conversationSafetyAssessmentRuns, eq(schema.conversationReviewDrafts.assessmentRunId, schema.conversationSafetyAssessmentRuns.id))
      .where(and(
        eq(schema.conversationReviewDraftRevisions.id, input.source.reviewDraftRevisionId),
        eq(schema.conversationReviewDrafts.organisationId, input.actor.organisation.id),
        eq(schema.conversationReviewDrafts.workflowSessionId, input.workflowSessionId),
        eq(schema.conversationReviewDrafts.pouId, input.pouId),
        eq(schema.conversationReviewDrafts.status, 'generated'),
        sql`${schema.conversationSafetyAssessmentRuns.status} <> 'superseded'`,
      ))
      .limit(1)
    if (!row) throw new ReviewDraftUnavailableError('The carry-forward source is not available for this Pou.')
    const [latest] = await tx
      .select({ id: schema.conversationReviewDraftRevisions.id })
      .from(schema.conversationReviewDraftRevisions)
      .where(eq(schema.conversationReviewDraftRevisions.reviewDraftId, row.draft.id))
      .orderBy(desc(schema.conversationReviewDraftRevisions.revision))
      .limit(1)
    if (latest?.id !== row.revision.id) {
      throw new ReviewDraftUnavailableError('The carry-forward source is no longer the current review revision.')
    }
    if (input.source.kind === 'areas_for_attention') {
      if (!row.revision.areasForAttentionSummary) throw new ReviewDraftUnavailableError('This review has no area for attention to carry forward.')
      return
    }
    const [criterion] = await tx.select({ id: schema.conversationReviewDraftCriterionAssessments.id })
      .from(schema.conversationReviewDraftCriterionAssessments)
      .where(and(
        eq(schema.conversationReviewDraftCriterionAssessments.reviewDraftRevisionId, row.revision.id),
        eq(schema.conversationReviewDraftCriterionAssessments.criterionCode, input.source.criterionCode),
        inArray(schema.conversationReviewDraftCriterionAssessments.status, ['partially_evidenced', 'not_explored', 'insufficient_information']),
      ))
      .limit(1)
    if (!criterion) throw new ReviewDraftUnavailableError('The selected review criterion is not available to carry forward.')
  }

  private async requireOwnedDraft(actor: AuthenticatedUser, workflowSessionId: string, reviewDraftId: string) {
    return this.requireOwnedDraftTx(this.db, actor, workflowSessionId, reviewDraftId)
  }
  private async requireOwnedDraftTx(db: ReviewDatabase | SafetyTransaction, actor: AuthenticatedUser, workflowSessionId: string, reviewDraftId: string) {
    const rows = await db.select({ draft: schema.conversationReviewDrafts }).from(schema.conversationReviewDrafts).innerJoin(schema.workflowSessions, and(eq(schema.workflowSessions.id, schema.conversationReviewDrafts.workflowSessionId), eq(schema.workflowSessions.organisationId, schema.conversationReviewDrafts.organisationId))).where(and(eq(schema.conversationReviewDrafts.id, reviewDraftId), eq(schema.conversationReviewDrafts.organisationId, actor.organisation.id), eq(schema.conversationReviewDrafts.workflowSessionId, workflowSessionId), eq(schema.workflowSessions.kaimahiUserId, actor.id))).limit(1)
    const draft = rows[0]?.draft
    if (!draft) throw new ReviewDraftUnavailableError('The review draft is unavailable.')
    return draft
  }

  /**
   * Current received runs are confirmable normally. A narrowly bounded legacy
   * exception supports historical runs that were superseded by confirming one
   * of their own candidates before that bug was corrected. This never changes
   * the recorded run status and cannot bypass checkpoint, lineage, or
   * canonical-review precedence.
   */
  private confirmableRunPredicate() {
    return or(
      sql`${schema.conversationSafetyAssessmentRuns.status} <> 'superseded'`,
      and(
        eq(schema.conversationSafetyAssessmentRuns.status, 'superseded'),
        eq(schema.workflowConversations.status, 'ended'),
        sql`${schema.workflowPouCheckpoints.progress} <> 'confirmed'`,
        sql`exists (
          select 1 from provider_assessment_review resolved_review
          where resolved_review.assessment_run_id = ${schema.conversationSafetyAssessmentRuns.id}
        )`,
        sql`not exists (
          select 1
          from conversation_provider_rule_assessment unresolved_assessment
          where unresolved_assessment.assessment_run_id = ${schema.conversationSafetyAssessmentRuns.id}
            and unresolved_assessment.outcome in ('possible_concern', 'insufficient_information')
            and not exists (
              select 1 from provider_assessment_review unresolved_review
              where unresolved_review.provider_rule_assessment_id = unresolved_assessment.id
            )
        )`,
        sql`not exists (
          select 1 from workflow_pou_review canonical_review
          where canonical_review.workflow_session_id = ${schema.conversationSafetyAssessmentRuns.workflowSessionId}
            and canonical_review.organisation_id = ${schema.conversationSafetyAssessmentRuns.organisationId}
            and canonical_review.pou_id = ${schema.conversationSafetyAssessmentRuns.pouId}
        )`,
        sql`not exists (
          select 1 from workflow_conversation later_conversation
          where later_conversation.workflow_session_id = ${schema.conversationSafetyAssessmentRuns.workflowSessionId}
            and later_conversation.organisation_id = ${schema.conversationSafetyAssessmentRuns.organisationId}
            and later_conversation.pou_id = ${schema.conversationSafetyAssessmentRuns.pouId}
            and later_conversation.status = 'ended'
            and (
              later_conversation.ended_at > ${schema.workflowConversations.endedAt}
              or (
                later_conversation.ended_at = ${schema.workflowConversations.endedAt}
                and later_conversation.id <> ${schema.workflowConversations.id}
              )
            )
        )`,
        sql`not exists (
          select 1
          from conversation_review_draft later_draft
          join conversation_safety_assessment_run later_run on later_run.id = later_draft.assessment_run_id
          where later_run.workflow_session_id = ${schema.conversationSafetyAssessmentRuns.workflowSessionId}
            and later_run.organisation_id = ${schema.conversationSafetyAssessmentRuns.organisationId}
            and later_run.pou_id = ${schema.conversationSafetyAssessmentRuns.pouId}
            and later_draft.status = 'generated'
            and later_run.id <> ${schema.conversationSafetyAssessmentRuns.id}
        )`,
      ),
    )
  }
}
