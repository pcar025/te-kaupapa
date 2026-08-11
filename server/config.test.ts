import { describe, expect, it } from 'vitest'

import { loadConfiguration } from './config.js'

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost/te_kaupapa_test',
  APP_ORIGIN: 'http://api.test',
  FRONTEND_ORIGIN: 'http://web.test',
  SESSION_COOKIE_SECRET: 'a-test-cookie-secret-that-is-long-enough',
}

describe('ElevenLabs server configuration', () => {
  it('allows ordinary startup without ElevenLabs configuration', () => {
    expect(loadConfiguration(base).elevenlabs).toBeUndefined()
  })

  it('requires complete server-only ElevenLabs configuration, including the reviewed branch, once any value is supplied', () => {
    expect(() => loadConfiguration({ ...base, ELEVENLABS_AGENT_ID: 'agent-only' })).toThrow('ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, ELEVENLABS_AGENT_BRANCH_ID, and ELEVENLABS_AGENT_ENVIRONMENT must be set together.')
    expect(() => loadConfiguration({
      ...base,
      ELEVENLABS_API_KEY: 'test-server-only-key',
      ELEVENLABS_AGENT_ID: 'agent-test',
      ELEVENLABS_AGENT_ENVIRONMENT: 'staging',
    })).toThrow('ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, ELEVENLABS_AGENT_BRANCH_ID, and ELEVENLABS_AGENT_ENVIRONMENT must be set together.')
  })

  it('reads the configured provider values without creating public client configuration', () => {
    expect(loadConfiguration({
      ...base,
      ELEVENLABS_API_KEY: 'test-server-only-key',
      ELEVENLABS_AGENT_ID: 'agent-test',
      ELEVENLABS_AGENT_BRANCH_ID: 'branch-test',
      ELEVENLABS_AGENT_ENVIRONMENT: 'staging',
    }).elevenlabs).toEqual({
      apiKey: 'test-server-only-key',
      agentId: 'agent-test',
      agentBranchId: 'branch-test',
      agentEnvironment: 'staging',
    })
  })
})
