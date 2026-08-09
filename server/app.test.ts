import { describe, expect, it } from 'vitest'

import { createApplication } from './app.js'
import { sha256 } from './auth/crypto.js'
import type { OidcProvider } from './auth/oidc.js'
import type { AppConfiguration } from './config.js'
import type { AuthRepository, CreateSessionInput } from './db/repository.js'
import type { AuthenticatedUser } from './domain/auth.js'

const activeKaimahi: AuthenticatedUser = {
  id: '0a7e65f8-3f45-4a2b-b837-7891aeff2ec4',
  displayName: 'Test Kaimahi',
  status: 'active',
  organisation: { id: 'fe750d03-3a1e-48c1-a8c0-d1c3855bb2f1', slug: 'test', name: 'Test organisation' },
  roles: ['KAIMAHI'],
}

class MemoryRepository implements AuthRepository {
  readonly identities = new Map<string, AuthenticatedUser>()
  readonly sessions = new Map<string, CreateSessionInput & { invalidatedAt?: Date }>()
  readonly supervision = new Set<string>()

  async findUserByExternalIdentity(provider: string, subject: string) {
    return this.identities.get(`${provider}:${subject}`) ?? null
  }

  async createSession(input: CreateSessionInput) {
    this.sessions.set(input.tokenHash, input)
  }

  async findUserBySessionHash(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash)
    if (!session || session.invalidatedAt || session.expiresAt <= now) return null
    return [...this.identities.values()].find((user) => user.id === session.userId) ?? null
  }

  async invalidateSession(tokenHash: string, invalidatedAt: Date) {
    const session = this.sessions.get(tokenHash)
    if (session) session.invalidatedAt = invalidatedAt
  }

  async isSupervisorOf(supervisorUserId: string, kaimahiUserId: string) {
    return this.supervision.has(`${supervisorUserId}:${kaimahiUserId}`)
  }
}

class FakeOidcProvider implements OidcProvider {
  authorizationUrl(input: { state: string }) {
    return `https://idp.test/authorize?state=${encodeURIComponent(input.state)}`
  }

  async exchangeCode() {
    return { provider: 'cognito' as const, subject: 'cognito-subject', email: 'test@example.invalid', displayName: 'Test Kaimahi' }
  }
}

function config(): AppConfiguration {
  return {
    nodeEnv: 'test',
    port: 3011,
    databaseUrl: 'postgresql://not-used',
    appOrigin: 'http://api.test',
    frontendOrigin: 'http://web.test',
    allowedOrigins: ['http://api.test', 'http://web.test'],
    cookieName: 'test_session',
    cookieSigningSecret: 'a-test-cookie-secret-that-is-long-enough',
    sessionTtlHours: 12,
  }
}

function cookieFrom(response: { headers: { ['set-cookie']?: string | string[] | number } }, name?: string): string {
  const header = response.headers['set-cookie']
  const values = Array.isArray(header) ? header : [typeof header === 'string' ? header : undefined]
  const value = name ? values.find((candidate) => candidate?.startsWith(`${name}=`)) : values[0]
  if (!value) throw new Error('Response had no cookie.')
  return value.split(';')[0]
}

describe('authenticated application shell API', () => {
  it('does not reveal a profile without an application session', async () => {
    const app = await createApplication({ config: config(), repository: new MemoryRepository(), oidcProvider: new FakeOidcProvider() })
    const response = await app.inject({ method: 'GET', url: '/api/me' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('creates a server session only for a provisioned active user and invalidates it on logout', async () => {
    const repository = new MemoryRepository()
    repository.identities.set('cognito:cognito-subject', activeKaimahi)
    const app = await createApplication({ config: config(), repository, oidcProvider: new FakeOidcProvider() })

    const login = await app.inject({ method: 'GET', url: '/api/auth/login' })
    const transactionCookie = cookieFrom(login)
    const state = new URL(login.headers.location!).searchParams.get('state')!
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=code&state=${encodeURIComponent(state)}`,
      headers: { cookie: transactionCookie },
    })
    expect(callback.statusCode).toBe(302)
    expect(callback.headers.location).toBe('http://web.test')

    const sessionCookie = cookieFrom(callback, 'test_session')
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: sessionCookie } })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toEqual({
      profile: {
        id: activeKaimahi.id,
        displayName: 'Test Kaimahi',
        organisation: activeKaimahi.organisation,
        roles: ['KAIMAHI'],
      },
    })

    const forbidden = await app.inject({ method: 'GET', url: '/api/entry/SUPERVISOR', headers: { cookie: sessionCookie } })
    expect(forbidden.statusCode).toBe(403)
    const rejectedLogout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: sessionCookie } })
    expect(rejectedLogout.statusCode).toBe(403)
    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: sessionCookie, origin: 'http://web.test' },
    })
    expect(logout.statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: sessionCookie } })).statusCode).toBe(401)
    await app.close()
  })

  it('does not create a session for an authenticated but unprovisioned identity', async () => {
    const app = await createApplication({ config: config(), repository: new MemoryRepository(), oidcProvider: new FakeOidcProvider() })
    const login = await app.inject({ method: 'GET', url: '/api/auth/login' })
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=code&state=${new URL(login.headers.location!).searchParams.get('state')}`,
      headers: { cookie: cookieFrom(login) },
    })
    expect(callback.headers.location).toBe('http://web.test/?auth=unprovisioned')
    expect(callback.headers['set-cookie']).not.toContain('test_session=')
    await app.close()
  })

  it('rejects an inactive or expired session and denies a supervisor outside their explicit relationship', async () => {
    const repository = new MemoryRepository()
    const inactive = { ...activeKaimahi, id: '3e5eb0bb-6bd3-4db2-8288-02d4176cc8e8', status: 'inactive' as const }
    const supervisor: AuthenticatedUser = { ...activeKaimahi, id: 'f279d807-3e4b-4d93-a370-d0b6e262c142', roles: ['SUPERVISOR'] }
    repository.identities.set('cognito:inactive', inactive)
    repository.identities.set('cognito:supervisor', supervisor)
    await repository.createSession({
      id: 'a04b9d4a-10c8-4f81-9073-5ea3bc883513',
      userId: inactive.id,
      tokenHash: sha256('inactive-session'),
      expiresAt: new Date(Date.now() + 60_000),
    })
    await repository.createSession({
      id: 'a59450ff-57b0-43af-bd5c-f4040bfae970',
      userId: supervisor.id,
      tokenHash: sha256('expired-session'),
      expiresAt: new Date(Date.now() - 60_000),
    })
    const app = await createApplication({ config: config(), repository, oidcProvider: new FakeOidcProvider() })

    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: 'test_session=inactive-session' } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: 'test_session=expired-session' } })).statusCode).toBe(401)
    await repository.createSession({
      id: 'e9016a7a-4654-4981-a71d-29f91e0ca8a2',
      userId: supervisor.id,
      tokenHash: sha256('supervisor-session'),
      expiresAt: new Date(Date.now() + 60_000),
    })
    expect((await app.inject({
      method: 'GET',
      url: '/api/supervision/0fba8d19-a0b7-4f28-931e-8940da7c364c',
      headers: { cookie: 'test_session=supervisor-session' },
    })).statusCode).toBe(403)
    repository.supervision.add(`${supervisor.id}:0fba8d19-a0b7-4f28-931e-8940da7c364c`)
    expect((await app.inject({
      method: 'GET',
      url: '/api/supervision/0fba8d19-a0b7-4f28-931e-8940da7c364c',
      headers: { cookie: 'test_session=supervisor-session' },
    })).statusCode).toBe(204)
    await app.close()
  })
})
