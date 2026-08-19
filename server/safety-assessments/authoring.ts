import { randomUUID } from 'node:crypto'

import { and, eq, isNull, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { z } from 'zod'

import type { SafetyBroadClass, SafetyObservationConcernLevel, WorkflowPouId } from '../../shared/workflow.js'
import { requireRole, type AuthenticatedUser } from '../domain/auth.js'
import * as schema from '../db/schema.js'
import { contentHash, providerProjection, safetySpecificationSchema, type SafetyRuleVersion, type SafetySpecificationVersion } from './domain.js'

type Database = NodePgDatabase<typeof schema>
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

const code = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{1,119}$/)
const line = z.string().trim().min(1).max(1_200)
const scope = z.enum(['current_conversation', 'application_state', 'longitudinal'])
const outcome = z.enum(['possible_concern', 'no_candidate_concern', 'insufficient_information', 'not_applicable'])
const level = z.enum(['low', 'watch', 'action'])
const broadClass = z.enum(['whanau_safety', 'practice_quality', 'practitioner_wellbeing'])

/** Practitioner-facing working-copy shape. Codes are generated server-side. */
export const safetyRuleDraftSchema = z.object({
  id: z.string().uuid(),
  safetyIndicator: line.max(300),
  whyThisMatters: line.max(2_000),
  evidenceRequired: z.array(line).min(1).max(12),
  possibleConcernIndicators: z.array(line).max(12),
  noCandidateEvidence: z.array(line).max(12),
  missingInformation: z.array(line).max(12),
  appliesWhen: z.array(line).max(12),
  doesNotApplyWhen: z.array(line).max(12),
  candidateOutcomes: z.array(outcome).min(1).max(4),
  humanJudgement: z.object({ reportOnly: z.boolean(), permittedLevels: z.array(level).max(3), broadClass: broadClass.nullable() }).strict(),
  evidenceScope: scope,
  sourceNotes: z.array(line).min(1).max(20),
}).strict().superRefine((rule, context) => {
  if (rule.evidenceScope === 'current_conversation' && rule.candidateOutcomes.includes('possible_concern') && rule.possibleConcernIndicators.length === 0) {
    context.addIssue({ code: 'custom', path: ['possibleConcernIndicators'], message: 'A possible concern requires at least one bounded indicator.' })
  }
  if (rule.evidenceScope === 'current_conversation' && rule.candidateOutcomes.includes('no_candidate_concern') && rule.noCandidateEvidence.length === 0) {
    context.addIssue({ code: 'custom', path: ['noCandidateEvidence'], message: 'A no-candidate outcome requires explicit evidence that the matter was adequately explored.' })
  }
  if (rule.candidateOutcomes.includes('insufficient_information') && rule.missingInformation.length === 0) {
    context.addIssue({ code: 'custom', path: ['missingInformation'], message: 'Insufficient-information semantics require what remains to be explored.' })
  }
  if (rule.candidateOutcomes.includes('not_applicable') && rule.doesNotApplyWhen.length === 0) {
    context.addIssue({ code: 'custom', path: ['doesNotApplyWhen'], message: 'Not-applicable semantics require an explicit criterion.' })
  }
  if (rule.humanJudgement.reportOnly) {
    if (rule.candidateOutcomes.includes('possible_concern') || rule.humanJudgement.permittedLevels.length || rule.humanJudgement.broadClass) context.addIssue({ code: 'custom', path: ['humanJudgement'], message: 'A report-only rule cannot be confirmed as a safety observation.' })
  } else if (rule.candidateOutcomes.includes('possible_concern') && (!rule.humanJudgement.broadClass || rule.humanJudgement.permittedLevels.length === 0)) {
    context.addIssue({ code: 'custom', path: ['humanJudgement'], message: 'A confirmable rule requires a safety area and at least one permitted human level.' })
  }
})

export const safetyPolicyDraftContentSchema = z.object({ rules: z.array(safetyRuleDraftSchema).max(50) }).strict()
export type SafetyPolicyDraftContent = z.infer<typeof safetyPolicyDraftContentSchema>

