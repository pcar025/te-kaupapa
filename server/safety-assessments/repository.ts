import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import type { SafetyBroadClass, SafetyObservationConcernLevel, WorkflowPouId } from '../../shared/workflow.js'
import type { AuthenticatedUser } from '../domain/auth.js'
import * as schema from '../db/schema.js'
import {
  assertConfirmationMapping,
  contentHash,
  providerProjection,
  ruleForConfirmation,
  safetySpecificationSchema,
  validateProviderAssessmentSet,
  type ProviderAssessmentProjection,
  type ProviderRuleAssessment,
  type SafetySpecificationVersion,
} from './domain.js'
import { conversationGuidanceProjection, organisationPouSpecificationSchema, pouReviewProjection, type ConversationGuidanceProjection, type PouReviewProjection } from '../pou-specifications/domain.js'

type SafetyDatabase = NodePgDatabase<typeof schema>
export type SafetyTransaction = Parameters<Parameters<SafetyDatabase['transaction']>[0]>[0]

export interface AssessmentStartPin {
  specificationId: string
  specification: SafetySpecificationVersion
  specificationHash: string
  ruleManifestHash: string
  projectionId: string
  projection: ProviderAssessmentProjection
  projectionHash: string
}

export interface ConversationAssessmentRunWriter {
  createRun(tx: SafetyTransaction, conversation: { id: string; organisationId: string; workflowSessionId: string; pouId: WorkflowPouId; provider: string; providerAgentReference: string; providerBranchReference: string | null; providerEnvironment: string }, pin: AssessmentStartPin): Promise<void>
}

export class SafetyAssessmentValidationError extends Error {}
export class ProviderDeliveryConflictError extends Error {}
export class AssessmentCandidateUnavailableError extends Error {}

function parseProjection(value: unknown): ProviderAssessmentProjection {
  const projection = value as ProviderAssessmentProjection
  if (!projection || !Array.isArray(projection.rules)) throw new SafetyAssessmentValidationError('The persisted provider projection is invalid.')
  return projection
}

function parseSpecification(value: unknown): SafetySpecificationVersion {
  return safetySpecificationSchema.parse(value)
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && ('code' in error ? (error as { code?: string }).code === '23505' : 'cause' in error && isUniqueViolation((error as { cause?: unknown }).cause))
}

export class PostgresSafetyAssessmentRepository implements ConversationAssessmentRunWriter {
  constructor(private readonly db: SafetyDatabase, private readonly now: () => Date = () => new Date()) {}

  async resolveActivePin(organisationId: string, pouId: WorkflowPouId, provider: { provider: 'elevenlabs'; agentReference: string; branchReference: string | null; environment: string }): Promise<AssessmentStartPin | null> {
    const rows = await this.db.select({ activation: schema.safetySpecificationActivations, specification: schema.safetySpecificationVersions, projection: schema.providerAssessmentProjections })
      .from(schema.safetySpecificationActivations)
      .innerJoin(schema.safetySpecificationVersions, eq(schema.safetySpecificationActivations.specificationId, schema.safetySpecificationVersions.id))
      .innerJoin(schema.providerAssessmentProjections, eq(schema.safetySpecificationActivations.projectionId, schema.providerAssessmentProjections.id))
      .where(and(eq(schema.safetySpecificationActivations.organisationId, organisationId), eq(schema.safetySpecificationActivations.pouId, pouId), sql`${schema.safetySpecificationActivations.deactivatedAt} is null`))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    if (row.specification.approvalStatus !== 'approved_for_pilot' || !row.specification.approvedForPilotBy || !row.specification.approvedForPilotAt) {
      throw new SafetyAssessmentValidationError('An active safety specification is not approved for pilot use.')
    }
    if (row.projection.provider !== provider.provider || row.projection.providerAgentReference !== provider.agentReference || row.projection.providerBranchReference !== provider.branchReference || row.projection.providerEnvironment !== provider.environment) {
      throw new SafetyAssessmentValidationError('The active safety projection does not match the server-selected provider configuration.')
    }
    const specification = safetySpecificationSchema.parse(row.specification.specification)
    const projection = parseProjection(row.projection.projection)
    if (specification.pouId !== pouId) throw new SafetyAssessmentValidationError('The active safety specification scope is invalid.')
    const expectedProjection = providerProjection(specification, {
      projectionCode: row.projection.projectionCode,
      projectionVersion: row.projection.projectionVersion,
    })
    if (contentHash(specification) !== row.specification.contentHash || projection.specificationHash !== row.specification.contentHash || projection.ruleManifestHash !== row.specification.ruleManifestHash || contentHash(projection) !== row.projection.projectionHash || contentHash(expectedProjection) !== row.projection.projectionHash) {
      throw new SafetyAssessmentValidationError('Pinned safety specification or projection hash does not match durable content.')
    }
    return { specificationId: row.specification.id, specification, specificationHash: row.specification.contentHash, ruleManifestHash: row.specification.ruleManifestHash, projectionId: row.projection.id, projection, projectionHash: row.projection.projectionHash }
  }

