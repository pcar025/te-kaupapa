import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as schema from '../db/schema.js'
import type { DatabaseConnection } from '../db/repository.js'
import { withMigratedTestDatabase } from '../db/test-harness.js'
import { conversationRuntimeDynamicVariables, organisationPouSpecificationSchema } from '../pou-specifications/domain.js'
import { safetySpecificationSchema } from '../safety-assessments/domain.js'
import {
  STAGING_CLIENT_DEMO_ORGANISATION,
  STAGING_CLIENT_DEMO_OPENINGS,
  stagingClientDemoOrdinarySpecificationsV02,
} from './configuration.js'
import { StagingBootstrapService } from './service.js'

const runtime = {
  elevenLabsAgentId: 'staging-agent-fixture',
  elevenLabsAgentBranchId: 'staging-branch-fixture',
  elevenLabsAgentEnvironment: 'staging',
}

describe('staging client-demo bootstrap', () => {
  it('creates only the seven approved v0.2 ordinary specifications and the approved formal safety baseline, then reruns without drift', async () => {
    await withMigratedTestDatabase(async (connection) => {
      await removeFixture(connection)
      const service = new StagingBootstrapService(connection.db, () => new Date('2026-08-19T00:00:00.000Z'))
      const first = await service.bootstrap(runtime)
      expect(first).toEqual({
        organisation: 'created', bootstrapUser: 'created',
        safetyPolicies: { created: 7, existing: 0 }, ordinarySpecifications: { created: 7, existing: 0 },
      })
      expect(await service.bootstrap(runtime)).toEqual({
        organisation: 'existing', bootstrapUser: 'existing',
        safetyPolicies: { created: 0, existing: 7 }, ordinarySpecifications: { created: 0, existing: 7 },
      })

      const [organisation] = await connection.db.select().from(schema.organisations)
        .where(eq(schema.organisations.slug, STAGING_CLIENT_DEMO_ORGANISATION.slug))
      if (!organisation) throw new Error('Expected staged organisation.')
      expect(await connection.db.select().from(schema.appUsers).where(eq(schema.appUsers.organisationId, organisation.id))).toMatchObject([
        { email: STAGING_CLIENT_DEMO_ORGANISATION.bootstrapUserEmail, displayName: STAGING_CLIENT_DEMO_ORGANISATION.bootstrapUserDisplayName },
      ])
      expect(await connection.db.select().from(schema.externalIdentities).innerJoin(schema.appUsers, eq(schema.externalIdentities.userId, schema.appUsers.id)).where(eq(schema.appUsers.organisationId, organisation.id))).toHaveLength(0)
      expect(await connection.db.select().from(schema.roleAssignments).innerJoin(schema.appUsers, eq(schema.roleAssignments.userId, schema.appUsers.id)).where(eq(schema.appUsers.organisationId, organisation.id))).toHaveLength(0)

      const active = await connection.db.execute(sql`
        select ordinary.pou_id, ordinary.specification as ordinary_specification, guidance.projection as guidance_projection,
          safety.specification as safety_specification
        from organisation_pou_specification_activation activation
        inner join organisation_pou_specification_version ordinary on ordinary.id = activation.specification_id
        inner join conversation_guidance_projection guidance on guidance.id = activation.conversation_guidance_projection_id
        inner join organisation_pou_safety_specification_link safety_link on safety_link.id = activation.safety_link_id
        inner join safety_specification_version safety on safety.id = safety_link.safety_specification_id
        where activation.organisation_id = ${organisation.id} and activation.deactivated_at is null
        order by ordinary.pou_id
      `)
      expect(active.rows).toHaveLength(7)
      const expected = new Map(stagingClientDemoOrdinarySpecificationsV02({
        approvedForPilotBy: (await connection.db.select({ id: schema.appUsers.id }).from(schema.appUsers).where(eq(schema.appUsers.organisationId, organisation.id)).limit(1))[0]!.id,
        approvedForPilotAt: '2026-08-19T00:00:00.000Z',
      }).map((specification) => [specification.pouId, specification]))
      for (const row of active.rows as Array<{ pou_id: keyof typeof STAGING_CLIENT_DEMO_OPENINGS; ordinary_specification: unknown; guidance_projection: unknown; safety_specification: unknown }>) {
        const ordinary = organisationPouSpecificationSchema.parse(row.ordinary_specification)
        const guidance = row.guidance_projection as Parameters<typeof conversationRuntimeDynamicVariables>[0]
        const safety = safetySpecificationSchema.parse(row.safety_specification)
        expect(ordinary).toEqual(expected.get(row.pou_id))
        expect(ordinary.specificationVersion).toBe('0.2')
        expect(ordinary.openingReflectionQuestion).toBe(STAGING_CLIENT_DEMO_OPENINGS[row.pou_id])
        expect(conversationRuntimeDynamicVariables(guidance, row.pou_id).pou_opening).toBe(STAGING_CLIENT_DEMO_OPENINGS[row.pou_id])
        expect(safety.rules).toHaveLength(row.pou_id === 'whakapapa' ? 3 : 0)
      }
      expect((await connection.db.execute(sql`select count(*)::int as count from workflow_session where organisation_id = ${organisation.id}`)).rows[0]).toMatchObject({ count: 0 })
      expect((await connection.db.execute(sql`select count(*)::int as count from workflow_conversation where organisation_id = ${organisation.id}`)).rows[0]).toMatchObject({ count: 0 })
      expect((await connection.db.execute(sql`select count(*)::int as count from conversation_transcript where organisation_id = ${organisation.id}`)).rows[0]).toMatchObject({ count: 0 })
      await removeFixture(connection)
    }, async (connection) => { await removeFixture(connection) })
  })
})

async function removeFixture(connection: DatabaseConnection) {
  const ids = sql`select id from organisation where slug = ${STAGING_CLIENT_DEMO_ORGANISATION.slug}`
  const immutable = [
    'safety_specification_version', 'provider_assessment_projection', 'organisation_pou_specification_version',
    'conversation_guidance_projection', 'pou_review_projection', 'organisation_pou_safety_specification_link',
  ]
  try {
    for (const table of immutable) await connection.db.execute(sql.raw(`alter table ${table} disable trigger ${table}_immutable`))
    await connection.db.execute(sql`delete from organisation_pou_specification_activation where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from organisation_pou_safety_specification_link where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from conversation_guidance_projection where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from pou_review_projection where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from organisation_pou_specification_version where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from safety_specification_activation where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from provider_assessment_projection where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from safety_specification_version where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from app_user where organisation_id in (${ids})`)
    await connection.db.execute(sql`delete from organisation where slug = ${STAGING_CLIENT_DEMO_ORGANISATION.slug}`)
  } finally {
    for (const table of immutable) await connection.db.execute(sql.raw(`alter table ${table} enable trigger ${table}_immutable`))
  }
}
