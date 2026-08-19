import { describe, expect, it } from 'vitest'

import { assertHostedStagingDatabaseUrl } from './command.js'

describe('staging bootstrap database target guard', () => {
  it('refuses local and disposable development database targets', () => {
    for (const url of ['postgresql://localhost/te_kaupapa_dev', 'postgresql://127.0.0.1/te_kaupapa_m2_test', 'postgresql://staging.example/te_kaupapa_dev']) {
      expect(() => assertHostedStagingDatabaseUrl(url)).toThrow('refuses local development and disposable test database targets')
    }
  })

  it('allows an explicitly named hosted staging PostgreSQL target', () => {
    expect(() => assertHostedStagingDatabaseUrl('postgresql://staging.example/te_kaupapa_staging')).not.toThrow()
  })
})