export class SafetyPolicyAuthoringError extends Error {}
export class SafetyPolicyDraftNotFoundError extends SafetyPolicyAuthoringError {}
export class StaleSafetyPolicyDraftError extends SafetyPolicyAuthoringError { constructor(readonly currentRevision: number) { super('The formal safety-policy draft has changed.') } }
export class IncompleteSafetyPolicyDraftError extends SafetyPolicyAuthoringError {}

function nextMinor(version: string) {
  const match = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(version)
  if (!match) throw new SafetyPolicyAuthoringError('The active safety-policy version is invalid.')
  return `${match[1]}.${Number(match[2]) + 1}`
}

function generatedCode(id: string, suffix: string) { return `SAFETY_${id.replace(/-/g, '').toUpperCase()}_${suffix}` }
function indicators(id: string, suffix: string, values: string[]) { return values.map((description, index) => ({ code: `${generatedCode(id, suffix)}_${index + 1}`, description })) }

function materialiseRule(draft: z.infer<typeof safetyRuleDraftSchema>, pouId: WorkflowPouId): SafetyRuleVersion {
  return {
    ruleCode: generatedCode(draft.id, 'RULE'), ruleVersion: 1, title: draft.safetyIndicator, purpose: draft.whyThisMatters,
    definition: `Assess only the approved ${draft.evidenceScope.replace(/_/g, ' ')} evidence described in this rule.`, pouId, evidenceScope: draft.evidenceScope,
    sourceItemReferences: draft.sourceNotes,
    protectiveIndicators: indicators(draft.id, 'NO_CANDIDATE', draft.noCandidateEvidence),
    concernIndicators: indicators(draft.id, 'POSSIBLE', draft.possibleConcernIndicators),
    requiredInformation: indicators(draft.id, 'REQUIRED', [...draft.evidenceRequired, ...draft.missingInformation]),
    applicabilityCriteria: draft.appliesWhen,
    exclusionCriteria: draft.doesNotApplyWhen,
    applicabilityReasonCodes: draft.doesNotApplyWhen.map((_, index) => `${generatedCode(draft.id, 'NOT_APPLICABLE')}_${index + 1}`),
    uncertaintyReasonCodes: draft.missingInformation.map((_, index) => `${generatedCode(draft.id, 'INSUFFICIENT')}_${index + 1}`),
    // Non-conversation policy intent is retained immutably for later governed
    // context work, but providerProjection() excludes it from today's runtime.
    allowedCandidateOutcomes: draft.candidateOutcomes,
    candidateLevelMode: 'human_only', protectiveIndicatorMode: 'report_only',
    canonicalBroadClass: draft.humanJudgement.reportOnly ? null : draft.humanJudgement.broadClass,
    permittedHumanConcernLevels: draft.humanJudgement.reportOnly ? [] : draft.humanJudgement.permittedLevels,
  }
}

function policySpecification(base: SafetySpecificationVersion, draftVersion: string, actor: AuthenticatedUser, now: Date, content: SafetyPolicyDraftContent): SafetySpecificationVersion {
  return safetySpecificationSchema.parse({
    ...base, specificationVersion: draftVersion, approvalStatus: 'approved_for_pilot', approvedForPilotBy: actor.id, approvedForPilotAt: now.toISOString(),
    rules: content.rules.map((rule) => materialiseRule(rule, base.pouId)),
  })
}

export class PostgresSafetyPolicyAuthoringService {
  constructor(private readonly db: Database, private readonly now: () => Date = () => new Date()) {}
  private requireEditor(actor: AuthenticatedUser) { requireRole(actor, 'SPECIFICATION_EDITOR') }

