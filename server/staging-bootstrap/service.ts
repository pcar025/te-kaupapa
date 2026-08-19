import { and, eq, isNull, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import type { WorkflowPouId } from '../../shared/workflow.js'
import * as schema from '../db/schema.js'
import { contentHash, providerProjection } from '../safety-assessments/domain.js'
import { SafetyProvisioningService } from '../safety-assessments/provisioning.js'
import { OrganisationPouSpecificationProvisioningService } from '../pou-specifications/provisioning.js'
import { conversationGuidanceProjection, pouReviewProjection } from '../pou-specifications/domain.js'
import {
  STAGING_CLIENT_DEMO_ORGANISATION,
  stagingClientDemoOrdinarySpecificationsV02,
  stagingClientDemoSafetySpecifications,
} from './configuration.js'

type Database = NodePgDatabase<typeof schema>

export class StagingBootstrapError extends Error {}

export interface StagingBootstrapInput {
  elevenLabsAgentId: string
  elevenLabsAgentBranchId: string
  elevenLabsAgentEnvironment: string
}

export interface StagingBootstrapResult {
  organisation: 'created' | 'existing'
  bootstrapUser: 'created' | 'existing'
  safetyPolicies: { created: number; existing: number }
  ordinarySpecifications: { created: number; existing: number }
}

interface ActiveSafety {
  specificationId: string
  projectionId: string
}

const stagedPouIds: WorkflowPouId[] = ['whakapapa', 'manaakitanga', 'tikanga', 'kaitiakitanga', 'puukenga', 'haepapa', 'oranga']

// This is source metadata for the approved synthetic staging baseline, not a
// claim about a human's production approval time. It keeps reruns byte-stable.
const STAGING_BASELINE_APPROVED_AT = '2026-08-19T00:00:00.000Z'

/**
 * Creates only the declared staging configuration baseline. It never creates
 * authentic identities, workflow history, sessions, provider deliveries, or
 * candidate/canonical practice records.
 */
export class StagingBootstrapService {
  constructor(private readonly db: Database, private readonly now: () => Date = () => new Date()) {}

  async bootstrap(input: StagingBootstrapInput): Promise<StagingBootstrapResult> {
    const organisation = await this.ensureOrganisation()
    const bootstrapUser = await this.ensureBootstrapUser(organisation.id)
    await this.assertBootstrapUserIsTechnical(bootstrapUser.id)

    const approval = { approvedForPilotBy: bootstrapUser.id, approvedForPilotAt: STAGING_BASELINE_APPROVED_AT }
    const safetyPolicies = { created: 0, existing: 0 }
    const activeSafety = new Map<WorkflowPouId, ActiveSafety>()

    for (const specification of stagingClientDemoSafetySpecifications(approval)) {
      const projection = providerProjection(specification, {
        projectionCode: `${specification.specificationCode}-assessment`,
        projectionVersion: specification.specificationVersion,
      })
      const existing = await this.findActiveSafety(organisation.id, specification.pouId)
      if (existing) {
        activeSafety.set(specification.pouId, this.assertExpectedSafety(existing, specification, projection, input))
        safetyPolicies.existing += 1
        continue
      }

      const created = await new SafetyProvisioningService(this.db, this.now).provisionAndActivate({
        organisationId: organisation.id,
        operatorUserId: bootstrapUser.id,
        specification,
        projection: { projectionCode: projection.projectionCode, projectionVersion: projection.projectionVersion },
        conversationProvider: {
          provider: 'elevenlabs',
          agentReference: input.elevenLabsAgentId,
          branchReference: input.elevenLabsAgentBranchId,
          environment: input.elevenLabsAgentEnvironment,
        },
      })
      activeSafety.set(specification.pouId, created)
      safetyPolicies.created += 1
    }

    const ordinarySpecifications = { created: 0, existing: 0 }
    for (const specification of stagingClientDemoOrdinarySpecificationsV02(approval)) {
      const guidance = conversationGuidanceProjection(specification, {
        projectionCode: `${specification.specificationCode}-conversation-guidance`,
        projectionVersion: specification.specificationVersion,
      })
      const review = pouReviewProjection(specification, {
        projectionCode: `${specification.specificationCode}-review`,
        projectionVersion: specification.specificationVersion,
      })
      const expectedSafety = activeSafety.get(specification.pouId)
      if (!expectedSafety) throw new StagingBootstrapError(`The ${specification.pouId} safety baseline could not be resolved.`)
      const existing = await this.findActiveOrdinary(organisation.id, specification.pouId)
      if (existing) {
        this.assertExpectedOrdinary(existing, specification, guidance, review, expectedSafety)
        ordinarySpecifications.existing += 1
        continue
      }

      await new OrganisationPouSpecificationProvisioningService(this.db, this.now).provisionAndActivate({
        organisationId: organisation.id,
        operatorUserId: bootstrapUser.id,
        specification,
        guidanceProjection: { projectionCode: guidance.projectionCode, projectionVersion: guidance.projectionVersion },
        reviewProjection: { projectionCode: review.projectionCode, projectionVersion: review.projectionVersion },
      })
      ordinarySpecifications.created += 1
    }

    await this.assertBootstrapUserIsTechnical(bootstrapUser.id)
    return { organisation: organisation.created ? 'created' : 'existing', bootstrapUser: bootstrapUser.created ? 'created' : 'existing', safetyPolicies, ordinarySpecifications }
  }

  private async ensureOrganisation(): Promise<{ id: string; created: boolean }> {
    const [inserted] = await this.db.insert(schema.organisations).values({
      slug: STAGING_CLIENT_DEMO_ORGANISATION.slug,
      name: STAGING_CLIENT_DEMO_ORGANISATION.name,
    }).onConflictDoNothing().returning({ id: schema.organisations.id })
    const [organisation] = inserted ? [inserted] : await this.db.select({ id: schema.organisations.id, name: schema.organisations.name })
      .from(schema.organisations).where(eq(schema.organisations.slug, STAGING_CLIENT_DEMO_ORGANISATION.slug)).limit(1)
    if (!organisation) throw new StagingBootstrapError('The staging client-demo organisation could not be resolved.')
    if (!inserted && 'name' in organisation && organisation.name !== STAGING_CLIENT_DEMO_ORGANISATION.name) {
      throw new StagingBootstrapError('The staging client-demo organisation slug is already assigned to a different organisation.')
    }
    return { id: organisation.id, created: Boolean(inserted) }
  }

  private async ensureBootstrapUser(organisationId: string): Promise<{ id: string; created: boolean }> {
    const [inserted] = await this.db.insert(schema.appUsers).values({
      organisationId,
      email: STAGING_CLIENT_DEMO_ORGANISATION.bootstrapUserEmail,
      displayName: STAGING_CLIENT_DEMO_ORGANISATION.bootstrapUserDisplayName,
    }).onConflictDoNothing().returning({ id: schema.appUsers.id })
    const [user] = inserted ? [inserted] : await this.db.select({ id: schema.appUsers.id, displayName: schema.appUsers.displayName })
      .from(schema.appUsers).where(and(eq(schema.appUsers.organisationId, organisationId), eq(schema.appUsers.email, STAGING_CLIENT_DEMO_ORGANISATION.bootstrapUserEmail))).limit(1)
    if (!user) throw new StagingBootstrapError('The staging bootstrap user could not be resolved.')
    if (!inserted && 'displayName' in user && user.displayName !== STAGING_CLIENT_DEMO_ORGANISATION.bootstrapUserDisplayName) {
      throw new StagingBootstrapError('The staging bootstrap user email is already assigned to a different user.')
    }
    return { id: user.id, created: Boolean(inserted) }
  }

  private async findActiveSafety(organisationId: string, pouId: WorkflowPouId): Promise<Record<string, unknown> | null> {
    const result = await this.db.execute(sql`
      select specification.id as specification_id, specification.content_hash as specification_hash, specification.specification as specification,
        projection.id as projection_id, projection.projection_hash as projection_hash, projection.projection as projection,
        projection.provider as provider, projection.provider_agent_reference as agent_id, projection.provider_branch_reference as branch_id,
        projection.provider_environment as environment
      from safety_specification_activation activation
      inner join safety_specification_version specification on specification.id = activation.specification_id
      inner join provider_assessment_projection projection on projection.id = activation.projection_id
      where activation.organisation_id = ${organisationId} and activation.pou_id = ${pouId} and activation.deactivated_at is null
    `)
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null
  }

  private assertExpectedSafety(row: Record<string, unknown>, specification: ReturnType<typeof stagingClientDemoSafetySpecifications>[number], projection: ReturnType<typeof providerProjection>, input: StagingBootstrapInput): ActiveSafety {
    if (
      row.specification_id == null || row.projection_id == null
      || row.specification_hash !== contentHash(specification)
      || row.projection_hash !== contentHash(projection)
      || row.provider !== 'elevenlabs'
      || row.agent_id !== input.elevenLabsAgentId
      || row.branch_id !== input.elevenLabsAgentBranchId
      || row.environment !== input.elevenLabsAgentEnvironment
    ) throw new StagingBootstrapError(`The existing ${specification.pouId} safety activation is not the approved staging baseline.`)
    return { specificationId: row.specification_id as string, projectionId: row.projection_id as string }
  }

  private async findActiveOrdinary(organisationId: string, pouId: WorkflowPouId): Promise<Record<string, unknown> | null> {
    const result = await this.db.execute(sql`
      select specification.content_hash as specification_hash, guidance.projection_hash as guidance_hash, review.projection_hash as review_hash,
        safety_link.safety_specification_id as safety_specification_id, safety_link.safety_projection_id as safety_projection_id
      from organisation_pou_specification_activation activation
      inner join organisation_pou_specification_version specification on specification.id = activation.specification_id
      inner join conversation_guidance_projection guidance on guidance.id = activation.conversation_guidance_projection_id
      inner join pou_review_projection review on review.id = activation.pou_review_projection_id
      inner join organisation_pou_safety_specification_link safety_link on safety_link.id = activation.safety_link_id
      where activation.organisation_id = ${organisationId} and activation.pou_id = ${pouId} and activation.deactivated_at is null
    `)
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null
  }

  private assertExpectedOrdinary(
    row: Record<string, unknown>,
    specification: ReturnType<typeof stagingClientDemoOrdinarySpecificationsV02>[number],
    guidance: ReturnType<typeof conversationGuidanceProjection>,
    review: ReturnType<typeof pouReviewProjection>,
    safety: ActiveSafety,
  ): void {
    if (
      row.specification_hash !== contentHash(specification)
      || row.guidance_hash !== contentHash(guidance)
      || row.review_hash !== contentHash(review)
      || row.safety_specification_id !== safety.specificationId
      || row.safety_projection_id !== safety.projectionId
    ) throw new StagingBootstrapError(`The existing ${specification.pouId} ordinary activation is not the approved staging baseline.`)
  }

  private async assertBootstrapUserIsTechnical(userId: string): Promise<void> {
    const result = await this.db.execute(sql`
      select
        (select count(*) from application_session where user_id = ${userId})::int as sessions,
        (select count(*) from external_identity where user_id = ${userId})::int as identities,
        (select count(*) from role_assignment where user_id = ${userId})::int as roles
    `)
    const row = result.rows[0] as { sessions?: number | string; identities?: number | string; roles?: number | string } | undefined
    const populated = ['sessions', 'identities', 'roles'].filter((key) => Number(row?.[key as keyof typeof row] ?? 0) !== 0)
    if (populated.length > 0) throw new StagingBootstrapError(`The staging bootstrap actor must remain non-login and unprivileged: ${populated.join(', ')} already exist.`)
  }
}

export { stagedPouIds }
