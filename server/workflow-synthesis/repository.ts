import { and, desc, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import type { AuthenticatedUser } from '../domain/auth.js'
import * as schema from '../db/schema.js'
import { contentHash } from '../safety-assessments/domain.js'
import type { WorkflowView } from '../workflows/repository.js'
import { WORKFLOW_POU_NAMES, type WorkflowPouId } from '../../shared/workflow.js'
import type { WorkflowSynthesisProvider, WorkflowSynthesisResult } from './provider.js'
import {
  StaleWorkflowSynthesisError,
  WorkflowSynthesisUnavailableError,
  workflowSynthesisContentSchema,
  workflowSynthesisInputSchema,
  type ConfirmedWorkflowSynthesisInput,
  type WorkflowSynthesisContent,
} from './domain.js'

type SynthesisDatabase = NodePgDatabase<typeof schema>
export type SynthesisTransaction = Parameters<Parameters<SynthesisDatabase['transaction']>[0]>[0]

export interface WorkflowSynthesisView {
  status: 'not_ready' | 'analysing' | 'ready' | 'failed' | 'confirmed'
  synthesisId: string | null
  draft: null | { id: string; revision: number; source: 'generated' | 'edited'; content: WorkflowSynthesisContent; createdAt: Date }
  confirmedRevisionId: string | null
  confirmedAt: Date | null
}

export interface FinalRecordView {
  id: string
  reference: string
  organisationName: string
  kaimahiDisplayName: string
  overallSummary: string
  keyThemes: string | null
  strengthsSummary: string | null
  areasForAttentionSummary: string | null
  informationStillToExploreSummary: string | null
  confirmedSafetyConcernsSummary: string
  actions: Array<{ title: string; type: string; status: string; dueDate: string | null; notes: string | null; pouName: string | null }>
  referrals: Array<{ destinationName: string; reason: string; status: string; notes: string | null; pouName: string | null }>
  safetyObservations: Array<{ context: string; concernLevel: string; contextNote: string | null }>
  finalizedAt: Date
}

function readContent(row: typeof schema.workflowSynthesisRevisions.$inferSelect): WorkflowSynthesisContent {
  return workflowSynthesisContentSchema.parse({
    overallSummary: row.overallSummary,
    keyThemes: row.keyThemes,
    strengthsSummary: row.strengthsSummary,
    areasForAttentionSummary: row.areasForAttentionSummary,
    informationStillToExploreSummary: row.informationStillToExploreSummary,
    confirmedSafetyConcernsSummary: row.confirmedSafetyConcernsSummary,
  })
}

export function synthesisInputFromWorkflow(workflow: WorkflowView): ConfirmedWorkflowSynthesisInput {
  const reviewsByPou = new Map(workflow.pouReviews.map((review) => [review.pouId, review]))
  const source = {
    // Manual Pou confirmation remains a supported path. Its explicitly empty
    // narrative fields are honest bounded source state, not invented content.
    pouReviews: workflow.checkpoints.map((checkpoint) => {
      const review = reviewsByPou.get(checkpoint.pouId)
      return {
      pouName: WORKFLOW_POU_NAMES[checkpoint.pouId],
      overallSummary: review?.overallSummary ?? null,
      strengthsSummary: review?.strengthsSummary ?? null,
      areasForAttentionSummary: review?.areasForAttentionSummary ?? null,
      stillToExplore: review?.stillToExplore ?? [],
      }
    }),
    carryForwards: workflow.carryForwards.flatMap((item) => item.presentation ? [{
      pouName: WORKFLOW_POU_NAMES[item.pouId],
      title: item.presentation.title,
      sourceLabel: item.presentation.sourceLabel,
      note: item.note,
    }] : []),
    confirmedSafetyConcerns: workflow.safety.observations
      .filter((observation) => observation.status === 'active')
      .map((observation) => ({
        context: observation.pouId ? WORKFLOW_POU_NAMES[observation.pouId] : 'Engagement setup',
        concernLevel: concernLevelLabel(observation.concernLevel),
        contextNote: observation.contextNote,
      })),
  }
  return workflowSynthesisInputSchema.parse(source)
}

function concernLevelLabel(level: string): string {
  return ({ unsure: 'Further review required', low: 'Low concern', watch: 'Watch', action: 'Action required', urgent: 'Urgent concern' } as Record<string, string>)[level] ?? 'Recorded concern'
}

function pouName(pouId: WorkflowPouId | null): string | null {
  return pouId ? WORKFLOW_POU_NAMES[pouId] : null
}

export class WorkflowSynthesisInProgressError extends Error {}

export class PostgresWorkflowSynthesisRepository {
  constructor(private readonly db: SynthesisDatabase, private readonly now: () => Date = () => new Date()) {}

  async generate(actor: AuthenticatedUser, workflow: WorkflowView, provider: WorkflowSynthesisProvider): Promise<WorkflowSynthesisView> {
    if (workflow.currentStage !== 'pou-summary' || workflow.checkpoints.some((checkpoint) => checkpoint.progress !== 'confirmed')) throw new WorkflowSynthesisUnavailableError('The synthesis is not ready until all seven Pou are confirmed.')
    const input = synthesisInputFromWorkflow(workflow)
    const sourceHash = contentHash(input)
    const reservation = await this.db.transaction(async (tx) => {
      const [session] = await tx.select().from(schema.workflowSessions).where(and(
        eq(schema.workflowSessions.id, workflow.id),
        eq(schema.workflowSessions.organisationId, actor.organisation.id),
        eq(schema.workflowSessions.kaimahiUserId, actor.id),
      )).limit(1)
      if (!session || session.currentStage !== 'pou-summary' || session.status !== 'in_progress') throw new WorkflowSynthesisUnavailableError('The synthesis is no longer available.')
      const [existing] = await tx.select().from(schema.workflowSyntheses).where(eq(schema.workflowSyntheses.workflowSessionId, workflow.id)).limit(1)
      if (existing?.status === 'generated') return { run: false, synthesisId: existing.id }
      if (existing?.status === 'generating') throw new WorkflowSynthesisInProgressError()
      if (existing) {
        await tx.update(schema.workflowSyntheses).set({ status: 'generating', sourceHash, failedAt: null, failureCategory: null, generatedAt: null, provider: null, providerModel: null, providerConfigHash: null, schemaVersion: null }).where(eq(schema.workflowSyntheses.id, existing.id))
        return { run: true, synthesisId: existing.id }
      }
      const [created] = await tx.insert(schema.workflowSyntheses).values({ workflowSessionId: workflow.id, organisationId: actor.organisation.id, status: 'generating', sourceHash, createdAt: this.now() }).returning()
      if (!created) throw new WorkflowSynthesisUnavailableError('Synthesis reservation failed.')
      return { run: true, synthesisId: created.id }
    })
    if (!reservation.run) return this.findForKaimahi(actor, workflow.id)
    try {
      const result = await provider.generateWorkflowSynthesis(input)
      await this.recordGenerated(actor, workflow.id, reservation.synthesisId, sourceHash, result)
    } catch (error) {
      await this.db.update(schema.workflowSyntheses).set({ status: 'failed', failedAt: this.now(), failureCategory: 'provider_unavailable' }).where(and(eq(schema.workflowSyntheses.id, reservation.synthesisId), eq(schema.workflowSyntheses.status, 'generating')))
      throw error
    }
    return this.findForKaimahi(actor, workflow.id)
  }

  private async recordGenerated(actor: AuthenticatedUser, workflowSessionId: string, synthesisId: string, sourceHash: string, result: WorkflowSynthesisResult): Promise<void> {
    const content = workflowSynthesisContentSchema.parse(result.content)
    await this.db.transaction(async (tx) => {
      const [synthesis] = await tx.select().from(schema.workflowSyntheses).where(and(eq(schema.workflowSyntheses.id, synthesisId), eq(schema.workflowSyntheses.workflowSessionId, workflowSessionId), eq(schema.workflowSyntheses.organisationId, actor.organisation.id))).limit(1)
      if (!synthesis || synthesis.status !== 'generating' || synthesis.sourceHash !== sourceHash) return
      const revisions = await tx.select({ revision: schema.workflowSynthesisRevisions.revision }).from(schema.workflowSynthesisRevisions).where(eq(schema.workflowSynthesisRevisions.synthesisId, synthesis.id)).orderBy(desc(schema.workflowSynthesisRevisions.revision)).limit(1)
      if (revisions[0]) return
      await tx.insert(schema.workflowSynthesisRevisions).values({ synthesisId: synthesis.id, revision: 1, source: 'generated', ...content, createdAt: result.generatedAt })
      await tx.update(schema.workflowSyntheses).set({ status: 'generated', provider: result.provider, providerModel: result.model, providerConfigHash: result.configurationHash, schemaVersion: result.schemaVersion, generatedAt: result.generatedAt }).where(eq(schema.workflowSyntheses.id, synthesis.id))
    })
  }

  async findForKaimahi(actor: AuthenticatedUser, workflowSessionId: string): Promise<WorkflowSynthesisView> {
    const rows = await this.db.select({ synthesis: schema.workflowSyntheses, revision: schema.workflowSynthesisRevisions, confirmation: schema.workflowConfirmedSyntheses })
      .from(schema.workflowSyntheses)
      .innerJoin(schema.workflowSessions, and(eq(schema.workflowSessions.id, schema.workflowSyntheses.workflowSessionId), eq(schema.workflowSessions.organisationId, schema.workflowSyntheses.organisationId)))
      .leftJoin(schema.workflowSynthesisRevisions, eq(schema.workflowSynthesisRevisions.synthesisId, schema.workflowSyntheses.id))
      .leftJoin(schema.workflowConfirmedSyntheses, eq(schema.workflowConfirmedSyntheses.workflowSessionId, schema.workflowSyntheses.workflowSessionId))
      .where(and(eq(schema.workflowSyntheses.workflowSessionId, workflowSessionId), eq(schema.workflowSyntheses.organisationId, actor.organisation.id), eq(schema.workflowSessions.kaimahiUserId, actor.id)))
      .orderBy(desc(schema.workflowSynthesisRevisions.revision)).limit(1)
    const row = rows[0]
    if (!row) return { status: 'not_ready', synthesisId: null, draft: null, confirmedRevisionId: null, confirmedAt: null }
    if (row.confirmation) return { status: 'confirmed', synthesisId: row.synthesis.id, draft: row.revision ? { id: row.revision.id, revision: row.revision.revision, source: row.revision.source, content: readContent(row.revision), createdAt: row.revision.createdAt } : null, confirmedRevisionId: row.confirmation.synthesisRevisionId, confirmedAt: row.confirmation.confirmedAt }
    if (row.synthesis.status === 'generating') return { status: 'analysing', synthesisId: row.synthesis.id, draft: null, confirmedRevisionId: null, confirmedAt: null }
    if (row.synthesis.status === 'failed') return { status: 'failed', synthesisId: row.synthesis.id, draft: null, confirmedRevisionId: null, confirmedAt: null }
    if (!row.revision) throw new WorkflowSynthesisUnavailableError('Generated synthesis is incomplete.')
    return { status: 'ready', synthesisId: row.synthesis.id, draft: { id: row.revision.id, revision: row.revision.revision, source: row.revision.source, content: readContent(row.revision), createdAt: row.revision.createdAt }, confirmedRevisionId: null, confirmedAt: null }
  }

  async edit(actor: AuthenticatedUser, workflowSessionId: string, input: { synthesisId: string; expectedRevision: number; content: WorkflowSynthesisContent }): Promise<WorkflowSynthesisView> {
    const content = workflowSynthesisContentSchema.parse(input.content)
    await this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        select "id" from "workflow_session"
        where "id" = ${workflowSessionId}
          and "organisation_id" = ${actor.organisation.id}
          and "kaimahi_user_id" = ${actor.id}
          and "current_stage" = 'pou-summary'
          and "status" = 'in_progress'
        for update
      `)
      if (locked.rows.length !== 1) throw new WorkflowSynthesisUnavailableError('The synthesis is not available.')
      const [synthesis] = await tx.select().from(schema.workflowSyntheses).innerJoin(schema.workflowSessions, eq(schema.workflowSyntheses.workflowSessionId, schema.workflowSessions.id)).where(and(eq(schema.workflowSyntheses.id, input.synthesisId), eq(schema.workflowSyntheses.workflowSessionId, workflowSessionId), eq(schema.workflowSyntheses.organisationId, actor.organisation.id), eq(schema.workflowSessions.kaimahiUserId, actor.id), eq(schema.workflowSessions.currentStage, 'pou-summary'))).limit(1)
      if (!synthesis) throw new WorkflowSynthesisUnavailableError('The synthesis is not available.')
      const revisions = await tx.select().from(schema.workflowSynthesisRevisions).where(eq(schema.workflowSynthesisRevisions.synthesisId, synthesis.workflow_synthesis.id)).orderBy(desc(schema.workflowSynthesisRevisions.revision)).limit(1)
      const latest = revisions[0]
      if (!latest) throw new WorkflowSynthesisUnavailableError('The synthesis is incomplete.')
      if (latest.revision !== input.expectedRevision) throw new StaleWorkflowSynthesisError(latest.revision)
      await tx.insert(schema.workflowSynthesisRevisions).values({ synthesisId: synthesis.workflow_synthesis.id, revision: latest.revision + 1, source: 'edited', ...content, editedByUserId: actor.id, createdAt: this.now() })
    })
    return this.findForKaimahi(actor, workflowSessionId)
  }

  async confirmInWorkflowTransaction(tx: SynthesisTransaction, input: { actor: AuthenticatedUser; workflowSessionId: string; synthesisRevisionId: string }): Promise<void> {
    const rows = await tx.select({ synthesis: schema.workflowSyntheses, revision: schema.workflowSynthesisRevisions })
      .from(schema.workflowSynthesisRevisions)
      .innerJoin(schema.workflowSyntheses, eq(schema.workflowSynthesisRevisions.synthesisId, schema.workflowSyntheses.id))
      .where(and(eq(schema.workflowSynthesisRevisions.id, input.synthesisRevisionId), eq(schema.workflowSyntheses.workflowSessionId, input.workflowSessionId), eq(schema.workflowSyntheses.organisationId, input.actor.organisation.id), eq(schema.workflowSyntheses.status, 'generated'))).limit(1)
    const row = rows[0]
    if (!row) throw new WorkflowSynthesisUnavailableError('The selected synthesis revision is not available.')
    const existing = await tx.select().from(schema.workflowConfirmedSyntheses).where(eq(schema.workflowConfirmedSyntheses.workflowSessionId, input.workflowSessionId)).limit(1)
    if (existing[0]) {
      if (existing[0].synthesisRevisionId === input.synthesisRevisionId) return
      throw new WorkflowSynthesisUnavailableError('A different synthesis revision is already confirmed.')
    }
    await tx.insert(schema.workflowConfirmedSyntheses).values({ workflowSessionId: input.workflowSessionId, organisationId: input.actor.organisation.id, synthesisRevisionId: input.synthesisRevisionId, confirmedByUserId: input.actor.id, confirmedAt: this.now() })
  }

  async createFinalRecordInWorkflowTransaction(tx: SynthesisTransaction, input: { actor: AuthenticatedUser; workflowSessionId: string; finalizedAt: Date }): Promise<void> {
    const existing = await tx.select().from(schema.workflowFinalRecords).where(eq(schema.workflowFinalRecords.workflowSessionId, input.workflowSessionId)).limit(1)
    if (existing[0]) return
    const rows = await tx.select({ confirmation: schema.workflowConfirmedSyntheses, revision: schema.workflowSynthesisRevisions, workflow: schema.workflowSessions, organisation: schema.organisations, user: schema.appUsers })
      .from(schema.workflowConfirmedSyntheses)
      .innerJoin(schema.workflowSynthesisRevisions, eq(schema.workflowConfirmedSyntheses.synthesisRevisionId, schema.workflowSynthesisRevisions.id))
      .innerJoin(schema.workflowSessions, eq(schema.workflowConfirmedSyntheses.workflowSessionId, schema.workflowSessions.id))
      .innerJoin(schema.organisations, eq(schema.workflowSessions.organisationId, schema.organisations.id))
      .innerJoin(schema.appUsers, eq(schema.workflowSessions.kaimahiUserId, schema.appUsers.id))
      .where(and(eq(schema.workflowConfirmedSyntheses.workflowSessionId, input.workflowSessionId), eq(schema.workflowConfirmedSyntheses.organisationId, input.actor.organisation.id))).limit(1)
    const row = rows[0]
    if (!row) throw new WorkflowSynthesisUnavailableError('A confirmed synthesis is required before finalisation.')
    const [actions, referrals, observations] = await Promise.all([
      tx.select().from(schema.workflowActions).where(and(eq(schema.workflowActions.workflowSessionId, input.workflowSessionId), sql`${schema.workflowActions.status} <> 'withdrawn'`)),
      tx.select().from(schema.workflowReferrals).where(and(eq(schema.workflowReferrals.workflowSessionId, input.workflowSessionId), sql`${schema.workflowReferrals.status} <> 'withdrawn'`)),
      tx.select().from(schema.workflowSafetyObservations).where(and(eq(schema.workflowSafetyObservations.workflowSessionId, input.workflowSessionId), eq(schema.workflowSafetyObservations.status, 'active'))),
    ])
    const content = readContent(row.revision)
    const snapshot = {
      reference: row.workflow.reference,
      organisationName: row.organisation.name,
      kaimahiDisplayName: row.user.displayName,
      ...content,
      actions: actions.map((action) => ({ title: action.title, type: action.type, status: action.status, dueDate: action.dueDate ?? null, notes: action.notes, pouName: pouName(action.pouId) })),
      referrals: referrals.map((referral) => ({ destinationName: referral.destinationName, reason: referral.reason, status: referral.status, notes: referral.notes, pouName: pouName(referral.pouId) })),
      safetyObservations: observations.map((observation) => ({ context: observation.pouId ? WORKFLOW_POU_NAMES[observation.pouId] : 'Engagement setup', concernLevel: concernLevelLabel(observation.concernLevel), contextNote: observation.contextNote })),
    }
    await tx.insert(schema.workflowFinalRecords).values({
      workflowSessionId: input.workflowSessionId, organisationId: input.actor.organisation.id, confirmedSynthesisId: row.confirmation.id,
      workflowReference: snapshot.reference, organisationName: snapshot.organisationName, kaimahiDisplayName: snapshot.kaimahiDisplayName,
      overallSummary: content.overallSummary, keyThemes: content.keyThemes, strengthsSummary: content.strengthsSummary, areasForAttentionSummary: content.areasForAttentionSummary, informationStillToExploreSummary: content.informationStillToExploreSummary, confirmedSafetyConcernsSummary: content.confirmedSafetyConcernsSummary,
      actions: snapshot.actions, referrals: snapshot.referrals, safetyObservations: snapshot.safetyObservations,
      contentHash: contentHash(snapshot), finalizedByUserId: input.actor.id, finalizedAt: input.finalizedAt,
    })
  }

  async findFinalRecord(actor: AuthenticatedUser, workflowSessionId: string): Promise<FinalRecordView | null> {
    const rows = await this.db.select({ record: schema.workflowFinalRecords })
      .from(schema.workflowFinalRecords)
      .innerJoin(schema.workflowSessions, and(eq(schema.workflowFinalRecords.workflowSessionId, schema.workflowSessions.id), eq(schema.workflowFinalRecords.organisationId, schema.workflowSessions.organisationId)))
      .where(and(eq(schema.workflowFinalRecords.workflowSessionId, workflowSessionId), eq(schema.workflowFinalRecords.organisationId, actor.organisation.id), eq(schema.workflowSessions.kaimahiUserId, actor.id))).limit(1)
    const record = rows[0]?.record
    if (!record) return null
    return {
      id: record.id, reference: record.workflowReference, organisationName: record.organisationName, kaimahiDisplayName: record.kaimahiDisplayName,
      overallSummary: record.overallSummary, keyThemes: record.keyThemes, strengthsSummary: record.strengthsSummary, areasForAttentionSummary: record.areasForAttentionSummary, informationStillToExploreSummary: record.informationStillToExploreSummary, confirmedSafetyConcernsSummary: record.confirmedSafetyConcernsSummary ?? 'No human-confirmed safety concerns are recorded.',
      actions: record.actions as FinalRecordView['actions'], referrals: record.referrals as FinalRecordView['referrals'], safetyObservations: record.safetyObservations as FinalRecordView['safetyObservations'], finalizedAt: record.finalizedAt,
    }
  }
}