  private async activeSafety(actor: AuthenticatedUser, pouId: WorkflowPouId, executor: Database | Transaction = this.db) {
    const rows = await executor.select({ activation: schema.safetySpecificationActivations, specification: schema.safetySpecificationVersions, projection: schema.providerAssessmentProjections })
      .from(schema.safetySpecificationActivations)
      .innerJoin(schema.safetySpecificationVersions, eq(schema.safetySpecificationActivations.specificationId, schema.safetySpecificationVersions.id))
      .innerJoin(schema.providerAssessmentProjections, eq(schema.safetySpecificationActivations.projectionId, schema.providerAssessmentProjections.id))
      .where(and(eq(schema.safetySpecificationActivations.organisationId, actor.organisation.id), eq(schema.safetySpecificationActivations.pouId, pouId), isNull(schema.safetySpecificationActivations.deactivatedAt))).limit(1)
    const row = rows[0]
    if (!row) throw new SafetyPolicyDraftNotFoundError('No active formal safety policy is available for this Pou.')
    return row
  }

  private present(row: typeof schema.organisationPouSafetyPolicyDrafts.$inferSelect) {
    const policy = safetyPolicyDraftContentSchema.parse(row.policy)
    return { id: row.id, pouId: row.pouId as WorkflowPouId, baseSafetySpecificationId: row.baseSafetySpecificationId, draftVersion: row.draftVersion, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt, approvedAt: row.approvedAt, activatedAt: row.activatedAt, policy, canApproveAndActivate: !row.activatedAt && policy.rules.length > 0 }
  }

  async list(actor: AuthenticatedUser) {
    this.requireEditor(actor)
    const rows = await this.db.select().from(schema.organisationPouSafetyPolicyDrafts).where(and(eq(schema.organisationPouSafetyPolicyDrafts.organisationId, actor.organisation.id), isNull(schema.organisationPouSafetyPolicyDrafts.activatedAt)))
    return rows.map((row) => this.present(row))
  }

  async listActive(actor: AuthenticatedUser) {
    this.requireEditor(actor)
    const rows = await this.db.select({ pouId: schema.safetySpecificationActivations.pouId, specification: schema.safetySpecificationVersions })
      .from(schema.safetySpecificationActivations)
      .innerJoin(schema.safetySpecificationVersions, eq(schema.safetySpecificationActivations.specificationId, schema.safetySpecificationVersions.id))
      .where(and(eq(schema.safetySpecificationActivations.organisationId, actor.organisation.id), isNull(schema.safetySpecificationActivations.deactivatedAt)))
    return rows.map(({ pouId, specification }) => ({ pouId: pouId as WorkflowPouId, version: specification.specificationVersion, ruleCount: safetySpecificationSchema.parse(specification.specification).rules.length }))
  }

  async createDraft(actor: AuthenticatedUser, pouId: WorkflowPouId) {
    this.requireEditor(actor)
    const active = await this.activeSafety(actor, pouId)
    const [existing] = await this.db.select({ id: schema.organisationPouSafetyPolicyDrafts.id }).from(schema.organisationPouSafetyPolicyDrafts).where(and(eq(schema.organisationPouSafetyPolicyDrafts.organisationId, actor.organisation.id), eq(schema.organisationPouSafetyPolicyDrafts.pouId, pouId), isNull(schema.organisationPouSafetyPolicyDrafts.activatedAt))).limit(1)
    if (existing) throw new SafetyPolicyAuthoringError('An open formal safety-policy draft already exists for this Pou.')
    const base = safetySpecificationSchema.parse(active.specification.specification)
    const [draft] = await this.db.insert(schema.organisationPouSafetyPolicyDrafts).values({ organisationId: actor.organisation.id, pouId, baseSafetySpecificationId: active.specification.id, draftVersion: nextMinor(base.specificationVersion), policy: { rules: [] }, createdByUserId: actor.id, updatedByUserId: actor.id, createdAt: this.now(), updatedAt: this.now() }).returning()
    if (!draft) throw new SafetyPolicyAuthoringError('The formal safety-policy draft could not be created.')
    return this.present(draft)
  }

  async getDraft(actor: AuthenticatedUser, id: string) {
    this.requireEditor(actor)
    const [draft] = await this.db.select().from(schema.organisationPouSafetyPolicyDrafts).where(and(eq(schema.organisationPouSafetyPolicyDrafts.id, id), eq(schema.organisationPouSafetyPolicyDrafts.organisationId, actor.organisation.id))).limit(1)
    if (!draft) throw new SafetyPolicyDraftNotFoundError('The formal safety-policy draft was not found.')
    return this.present(draft)
  }

