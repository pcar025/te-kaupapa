import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

import { createDatabaseConnection, type DatabaseConnection } from './repository.js'

const TEST_DATABASE_URL_ENVIRONMENT_VARIABLE = 'TEST_DATABASE_URL'
const DEFAULT_POSTGRES_PORT = '5432'
const MIGRATION_LOCK_ID = 724188218
const REQUIRED_MIGRATION_TAGS = ['0000_absent_wallow', '0001_conscious_richard_fisk', '0002_glossy_ronan', '0003_simple_grandmaster', '0004_nice_chamber', '0005_living_thena', '0006_large_wolfpack', '0007_opposite_johnny_blaze', '0008_dear_master_chief', '0009_loose_mindworm', '0010_violet_luke_cage', '0011_short_zeigeist', '0012_nervous_gateway', '0013_wooden_triathlon', '0014_ordinary_lady_mastermind', '0015_yellow_microbe']
const PRE_MILESTONE_5_MIGRATION_TAGS = REQUIRED_MIGRATION_TAGS.slice(0, 6)

interface MigrationJournal {
  entries: Array<{ tag: string }>
}

function parsePostgresUrl(connectionString: string): URL {
  let parsed: URL
  try {
    parsed = new URL(connectionString)
  } catch {
    throw new Error(`${TEST_DATABASE_URL_ENVIRONMENT_VARIABLE} must be a valid PostgreSQL connection URL.`)
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`${TEST_DATABASE_URL_ENVIRONMENT_VARIABLE} must use the postgres or postgresql protocol.`)
  }

  if (!parsed.pathname || parsed.pathname === '/') {
    throw new Error(`${TEST_DATABASE_URL_ENVIRONMENT_VARIABLE} must name an explicitly disposable database.`)
  }

  return parsed
}

function databaseName(connectionUrl: URL): string {
  return decodeURIComponent(connectionUrl.pathname.slice(1))
}

function databaseTarget(connectionUrl: URL): string {
  return [
    connectionUrl.protocol,
    connectionUrl.hostname.toLowerCase(),
    connectionUrl.port || DEFAULT_POSTGRES_PORT,
    databaseName(connectionUrl).toLowerCase(),
  ].join('|')
}

export function hasTestDatabaseUrl(): boolean {
  return Boolean(process.env[TEST_DATABASE_URL_ENVIRONMENT_VARIABLE])
}

export function testDatabaseTargetDescription(connectionString: string): string {
  const connectionUrl = parsePostgresUrl(connectionString)
  const port = connectionUrl.port || DEFAULT_POSTGRES_PORT
  return `${connectionUrl.protocol}//${connectionUrl.hostname}:${port}/${databaseName(connectionUrl)}`
}

export function getTestDatabaseUrl(): string {
  const connectionString = process.env[TEST_DATABASE_URL_ENVIRONMENT_VARIABLE]
  if (!connectionString) {
    throw new Error(`${TEST_DATABASE_URL_ENVIRONMENT_VARIABLE} is required for PostgreSQL integration tests; no database will be selected by default.`)
  }

  const testDatabase = parsePostgresUrl(connectionString)
  const name = databaseName(testDatabase).toLowerCase()
  if (name === 'te_kaupapa' || name === 'te_kaupapa_dev') {
    throw new Error(`${TEST_DATABASE_URL_ENVIRONMENT_VARIABLE} must not target the normal Te Kaupapa development database.`)
  }

  const developmentConnectionString = process.env.DATABASE_URL
  if (developmentConnectionString && databaseTarget(testDatabase) === databaseTarget(parsePostgresUrl(developmentConnectionString))) {
    throw new Error(`${TEST_DATABASE_URL_ENVIRONMENT_VARIABLE} must not target the same database as DATABASE_URL.`)
  }

  return connectionString
}

