import { randomUUID } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import type { AuthenticatedUser } from '../domain/auth.js'
import * as schema from '../db/schema.js'
import { hasTestDatabaseUrl, withMigratedTestDatabase } from '../db/test-harness.js'
import { PostgresWorkflowRepository } from '../workflows/repository.js'
import { PostgresWorkflowSynthesisRepository } from './repository.js'
import { WorkflowSynthesisUnavailableError } from './domain.js'
import type { WorkflowSynthesisProvider } from './provider.js'

const generated = { overallSummary: 'A concise confirmed cross-Pou reflection.', keyThemes: 'Shared whānau themes.', strengthsSummary: 'Supportive relationships.', areasForAttentionSummary: 'A matter needs follow-up.', informationStillToExploreSummary: 'One matter remains to explore.', confirmedSafetyConcernsSummary: 'No human-confirmed safety concerns are recorded.' }

function postgresCause(error: unknown): { code?: unknown; message?: unknown } | undefined {
  const seen = new Set<unknown>()
  const visit = (value: unknown): { code?: unknown; message?: unknown } | undefined => {
    if (!value || typeof value !== 'object' || seen.has(value)) return undefined
    seen.add(value)
    const record = value as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown[] }
    if (record.code === 'P0001' && (record.message === 'workflow synthesis provenance is immutable' || record.message === 'confirmed synthesis revision does not belong to workflow' || record.message === 'final record confirmed synthesis does not belong to workflow')) return record
    return visit(record.cause) ?? (Array.isArray(record.errors) ? record.errors.map(visit).find(Boolean) : undefined)
  }
  return visit(error)
}