  async createRun(tx: SafetyTransaction, conversation: { id: string; organisationId: string; workflowSessionId: string; pouId: WorkflowPouId; provider: string; providerAgentReference: string; providerBranchReference: string | null; providerEnvironment: string }, pin: AssessmentStartPin): Promise<void> {
    // A new conversation is the only current input for this Pou. Retain old
    // deliveries as bounded provenance, but make their candidates ineligible.
    await tx.update(schema.conversationSafetyAssessmentRuns).set({ status: 'superseded', supersededAt: this.now() }).where(and(
      eq(schema.conversationSafetyAssessmentRuns.workflowSessionId, conversation.workflowSessionId),
      eq(schema.conversationSafetyAssessmentRuns.pouId, conversation.pouId),
      sql`${schema.conversationSafetyAssessmentRuns.status} in ('pending', 'received')`,
    ))
    await tx.insert(schema.conversationSafetyAssessmentRuns).values({
      workflowConversationId: conversation.id, organisationId: conversation.organisationId, workflowSessionId: conversation.workflowSessionId, pouId: conversation.pouId,
      specificationId: pin.specificationId, specificationCode: pin.specification.specificationCode, specificationVersion: pin.specification.specificationVersion, specificationHash: pin.specificationHash, ruleManifestHash: pin.ruleManifestHash,
      projectionId: pin.projectionId, projectionCode: pin.projection.projectionCode, projectionVersion: pin.projection.projectionVersion, projectionHash: pin.projectionHash,
      provider: conversation.provider, providerAgentReference: conversation.providerAgentReference, providerBranchReference: conversation.providerBranchReference, providerEnvironment: conversation.providerEnvironment,
      specificationSnapshot: pin.specification, projectionSnapshot: pin.projection,
      status: 'pending', createdAt: this.now(),
    })
  }

  async supersedeForPouConfirmation(tx: SafetyTransaction, organisationId: string, workflowSessionId: string, pouId: WorkflowPouId): Promise<void> {
    await tx.update(schema.conversationSafetyAssessmentRuns).set({ status: 'superseded', supersededAt: this.now() }).where(and(
      eq(schema.conversationSafetyAssessmentRuns.organisationId, organisationId),
      eq(schema.conversationSafetyAssessmentRuns.workflowSessionId, workflowSessionId),
      eq(schema.conversationSafetyAssessmentRuns.pouId, pouId),
      sql`${schema.conversationSafetyAssessmentRuns.status} in ('pending', 'received')`,
    ))
  }

