import { createHash } from 'node:crypto'

import { sql } from 'drizzle-orm'

import { createDatabaseConnection } from '../db/repository.js'
import { SafetyProvisioningService } from '../safety-assessments/provisioning.js'

type ActiveProjection = {
  organisation_id: string
  pou_id: string
  specification_id: string
  activated_by_user_id: string
  projection_code: string
  projection_version: string
  provider: string
  provider_agent_reference: string
  provider_branch_reference: string | null
  provider_environment: string
}

const databaseUrl = process.env.DATABASE_URL
const agentReference = process.env.ELEVENLABS_AGENT_ID
const branchReference = process.env.ELEVENLABS_AGENT_BRANCH_ID
const environment = process.env.ELEVENLABS_AGENT_ENVIRONMENT

if (!databaseUrl || !agentReference || !branchReference || !environment) {
  throw new Error('DATABASE_URL and the complete ElevenLabs provider configuration are required.')
}

const target = new URL(databaseUrl)
if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname) || target.pathname !== '/te_kaupapa_dev') {
  throw new Error('This command is restricted to the local te_kaupapa_dev database.')
}

const database = createDatabaseConnection(databaseUrl)
try {
  const active = await database.db.execute(sql`
    select
      activation.organisation_id,
      activation.pou_id,
      activation.specification_id,
      activation.activated_by_user_id,
      projection.projection_code,
      projection.projection_version,
      projection.provider,
      projection.provider_agent_reference,
      projection.provider_branch_reference,
      projection.provider_environment
    from safety_specification_activation activation
    inner join provider_assessment_projection projection on projection.id = activation.projection_id
    where activation.deactivated_at is null
    order by activation.pou_id
  `)
  const rows = active.rows as ActiveProjection[]
  const organisationIds = new Set(rows.map((row) => row.organisation_id))
  const operatorUserIds = new Set(rows.map((row) => row.activated_by_user_id))
  if (rows.length !== 7 || organisationIds.size !== 1 || operatorUserIds.size !== 1) {
    throw new Error('Expected exactly seven active Pou projections for one local organisation and one technical operator.')
  }

  const provider = { provider: 'elevenlabs', agentReference, branchReference, environment }
  const mismatched = rows.filter((row) => row.provider !== provider.provider || row.provider_agent_reference !== provider.agentReference || row.provider_branch_reference !== provider.branchReference || row.provider_environment !== provider.environment)
  const provisioning = new SafetyProvisioningService(database.db)
  for (const row of mismatched) {
    const fingerprint = createHash('sha256').update(`${provider.agentReference}\n${provider.branchReference}\n${provider.environment}`).digest('hex').slice(0, 12)
    await provisioning.reprojectAndActivateExisting({
      organisationId: row.organisation_id,
      specificationId: row.specification_id,
      projection: { projectionCode: row.projection_code, projectionVersion: `${row.projection_version}-provider-${fingerprint}` },
      conversationProvider: provider,
      operatorUserId: row.activated_by_user_id,
    })
  }

  const verified = await database.db.execute(sql`
    select count(*)::int as count
    from safety_specification_activation safety_activation
    inner join provider_assessment_projection projection on projection.id = safety_activation.projection_id
    inner join organisation_pou_specification_activation pou_activation on pou_activation.organisation_id = safety_activation.organisation_id and pou_activation.pou_id = safety_activation.pou_id and pou_activation.deactivated_at is null
    inner join organisation_pou_safety_specification_link link on link.id = pou_activation.safety_link_id
    where safety_activation.deactivated_at is null
      and projection.provider = ${provider.provider}
      and projection.provider_agent_reference = ${provider.agentReference}
      and projection.provider_branch_reference = ${provider.branchReference}
      and projection.provider_environment = ${provider.environment}
      and link.safety_specification_id = safety_activation.specification_id
      and link.safety_projection_id = safety_activation.projection_id
  `)
  if ((verified.rows[0] as { count?: number } | undefined)?.count !== 7) {
    throw new Error('Local provider reprojection verification failed.')
  }
  process.stdout.write(`Local provider reprojection complete: ${mismatched.length} of 7 active Pou projections updated.\n`)
} finally {
  await database.close()
}
