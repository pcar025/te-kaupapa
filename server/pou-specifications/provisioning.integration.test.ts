import { randomUUID } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as schema from '../db/schema.js'
import { withMigratedTestDatabase } from '../db/test-harness.js'
import { approvedWhakapapaPilotV01, contentHash, providerProjection } from '../safety-assessments/domain.js'
import { SafetyProvisioningService } from '../safety-assessments/provisioning.js'
import { PostgresSafetyAssessmentRepository } from '../safety-assessments/repository.js'
import { approvedWhakapapaOrganisationPouV01, conversationGuidanceProjection, pouReviewProjection } from './domain.js'
import { OrganisationPouSpecificationProvisioningService } from './provisioning.js'
import { PostgresOrganisationPouSpecificationRepository } from './repository.js'
import { organisationPouSpecificationFromRegistry } from './registry.js'
import { safetySpecificationFromRegistry } from '../safety-assessments/registry.js'
import { PHASE_5D_DRAFT_POU_SPECIFICATIONS } from './phase5d-specifications.js'

describe('Organisation Pou specification operator provisioning', () => {
  it('creates one immutable approved Whakapapa aggregate linked to the active safety projection without workflow mutation', async () => {
    await withMigratedTestDatabase(async (connection) => {
      const organisationId = randomUUID()
      const operatorId = randomUUID()
      const now = new Date('2026-08-14T07:07:00.000Z')
      await connection.db.insert(schema.organisations).values({ id: organisationId, slug: `pou-spec-${organisationId}`, name: 'Pou specification fixture' })
      await connection.db.insert(schema.appUsers).values({ id: operatorId, organisationId, email: `${operatorId}@example.invalid`, displayName: 'Pilot operator' })

      const safetySpecification = approvedWhakapapaPilotV01({ approvedForPilotBy: operatorId, approvedForPilotAt: now.toISOString() })
      const safety = await new SafetyProvisioningService(connection.db, () => now).provisionAndActivate({
        organisationId,
        operatorUserId: operatorId,
        specification: safetySpecification,
        projection: { projectionCode: 'fixture-safety', projectionVersion: '1' },
        conversationProvider: { provider: 'elevenlabs', agentReference: 'agent-fixture', branchReference: 'branch-fixture', environment: 'test' },
      })

      const before = await connection.db.execute(sql`
        select
          (select count(*)::int from workflow_session where organisation_id = ${organisationId}) as workflows,
          (select count(*)::int from workflow_conversation where organisation_id = ${organisationId}) as conversations,
          (select count(*)::int from conversation_safety_assessment_run where organisation_id = ${organisationId}) as runs
      `)
      const organisationSpecification = approvedWhakapapaOrganisationPouV01({ approvedForPilotBy: operatorId, approvedForPilotAt: now.toISOString() })
      await expect(new OrganisationPouSpecificationProvisioningService(connection.db, () => now).provisionAndActivate({
        organisationId,
        operatorUserId: operatorId,
        specification: { ...organisationSpecification, sourceDocumentHash: 'f'.repeat(64) },
        guidanceProjection: { projectionCode: 'mismatched-guidance', projectionVersion: '1' },
        reviewProjection: { projectionCode: 'mismatched-review', projectionVersion: '1' },
      })).rejects.toThrow('active safety projection')
      const provisioned = await new OrganisationPouSpecificationProvisioningService(connection.db, () => now).provisionAndActivate({
        organisationId,
        operatorUserId: operatorId,
        specification: organisationSpecification,
        guidanceProjection: { projectionCode: 'fixture-guidance', projectionVersion: '1' },
        reviewProjection: { projectionCode: 'fixture-review', projectionVersion: '1' },
      })

      const safetyPin = await new PostgresSafetyAssessmentRepository(connection.db).resolveActivePin(organisationId, 'whakapapa', {
        provider: 'elevenlabs', agentReference: 'agent-fixture', branchReference: 'branch-fixture', environment: 'test',
      })
      expect(safetyPin).not.toBeNull()
      if (!safetyPin) throw new Error('Expected the active fixture safety pin.')
      const pin = await new PostgresOrganisationPouSpecificationRepository(connection.db).resolveActivePin(organisationId, 'whakapapa', safetyPin)
      expect(pin.specificationId).toBe(provisioned.specificationId)
      expect(pin.conversationGuidanceProjectionId).toBe(provisioned.guidanceProjectionId)
      expect(pin.pouReviewProjectionId).toBe(provisioned.reviewProjectionId)
      expect(pin.specification.approvalStatus).toBe('approved_for_pilot')
      expect(pin.specification.sourceDocumentStatus).toBe('draft')
      expect(pin.conversationGuidanceProjection.explorationAreas).toHaveLength(4)
      expect(pin.pouReviewProjection.criteria.map((criterion) => criterion.criterionCode)).toEqual([
        'WHAKAPAPA_IDENTITY_CONTEXT',
        'WHAKAPAPA_STRENGTHS_PROTECTION',
        'WHAKAPAPA_CULTURAL_CONNECTION',
      ])
      expect(pin.pouReviewProjection.criteria.every((criterion) => criterion.evidenceScope === 'current_conversation')).toBe(true)
      expect(await connection.db.select().from(schema.organisationPouSafetySpecificationLinks).where(eq(schema.organisationPouSafetySpecificationLinks.id, provisioned.safetyLinkId))).toMatchObject([
        { organisationPouSpecificationId: provisioned.specificationId, safetySpecificationId: safety.specificationId, safetyProjectionId: safety.projectionId },
      ])

      // This is the exact durable shape created before Phase 5D added the
      // redundant projection-level Pou identifier. It must remain valid only
      // as the known Whakapapa v0.1 historical derivation.
      const { pouId: _guidancePouId, ...historicGuidance } = conversationGuidanceProjection(organisationSpecification, {
        projectionCode: 'TE_WAHAROA_WHAKAPAPA-conversation-guidance', projectionVersion: '0.1',
      })
      const { pouId: _reviewPouId, ...historicReview } = pouReviewProjection(organisationSpecification, {
        projectionCode: 'TE_WAHAROA_WHAKAPAPA-review', projectionVersion: '0.1',
      })
      const [storedHistoricGuidance] = await connection.db.insert(schema.conversationGuidanceProjections).values({
        organisationId, pouId: 'whakapapa', specificationId: provisioned.specificationId,
        projectionCode: 'TE_WAHAROA_WHAKAPAPA-conversation-guidance', projectionVersion: '0.1', projectionHash: contentHash(historicGuidance), projection: historicGuidance, createdAt: now,
      }).returning()
      const [storedHistoricReview] = await connection.db.insert(schema.pouReviewProjections).values({
        organisationId, pouId: 'whakapapa', specificationId: provisioned.specificationId,
        projectionCode: 'TE_WAHAROA_WHAKAPAPA-review', projectionVersion: '0.1', projectionHash: contentHash(historicReview), projection: historicReview, createdAt: now,
      }).returning()
      await connection.db.update(schema.organisationPouSpecificationActivations)
        .set({ deactivatedAt: now })
        .where(eq(schema.organisationPouSpecificationActivations.id, provisioned.activationId))
      await connection.db.insert(schema.organisationPouSpecificationActivations).values({
        organisationId, pouId: 'whakapapa', specificationId: provisioned.specificationId,
        conversationGuidanceProjectionId: storedHistoricGuidance!.id,
        pouReviewProjectionId: storedHistoricReview!.id,
        safetyLinkId: provisioned.safetyLinkId,
        activatedByUserId: operatorId,
        activatedAt: now,
      })
      await expect(new PostgresOrganisationPouSpecificationRepository(connection.db).resolveActivePin(organisationId, 'whakapapa', safetyPin)).resolves.toMatchObject({
        conversationGuidanceProjectionId: storedHistoricGuidance!.id,
        pouReviewProjectionId: storedHistoricReview!.id,
      })

      await expect(connection.db.update(schema.organisationPouSpecificationVersions)
        .set({ specificationCode: 'forged' })
        .where(eq(schema.organisationPouSpecificationVersions.id, provisioned.specificationId)))
        .rejects.toMatchObject({ cause: expect.objectContaining({ code: 'P0001' }) })
      const after = await connection.db.execute(sql`
        select
          (select count(*)::int from workflow_session where organisation_id = ${organisationId}) as workflows,
          (select count(*)::int from workflow_conversation where organisation_id = ${organisationId}) as conversations,
          (select count(*)::int from conversation_safety_assessment_run where organisation_id = ${organisationId}) as runs
      `)
      expect(after.rows[0]).toEqual(before.rows[0])
    }, async (connection) => {
      const ids = sql`select id from organisation where slug like 'pou-spec-%'`
      const immutableTriggers = [
        ['safety_specification_version', 'safety_specification_version_immutable'],
        ['provider_assessment_projection', 'provider_assessment_projection_immutable'],
        ['organisation_pou_specification_version', 'organisation_pou_specification_version_immutable'],
        ['conversation_guidance_projection', 'conversation_guidance_projection_immutable'],
        ['pou_review_projection', 'pou_review_projection_immutable'],
        ['organisation_pou_safety_specification_link', 'organisation_pou_safety_specification_link_immutable'],
      ] as const
      for (const [table, trigger] of immutableTriggers) await connection.db.execute(sql.raw(`alter table ${table} disable trigger ${trigger}`))
      try {
        await connection.db.execute(sql`delete from organisation_pou_specification_activation where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from organisation_pou_safety_specification_link where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from conversation_guidance_projection where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from pou_review_projection where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from organisation_pou_specification_version where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from safety_specification_activation where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from provider_assessment_projection where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from safety_specification_version where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from app_user where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from organisation where slug like 'pou-spec-%'`)
      } finally {
        for (const [table, trigger] of immutableTriggers) await connection.db.execute(sql.raw(`alter table ${table} enable trigger ${trigger}`))
      }
    })
  })

  it('keeps two approved draft-derived Pou aggregates isolated by Pou and organisation without workflow mutation', async () => {
    await withMigratedTestDatabase(async (connection) => {
      const organisationId = randomUUID()
      const foreignOrganisationId = randomUUID()
      const operatorId = randomUUID()
      const now = new Date('2026-08-14T07:08:00.000Z')
      await connection.db.insert(schema.organisations).values([
        { id: organisationId, slug: `pou-spec-${organisationId}`, name: 'Pou specification fixture' },
        { id: foreignOrganisationId, slug: `pou-spec-${foreignOrganisationId}`, name: 'Foreign specification fixture' },
      ])
      await connection.db.insert(schema.appUsers).values({ id: operatorId, organisationId, email: `${operatorId}@example.invalid`, displayName: 'Pilot operator' })
      const safetyRepository = new PostgresSafetyAssessmentRepository(connection.db)
      const pouRepository = new PostgresOrganisationPouSpecificationRepository(connection.db)
      const provisionSafety = new SafetyProvisioningService(connection.db, () => now)
      const provisionPou = new OrganisationPouSpecificationProvisioningService(connection.db, () => now)
      const approval = { approvedForPilotBy: operatorId, approvedForPilotAt: now.toISOString() }
      const selected = PHASE_5D_DRAFT_POU_SPECIFICATIONS.filter((specification) => specification.pouId === 'manaakitanga' || specification.pouId === 'tikanga')

      for (const draft of selected) {
        const safety = safetySpecificationFromRegistry(`${draft.specificationCode}_SAFETY`, draft.specificationVersion, approval)
        await provisionSafety.provisionAndActivate({
          organisationId, operatorUserId: operatorId, specification: safety,
          projection: { projectionCode: `${draft.pouId}-safety`, projectionVersion: '1' },
          conversationProvider: { provider: 'elevenlabs', agentReference: 'agent-fixture', branchReference: 'branch-fixture', environment: 'test' },
        })
        const specification = organisationPouSpecificationFromRegistry(draft.specificationCode, draft.specificationVersion, approval)
        await provisionPou.provisionAndActivate({
          organisationId, operatorUserId: operatorId, specification,
          guidanceProjection: { projectionCode: `${draft.pouId}-guidance`, projectionVersion: '1' },
          reviewProjection: { projectionCode: `${draft.pouId}-review`, projectionVersion: '1' },
        })
      }

      const manaSafety = await safetyRepository.resolveActivePin(organisationId, 'manaakitanga', { provider: 'elevenlabs', agentReference: 'agent-fixture', branchReference: 'branch-fixture', environment: 'test' })
      const tikangaSafety = await safetyRepository.resolveActivePin(organisationId, 'tikanga', { provider: 'elevenlabs', agentReference: 'agent-fixture', branchReference: 'branch-fixture', environment: 'test' })
      expect(manaSafety?.projection.rules).toEqual([])
      expect(tikangaSafety?.projection.rules).toEqual([])
      if (!manaSafety || !tikangaSafety) throw new Error('Expected both active draft-derived safety pins.')
      const mana = await pouRepository.resolveActivePin(organisationId, 'manaakitanga', manaSafety)
      const tikanga = await pouRepository.resolveActivePin(organisationId, 'tikanga', tikangaSafety)
      expect(mana.conversationGuidanceProjection.pouId).toBe('manaakitanga')
      expect(tikanga.conversationGuidanceProjection.pouId).toBe('tikanga')
      expect(mana.pouReviewProjection.criteria.map((criterion) => criterion.criterionCode)).not.toEqual(tikanga.pouReviewProjection.criteria.map((criterion) => criterion.criterionCode))
      await expect(pouRepository.resolveActivePin(organisationId, 'tikanga', manaSafety)).rejects.toThrow('not linked')
      await expect(safetyRepository.resolveActivePin(foreignOrganisationId, 'manaakitanga', { provider: 'elevenlabs', agentReference: 'agent-fixture', branchReference: 'branch-fixture', environment: 'test' })).resolves.toBeNull()
      await expect(safetyRepository.resolveActivePin(organisationId, 'oranga', { provider: 'elevenlabs', agentReference: 'agent-fixture', branchReference: 'branch-fixture', environment: 'test' })).resolves.toBeNull()
      expect((await connection.db.execute(sql`select count(*)::int as count from workflow_session where organisation_id = ${organisationId}`)).rows[0]).toMatchObject({ count: 0 })
    }, async (connection) => {
      const ids = sql`select id from organisation where slug like 'pou-spec-%'`
      const immutableTriggers = [
        ['safety_specification_version', 'safety_specification_version_immutable'],
        ['provider_assessment_projection', 'provider_assessment_projection_immutable'],
        ['organisation_pou_specification_version', 'organisation_pou_specification_version_immutable'],
        ['conversation_guidance_projection', 'conversation_guidance_projection_immutable'],
        ['pou_review_projection', 'pou_review_projection_immutable'],
        ['organisation_pou_safety_specification_link', 'organisation_pou_safety_specification_link_immutable'],
      ] as const
      for (const [table, trigger] of immutableTriggers) await connection.db.execute(sql.raw(`alter table ${table} disable trigger ${trigger}`))
      try {
        await connection.db.execute(sql`delete from organisation_pou_specification_activation where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from organisation_pou_safety_specification_link where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from conversation_guidance_projection where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from pou_review_projection where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from organisation_pou_specification_version where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from safety_specification_activation where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from provider_assessment_projection where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from safety_specification_version where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from app_user where organisation_id in (${ids})`)
        await connection.db.execute(sql`delete from organisation where slug like 'pou-spec-%'`)
      } finally {
        for (const [table, trigger] of immutableTriggers) await connection.db.execute(sql.raw(`alter table ${table} enable trigger ${trigger}`))
      }
    })
  })
})
