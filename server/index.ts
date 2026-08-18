import { CognitoOidcProvider } from './auth/oidc.js'
import { createApplication } from './app.js'
import { loadConfiguration } from './config.js'
import { createDatabaseConnection, PostgresAuthRepository } from './db/repository.js'
import { ElevenLabsConversationProvider } from './conversations/elevenlabs-provider.js'
import { PostgresConversationRepository } from './conversations/repository.js'
import { ConversationService } from './conversations/service.js'
import { PostgresWorkflowRepository } from './workflows/repository.js'
import { PostgresSafetyAssessmentRepository } from './safety-assessments/repository.js'
import { OpenAIConversationAssessmentProvider } from './safety-assessments/assessment-provider.js'
import { PostgresTranscriptRepository } from './transcripts/repository.js'
import { OpenAIConversationReviewDraftProvider } from './review-drafts/provider.js'
import { PostgresConversationReviewDraftRepository } from './review-drafts/repository.js'
import { PostgresOrganisationPouSpecificationRepository } from './pou-specifications/repository.js'
import { PostgresOrganisationPouSpecificationAuthoringService } from './pou-specifications/authoring.js'

const config = loadConfiguration()
const database = createDatabaseConnection(config.databaseUrl)
const safetyAssessmentRepository = new PostgresSafetyAssessmentRepository(database.db)
const transcriptRepository = new PostgresTranscriptRepository(database.db)
const reviewDraftRepository = new PostgresConversationReviewDraftRepository(database.db)
const pouSpecificationRepository = new PostgresOrganisationPouSpecificationRepository(database.db)
const workflowRepository = new PostgresWorkflowRepository(database.db, undefined, undefined, safetyAssessmentRepository, reviewDraftRepository)
const conversationService = new ConversationService(
  workflowRepository,
  new PostgresConversationRepository(database.db, undefined, safetyAssessmentRepository),
  config.elevenlabs ? new ElevenLabsConversationProvider(config.elevenlabs.apiKey) : undefined,
  config.elevenlabs ? {
    agentId: config.elevenlabs.agentId,
    branchId: config.elevenlabs.agentBranchId,
    environment: config.elevenlabs.agentEnvironment,
  } : undefined,
  safetyAssessmentRepository,
  pouSpecificationRepository,
)
const app = await createApplication({
  config,
  repository: new PostgresAuthRepository(database.db),
  workflowRepository,
  conversationService,
  safetyAssessmentRepository,
  conversationAssessmentProvider: config.openaiAssessment ? new OpenAIConversationAssessmentProvider(config.openaiAssessment) : undefined,
  conversationReviewDraftProvider: config.openaiAssessment ? new OpenAIConversationReviewDraftProvider(config.openaiAssessment) : undefined,
  reviewDraftRepository,
  transcriptRepository,
  pouSpecificationAuthoringService: new PostgresOrganisationPouSpecificationAuthoringService(database.db),
  oidcProvider: config.cognito ? new CognitoOidcProvider(config.cognito) : undefined,
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => database.close()).finally(() => process.exit(0))
  })
}

await app.listen({ port: config.port, host: config.host })
