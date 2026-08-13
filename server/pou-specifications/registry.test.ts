import { describe, expect, it } from 'vitest'

import { organisationPouSpecificationFromRegistry } from './registry.js'

describe('Organisation Pou specification registry', () => {
  it('canonicalises an explicitly approved offset timestamp without changing its instant', () => {
    const specification = organisationPouSpecificationFromRegistry('TE_WAHAROA_WHAKAPAPA', '0.1', {
      approvedForPilotBy: '11111111-1111-4111-8111-111111111111',
      approvedForPilotAt: '2026-08-14T07:07:00+12:00',
    })
    expect(specification.approvalStatus).toBe('approved_for_pilot')
    expect(specification.approvedForPilotAt).toBe('2026-08-13T19:07:00.000Z')
  })
})
