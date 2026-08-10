import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

import { createDatabaseConnection, type DatabaseConnection } from './repository.js'

const TEST_DATABASE_URL_ENVIRONMENT_VARIABLE = 'TEST_DATABASE_URL'
const DEFAULT_POSTGRES_PORT = '5432'
const MIGRATION_LOCK_ID = 724188218
const REQUIRED_MIGRATION_TAGS = ['0000_absent_wallow', '0001_conscious_richard_fisk', '0002_glossy_ronan']

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
