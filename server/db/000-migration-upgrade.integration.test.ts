import { describe, expect, it } from 'vitest'

import { hasTestDatabaseUrl, verifyUpgradeFromPreMilestone5TestDatabase } from './test-harness.js'

describe.skipIf(!hasTestDatabaseUrl())('PostgreSQL Milestone 5 migration upgrade', () => {
  it('upgrades the genuine 0000 through 0004 Drizzle journal to 0005', async () => {
    await expect(verifyUpgradeFromPreMilestone5TestDatabase()).resolves.toBeUndefined()
  })
})