  async saveDraft(actor: AuthenticatedUser, id: string, expectedRevision: number, policy: SafetyPolicyDraftContent) {
    this.requireEditor(actor)
    const parsed = safetyPolicyDraftContentSchema.parse(policy)
    const [draft] = await this.db.update(schema.organisationPouSafetyPolicyDrafts).set({ policy: parsed, revision: sql`${schema.organisationPouSafetyPolicyDrafts.revision} + 1`, updatedByUserId: actor.id, updatedAt: this.now() }).where(and(eq(schema.organisationPouSafetyPolicyDrafts.id, id), eq(schema.organisationPouSafetyPolicyDrafts.organisationId, actor.organisation.id), eq(schema.organisationPouSafetyPolicyDrafts.revision, expectedRevision), isNull(schema.organisationPouSafetyPolicyDrafts.activatedAt))).returning()
    if (!draft) {
      const [current] = await this.db.select({ revision: schema.organisationPouSafetyPolicyDrafts.revision }).from(schema.organisationPouSafetyPolicyDrafts).where(and(eq(schema.organisationPouSafetyPolicyDrafts.id, id), eq(schema.organisationPouSafetyPolicyDrafts.organisationId, actor.organisation.id))).limit(1)
      if (!current) throw new SafetyPolicyDraftNotFoundError('The formal safety-policy draft was not found.')
      throw new StaleSafetyPolicyDraftError(current.revision)
    }
    return this.present(draft)
  }

