import { describe, expect, it } from 'vitest'

import { hasTestDatabaseUrl, verifyUpgradeFromPreMilestone4TestDatabase } from './test-harness.js'

describe.skipIf(!hasTestDatabaseUrl())('PostgreSQL Milestone 4 migration upgrade', () => {
  it('upgrades the genuine 0000/0001/0002/0003 Drizzle journal to 0004', async () => {
    await expect(verifyUpgradeFromPreMilestone4TestDatabase()).resolves.toBeUndefined()
  })
})
