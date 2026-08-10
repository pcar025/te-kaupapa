import { describe, expect, it } from 'vitest'

import { hasTestDatabaseUrl, verifyUpgradeFromMilestone2TestDatabase } from './test-harness.js'

describe.skipIf(!hasTestDatabaseUrl())('PostgreSQL Milestone 3 migration upgrade', () => {
  it('upgrades the genuine 0000/0001/0002 Drizzle journal to 0003', async () => {
    await expect(verifyUpgradeFromMilestone2TestDatabase()).resolves.toBeUndefined()
  })
})