  async approveAndActivate(actor: AuthenticatedUser, id: string, expectedRevision: number) {
    this.requireEditor(actor)
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`select id from organisation_pou_safety_policy_draft where id = ${id} and organisation_id = ${actor.organisation.id} for update`)
      if (!(locked.rows[0] as { id?: string } | undefined)?.id) throw new SafetyPolicyDraftNotFoundError('The formal safety-policy draft was not found.')
      const [draft] = await tx.select().from(schema.organisationPouSafetyPolicyDrafts).where(and(eq(schema.organisationPouSafetyPolicyDrafts.id, id), eq(schema.organisationPouSafetyPolicyDrafts.organisationId, actor.organisation.id))).limit(1)
      if (!draft) throw new SafetyPolicyDraftNotFoundError('The formal safety-policy draft was not found.')
      if (draft.activatedAt) throw new SafetyPolicyAuthoringError('This formal safety-policy draft has already been activated.')
      if (draft.revision !== expectedRevision) throw new StaleSafetyPolicyDraftError(draft.revision)
      const content = safetyPolicyDraftContentSchema.parse(draft.policy)
      if (content.rules.length === 0) throw new IncompleteSafetyPolicyDraftError('Add at least one formal safety rule before activation.')
      const active = await this.activeSafety(actor, draft.pouId as WorkflowPouId, tx)
      if (active.specification.id !== draft.baseSafetySpecificationId) throw new StaleSafetyPolicyDraftError(draft.revision)
      const base = safetySpecificationSchema.parse(active.specification.specification)
      const timestamp = this.now()
      const specification = policySpecification(base, draft.draftVersion, actor, timestamp, content)
      const projection = providerProjection(specification, { projectionCode: `${specification.specificationCode}-assessment`, projectionVersion: specification.specificationVersion })
      const specificationHash = contentHash(specification)
      const projectionHash = contentHash(projection)
      const ruleManifestHash = contentHash(projection.rules)
      const [storedSpecification] = await tx.insert(schema.safetySpecificationVersions).values({ organisationId: actor.organisation.id, specificationCode: specification.specificationCode, specificationVersion: specification.specificationVersion, pouId: specification.pouId, approvalStatus: specification.approvalStatus, contentHash: specificationHash, ruleManifestHash, specification, sourceDocumentCode: specification.sourceDocumentCode, sourceDocumentStatus: specification.sourceDocumentStatus, sourceReference: specification.sourceReference, sourceDocumentHash: specification.sourceDocumentHash, derivedAt: timestamp, approvedForPilotBy: actor.id, approvedForPilotAt: timestamp, createdAt: timestamp }).returning()
      if (!storedSpecification) throw new SafetyPolicyAuthoringError('The formal safety policy could not be materialised.')
      const [storedProjection] = await tx.insert(schema.providerAssessmentProjections).values({ organisationId: actor.organisation.id, pouId: specification.pouId, specificationId: storedSpecification.id, projectionCode: projection.projectionCode, projectionVersion: projection.projectionVersion, projectionHash, provider: active.projection.provider, providerAgentReference: active.projection.providerAgentReference, providerBranchReference: active.projection.providerBranchReference, providerEnvironment: active.projection.providerEnvironment, projection, createdAt: timestamp }).returning()
      if (!storedProjection) throw new SafetyPolicyAuthoringError('The formal safety projection could not be materialised.')
      await tx.update(schema.safetySpecificationActivations).set({ deactivatedAt: timestamp }).where(and(eq(schema.safetySpecificationActivations.organisationId, actor.organisation.id), eq(schema.safetySpecificationActivations.pouId, specification.pouId), isNull(schema.safetySpecificationActivations.deactivatedAt)))
      const [safetyActivation] = await tx.insert(schema.safetySpecificationActivations).values({ organisationId: actor.organisation.id, pouId: specification.pouId, specificationId: storedSpecification.id, projectionId: storedProjection.id, activatedByUserId: actor.id, activatedAt: timestamp }).returning()
      if (!safetyActivation) throw new SafetyPolicyAuthoringError('The formal safety policy could not be activated.')
      // The ordinary active specification is intentionally unchanged.  A fresh immutable link and activation make the new policy authoritative without treating ordinary content as edited.
      const activePou = await tx.execute(sql`select * from organisation_pou_specification_activation where organisation_id = ${actor.organisation.id} and pou_id = ${specification.pouId} and deactivated_at is null for update`)
      const activePouRow = activePou.rows[0] as { specification_id?: string; conversation_guidance_projection_id?: string; pou_review_projection_id?: string } | undefined
      if (!activePouRow?.specification_id || !activePouRow.conversation_guidance_projection_id || !activePouRow.pou_review_projection_id) throw new SafetyPolicyAuthoringError('The active Pou specification could not be linked to the formal safety policy.')
      const [link] = await tx.insert(schema.organisationPouSafetySpecificationLinks).values({ organisationId: actor.organisation.id, pouId: specification.pouId, organisationPouSpecificationId: activePouRow.specification_id, safetySpecificationId: storedSpecification.id, safetyProjectionId: storedProjection.id, createdAt: timestamp }).returning()
      if (!link) throw new SafetyPolicyAuthoringError('The formal safety-policy link could not be created.')
      await tx.update(schema.organisationPouSpecificationActivations).set({ deactivatedAt: timestamp }).where(and(eq(schema.organisationPouSpecificationActivations.organisationId, actor.organisation.id), eq(schema.organisationPouSpecificationActivations.pouId, specification.pouId), isNull(schema.organisationPouSpecificationActivations.deactivatedAt)))
      await tx.insert(schema.organisationPouSpecificationActivations).values({ organisationId: actor.organisation.id, pouId: specification.pouId, specificationId: activePouRow.specification_id, conversationGuidanceProjectionId: activePouRow.conversation_guidance_projection_id, pouReviewProjectionId: activePouRow.pou_review_projection_id, safetyLinkId: link.id, activatedByUserId: actor.id, activatedAt: timestamp })
      const [updated] = await tx.update(schema.organisationPouSafetyPolicyDrafts).set({ approvedByUserId: actor.id, approvedAt: timestamp, activatedByUserId: actor.id, activatedAt: timestamp, updatedByUserId: actor.id, updatedAt: timestamp }).where(eq(schema.organisationPouSafetyPolicyDrafts.id, id)).returning()
      if (!updated) throw new SafetyPolicyAuthoringError('The activated policy draft could not be recorded.')
      return { draft: this.present(updated), activation: { specificationId: storedSpecification.id, projectionId: storedProjection.id, safetyActivationId: safetyActivation.id, safetyLinkId: link.id } }
    })
  }
}
