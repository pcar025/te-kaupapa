import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as schema from '../db/schema.js'
import type { DatabaseConnection } from '../db/repository.js'
import { withMigratedTestDatabase } from '../db/test-harness.js'
import type { AuthenticatedUser } from '../domain/auth.js'
import { AuthorizationError } from '../domain/auth.js'
import { approvedWhakapapaPilotV01 } from '../safety-assessments/domain.js'
import { SafetyProvisioningService } from '../safety-assessments/provisioning.js'
import { PostgresSafetyAssessmentRepository } from '../safety-assessments/repository.js'
import { approvedWhakapapaOrganisationPouV01, conversationRuntimeDynamicVariables } from './domain.js'
import { IncompletePouSpecificationDraftError, PostgresOrganisationPouSpecificationAuthoringService, PouSpecificationDraftNotFoundError } from './authoring.js'
import { OrganisationPouSpecificationProvisioningService } from './provisioning.js'
import { PostgresOrganisationPouSpecificationRepository } from './repository.js'

async function fixture(connection: DatabaseConnection) {
  const organisationId = randomUUID()
  const userId = randomUUID()
  const now = new Date('2026-08-18T04:00:00.000Z')
  await connection.db.insert(schema.organisations).values({ id: organisationId, slug: `pou-author-${organisationId}`, name: 'Pou authoring fixture' })
  await connection.db.insert(schema.appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: 'Specification editor' })
  const actor: AuthenticatedUser = { id: userId, displayName: 'Specification editor', status: 'active', organisation: { id: organisationId, slug: `pou-author-${organisationId}`, name: 'Pou authoring fixture' }, roles: ['SPECIFICATION_EDITOR'] }
  const approval = { approvedForPilotBy: userId, approvedForPilotAt: now.toISOString() }
  const safety = await new SafetyProvisioningService(connection.db, () => now).provisionAndActivate({ organisationId, operatorUserId: userId, specification: approvedWhakapapaPilotV01(approval), projection: { projectionCode: 'authoring-safety', projectionVersion: '0.1' }, conversationProvider: { provider: 'elevenlabs', agentReference: 'fixture-agent', branchReference: 'fixture-branch', environment: 'test' } })
  await new OrganisationPouSpecificationProvisioningService(connection.db, () => now).provisionAndActivate({ organisationId, operatorUserId: userId, specification: approvedWhakapapaOrganisationPouV01(approval), guidanceProjection: { projectionCode: 'TE_WAHAROA_WHAKAPAPA-conversation-guidance', projectionVersion: '0.1' }, reviewProjection: { projectionCode: 'TE_WAHAROA_WHAKAPAPA-review', projectionVersion: '0.1' } })
  return { organisationId, userId, now, actor, safety }
}

async function cleanup(connection: DatabaseConnection) {
  const ids = sql`select id from organisation where slug like 'pou-author-%'`
  const immutable = ['safety_specification_version', 'provider_assessment_projection', 'organisation_pou_specification_version', 'conversation_guidance_projection', 'pou_review_projection', 'organisation_pou_safety_specification_link'] as const
  for (const table of immutable) await connection.db.execute(sql.raw(`alter table ${table} disable trigger ${table}_immutable`))
  try {
    await connection.db.execute(sql`delete from organisation_pou_specification_draft where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from organisation_pou_specification_activation where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from organisation_pou_safety_specification_link where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from conversation_guidance_projection where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from pou_review_projection where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from organisation_pou_specification_version where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from safety_specification_activation where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from provider_assessment_projection where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from safety_specification_version where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from app_user where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from organisation where slug like 'pou-author-%'`)
  } finally { for (const table of immutable) await connection.db.execute(sql.raw(`alter table ${table} enable trigger ${table}_immutable`)) }
}

