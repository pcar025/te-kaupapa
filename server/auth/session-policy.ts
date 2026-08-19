export const APPLICATION_SESSION_MODES = ['standard', 'trusted_device'] as const

export type ApplicationSessionMode = (typeof APPLICATION_SESSION_MODES)[number]

export interface ApplicationSessionPolicy {
  mode: ApplicationSessionMode
  absoluteLifetimeSeconds: number
  idleTimeoutSeconds: number | null
}

export const STANDARD_SESSION_POLICY: ApplicationSessionPolicy = {
  mode: 'standard',
  absoluteLifetimeSeconds: 12 * 60 * 60,
  idleTimeoutSeconds: 8 * 60 * 60,
}

export const TRUSTED_DEVICE_SESSION_POLICY: ApplicationSessionPolicy = {
  mode: 'trusted_device',
  absoluteLifetimeSeconds: 30 * 24 * 60 * 60,
  idleTimeoutSeconds: null,
}

export function applicationSessionPolicy(mode: ApplicationSessionMode): ApplicationSessionPolicy {
  return mode === 'trusted_device' ? TRUSTED_DEVICE_SESSION_POLICY : STANDARD_SESSION_POLICY
}

export function sessionExpiresAt(mode: ApplicationSessionMode, authenticatedAt: Date): Date {
  return new Date(authenticatedAt.getTime() + applicationSessionPolicy(mode).absoluteLifetimeSeconds * 1000)
}

export function sessionCookieMaxAgeSeconds(mode: ApplicationSessionMode): number {
  return applicationSessionPolicy(mode).absoluteLifetimeSeconds
}

export function sessionHasIdleExpired(mode: ApplicationSessionMode, lastActivityAt: Date, now: Date): boolean {
  const idleTimeoutSeconds = applicationSessionPolicy(mode).idleTimeoutSeconds
  return idleTimeoutSeconds !== null && lastActivityAt <= new Date(now.getTime() - idleTimeoutSeconds * 1000)
}
