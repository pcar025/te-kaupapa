import { CognitoOidcProvider } from './auth/oidc.js'
import { createApplication } from './app.js'
import { loadConfiguration } from './config.js'
import { createDatabaseConnection, PostgresAuthRepository } from './db/repository.js'
import { ElevenLabsConversationProvider } from './conversations/elevenlabs-provider.js'
import { PostgresConversationRepository } from './conversations/repository.js'
import { ConversationService } from './conversations/service.js'
import { PostgresWorkflowRepository } from './workflows/repository.js'

const config = loadConfiguration()
const database = createDatabaseConnection(config.databaseUrl)
const workflowRepository = new PostgresWorkflowRepository(database.db)
const conversationService = new ConversationService(
  workflowRepository,
  new PostgresConversationRepository(database.db),
  config.elevenlabs ? new ElevenLabsConversationProvider(config.elevenlabs.apiKey) : undefined,
  config.elevenlabs ? {
    agentId: config.elevenlabs.agentId,
    branchId: config.elevenlabs.agentBranchId,
    environment: config.elevenlabs.agentEnvironment,
  } : undefined,
)
const app = await createApplication({
  config,
  repository: new PostgresAuthRepository(database.db),
  workflowRepository,
  conversationService,
  oidcProvider: config.cognito ? new CognitoOidcProvider(config.cognito) : undefined,
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => database.close()).finally(() => process.exit(0))
  })
}

await app.listen({ port: config.port, host: '0.0.0.0' })
