import { createDatabaseConnection } from '../db/repository.js'
import { safetySpecificationFromRegistry } from '../safety-assessments/registry.js'
import { SafetyProvisioningService } from '../safety-assessments/provisioning.js'

const [organisationId, operatorUserId, approvedForPilotBy, specificationCode, specificationVersion, agentReference, branchReference, environment] = process.argv.slice(2)
if (![organisationId, operatorUserId, approvedForPilotBy, specificationCode, specificationVersion, agentReference, branchReference, environment].every(Boolean)) {
  throw new Error('Usage: provision-safety-assessment <organisationId> <operatorUserId> <approvedForPilotBy> <specificationCode> <specificationVersion> <agentReference> <branchReference> <environment>')
}
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required for operator provisioning.')
const database = createDatabaseConnection(databaseUrl)
try {
  const result = await new SafetyProvisioningService(database.db).provisionAndActivate({
    organisationId: organisationId!, operatorUserId: operatorUserId!, specification: safetySpecificationFromRegistry(specificationCode!, specificationVersion!, { approvedForPilotBy: approvedForPilotBy!, approvedForPilotAt: new Date().toISOString() }),
    projection: { projectionCode: `${specificationCode}-assessment`, projectionVersion: specificationVersion! },
    conversationProvider: { provider: 'elevenlabs', agentReference: agentReference!, branchReference: branchReference!, environment: environment! },
  })
  process.stdout.write(`Provisioned immutable safety policy ${result.specificationId} / ${result.projectionId}\n`)
} finally {
  await database.close()
}
