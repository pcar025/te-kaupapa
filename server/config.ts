import { z } from 'zod'

export interface CognitoConfiguration {
  clientId: string
  clientSecret?: string
  issuer: string
  managedLoginDomain: string
}

export interface AppConfiguration {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  databaseUrl: string
  appOrigin: string
  frontendOrigin: string
  allowedOrigins: string[]
  cookieName: string
  cookieSigningSecret: string
  sessionTtlHours: number
  sessionIdleTimeoutMinutes: number
  cognito?: CognitoConfiguration
}

const runtimeSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3011),
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

  const allowedOrigins = new Set([parsed.APP_ORIGIN, parsed.FRONTEND_ORIGIN])
  for (const origin of (parsed.CORS_ALLOWED_ORIGINS ?? '').split(',')) {
    if (origin.trim()) allowedOrigins.add(z.string().url().parse(origin.trim()))
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
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
  }
}
