import { describe, expect, it } from 'vitest'

import { STANDARD_SESSION_POLICY, TRUSTED_DEVICE_SESSION_POLICY, sessionExpiresAt, sessionHasIdleExpired } from './session-policy.js'

describe('application session policy', () => {
  it('keeps the standard session to a 12-hour absolute lifetime with an 8-hour idle timeout', () => {
    const authenticatedAt = new Date('2026-09-01T08:00:00.000Z')
    expect(STANDARD_SESSION_POLICY).toMatchObject({ mode: 'standard', absoluteLifetimeSeconds: 43_200, idleTimeoutSeconds: 28_800 })
    expect(sessionExpiresAt('standard', authenticatedAt)).toEqual(new Date('2026-09-01T20:00:00.000Z'))
    expect(sessionHasIdleExpired('standard', authenticatedAt, new Date('2026-09-01T15:59:00.000Z'))).toBe(false)
    expect(sessionHasIdleExpired('standard', authenticatedAt, new Date('2026-09-01T16:00:00.000Z'))).toBe(true)
  })

  it('keeps trusted-device sessions to a hard non-sliding 30-day lifetime without a standard idle rejection', () => {
    const authenticatedAt = new Date('2026-09-01T09:00:00.000Z')
    expect(TRUSTED_DEVICE_SESSION_POLICY).toMatchObject({ mode: 'trusted_device', absoluteLifetimeSeconds: 2_592_000, idleTimeoutSeconds: null })
    expect(sessionExpiresAt('trusted_device', authenticatedAt)).toEqual(new Date('2026-10-01T09:00:00.000Z'))
    expect(sessionHasIdleExpired('trusted_device', authenticatedAt, new Date('2026-09-30T08:59:00.000Z'))).toBe(false)
  })
})
