import { z } from 'zod'

export interface CognitoConfiguration {
  clientId: string
  clientSecret?: string
  issuer: string
  managedLoginDomain: string
}

export interface ElevenLabsConfiguration {
  apiKey: string
  agentId: string
  agentBranchId: string
  agentEnvironment: string
}

export interface ElevenLabsWebhookConfiguration {
  signingSecret: string
  maximumBodyBytes: number
  maximumAgeSeconds: number
}
export interface OpenAiAssessmentConfiguration { apiKey: string; model: string }

export interface AppConfiguration {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  host: '0.0.0.0' | '127.0.0.1' | '::1'
  databaseUrl: string
  appOrigin: string
  frontendOrigin: string
  allowedOrigins: string[]
  cookieName: string
  cookieSigningSecret: string
  sessionTtlHours: number
  sessionIdleTimeoutMinutes: number
  cognito?: CognitoConfiguration
  elevenlabs?: ElevenLabsConfiguration
  elevenlabsWebhook?: ElevenLabsWebhookConfiguration
  openaiAssessment?: OpenAiAssessmentConfiguration
}

const runtimeSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3011),
  HOST: z.enum(['0.0.0.0', '127.0.0.1', '::1']).default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.string().url(),
  FRONTEND_ORIGIN: z.string().url(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  SESSION_COOKIE_NAME: z.string().min(1).default('te_kaupapa_session'),
  SESSION_COOKIE_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(720).default(60),
  COGNITO_CLIENT_ID: z.string().min(1).optional(),
  COGNITO_CLIENT_SECRET: z.string().min(1).optional(),
  COGNITO_ISSUER: z.string().url().optional(),
  COGNITO_MANAGED_LOGIN_DOMAIN: z.string().url().optional(),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_AGENT_ID: z.string().trim().min(1).max(255).optional(),
  ELEVENLABS_AGENT_BRANCH_ID: z.string().trim().min(1).max(255).optional(),
  ELEVENLABS_AGENT_ENVIRONMENT: z.string().trim().min(1).max(80).optional(),
  ELEVENLABS_WEBHOOK_SECRET: z.string().min(16).optional(),
  // Real post-call transcript envelopes can exceed 32 KiB. Keep a bounded
  // ingress limit while allowing the provider's signed result to arrive.
  ELEVENLABS_WEBHOOK_MAXIMUM_BODY_BYTES: z.coerce.number().int().min(1024).max(262144).default(131072),
  ELEVENLABS_WEBHOOK_MAXIMUM_AGE_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_ASSESSMENT_MODEL: z.string().trim().min(1).max(200).optional(),
})

export function loadConfiguration(env = process.env): AppConfiguration {
  const parsed = runtimeSchema.parse(env)
  const cognitoValues = [
    parsed.COGNITO_CLIENT_ID,
    parsed.COGNITO_ISSUER,
    parsed.COGNITO_MANAGED_LOGIN_DOMAIN,
  ]
  const hasCognito = cognitoValues.some(Boolean)
  if (hasCognito && cognitoValues.some((value) => !value)) {
    throw new Error('COGNITO_CLIENT_ID, COGNITO_ISSUER, and COGNITO_MANAGED_LOGIN_DOMAIN must be set together.')
  }
  const elevenLabsValues = [
    parsed.ELEVENLABS_API_KEY,
    parsed.ELEVENLABS_AGENT_ID,
    parsed.ELEVENLABS_AGENT_BRANCH_ID,
    parsed.ELEVENLABS_AGENT_ENVIRONMENT,
  ]
  const hasElevenLabs = elevenLabsValues.some(Boolean)
  if (hasElevenLabs && elevenLabsValues.some((value) => !value)) {
    throw new Error('ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, ELEVENLABS_AGENT_BRANCH_ID, and ELEVENLABS_AGENT_ENVIRONMENT must be set together.')
  }
  const openAiValues = [parsed.OPENAI_API_KEY, parsed.OPENAI_ASSESSMENT_MODEL]
  const hasOpenAiAssessment = openAiValues.some(Boolean)
  if (hasOpenAiAssessment && openAiValues.some((value) => !value)) throw new Error('OPENAI_API_KEY and OPENAI_ASSESSMENT_MODEL must be set together.')

  const allowedOrigins = new Set([parsed.APP_ORIGIN, parsed.FRONTEND_ORIGIN])
  for (const origin of (parsed.CORS_ALLOWED_ORIGINS ?? '').split(',')) {
    if (origin.trim()) allowedOrigins.add(z.string().url().parse(origin.trim()))
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    databaseUrl: parsed.DATABASE_URL,
    appOrigin: parsed.APP_ORIGIN,
    frontendOrigin: parsed.FRONTEND_ORIGIN,
    allowedOrigins: [...allowedOrigins],
    cookieName: parsed.SESSION_COOKIE_NAME,
    cookieSigningSecret: parsed.SESSION_COOKIE_SECRET,
    sessionTtlHours: parsed.SESSION_TTL_HOURS,
    sessionIdleTimeoutMinutes: parsed.SESSION_IDLE_TIMEOUT_MINUTES,
    cognito: hasCognito
      ? {
          clientId: parsed.COGNITO_CLIENT_ID!,
          clientSecret: parsed.COGNITO_CLIENT_SECRET,
          issuer: parsed.COGNITO_ISSUER!,
          managedLoginDomain: parsed.COGNITO_MANAGED_LOGIN_DOMAIN!.replace(/\/$/, ''),
        }
      : undefined,
    elevenlabs: hasElevenLabs
      ? {
          apiKey: parsed.ELEVENLABS_API_KEY!,
          agentId: parsed.ELEVENLABS_AGENT_ID!,
          agentBranchId: parsed.ELEVENLABS_AGENT_BRANCH_ID!,
          agentEnvironment: parsed.ELEVENLABS_AGENT_ENVIRONMENT!,
        }
      : undefined,
    elevenlabsWebhook: parsed.ELEVENLABS_WEBHOOK_SECRET
      ? { signingSecret: parsed.ELEVENLABS_WEBHOOK_SECRET, maximumBodyBytes: parsed.ELEVENLABS_WEBHOOK_MAXIMUM_BODY_BYTES, maximumAgeSeconds: parsed.ELEVENLABS_WEBHOOK_MAXIMUM_AGE_SECONDS }
      : undefined,
    openaiAssessment: hasOpenAiAssessment ? { apiKey: parsed.OPENAI_API_KEY!, model: parsed.OPENAI_ASSESSMENT_MODEL! } : undefined,
  }
}
