import { createDatabaseConnection } from '../db/repository.js'
import { organisationPouSpecificationFromRegistry } from '../pou-specifications/registry.js'
import { OrganisationPouSpecificationProvisioningService } from '../pou-specifications/provisioning.js'

const [organisationId, operatorUserId, approvedForPilotBy, approvedForPilotAt, specificationCode, specificationVersion] = process.argv.slice(2)
if (![organisationId, operatorUserId, approvedForPilotBy, approvedForPilotAt, specificationCode, specificationVersion].every(Boolean)) {
  throw new Error('Usage: provision-pou-specification <organisationId> <operatorUserId> <approvedForPilotBy> <approvedForPilotAt> <specificationCode> <specificationVersion>')
}
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required for operator provisioning.')

const database = createDatabaseConnection(databaseUrl)
try {
  const specification = organisationPouSpecificationFromRegistry(specificationCode!, specificationVersion!, {
    approvedForPilotBy: approvedForPilotBy!,
    approvedForPilotAt: approvedForPilotAt!,
  })
  const result = await new OrganisationPouSpecificationProvisioningService(database.db).provisionAndActivate({
    organisationId: organisationId!,
    operatorUserId: operatorUserId!,
    specification,
    guidanceProjection: { projectionCode: `${specificationCode}-conversation-guidance`, projectionVersion: specificationVersion! },
    reviewProjection: { projectionCode: `${specificationCode}-review`, projectionVersion: specificationVersion! },
  })
  process.stdout.write(`Provisioned immutable organisation Pou specification ${result.specificationId}\n`)
} finally {
  await database.close()
}
