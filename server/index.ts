import { CognitoOidcProvider } from './auth/oidc.js'
import { createApplication } from './app.js'
import { loadConfiguration } from './config.js'
import { createDatabaseConnection, PostgresAuthRepository } from './db/repository.js'

const config = loadConfiguration()
const database = createDatabaseConnection(config.databaseUrl)
const app = await createApplication({
  config,
  repository: new PostgresAuthRepository(database.db),
  oidcProvider: config.cognito ? new CognitoOidcProvider(config.cognito) : undefined,
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => database.close()).finally(() => process.exit(0))
  })
}

await app.listen({ port: config.port, host: '0.0.0.0' })