describe('SME Pou specification draft authoring', () => {
  it('keeps an incomplete v0.2 opening separate from active v0.1 until explicit activation', async () => {
    await withMigratedTestDatabase(async (connection) => {
      const { actor, organisationId, safety, now } = await fixture(connection)
      const service = new PostgresOrganisationPouSpecificationAuthoringService(connection.db, () => now)
      await expect(service.list({ ...actor, roles: ['SUPERVISOR'] })).rejects.toBeInstanceOf(AuthorizationError)
      const active = new PostgresOrganisationPouSpecificationRepository(connection.db)
      const safetyPin = await new PostgresSafetyAssessmentRepository(connection.db).resolveActivePin(organisationId, 'whakapapa', { provider: 'elevenlabs', agentReference: 'fixture-agent', branchReference: 'fixture-branch', environment: 'test' })
      if (!safetyPin) throw new Error('Expected active safety fixture.')
      const before = await active.resolveActivePin(organisationId, 'whakapapa', safetyPin)
      expect(conversationRuntimeDynamicVariables(before.conversationGuidanceProjection, 'whakapapa').pou_opening).toBe('')
      const draft = await service.createDraft(actor, 'whakapapa')
      const foreignOrganisationId = randomUUID()
      const foreignActorId = randomUUID()
      await connection.db.insert(schema.organisations).values({ id: foreignOrganisationId, slug: `pou-author-${foreignOrganisationId}`, name: 'Foreign authoring fixture' })
      await connection.db.insert(schema.appUsers).values({ id: foreignActorId, organisationId: foreignOrganisationId, email: `${foreignActorId}@example.invalid`, displayName: 'Foreign editor' })
      const foreignEditor: AuthenticatedUser = { id: foreignActorId, displayName: 'Foreign editor', status: 'active', organisation: { id: foreignOrganisationId, slug: `pou-author-${foreignOrganisationId}`, name: 'Foreign authoring fixture' }, roles: ['SPECIFICATION_EDITOR'] }
      await expect(service.getDraft(foreignEditor, draft.id)).rejects.toBeInstanceOf(PouSpecificationDraftNotFoundError)
      await expect(service.saveDraft(foreignEditor, draft.id, draft.revision, { purpose: draft.specification.purpose, conversationExplorationAreas: draft.specification.conversationExplorationAreas, evidenceCriteria: draft.specification.evidenceCriteria, reviewSynthesisGuidance: draft.specification.reviewSynthesisGuidance, proposedSafetyRuleNotes: [] })).rejects.toBeInstanceOf(PouSpecificationDraftNotFoundError)
      await expect(service.approveAndActivate(foreignEditor, draft.id, draft.revision)).rejects.toBeInstanceOf(PouSpecificationDraftNotFoundError)
      expect(draft.draftVersion).toBe('0.2')
      expect(draft.specification.openingReflectionQuestion).toBeNull()
      expect(draft.preview.openingStatus).toBe('sme_input_required')
      expect(draft.preview.opening).toBeNull()
      expect(draft.preview.conversationStart).toBe('Kia ora. We’re reflecting on Whakapapa.')
      expect(draft.canApproveAndActivate).toBe(false)
      const content = (source: typeof draft.specification, openingReflectionQuestion?: string) => ({ purpose: source.purpose, openingReflectionQuestion, conversationExplorationAreas: source.conversationExplorationAreas, evidenceCriteria: source.evidenceCriteria, reviewSynthesisGuidance: source.reviewSynthesisGuidance, proposedSafetyRuleNotes: [] })
      const blankSaved = await service.saveDraft(actor, draft.id, draft.revision, content(draft.specification))
      await expect(service.approveAndActivate(actor, blankSaved.id, blankSaved.revision)).rejects.toBeInstanceOf(IncompletePouSpecificationDraftError)
      expect((await active.resolveActivePin(organisationId, 'whakapapa', safetyPin)).specificationHash).toBe(before.specificationHash)
      const withOpening = await service.saveDraft(actor, blankSaved.id, blankSaved.revision, content(blankSaved.specification, 'What would be most helpful to begin with in this reflection?'))
      expect(withOpening.specification.openingReflectionQuestionProvenance).toBe('sme_authored')
      expect(withOpening.preview.conversationStart).toBe('Kia ora. We’re reflecting on Whakapapa. What would be most helpful to begin with in this reflection?')
      expect(withOpening.canApproveAndActivate).toBe(true)
      await expect(service.approveAndActivate(actor, withOpening.id, withOpening.revision - 1)).rejects.toMatchObject({ currentRevision: withOpening.revision })
      const invalidConditional = await service.saveDraft(actor, withOpening.id, withOpening.revision, content(withOpening.specification, withOpening.specification.openingReflectionQuestion ?? undefined))
      const invalidContent = content(invalidConditional.specification, invalidConditional.specification.openingReflectionQuestion ?? undefined)
      invalidContent.conversationExplorationAreas = invalidContent.conversationExplorationAreas.map((area, index) => index === 0 ? { ...area, explorationMode: 'conditional', conditionalTrigger: null, followUpGuidance: [] } : area)
      const invalid = await service.saveDraft(actor, invalidConditional.id, invalidConditional.revision, invalidContent)
      await expect(service.approveAndActivate(actor, invalid.id, invalid.revision)).rejects.toThrow('Conditional exploration')
      const noCurrentContent = content(withOpening.specification, withOpening.specification.openingReflectionQuestion ?? undefined)
      noCurrentContent.conversationExplorationAreas = noCurrentContent.conversationExplorationAreas.map((area) => ({ ...area, evidenceScope: 'application_state' as const }))
      noCurrentContent.evidenceCriteria = noCurrentContent.evidenceCriteria.map((criterion) => ({ ...criterion, evidenceScope: 'application_state' as const }))
      const noCurrent = await service.saveDraft(actor, invalid.id, invalid.revision, noCurrentContent)
      await expect(service.approveAndActivate(actor, noCurrent.id, noCurrent.revision)).rejects.toThrow('current-conversation guidance')
      const repaired = await service.saveDraft(actor, noCurrent.id, noCurrent.revision, content(withOpening.specification, withOpening.specification.openingReflectionQuestion ?? undefined))
      const activated = await service.approveAndActivate(actor, repaired.id, repaired.revision)
      expect(activated.draft.activatedAt).not.toBeNull()
      const after = await active.resolveActivePin(organisationId, 'whakapapa', safetyPin)
      expect(after.specification.specificationVersion).toBe('0.2')
      expect(after.conversationGuidanceProjection.openingQuestion).toBe('What would be most helpful to begin with in this reflection?')
      expect(conversationRuntimeDynamicVariables(after.conversationGuidanceProjection, 'whakapapa').pou_opening).toBe('What would be most helpful to begin with in this reflection?')
      expect(after.specification.openingReflectionQuestionProvenance).toBe('sme_authored')
      expect((await connection.db.select().from(schema.organisationPouSpecificationVersions).where(eq(schema.organisationPouSpecificationVersions.organisationId, organisationId))).length).toBe(2)
      expect(safety.specificationId).toBeTruthy()
    }, cleanup)
  })
})