function migrationDetails(): { migrationsFolder: string; expectedMigrationCount: number } {
  const migrationsFolder = path.resolve(process.cwd(), 'server/db/migrations')
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json')
  if (!existsSync(journalPath)) {
    throw new Error(`Drizzle migration journal was not found at ${journalPath}.`)
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournal
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error(`Drizzle migration journal at ${journalPath} has no migrations.`)
  }

  let previousRequiredMigrationIndex = -1
  for (const requiredTag of REQUIRED_MIGRATION_TAGS) {
    const requiredMigrationIndex = journal.entries.findIndex(({ tag }) => tag === requiredTag)
    if (requiredMigrationIndex <= previousRequiredMigrationIndex) {
      throw new Error(`Required migration ${requiredTag} is missing from, or out of order in, the Drizzle migration journal.`)
    }
    previousRequiredMigrationIndex = requiredMigrationIndex
  }

  for (const { tag } of journal.entries) {
    const migrationPath = path.join(migrationsFolder, `${tag}.sql`)
    if (!existsSync(migrationPath)) {
      throw new Error(`Migration ${tag} listed in the Drizzle journal was not found at ${migrationPath}.`)
    }
  }

  return { migrationsFolder, expectedMigrationCount: journal.entries.length }
}

async function migrateTestDatabase(connection: DatabaseConnection): Promise<void> {
  const { migrationsFolder, expectedMigrationCount } = migrationDetails()
  await connection.db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`)
  let migrationFailure = false
  try {
    await migrate(connection.db, { migrationsFolder })
    const result = await connection.db.execute(sql`select count(*)::int as count from "drizzle"."__drizzle_migrations"`)
    const recordedMigrationCount = Number((result.rows[0] as { count?: number | string } | undefined)?.count ?? 0)
    if (recordedMigrationCount < expectedMigrationCount) {
      throw new Error(`Drizzle migration journal is incomplete in the test database: expected ${expectedMigrationCount}, found ${recordedMigrationCount}.`)
    }
  } catch (error) {
    migrationFailure = true
    throw error
  } finally {
    try {
      await connection.db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`)
    } catch (error) {
      if (!migrationFailure) throw error
    }
  }
}

function createPreMilestone5MigrationFolder(): string {
  const { migrationsFolder } = migrationDetails()
  const journal = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as MigrationJournal
  const folder = mkdtempSync(path.join(tmpdir(), 'te-kaupapa-pre-m5-migrations-'))
  mkdirSync(path.join(folder, 'meta'))
  const entries = journal.entries.filter(({ tag }) => PRE_MILESTONE_5_MIGRATION_TAGS.includes(tag))
  if (entries.length !== PRE_MILESTONE_5_MIGRATION_TAGS.length) throw new Error('The pre-Milestone 5 migration chain is incomplete.')
  writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify({ version: '7', dialect: 'postgresql', entries }, null, 2))
  for (const { tag } of entries) cpSync(path.join(migrationsFolder, `${tag}.sql`), path.join(folder, `${tag}.sql`))
  return folder
}

async function recordedMigrationCount(connection: DatabaseConnection): Promise<number> {
  const result = await connection.db.execute(sql`select count(*)::int as count from "drizzle"."__drizzle_migrations"`)
  return Number((result.rows[0] as { count?: number | string } | undefined)?.count ?? 0)
}

async function resetDisposableSchemaForUpgradeTest(connection: DatabaseConnection): Promise<void> {
  // This function is called only after getTestDatabaseUrl() has rejected normal
  // development targets and the migration advisory lock has been acquired.
  await connection.db.execute(sql`drop schema if exists "drizzle" cascade`)
  await connection.db.execute(sql`drop schema if exists "public" cascade`)
  await connection.db.execute(sql`create schema "public"`)
}