  /**
   * The ElevenLabs event identifies a conversation only.  Assessment policy
   * comes exclusively from the immutable run pinned when that conversation
   * was prepared—not from webhook data or whatever activation is current now.
   */
  async resolveActivePinForConversation(input: {
    providerConversationId: string
    agentReference: string
    branchReference: string | null
    environment: string
  }): Promise<{ runId: string; workflowConversationId: string; organisationId: string; workflowSessionId: string; pouId: WorkflowPouId; projection: ProviderAssessmentProjection; guidanceProjection: ConversationGuidanceProjection | null; reviewProjection: PouReviewProjection | null; superseded: boolean; requiresAssessment: boolean }> {
    const rows = await this.db.select({ run: schema.conversationSafetyAssessmentRuns, conversation: schema.workflowConversations, pouPin: schema.workflowConversationPouSpecificationPins })
      .from(schema.conversationSafetyAssessmentRuns)
      .innerJoin(schema.workflowConversations, eq(schema.conversationSafetyAssessmentRuns.workflowConversationId, schema.workflowConversations.id))
      .leftJoin(schema.workflowConversationPouSpecificationPins, eq(schema.workflowConversationPouSpecificationPins.workflowConversationId, schema.workflowConversations.id))
      .where(and(
        eq(schema.workflowConversations.provider, 'elevenlabs'),
        eq(schema.workflowConversations.providerConversationId, input.providerConversationId),
      ))
      .limit(1)
    const row = rows[0]
    if (!row) throw new SafetyAssessmentValidationError('The provider conversation is unknown.')
    if (!['pending', 'received', 'superseded'].includes(row.run.status)) throw new SafetyAssessmentValidationError('The assessment run is no longer available.')
    if (row.run.providerAgentReference !== input.agentReference || row.run.providerBranchReference !== input.branchReference || row.run.providerEnvironment !== input.environment) {
      throw new SafetyAssessmentValidationError('Conversation-provider provenance does not match the pinned assessment run.')
    }
    const specification = parseSpecification(row.run.specificationSnapshot)
    const projection = parseProjection(row.run.projectionSnapshot)
    if (contentHash(specification) !== row.run.specificationHash || contentHash(projection.rules) !== row.run.ruleManifestHash || contentHash(projection) !== row.run.projectionHash) {
      throw new SafetyAssessmentValidationError('Pinned historical assessment content does not match its hashes.')
    }
    const pinnedSpecification = row.pouPin ? organisationPouSpecificationSchema.parse(row.pouPin.specificationSnapshot) : null
    const guidanceProjection = row.pouPin?.conversationGuidanceProjectionSnapshot as ConversationGuidanceProjection | undefined
    const reviewProjection = row.pouPin?.pouReviewProjectionSnapshot as PouReviewProjection | undefined
    if (pinnedSpecification && guidanceProjection && reviewProjection) {
      const expectedGuidance = conversationGuidanceProjection(pinnedSpecification, { projectionCode: guidanceProjection.projectionCode, projectionVersion: guidanceProjection.projectionVersion })
      const expectedReview = pouReviewProjection(pinnedSpecification, { projectionCode: reviewProjection.projectionCode, projectionVersion: reviewProjection.projectionVersion })
      const linkedRules = pinnedSpecification.safetyRuleReferences.map((rule) => `${rule.ruleCode}@${rule.ruleVersion}`).sort()
      const assessmentRules = specification.rules.map((rule) => `${rule.ruleCode}@${rule.ruleVersion}`).sort()
      if (contentHash(pinnedSpecification) !== row.pouPin!.specificationHash || guidanceProjection.specificationHash !== row.pouPin!.specificationHash || reviewProjection.specificationHash !== row.pouPin!.specificationHash || contentHash(guidanceProjection) !== row.pouPin!.conversationGuidanceProjectionHash || contentHash(reviewProjection) !== row.pouPin!.pouReviewProjectionHash || contentHash(expectedGuidance) !== row.pouPin!.conversationGuidanceProjectionHash || contentHash(expectedReview) !== row.pouPin!.pouReviewProjectionHash || linkedRules.join('|') !== assessmentRules.join('|')) {
        throw new SafetyAssessmentValidationError('Pinned conversation, review, and safety projection provenance is invalid.')
      }
    } else if (row.pouPin || guidanceProjection || reviewProjection) {
      throw new SafetyAssessmentValidationError('Pinned organisation Pou provenance is incomplete.')
    }
    return { runId: row.run.id, workflowConversationId: row.run.workflowConversationId, organisationId: row.run.organisationId, workflowSessionId: row.run.workflowSessionId, pouId: row.run.pouId as WorkflowPouId, projection, guidanceProjection: guidanceProjection ?? null, reviewProjection: reviewProjection ?? null, superseded: row.run.status === 'superseded', requiresAssessment: row.run.status === 'pending' }
  }

