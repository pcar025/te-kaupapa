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
  it('defaults to the normal network host but supports loopback-only ingress', () => {
    expect(loadConfiguration(base).host).toBe('0.0.0.0')
    expect(loadConfiguration({ ...base, HOST: '127.0.0.1' }).host).toBe('127.0.0.1')
  })

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

  it('keeps post-call ingestion disabled unless its separate server-only signing secret is configured', () => {
    expect(loadConfiguration(base).elevenlabsWebhook).toBeUndefined()
    expect(loadConfiguration({ ...base, ELEVENLABS_WEBHOOK_SECRET: 'test-webhook-secret-with-sufficient-length' }).elevenlabsWebhook).toEqual({
      signingSecret: 'test-webhook-secret-with-sufficient-length', maximumBodyBytes: 131072, maximumAgeSeconds: 300,
    })
  })
})
