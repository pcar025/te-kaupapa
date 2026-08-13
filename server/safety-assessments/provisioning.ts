import { and, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from '../db/schema.js'
import { contentHash, providerProjection, safetySpecificationSchema, type ProviderAssessmentProjection, type SafetySpecificationVersion } from './domain.js'

type Database = NodePgDatabase<typeof schema>

export class SafetyProvisioningError extends Error {}

export function assertProvisionableSpecification(specification: SafetySpecificationVersion): SafetySpecificationVersion {
  const parsed = safetySpecificationSchema.parse(specification)
  if (parsed.approvalStatus !== 'approved_for_pilot' || !parsed.approvedForPilotBy || !parsed.approvedForPilotAt) {
    throw new SafetyProvisioningError('Only an approved-for-pilot specification with recorded approver provenance may be activated.')
  }
  for (const rule of parsed.rules.filter((rule) => rule.allowedCandidateOutcomes.includes('possible_concern'))) {
    if (!rule.canonicalBroadClass || rule.permittedHumanConcernLevels.length === 0) throw new SafetyProvisioningError('Every confirmable rule requires an approved canonical mapping and human levels.')
  }
  return parsed
}

export interface SafetyProvisioningInput {
  organisationId: string
  specification: SafetySpecificationVersion
  projection: Pick<ProviderAssessmentProjection, 'projectionCode' | 'projectionVersion'>
  conversationProvider: { provider: string; agentReference: string; branchReference: string | null; environment: string }
  operatorUserId: string
}

export interface SafetyProjectionReactivationInput {
  organisationId: string
  specificationId: string
  projection: Pick<ProviderAssessmentProjection, 'projectionCode' | 'projectionVersion'>
  conversationProvider: { provider: string; agentReference: string; branchReference: string | null; environment: string }
  operatorUserId: string
}

/**
 * Server-side/operator-only activation. It deliberately exposes no HTTP route
 * and creates new content-addressed records rather than altering historical
 * policy or projection records.
 */
export class SafetyProvisioningService {
  constructor(private readonly db: Database, private readonly now: () => Date = () => new Date()) {}

  async provisionAndActivate(input: SafetyProvisioningInput): Promise<{ specificationId: string; projectionId: string }> {
    const specification = assertProvisionableSpecification(input.specification)
    const projection = providerProjection(specification, input.projection)
    const specificationHash = contentHash(specification)
    const ruleManifestHash = contentHash(projection.rules)
    const projectionHash = contentHash(projection)
    if (projection.specificationHash !== specificationHash || projection.ruleManifestHash !== ruleManifestHash) throw new SafetyProvisioningError('Generated provider projection does not match the specification hashes.')

    return this.db.transaction(async (tx) => {
      const [storedSpecification] = await tx.insert(schema.safetySpecificationVersions).values({
        organisationId: input.organisationId, specificationCode: specification.specificationCode, specificationVersion: specification.specificationVersion,
        pouId: specification.pouId, approvalStatus: specification.approvalStatus, contentHash: specificationHash, ruleManifestHash,
        specification, sourceDocumentCode: specification.sourceDocumentCode, sourceDocumentStatus: specification.sourceDocumentStatus,
        sourceReference: specification.sourceReference, sourceDocumentHash: specification.sourceDocumentHash, derivedAt: new Date(specification.derivedAt),
        approvedForPilotBy: specification.approvedForPilotBy, approvedForPilotAt: new Date(specification.approvedForPilotAt!), createdAt: this.now(),
      }).returning()
      if (!storedSpecification) throw new SafetyProvisioningError('Specification provisioning failed.')
      const [storedProjection] = await tx.insert(schema.providerAssessmentProjections).values({
        organisationId: input.organisationId, pouId: specification.pouId, specificationId: storedSpecification.id,
        projectionCode: projection.projectionCode, projectionVersion: projection.projectionVersion, projectionHash,
        provider: input.conversationProvider.provider, providerAgentReference: input.conversationProvider.agentReference, providerBranchReference: input.conversationProvider.branchReference,
        providerEnvironment: input.conversationProvider.environment, projection, createdAt: this.now(),
      }).returning()
      if (!storedProjection) throw new SafetyProvisioningError('Provider projection provisioning failed.')
      await tx.update(schema.safetySpecificationActivations).set({ deactivatedAt: this.now() }).where(and(
        eq(schema.safetySpecificationActivations.organisationId, input.organisationId),
        eq(schema.safetySpecificationActivations.pouId, specification.pouId),
        sql`${schema.safetySpecificationActivations.deactivatedAt} is null`,
      ))
      await tx.insert(schema.safetySpecificationActivations).values({
        organisationId: input.organisationId, pouId: specification.pouId, specificationId: storedSpecification.id, projectionId: storedProjection.id, activatedByUserId: input.operatorUserId, activatedAt: this.now(),
      })
      return { specificationId: storedSpecification.id, projectionId: storedProjection.id }
    })
  }

  /**
   * Re-derive an immutable provider projection from an existing approved
   * specification. This preserves the original approval provenance while
   * allowing an operator to supersede an obsolete technical projection.
   */
  async reprojectAndActivateExisting(input: SafetyProjectionReactivationInput): Promise<{ specificationId: string; projectionId: string }> {
    return this.db.transaction(async (tx) => {
      const [storedSpecification] = await tx.select().from(schema.safetySpecificationVersions).where(and(
        eq(schema.safetySpecificationVersions.id, input.specificationId),
        eq(schema.safetySpecificationVersions.organisationId, input.organisationId),
      )).limit(1)
      if (!storedSpecification) throw new SafetyProvisioningError('The approved safety specification could not be found.')

      const specification = assertProvisionableSpecification(safetySpecificationSchema.parse(storedSpecification.specification))
      const projection = providerProjection(specification, input.projection)
      const specificationHash = contentHash(specification)
      const ruleManifestHash = contentHash(projection.rules)
      const projectionHash = contentHash(projection)
      if (specificationHash !== storedSpecification.contentHash || ruleManifestHash !== storedSpecification.ruleManifestHash || projection.specificationHash !== specificationHash || projection.ruleManifestHash !== ruleManifestHash) {
        throw new SafetyProvisioningError('The stored approved safety specification failed immutable integrity verification.')
      }

      const [storedProjection] = await tx.insert(schema.providerAssessmentProjections).values({
        organisationId: input.organisationId, pouId: specification.pouId, specificationId: storedSpecification.id,
        projectionCode: projection.projectionCode, projectionVersion: projection.projectionVersion, projectionHash,
        provider: input.conversationProvider.provider, providerAgentReference: input.conversationProvider.agentReference, providerBranchReference: input.conversationProvider.branchReference,
        providerEnvironment: input.conversationProvider.environment, projection, createdAt: this.now(),
      }).returning()
      if (!storedProjection) throw new SafetyProvisioningError('Provider projection provisioning failed.')
      await tx.update(schema.safetySpecificationActivations).set({ deactivatedAt: this.now() }).where(and(
        eq(schema.safetySpecificationActivations.organisationId, input.organisationId),
        eq(schema.safetySpecificationActivations.pouId, specification.pouId),
        sql`${schema.safetySpecificationActivations.deactivatedAt} is null`,
      ))
      await tx.insert(schema.safetySpecificationActivations).values({
        organisationId: input.organisationId, pouId: specification.pouId, specificationId: storedSpecification.id, projectionId: storedProjection.id,
        activatedByUserId: input.operatorUserId, activatedAt: this.now(),
      })
      return { specificationId: storedSpecification.id, projectionId: storedProjection.id }
    })
  }
}
