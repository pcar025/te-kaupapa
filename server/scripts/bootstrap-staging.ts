import { createDatabaseConnection } from '../db/repository.js'
import { assertHostedStagingDatabaseUrl } from '../staging-bootstrap/command.js'
import { StagingBootstrapService } from '../staging-bootstrap/service.js'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the staging bootstrap.`)
  return value
}

async function main(): Promise<void> {
  const databaseUrl = required('DATABASE_URL')
  assertHostedStagingDatabaseUrl(databaseUrl)
  const database = createDatabaseConnection(databaseUrl)
  try {
    const result = await new StagingBootstrapService(database.db).bootstrap({
      elevenLabsAgentId: required('ELEVENLABS_AGENT_ID'),
      elevenLabsAgentBranchId: required('ELEVENLABS_AGENT_BRANCH_ID'),
      elevenLabsAgentEnvironment: required('ELEVENLABS_AGENT_ENVIRONMENT'),
    })
    process.stdout.write(`Staging bootstrap complete: organisation ${result.organisation}; bootstrap user ${result.bootstrapUser}; safety policies ${result.safetyPolicies.created} created/${result.safetyPolicies.existing} existing; ordinary specifications ${result.ordinarySpecifications.created} created/${result.ordinarySpecifications.existing} existing.\n`)
  } finally {
    await database.close()
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Staging bootstrap failed.'}\n`)
  process.exitCode = 1
})