describe.skipIf(!hasTestDatabaseUrl())('PostgreSQL workflow synthesis integration', () => {
  it('keeps generated and edited revisions noncanonical until explicit confirmation, then snapshots the final record immutably', async () => {
    let organisationId = ''
    let foreignOrganisationId = ''
    await withMigratedTestDatabase(async (connection) => {
      organisationId = randomUUID(); const userId = randomUUID()
      const actor: AuthenticatedUser = { id: userId, displayName: 'Synthesis test Kaimahi', status: 'active', organisation: { id: organisationId, slug: `synthesis-${organisationId}`, name: 'Synthesis test organisation' }, roles: ['KAIMAHI'] }
      await connection.db.insert(schema.organisations).values({ id: organisationId, slug: actor.organisation.slug, name: actor.organisation.name })
      await connection.db.insert(schema.appUsers).values({ id: userId, organisationId, email: `${userId}@example.invalid`, displayName: actor.displayName })
      const now = new Date('2026-08-18T00:00:00.000Z')
      const syntheses = new PostgresWorkflowSynthesisRepository(connection.db, () => now)
      let reference = 0
      const workflows = new PostgresWorkflowRepository(connection.db, () => now, () => `TK-SYNTH${++reference}`, undefined, undefined, syntheses)
      const created = await workflows.createDraft({ actor, idempotencyKey: randomUUID() })
      let workflow = (await workflows.submitCommand({ actor, workflowSessionId: created.workflow.id, command: { type: 'setup-confirmed', idempotencyKey: randomUUID(), expectedVersion: 1, whanauReference: 'SYNTHETIC', engagementType: 'hui', sessionFocus: 'Synthetic synthesis proof', immediateConcern: 'none', readiness: { verbalConsentConfirmed: true, writtenConsentConfirmed: true, initialRiskAssessmentCompleted: true } } })).workflow
      for (const checkpoint of workflow.checkpoints) workflow = (await workflows.submitCommand({ actor, workflowSessionId: workflow.id, command: { type: 'pou-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: workflow.version, pouId: checkpoint.pouId } })).workflow
      expect(workflow.currentStage).toBe('pou-summary')
      const provider: WorkflowSynthesisProvider = { generateWorkflowSynthesis: async (input) => {
        expect(input.pouReviews).toHaveLength(7)
        expect(JSON.stringify(input)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i)
        return { content: generated, provider: 'test', model: 'test-model', configurationHash: 'a'.repeat(64), schemaVersion: '1', generatedAt: now }
      } }
      const ready = await syntheses.generate(actor, workflow, provider)
      expect(ready).toMatchObject({ status: 'ready', draft: { revision: 1, source: 'generated', content: generated } })
      const edited = await syntheses.edit(actor, workflow.id, { synthesisId: ready.synthesisId!, expectedRevision: 1, content: { ...generated, overallSummary: 'Kaimahi-edited confirmed synthesis.' } })
      expect(edited).toMatchObject({ status: 'ready', draft: { revision: 2, source: 'edited', content: { overallSummary: 'Kaimahi-edited confirmed synthesis.' } } })
      const revisions = await connection.db.select().from(schema.workflowSynthesisRevisions).where(eq(schema.workflowSynthesisRevisions.synthesisId, ready.synthesisId!)).orderBy(schema.workflowSynthesisRevisions.revision)
      expect(revisions).toHaveLength(2)
      await expect(connection.db.execute(sql`update workflow_synthesis_revision set overall_summary = 'forged' where id = ${revisions[0]!.id}`)).rejects.toSatisfy((error: unknown) => postgresCause(error) !== undefined)
      const preserved = await connection.db.select().from(schema.workflowSynthesisRevisions).where(eq(schema.workflowSynthesisRevisions.id, revisions[0]!.id))
      expect(preserved[0]?.overallSummary).toBe(generated.overallSummary)
      const unrelated = await workflows.createDraft({ actor, idempotencyKey: randomUUID() })
      const [foreignSynthesis] = await connection.db.insert(schema.workflowSyntheses).values({ workflowSessionId: unrelated.workflow.id, organisationId, status: 'generated', sourceHash: 'b'.repeat(64), generatedAt: now }).returning()
      const [foreignRevision] = await connection.db.insert(schema.workflowSynthesisRevisions).values({ synthesisId: foreignSynthesis!.id, revision: 1, source: 'generated', ...generated, createdAt: now }).returning()
      await expect(connection.db.insert(schema.workflowConfirmedSyntheses).values({ workflowSessionId: workflow.id, organisationId, synthesisRevisionId: foreignRevision!.id, confirmedByUserId: actor.id, confirmedAt: now })).rejects.toSatisfy((error: unknown) => postgresCause(error) !== undefined)
      workflow = (await workflows.submitCommand({ actor, workflowSessionId: workflow.id, command: { type: 'workflow-synthesis-confirmed', idempotencyKey: randomUUID(), expectedVersion: workflow.version, synthesisRevisionId: edited.draft!.id } })).workflow
      expect(workflow.currentStage).toBe('action-planning')
      await expect(syntheses.edit(actor, workflow.id, { synthesisId: ready.synthesisId!, expectedRevision: 2, content: generated })).rejects.toBeInstanceOf(WorkflowSynthesisUnavailableError)
      expect(await connection.db.select().from(schema.workflowSynthesisRevisions).where(eq(schema.workflowSynthesisRevisions.synthesisId, ready.synthesisId!))).toHaveLength(2)
      const [confirmation] = await connection.db.select().from(schema.workflowConfirmedSyntheses).where(eq(schema.workflowConfirmedSyntheses.workflowSessionId, workflow.id))
      await expect(connection.db.execute(sql`update workflow_confirmed_synthesis set confirmed_at = ${now} where id = ${confirmation!.id}`)).rejects.toSatisfy((error: unknown) => postgresCause(error) !== undefined)
      const observationId = randomUUID()
      await connection.db.insert(schema.workflowSafetyObservations).values({ id: observationId, workflowSessionId: workflow.id, organisationId, assessmentContext: 'pou', pouId: 'kaitiakitanga', broadClass: 'whanau_safety', concernLevel: 'action', contextNote: 'Human-confirmed synthetic safety context.', confirmedByUserId: actor.id, confirmedAt: now, updatedAt: now })
      workflow = (await workflows.submitCommand({ actor, workflowSessionId: workflow.id, command: { type: 'action-plan-confirmed', idempotencyKey: randomUUID(), expectedVersion: workflow.version, actions: [] } })).workflow
      workflow = (await workflows.submitCommand({ actor, workflowSessionId: workflow.id, command: { type: 'referral-plan-confirmed', idempotencyKey: randomUUID(), expectedVersion: workflow.version, referrals: [] } })).workflow
      workflow = (await workflows.submitCommand({ actor, workflowSessionId: workflow.id, command: { type: 'structured-review-confirmed', idempotencyKey: randomUUID(), expectedVersion: workflow.version } })).workflow
      workflow = (await workflows.submitCommand({ actor, workflowSessionId: workflow.id, command: { type: 'workflow-completed', idempotencyKey: randomUUID(), expectedVersion: workflow.version } })).workflow
      expect(workflow.status).toBe('completed')
      const record = await syntheses.findFinalRecord(actor, workflow.id)
      expect(record).toMatchObject({ overallSummary: 'Kaimahi-edited confirmed synthesis.', actions: [], referrals: [], safetyObservations: [{ context: 'Kaitiakitanga & Risk Management', concernLevel: 'Action required', contextNote: 'Human-confirmed synthetic safety context.' }] })

      const [unrelatedConfirmation] = await connection.db.insert(schema.workflowConfirmedSyntheses).values({ workflowSessionId: unrelated.workflow.id, organisationId, synthesisRevisionId: foreignRevision!.id, confirmedByUserId: actor.id, confirmedAt: now }).returning()
      const finalRecordValues = {
        organisationId,
        confirmedSynthesisId: confirmation!.id,
        workflowReference: 'TK-SYNTH-DIRECT',
        organisationName: actor.organisation.name,
        kaimahiDisplayName: actor.displayName,
        overallSummary: 'A synthetic direct database lineage check.',
        keyThemes: null,
        strengthsSummary: null,
        areasForAttentionSummary: null,
        informationStillToExploreSummary: null,
        confirmedSafetyConcernsSummary: null,
        actions: [],
        referrals: [],
        safetyObservations: [],
        contentHash: 'c'.repeat(64),
        finalizedByUserId: actor.id,
        finalizedAt: now,
      }
      await expect(connection.db.insert(schema.workflowFinalRecords).values({ ...finalRecordValues, workflowSessionId: unrelated.workflow.id })).rejects.toSatisfy((error: unknown) => postgresCause(error)?.message === 'final record confirmed synthesis does not belong to workflow')

      foreignOrganisationId = randomUUID(); const foreignUserId = randomUUID()
      const foreignActor: AuthenticatedUser = { id: foreignUserId, displayName: 'Foreign synthesis test Kaimahi', status: 'active', organisation: { id: foreignOrganisationId, slug: `foreign-${foreignOrganisationId}`, name: 'Foreign synthesis test organisation' }, roles: ['KAIMAHI'] }
      await connection.db.insert(schema.organisations).values({ id: foreignOrganisationId, slug: foreignActor.organisation.slug, name: foreignActor.organisation.name })
      await connection.db.insert(schema.appUsers).values({ id: foreignUserId, organisationId: foreignOrganisationId, email: `${foreignUserId}@example.invalid`, displayName: foreignActor.displayName })
      const foreignWorkflow = await workflows.createDraft({ actor: foreignActor, idempotencyKey: randomUUID() })
      await expect(connection.db.insert(schema.workflowFinalRecords).values({ ...finalRecordValues, workflowSessionId: foreignWorkflow.workflow.id, organisationId: foreignOrganisationId, finalizedByUserId: foreignActor.id })).rejects.toSatisfy((error: unknown) => postgresCause(error)?.message === 'final record confirmed synthesis does not belong to workflow')

      await expect(connection.db.execute(sql`update workflow_final_record set confirmed_synthesis_id = ${unrelatedConfirmation!.id} where workflow_session_id = ${workflow.id}`)).rejects.toSatisfy((error: unknown) => postgresCause(error)?.message === 'final record confirmed synthesis does not belong to workflow')
      await connection.db.execute(sql`alter table workflow_final_record disable trigger workflow_final_record_immutable`)
      try {
        await expect(connection.db.execute(sql`update workflow_final_record set confirmed_synthesis_id = ${unrelatedConfirmation!.id} where workflow_session_id = ${workflow.id}`)).rejects.toSatisfy((error: unknown) => postgresCause(error)?.message === 'final record confirmed synthesis does not belong to workflow')
      } finally {
        await connection.db.execute(sql`alter table workflow_final_record enable trigger workflow_final_record_immutable`)
      }

      const recordBeforeCorrection = JSON.stringify(record)
      workflow = (await workflows.submitCommand({ actor, workflowSessionId: workflow.id, command: { type: 'safety-observation-corrected', observationId, expectedObservationRevision: 1, idempotencyKey: randomUUID(), expectedVersion: workflow.version, reason: 'Synthetic post-completion correction.', replacement: { assessmentContext: 'pou', pouId: 'kaitiakitanga', broadClass: 'whanau_safety', concernLevel: 'low', contextNote: 'Corrected canonical state.' } } })).workflow
      expect(workflow.safety.observations.find((observation) => observation.id === observationId)).toMatchObject({ concernLevel: 'low', contextNote: 'Corrected canonical state.' })
      expect(JSON.stringify(await syntheses.findFinalRecord(actor, workflow.id))).toBe(recordBeforeCorrection)
      await expect(connection.db.execute(sql`update workflow_final_record set overall_summary = 'forged' where workflow_session_id = ${workflow.id}`)).rejects.toSatisfy((error: unknown) => postgresCause(error) !== undefined)
      const interactions = await connection.db.select().from(schema.workflowInteractions).where(and(eq(schema.workflowInteractions.workflowSessionId, workflow.id), eq(schema.workflowInteractions.type, 'workflow_synthesis_confirmed')))
      expect(interactions).toHaveLength(1)
    }, async (connection) => {
      if (!organisationId) return
      await connection.db.execute(sql`alter table workflow_synthesis_revision disable trigger workflow_synthesis_revision_immutable`)
      await connection.db.execute(sql`alter table workflow_confirmed_synthesis disable trigger workflow_confirmed_synthesis_immutable`)
      await connection.db.execute(sql`alter table workflow_final_record disable trigger workflow_final_record_immutable`)
      try {
        await connection.db.execute(sql`delete from workflow_final_record where organisation_id = ${organisationId}`)
        await connection.db.execute(sql`delete from workflow_confirmed_synthesis where organisation_id = ${organisationId}`)
        await connection.db.execute(sql`delete from workflow_synthesis_revision where synthesis_id in (select id from workflow_synthesis where organisation_id = ${organisationId})`)
        await connection.db.execute(sql`delete from workflow_synthesis where organisation_id = ${organisationId}`)
        await connection.db.execute(sql`delete from workflow_safety_consequence where organisation_id = ${organisationId}`)
        await connection.db.execute(sql`delete from workflow_safety_rule_evaluation where organisation_id = ${organisationId}`)
        await connection.db.execute(sql`delete from workflow_safety_observation_revision where organisation_id = ${organisationId}`)
        await connection.db.execute(sql`delete from workflow_safety_observation where organisation_id = ${organisationId}`)
        await connection.db.execute(sql`delete from workflow_interaction where organisation_id = ${organisationId}`)
        await connection.db.execute(sql`delete from workflow_pou_checkpoint where organisation_id = ${organisationId}`)
        await connection.db.execute(sql`delete from workflow_session where organisation_id = ${organisationId}`)
        await connection.db.execute(sql`delete from app_user where organisation_id = ${organisationId}`)
        await connection.db.execute(sql`delete from organisation where id = ${organisationId}`)
        if (foreignOrganisationId) {
          await connection.db.execute(sql`delete from workflow_interaction where organisation_id = ${foreignOrganisationId}`)
          await connection.db.execute(sql`delete from workflow_pou_checkpoint where organisation_id = ${foreignOrganisationId}`)
          await connection.db.execute(sql`delete from workflow_session where organisation_id = ${foreignOrganisationId}`)
          await connection.db.execute(sql`delete from app_user where organisation_id = ${foreignOrganisationId}`)
          await connection.db.execute(sql`delete from organisation where id = ${foreignOrganisationId}`)
        }
      } finally {
        await connection.db.execute(sql`alter table workflow_synthesis_revision enable trigger workflow_synthesis_revision_immutable`)
        await connection.db.execute(sql`alter table workflow_confirmed_synthesis enable trigger workflow_confirmed_synthesis_immutable`)
        await connection.db.execute(sql`alter table workflow_final_record enable trigger workflow_final_record_immutable`)
      }
    })
  })
})
