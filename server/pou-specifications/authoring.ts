import { and, eq, isNull, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { z } from 'zod'

import type { WorkflowPouId } from '../../shared/workflow.js'
import * as schema from '../db/schema.js'
import { requireRole, type AuthenticatedUser } from '../domain/auth.js'
import {
  approvedOrganisationPouSpecification,
  conversationFirstMessage,
  organisationPouSpecificationSchema,
  POU_DISPLAY_NAMES,
  pouExplorationAreaSchema,
  pouEvidenceCriterionSchema,
  type OrganisationPouSpecificationVersion,
} from './domain.js'
import { OrganisationPouSpecificationProvisioningService } from './provisioning.js'

type Database = NodePgDatabase<typeof schema>

const safetyProposalNotesSchema = z.array(z.string().min(1).max(1_200)).max(12)
export const pouSpecificationDraftContentSchema = z.object({
  purpose: z.string().min(1).max(2_000),
  openingReflectionQuestion: z.string().trim().min(1).max(400).optional(),
  conversationExplorationAreas: z.array(pouExplorationAreaSchema).min(1).max(20),
  evidenceCriteria: z.array(pouEvidenceCriterionSchema).min(1).max(30),
  reviewSynthesisGuidance: z.array(z.string().min(1).max(1_200)).min(1).max(12),
  proposedSafetyRuleNotes: safetyProposalNotesSchema,
}).strict()

export type PouSpecificationDraftContent = z.infer<typeof pouSpecificationDraftContentSchema>

export class PouSpecificationAuthoringError extends Error {}
export class PouSpecificationDraftNotFoundError extends PouSpecificationAuthoringError {}
export class StalePouSpecificationDraftError extends PouSpecificationAuthoringError {
  constructor(readonly currentRevision: number) { super('The specification draft has changed.') }
}
export class IncompletePouSpecificationDraftError extends PouSpecificationAuthoringError {}
export class SafetyPolicyProposalPendingError extends PouSpecificationAuthoringError {}

function nextMinorVersion(version: string): string {
  const match = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(version)
  if (!match) throw new PouSpecificationAuthoringError('The active specification version is invalid.')
  return `${match[1]}.${Number(match[2]) + 1}`
}

function safeSpecification(specification: OrganisationPouSpecificationVersion) {
  return {
    purpose: specification.purpose,
    openingReflectionQuestion: specification.openingReflectionQuestion ?? null,
    openingReflectionQuestionProvenance: specification.openingReflectionQuestionProvenance ?? null,
    conversationExplorationAreas: specification.conversationExplorationAreas,
    evidenceCriteria: specification.evidenceCriteria,
    reviewSynthesisGuidance: specification.reviewSynthesisGuidance,
    safetyRuleReferences: specification.safetyRuleReferences,
  }
}

function preview(specification: OrganisationPouSpecificationVersion) {
  const currentAreas = specification.conversationExplorationAreas.filter((area) => area.evidenceScope === 'current_conversation')
  const currentCriteria = specification.evidenceCriteria.filter((criterion) => criterion.evidenceScope === 'current_conversation')
  return {
    opening: specification.openingReflectionQuestion?.trim() || null,
    openingStatus: specification.openingReflectionQuestion?.trim() ? 'ready' as const : 'sme_input_required' as const,
    conversationStart: conversationFirstMessage(POU_DISPLAY_NAMES[specification.pouId], specification.openingReflectionQuestion ?? ''),
    conversationGuidance: {
      purpose: specification.purpose,
      explorationAreas: currentAreas.map(({ code, label, intent, followUpGuidance }) => ({ code, label, intent, followUpGuidance })),
      constraints: specification.openingReflectionQuestion ? ['Preview only. This draft is not active until it is explicitly approved and activated.'] : ['Opening reflection question not yet defined. This draft cannot be used in a live conversation.'],
    },
    review: { criteria: currentCriteria.map(({ criterionCode, label, description, evidenceScope, strengthsOrProtective, areasForAttention, missingInformationCodes }) => ({ criterionCode, label, description, evidenceScope, strengthsOrProtective, areasForAttention, missingInformationCodes })), synthesisGuidance: specification.reviewSynthesisGuidance },
    safetyRuleReferences: specification.safetyRuleReferences,
  }
}

/**
 * Organisation-scoped working-copy authoring. Drafts never participate in the
 * active-pin resolver; this service is the sole path that may materialise a
 * later immutable approved version.
 */
export class PostgresOrganisationPouSpecificationAuthoringService {
  constructor(private readonly db: Database, private readonly now: () => Date = () => new Date()) {}

  private requireEditor(actor: AuthenticatedUser) { requireRole(actor, 'SPECIFICATION_EDITOR') }

  private async activeFor(actor: AuthenticatedUser, pouId: WorkflowPouId) {
    const rows = await this.db.select({ specification: schema.organisationPouSpecificationVersions })
      .from(schema.organisationPouSpecificationActivations)
      .innerJoin(schema.organisationPouSpecificationVersions, eq(schema.organisationPouSpecificationActivations.specificationId, schema.organisationPouSpecificationVersions.id))
      .where(and(eq(schema.organisationPouSpecificationActivations.organisationId, actor.organisation.id), eq(schema.organisationPouSpecificationActivations.pouId, pouId), isNull(schema.organisationPouSpecificationActivations.deactivatedAt)))
      .limit(1)
    const row = rows[0]?.specification
    if (!row) throw new PouSpecificationDraftNotFoundError('No active Pou specification is available.')
    return row
  }

  private async findDraft(actor: AuthenticatedUser, draftId: string) {
    const rows = await this.db.select().from(schema.organisationPouSpecificationDrafts)
      .where(and(eq(schema.organisationPouSpecificationDrafts.id, draftId), eq(schema.organisationPouSpecificationDrafts.organisationId, actor.organisation.id))).limit(1)
    const draft = rows[0]
    if (!draft) throw new PouSpecificationDraftNotFoundError('The specification draft was not found.')
    return draft
  }

  private present(draft: typeof schema.organisationPouSpecificationDrafts.$inferSelect) {
    const specification = organisationPouSpecificationSchema.parse(draft.specification)
    return {
      id: draft.id, pouId: draft.pouId, baseSpecificationId: draft.baseSpecificationId, draftVersion: draft.draftVersion,
      revision: draft.revision, createdAt: draft.createdAt, updatedAt: draft.updatedAt, approvedAt: draft.approvedAt, activatedAt: draft.activatedAt,
      specification: safeSpecification(specification), proposedSafetyRuleNotes: safetyProposalNotesSchema.parse(draft.proposedSafetyRuleNotes),
      preview: preview(specification),
      canApproveAndActivate: Boolean(specification.openingReflectionQuestion?.trim()) && safetyProposalNotesSchema.parse(draft.proposedSafetyRuleNotes).length === 0 && !draft.activatedAt,
    }
  }

  async list(actor: AuthenticatedUser) {
    this.requireEditor(actor)
    const active = await this.db.select({ activation: schema.organisationPouSpecificationActivations, specification: schema.organisationPouSpecificationVersions })
      .from(schema.organisationPouSpecificationActivations)
      .innerJoin(schema.organisationPouSpecificationVersions, eq(schema.organisationPouSpecificationActivations.specificationId, schema.organisationPouSpecificationVersions.id))
      .where(and(eq(schema.organisationPouSpecificationActivations.organisationId, actor.organisation.id), isNull(schema.organisationPouSpecificationActivations.deactivatedAt)))
    const drafts = await this.db.select().from(schema.organisationPouSpecificationDrafts)
      .where(and(eq(schema.organisationPouSpecificationDrafts.organisationId, actor.organisation.id), isNull(schema.organisationPouSpecificationDrafts.activatedAt)))
    return active.map(({ specification }) => ({
      pouId: specification.pouId, activeVersion: specification.specificationVersion, activeStatus: specification.approvalStatus,
      activeSpecification: safeSpecification(organisationPouSpecificationSchema.parse(specification.specification)),
      draft: drafts.find((draft) => draft.pouId === specification.pouId) ? this.present(drafts.find((draft) => draft.pouId === specification.pouId)!) : null,
    }))
  }

  async createDraft(actor: AuthenticatedUser, pouId: WorkflowPouId) {
    this.requireEditor(actor)
    const base = await this.activeFor(actor, pouId)
    const activeSpecification = organisationPouSpecificationSchema.parse(base.specification)
    const [existing] = await this.db.select({ id: schema.organisationPouSpecificationDrafts.id }).from(schema.organisationPouSpecificationDrafts)
      .where(and(eq(schema.organisationPouSpecificationDrafts.organisationId, actor.organisation.id), eq(schema.organisationPouSpecificationDrafts.pouId, pouId), isNull(schema.organisationPouSpecificationDrafts.activatedAt))).limit(1)
    if (existing) throw new PouSpecificationAuthoringError('An open draft already exists for this Pou.')
    const draftVersion = nextMinorVersion(activeSpecification.specificationVersion)
    const specification = organisationPouSpecificationSchema.parse({
      ...activeSpecification, specificationVersion: draftVersion, approvalStatus: 'draft_derived', approvedForPilotBy: null, approvedForPilotAt: null,
      // The v0.1 source does not provide an opening. Do not invent one.
      ...(activeSpecification.openingReflectionQuestion ? {} : { openingReflectionQuestion: undefined, openingReflectionQuestionProvenance: undefined }),
    })
    const [draft] = await this.db.insert(schema.organisationPouSpecificationDrafts).values({
      organisationId: actor.organisation.id, pouId, baseSpecificationId: base.id, draftVersion, specification, proposedSafetyRuleNotes: [],
      createdByUserId: actor.id, updatedByUserId: actor.id, createdAt: this.now(), updatedAt: this.now(),
    }).returning()
    if (!draft) throw new PouSpecificationAuthoringError('The draft could not be created.')
    return this.present(draft)
  }

  async getDraft(actor: AuthenticatedUser, draftId: string) { this.requireEditor(actor); return this.present(await this.findDraft(actor, draftId)) }

  async saveDraft(actor: AuthenticatedUser, draftId: string, expectedRevision: number, content: PouSpecificationDraftContent) {
    this.requireEditor(actor)
    const draft = await this.findDraft(actor, draftId)
    if (draft.activatedAt) throw new PouSpecificationAuthoringError('An activated draft cannot be edited.')
    if (draft.revision !== expectedRevision) throw new StalePouSpecificationDraftError(draft.revision)
    const parsedContent = pouSpecificationDraftContentSchema.parse(content)
    const base = await this.db.select().from(schema.organisationPouSpecificationVersions).where(and(eq(schema.organisationPouSpecificationVersions.id, draft.baseSpecificationId), eq(schema.organisationPouSpecificationVersions.organisationId, actor.organisation.id), eq(schema.organisationPouSpecificationVersions.pouId, draft.pouId))).limit(1)
    const baseSpecification = base[0] && organisationPouSpecificationSchema.parse(base[0].specification)
    if (!baseSpecification) throw new PouSpecificationDraftNotFoundError('The draft base specification was not found.')
    const specification = organisationPouSpecificationSchema.parse({
      ...baseSpecification, specificationVersion: draft.draftVersion, approvalStatus: 'draft_derived', approvedForPilotBy: null, approvedForPilotAt: null,
      purpose: parsedContent.purpose, openingReflectionQuestion: parsedContent.openingReflectionQuestion,
      ...(parsedContent.openingReflectionQuestion ? { openingReflectionQuestionProvenance: 'sme_authored' as const } : { openingReflectionQuestionProvenance: undefined }),
      conversationExplorationAreas: parsedContent.conversationExplorationAreas, evidenceCriteria: parsedContent.evidenceCriteria, reviewSynthesisGuidance: parsedContent.reviewSynthesisGuidance,
    })
    const [updated] = await this.db.update(schema.organisationPouSpecificationDrafts).set({ specification, proposedSafetyRuleNotes: parsedContent.proposedSafetyRuleNotes, revision: sql`${schema.organisationPouSpecificationDrafts.revision} + 1`, updatedByUserId: actor.id, updatedAt: this.now() })
      .where(and(eq(schema.organisationPouSpecificationDrafts.id, draft.id), eq(schema.organisationPouSpecificationDrafts.organisationId, actor.organisation.id), eq(schema.organisationPouSpecificationDrafts.revision, expectedRevision), isNull(schema.organisationPouSpecificationDrafts.activatedAt))).returning()
    if (!updated) throw new StalePouSpecificationDraftError(draft.revision)
    return this.present(updated)
  }

  async approveAndActivate(actor: AuthenticatedUser, draftId: string, expectedRevision: number) {
    this.requireEditor(actor)
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`select id from organisation_pou_specification_draft where id = ${draftId} and organisation_id = ${actor.organisation.id} for update`)
      const lockedId = (result.rows[0] as { id?: string } | undefined)?.id
      const [draft] = lockedId ? await tx.select().from(schema.organisationPouSpecificationDrafts)
        .where(and(eq(schema.organisationPouSpecificationDrafts.id, lockedId), eq(schema.organisationPouSpecificationDrafts.organisationId, actor.organisation.id))).limit(1) : []
      if (!draft) throw new PouSpecificationDraftNotFoundError('The specification draft was not found.')
      if (draft.activatedAt) throw new PouSpecificationAuthoringError('This draft has already been activated.')
      if (draft.revision !== expectedRevision) throw new StalePouSpecificationDraftError(draft.revision)
      const specification = organisationPouSpecificationSchema.parse(draft.specification)
      if (!specification.openingReflectionQuestion?.trim() || specification.openingReflectionQuestionProvenance !== 'sme_authored') throw new IncompletePouSpecificationDraftError('An SME-authored opening reflection question is required before activation.')
      if (safetyProposalNotesSchema.parse(draft.proposedSafetyRuleNotes).length > 0) throw new SafetyPolicyProposalPendingError('Formal safety-rule proposals require separate approval and are not activated by this editor.')
      const approvedAt = this.now()
      const approved = approvedOrganisationPouSpecification(specification, { approvedForPilotBy: actor.id, approvedForPilotAt: approvedAt.toISOString() })
      const provisioned = await new OrganisationPouSpecificationProvisioningService(tx as unknown as Database, this.now).provisionAndActivate({
        organisationId: actor.organisation.id, operatorUserId: actor.id, specification: approved,
        guidanceProjection: { projectionCode: `${approved.specificationCode}-conversation-guidance`, projectionVersion: approved.specificationVersion },
        reviewProjection: { projectionCode: `${approved.specificationCode}-review`, projectionVersion: approved.specificationVersion },
      })
      const [updated] = await tx.update(schema.organisationPouSpecificationDrafts).set({ approvedByUserId: actor.id, approvedAt, activatedByUserId: actor.id, activatedAt: this.now(), updatedByUserId: actor.id, updatedAt: this.now() })
        .where(eq(schema.organisationPouSpecificationDrafts.id, draft.id)).returning()
      if (!updated) throw new PouSpecificationAuthoringError('The approved draft could not be recorded.')
      return { draft: this.present(updated), activation: provisioned }
    })
  }
}