  /**
   * Inspect replay identity before any external assessment request.  An exact
   * retry must not invoke the model twice, while a conflicting same delivery
   * ID makes the attached candidate permanently ineligible.
   */
  async reserveDelivery(input: { provider: 'elevenlabs'; deliveryId: string; payloadHash: string; assessmentRunId: string }): Promise<{ replayed: boolean; conflict: boolean; reserved: boolean; inFlight: boolean; superseded: boolean }> {
    try { return await this.db.transaction(async (tx) => {
      const existing = await tx.select().from(schema.providerAssessmentDeliveries).where(and(
        eq(schema.providerAssessmentDeliveries.provider, input.provider),
        eq(schema.providerAssessmentDeliveries.providerDeliveryId, input.deliveryId),
      )).limit(1)
      if (!existing[0]) {
        const runs = await tx.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, input.assessmentRunId)).limit(1)
        const run = runs[0]
        if (!run) throw new SafetyAssessmentValidationError('The assessment run is unavailable.')
        const lockedSession = await tx.execute(sql`select id from workflow_session where id = ${run.workflowSessionId} and organisation_id = ${run.organisationId} for update`)
        if (lockedSession.rows.length === 0) throw new SafetyAssessmentValidationError('The assessment workflow session is unavailable.')
        const [lockedRun] = await tx.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id)).limit(1)
        const checkpoint = await tx.select().from(schema.workflowPouCheckpoints).where(and(eq(schema.workflowPouCheckpoints.workflowSessionId, run.workflowSessionId), eq(schema.workflowPouCheckpoints.pouId, run.pouId))).limit(1)
        const superseded = lockedRun?.status === 'superseded' || checkpoint[0]?.progress === 'confirmed'
        await tx.insert(schema.providerAssessmentDeliveries).values({ provider: input.provider, providerDeliveryId: input.deliveryId, payloadHash: input.payloadHash, assessmentRunId: input.assessmentRunId, status: 'reserved', receivedAt: this.now() })
        return { replayed: false, conflict: false, reserved: true, inFlight: false, superseded }
      }
      if (existing[0].payloadHash === input.payloadHash) return existing[0].status === 'completed'
        ? { replayed: true, conflict: false, reserved: false, inFlight: false, superseded: false }
        : { replayed: false, conflict: false, reserved: false, inFlight: true, superseded: false }
      await tx.update(schema.conversationSafetyAssessmentRuns).set({ status: 'superseded', supersededAt: this.now() }).where(and(
        eq(schema.conversationSafetyAssessmentRuns.id, existing[0].assessmentRunId),
        sql`${schema.conversationSafetyAssessmentRuns.status} in ('pending', 'received')`,
      ))
      return { replayed: false, conflict: true, reserved: false, inFlight: false, superseded: false }
    }) } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const existing = await this.db.select().from(schema.providerAssessmentDeliveries).where(and(
        eq(schema.providerAssessmentDeliveries.provider, input.provider),
        eq(schema.providerAssessmentDeliveries.providerDeliveryId, input.deliveryId),
      )).limit(1)
      if (!existing[0]) throw error
      if (existing[0].payloadHash === input.payloadHash) return existing[0].status === 'completed'
        ? { replayed: true, conflict: false, reserved: false, inFlight: false, superseded: false }
        : { replayed: false, conflict: false, reserved: false, inFlight: true, superseded: false }
      await this.db.update(schema.conversationSafetyAssessmentRuns).set({ status: 'superseded', supersededAt: this.now() }).where(and(
        eq(schema.conversationSafetyAssessmentRuns.id, existing[0].assessmentRunId),
        sql`${schema.conversationSafetyAssessmentRuns.status} in ('pending', 'received')`,
      ))
      return { replayed: false, conflict: true, reserved: false, inFlight: false, superseded: false }
    }
  }

  async releaseReservedDelivery(input: { provider: 'elevenlabs'; deliveryId: string; payloadHash: string }): Promise<void> {
    await this.db.delete(schema.providerAssessmentDeliveries).where(and(
      eq(schema.providerAssessmentDeliveries.provider, input.provider),
      eq(schema.providerAssessmentDeliveries.providerDeliveryId, input.deliveryId),
      eq(schema.providerAssessmentDeliveries.payloadHash, input.payloadHash),
      eq(schema.providerAssessmentDeliveries.status, 'reserved'),
    ))
  }

  async ingest(input: {
    deliveryProvider: 'elevenlabs'
    deliveryId: string
    payloadHash: string
    providerConversationId: string
    agentReference: string
    branchReference: string | null
    environment: string
    assessmentProvider?: string
    assessmentProviderModel?: string
    assessmentProviderConfigHash?: string
    assessmentSchemaVersion?: string
    transcriptId: string
    transcriptReceivedAt: Date
    assessmentStartedAt?: Date
    assessmentCompletedAt?: Date
    assessments: ProviderRuleAssessment[]
  }): Promise<{ replayed: boolean; superseded: boolean; conflict?: boolean }> {
    try { return await this.db.transaction(async (tx) => {
      const existing = await tx.select().from(schema.providerAssessmentDeliveries).where(and(eq(schema.providerAssessmentDeliveries.provider, input.deliveryProvider), eq(schema.providerAssessmentDeliveries.providerDeliveryId, input.deliveryId))).limit(1)
      if (existing[0]) {
        if (existing[0].payloadHash !== input.payloadHash) {
          await tx.update(schema.conversationSafetyAssessmentRuns).set({ status: 'superseded', supersededAt: this.now() }).where(and(eq(schema.conversationSafetyAssessmentRuns.id, existing[0].assessmentRunId), sql`${schema.conversationSafetyAssessmentRuns.status} in ('pending', 'received')`))
          return { replayed: false, superseded: true, conflict: true }
        }
        if (existing[0].status === 'completed') return { replayed: true, superseded: false }
      }
      const conversations = await tx.select().from(schema.workflowConversations).where(and(eq(schema.workflowConversations.provider, input.deliveryProvider), eq(schema.workflowConversations.providerConversationId, input.providerConversationId))).limit(1)
      const conversation = conversations[0]
      if (!conversation) throw new SafetyAssessmentValidationError('The provider conversation is unknown.')
      const runs = await tx.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.workflowConversationId, conversation.id)).limit(1)
      let run = runs[0]
      if (!run) throw new SafetyAssessmentValidationError('This conversation has no pinned assessment run.')
      // The workflow command path owns the same session lock before confirming
      // a Pou. Re-read after acquiring it so a delivery cannot write a stale
      // pending run back to received after a human confirmation supersedes it.
      const lockedSession = await tx.execute(sql`
        select id from workflow_session
        where id = ${run.workflowSessionId} and organisation_id = ${run.organisationId}
        for update
      `)
      if (lockedSession.rows.length === 0) throw new SafetyAssessmentValidationError('The assessment workflow session is unavailable.')
      const lockedRuns = await tx.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id)).limit(1)
      run = lockedRuns[0]
      if (!run) throw new SafetyAssessmentValidationError('This conversation has no pinned assessment run.')
      if (run.providerAgentReference !== input.agentReference || run.providerBranchReference !== input.branchReference || run.providerEnvironment !== input.environment) throw new SafetyAssessmentValidationError('Conversation-provider provenance does not match the pinned assessment run.')
      const projection = parseProjection(run.projectionSnapshot)
      const specification = parseSpecification(run.specificationSnapshot)
      if (contentHash(specification) !== run.specificationHash || contentHash(projection.rules) !== run.ruleManifestHash || contentHash(projection) !== run.projectionHash) throw new SafetyAssessmentValidationError('Pinned historical assessment content does not match its hashes.')
      const checkpoint = await tx.select().from(schema.workflowPouCheckpoints).where(and(eq(schema.workflowPouCheckpoints.workflowSessionId, run.workflowSessionId), eq(schema.workflowPouCheckpoints.pouId, run.pouId))).limit(1)
      const newer = await tx.select({ id: schema.conversationSafetyAssessmentRuns.id }).from(schema.conversationSafetyAssessmentRuns).innerJoin(schema.workflowConversations, eq(schema.conversationSafetyAssessmentRuns.workflowConversationId, schema.workflowConversations.id)).where(and(eq(schema.conversationSafetyAssessmentRuns.workflowSessionId, run.workflowSessionId), eq(schema.conversationSafetyAssessmentRuns.pouId, run.pouId), ne(schema.conversationSafetyAssessmentRuns.id, run.id), sql`${schema.workflowConversations.createdAt} > ${conversation.createdAt}`)).limit(1)
      const alreadyReceived = run.status === 'received'
      const superseded = checkpoint[0]?.progress === 'confirmed' || Boolean(newer[0]) || run.status === 'superseded'
      if (!existing[0]) throw new SafetyAssessmentValidationError('The provider delivery was not reserved.')
      const transcriptTurns = await tx.select({ id: schema.conversationTranscriptTurns.id }).from(schema.conversationTranscriptTurns).innerJoin(schema.conversationTranscripts, eq(schema.conversationTranscriptTurns.transcriptId, schema.conversationTranscripts.id)).where(and(
        eq(schema.conversationTranscripts.id, input.transcriptId), eq(schema.conversationTranscripts.workflowConversationId, conversation.id),
        eq(schema.conversationTranscripts.organisationId, run.organisationId), eq(schema.conversationTranscripts.workflowSessionId, run.workflowSessionId), eq(schema.conversationTranscripts.pouId, run.pouId),
      ))
      if (transcriptTurns.length === 0) throw new SafetyAssessmentValidationError('Retained transcript is unavailable for this assessment.')
      const permittedEvidenceTurnIds = new Set(transcriptTurns.map((turn) => turn.id))
      const assessments = superseded || alreadyReceived ? [] : validateProviderAssessmentSet(projection, input.assessments, permittedEvidenceTurnIds)
      if (run.status === 'pending' && !superseded && assessments.length > 0) {
        await tx.insert(schema.conversationProviderRuleAssessments).values(assessments.map((assessment) => ({
          assessmentRunId: run.id, ruleCode: assessment.ruleCode, ruleVersion: assessment.ruleVersion, evidenceScope: 'current_conversation' as const, outcome: assessment.outcome, candidateConcernLevel: assessment.candidateConcernLevel,
          matchedProtectiveIndicatorCodes: assessment.matchedProtectiveIndicatorCodes, matchedConcernIndicatorCodes: assessment.matchedConcernIndicatorCodes, missingInformationCodes: assessment.missingInformationCodes, uncertaintyReasonCodes: assessment.uncertaintyReasonCodes, applicabilityReasonCode: assessment.applicabilityReasonCode, createdAt: this.now(),
          evidenceTurnIds: assessment.evidenceTurnIds,
        })))
      }
      const lifecycle = input.assessmentProvider ? {
        assessmentProvider: input.assessmentProvider,
        assessmentProviderModel: input.assessmentProviderModel,
        assessmentProviderConfigHash: input.assessmentProviderConfigHash,
        assessmentSchemaVersion: input.assessmentSchemaVersion,
        transcriptReceivedAt: input.transcriptReceivedAt,
        assessmentStartedAt: input.assessmentStartedAt,
        assessmentCompletedAt: input.assessmentCompletedAt,
      } : { transcriptReceivedAt: input.transcriptReceivedAt }
      await tx.update(schema.conversationSafetyAssessmentRuns).set(alreadyReceived
        ? lifecycle
        : superseded
        ? { ...lifecycle, status: 'superseded', supersededAt: this.now() }
        : {
            ...lifecycle,
            status: 'received',
            receivedAt: this.now(),
            reviewAvailableAt: assessments.some((assessment) => assessment.outcome === 'possible_concern' || assessment.outcome === 'insufficient_information') ? this.now() : null,
          }).where(eq(schema.conversationSafetyAssessmentRuns.id, run.id))
      await tx.update(schema.providerAssessmentDeliveries).set({ status: 'completed' }).where(eq(schema.providerAssessmentDeliveries.id, existing[0].id))
      return { replayed: false, superseded }
    }) } catch (error) {
      // A concurrent exact duplicate can lose the initial lookup race. Re-read
      // the durable identity and return the same deterministic acknowledgement.
      if (!isUniqueViolation(error)) throw error
      const existing = await this.db.select().from(schema.providerAssessmentDeliveries).where(and(eq(schema.providerAssessmentDeliveries.provider, input.deliveryProvider), eq(schema.providerAssessmentDeliveries.providerDeliveryId, input.deliveryId))).limit(1)
      if (existing[0]?.payloadHash === input.payloadHash) return { replayed: true, superseded: false }
      if (existing[0]) {
        await this.db.update(schema.conversationSafetyAssessmentRuns).set({ status: 'superseded', supersededAt: this.now() }).where(and(eq(schema.conversationSafetyAssessmentRuns.id, existing[0].assessmentRunId), sql`${schema.conversationSafetyAssessmentRuns.status} in ('pending', 'received')`))
        return { replayed: false, superseded: true, conflict: true }
      }
      throw error
    }
  }

  async listReviewable(actor: AuthenticatedUser, workflowSessionId: string, pouId: WorkflowPouId = 'whakapapa'): Promise<Array<{ id: string; outcome: string; title: string; description: string; ruleCode: string; ruleVersion: number; matchedProtectiveIndicatorCodes: string[]; matchedConcernIndicatorCodes: string[]; missingInformationCodes: string[]; permittedHumanConcernLevels: SafetyObservationConcernLevel[]; canonicalBroadClass: SafetyBroadClass | null }>> {
    const rows = await this.db.select({ assessment: schema.conversationProviderRuleAssessments, run: schema.conversationSafetyAssessmentRuns, review: schema.providerAssessmentReviews })
      .from(schema.conversationProviderRuleAssessments)
      .innerJoin(schema.conversationSafetyAssessmentRuns, eq(schema.conversationProviderRuleAssessments.assessmentRunId, schema.conversationSafetyAssessmentRuns.id))
      .innerJoin(schema.workflowSessions, and(eq(schema.workflowSessions.id, schema.conversationSafetyAssessmentRuns.workflowSessionId), eq(schema.workflowSessions.organisationId, schema.conversationSafetyAssessmentRuns.organisationId)))
      .innerJoin(schema.workflowPouCheckpoints, and(eq(schema.workflowPouCheckpoints.workflowSessionId, schema.conversationSafetyAssessmentRuns.workflowSessionId), eq(schema.workflowPouCheckpoints.pouId, schema.conversationSafetyAssessmentRuns.pouId)))
      .leftJoin(schema.providerAssessmentReviews, eq(schema.conversationProviderRuleAssessments.id, schema.providerAssessmentReviews.providerRuleAssessmentId))
      .where(and(eq(schema.conversationSafetyAssessmentRuns.organisationId, actor.organisation.id), eq(schema.workflowSessions.kaimahiUserId, actor.id), eq(schema.conversationSafetyAssessmentRuns.workflowSessionId, workflowSessionId), eq(schema.conversationSafetyAssessmentRuns.pouId, pouId), eq(schema.conversationSafetyAssessmentRuns.status, 'received'), inArray(schema.conversationProviderRuleAssessments.outcome, ['possible_concern', 'insufficient_information']), sql`${schema.workflowPouCheckpoints.progress} <> 'confirmed'`, sql`${schema.providerAssessmentReviews.id} is null`))
      .orderBy(desc(schema.conversationProviderRuleAssessments.createdAt))
    return rows.map(({ assessment, run }) => {
      const rule = parseSpecification(run.specificationSnapshot).rules.find((candidate) => candidate.ruleCode === assessment.ruleCode && candidate.ruleVersion === assessment.ruleVersion)
      if (!rule) throw new SafetyAssessmentValidationError('Pinned historical rule is missing.')
      return { id: assessment.id, outcome: assessment.outcome, title: rule.title, description: rule.purpose, ruleCode: rule.ruleCode, ruleVersion: rule.ruleVersion, matchedProtectiveIndicatorCodes: assessment.matchedProtectiveIndicatorCodes as string[], matchedConcernIndicatorCodes: assessment.matchedConcernIndicatorCodes as string[], missingInformationCodes: assessment.missingInformationCodes as string[], permittedHumanConcernLevels: rule.permittedHumanConcernLevels as SafetyObservationConcernLevel[], canonicalBroadClass: rule.canonicalBroadClass as SafetyBroadClass | null }
    })
  }

  async acknowledge(actor: AuthenticatedUser, workflowSessionId: string, assessmentId: string, status: 'dismissed' | 'insufficient_information_acknowledged'): Promise<void> {
    await this.db.transaction(async (tx) => {
      const candidate = await this.lockCandidate(tx, actor, workflowSessionId, assessmentId)
      if ((status === 'dismissed' && candidate.assessment.outcome !== 'possible_concern') || (status === 'insufficient_information_acknowledged' && candidate.assessment.outcome !== 'insufficient_information')) throw new AssessmentCandidateUnavailableError('The assessment cannot receive that review outcome.')
      await tx.insert(schema.providerAssessmentReviews).values({ providerRuleAssessmentId: assessmentId, assessmentRunId: candidate.run.id, workflowSessionId, organisationId: actor.organisation.id, reviewedByUserId: actor.id, status, reviewedAt: this.now() })
    })
  }

  async prepareConfirmation(tx: SafetyTransaction, actor: AuthenticatedUser, workflowSessionId: string, assessmentId: string, pouId: WorkflowPouId, broadClass: SafetyBroadClass, level: SafetyObservationConcernLevel): Promise<void> {
    const candidate = await this.lockCandidate(tx, actor, workflowSessionId, assessmentId)
    if (candidate.assessment.outcome !== 'possible_concern') throw new AssessmentCandidateUnavailableError('Only a possible concern can be confirmed.')
    if (candidate.run.pouId !== pouId) throw new AssessmentCandidateUnavailableError('The assessment is not available for this Pou.')
    const rule = ruleForConfirmation(parseSpecification(candidate.run.specificationSnapshot), candidate.assessment.ruleCode, candidate.assessment.ruleVersion)
    assertConfirmationMapping(rule, candidate.run.pouId as WorkflowPouId, broadClass, level)
  }

  async finalizeConfirmation(tx: SafetyTransaction, actor: AuthenticatedUser, workflowSessionId: string, assessmentId: string, observationId: string): Promise<void> {
    const candidate = await this.lockCandidate(tx, actor, workflowSessionId, assessmentId)
    await tx.insert(schema.providerAssessmentReviews).values({ providerRuleAssessmentId: assessmentId, assessmentRunId: candidate.run.id, workflowSessionId, organisationId: actor.organisation.id, reviewedByUserId: actor.id, status: 'confirmed', classificationSource: 'human_selected', canonicalObservationId: observationId, reviewedAt: this.now() })
    await tx.update(schema.conversationSafetyAssessmentRuns).set({ status: 'superseded', supersededAt: this.now() }).where(and(eq(schema.conversationSafetyAssessmentRuns.workflowSessionId, workflowSessionId), eq(schema.conversationSafetyAssessmentRuns.pouId, candidate.run.pouId), sql`${schema.conversationSafetyAssessmentRuns.status} in ('pending', 'received')`))
  }

  private async lockCandidate(tx: SafetyTransaction, actor: AuthenticatedUser, workflowSessionId: string, assessmentId: string) {
    const result = await tx.execute(sql`
      select a.*, r.* from conversation_provider_rule_assessment a
      join conversation_safety_assessment_run r on r.id = a.assessment_run_id
      join workflow_session workflow on workflow.id = r.workflow_session_id and workflow.organisation_id = r.organisation_id
      join workflow_pou_checkpoint checkpoint on checkpoint.workflow_session_id = r.workflow_session_id and checkpoint.organisation_id = r.organisation_id and checkpoint.pou_id = r.pou_id
      left join provider_assessment_review review on review.provider_rule_assessment_id = a.id
      where a.id = ${assessmentId} and r.workflow_session_id = ${workflowSessionId} and r.organisation_id = ${actor.organisation.id}
        and workflow.kaimahi_user_id = ${actor.id} and r.status = 'received' and checkpoint.progress <> 'confirmed' and review.id is null
      for update of a, r, checkpoint
    `)
    const row = result.rows[0] as { id?: string } | undefined
    if (!row) throw new AssessmentCandidateUnavailableError('The assessment is no longer available for review.')
    const assessments = await tx.select().from(schema.conversationProviderRuleAssessments).where(eq(schema.conversationProviderRuleAssessments.id, assessmentId)).limit(1)
    const runs = await tx.select().from(schema.conversationSafetyAssessmentRuns).where(eq(schema.conversationSafetyAssessmentRuns.id, assessments[0]!.assessmentRunId)).limit(1)
    if (!assessments[0] || !runs[0]) throw new AssessmentCandidateUnavailableError('The assessment is incomplete.')
    return { assessment: assessments[0], run: runs[0] }
  }
}