export async function verifyUpgradeFromPreMilestone5TestDatabase(): Promise<void> {
  const connection = createDatabaseConnection(getTestDatabaseUrl())
  const temporaryMigrationsFolder = createPreMilestone5MigrationFolder()
  let primaryFailure = false
  try {
    await connection.db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`)
    await resetDisposableSchemaForUpgradeTest(connection)
    await migrate(connection.db, { migrationsFolder: temporaryMigrationsFolder })
    if (await recordedMigrationCount(connection) !== PRE_MILESTONE_5_MIGRATION_TAGS.length) {
      throw new Error('The disposable database did not record the genuine 0000 through 0005 Drizzle migration journal before the later migration upgrades.')
    }

    const markerSlug = `upgrade-check-${Date.now()}`
    await connection.db.execute(sql`insert into "organisation" ("slug", "name") values (${markerSlug}, 'Pre-Milestone 5 fixture')`)
    await migrate(connection.db, { migrationsFolder: migrationDetails().migrationsFolder })
    if (await recordedMigrationCount(connection) !== REQUIRED_MIGRATION_TAGS.length) {
      throw new Error(`Expected ${REQUIRED_MIGRATION_TAGS.length} ordered Drizzle migration records after the later migration upgrades.`)
    }
    const preservedFixture = await connection.db.execute(sql`select "id" from "organisation" where "slug" = ${markerSlug}`)
    if (preservedFixture.rows.length !== 1) {
      throw new Error('The pre-Milestone 5 fixture data was not preserved by the later migration upgrades.')
    }
    const conversationTable = await connection.db.execute(sql`select to_regclass('public.workflow_conversation') as relation`)
    if (!(conversationTable.rows[0] as { relation?: string | null } | undefined)?.relation) {
      throw new Error('The conversation provenance schema was not preserved by the later migration upgrades.')
    }
    const pouSpecificationRelations = await connection.db.execute(sql`
      select count(*)::int as count from pg_class
      where oid in (
        'public.organisation_pou_specification_version'::regclass,
        'public.conversation_guidance_projection'::regclass,
        'public.pou_review_projection'::regclass,
        'public.organisation_pou_safety_specification_link'::regclass,
        'public.workflow_conversation_pou_specification_pin'::regclass,
        'public.conversation_review_draft_criterion_assessment'::regclass
      )
    `)
    if (Number(pouSpecificationRelations.rows[0]?.count ?? 0) !== 6) {
      throw new Error('The organisation Pou specification provenance relations were not preserved through the Phase 5D migration chain.')
    }
    const assessmentProviderColumns = await connection.db.execute(sql`
      select count(*)::int as count from information_schema.columns
      where table_schema = 'public' and table_name = 'conversation_safety_assessment_run'
        and column_name in ('assessment_provider', 'assessment_provider_model', 'assessment_provider_config_hash', 'assessment_schema_version', 'transcript_received_at', 'assessment_started_at', 'assessment_completed_at', 'review_available_at')
    `)
    if (Number(assessmentProviderColumns.rows[0]?.count ?? 0) !== 8) {
      throw new Error('The assessment-provider provenance columns were not created by the Phase 5B migration chain.')
    }
    const transcriptRelations = await connection.db.execute(sql`
      select count(*)::int as count from information_schema.tables
      where table_schema = 'public' and table_name in ('conversation_transcript', 'conversation_transcript_turn')
    `)
    if (Number(transcriptRelations.rows[0]?.count ?? 0) !== 2) {
      throw new Error('The transcript source-material tables were not created by the Phase 5B migration chain.')
    }
    const evidenceTurnColumn = await connection.db.execute(sql`
      select count(*)::int as count from information_schema.columns
      where table_schema = 'public' and table_name = 'conversation_provider_rule_assessment' and column_name = 'evidence_turn_ids'
    `)
    if (Number(evidenceTurnColumn.rows[0]?.count ?? 0) !== 1) {
      throw new Error('The evidence-turn provenance column was not created by the Phase 5B migration chain.')
    }
  } catch (error) {
    primaryFailure = true
    throw error
  } finally {
    try {
      await connection.db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`)
    } catch (error) {
      if (!primaryFailure) throw error
    }
    rmSync(temporaryMigrationsFolder, { recursive: true, force: true })
    await connection.close()
  }
}

export async function withMigratedTestDatabase<T>(
  testBody: (connection: DatabaseConnection) => Promise<T>,
  cleanup: (connection: DatabaseConnection) => Promise<void>,
): Promise<T> {
  const connection = createDatabaseConnection(getTestDatabaseUrl())
  let migrationCompleted = false
  let primaryFailure = false

  try {
    await migrateTestDatabase(connection)
    migrationCompleted = true
    return await testBody(connection)
  } catch (error) {
    primaryFailure = true
    throw error
  } finally {
    let cleanupFailure: unknown
    if (migrationCompleted) {
      try {
        await cleanup(connection)
      } catch (error) {
        cleanupFailure = error
      }
    }

    let closeFailure: unknown
    try {
      await connection.close()
    } catch (error) {
      closeFailure = error
    }

    if (!primaryFailure) {
      if (cleanupFailure) throw cleanupFailure
      if (closeFailure) throw closeFailure
    }
  }
}
