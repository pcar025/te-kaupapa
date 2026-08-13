import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { safetySpecificationFromRegistry } from './registry.js'

describe('Whakapapa pilot specification registry', () => {
  it('materialises the approved v0.1 template only with supplied approval provenance', () => {
    const approvedForPilotBy = randomUUID()
    const approvedForPilotAt = '2026-08-12T14:00:00.000Z'

    const specification = safetySpecificationFromRegistry('TE_WAHAROA_WHAKAPAPA_SAFETY', '0.1', { approvedForPilotBy, approvedForPilotAt })

    expect(specification).toMatchObject({
      approvalStatus: 'approved_for_pilot',
      approvedForPilotBy,
      approvedForPilotAt,
      sourceDocumentStatus: 'draft',
    })
    expect(specification.rules.map((rule) => rule.ruleCode)).toEqual([
      'WHAKAPAPA_IDENTITY_CONTEXT_001',
      'WHAKAPAPA_STRENGTHS_PROTECTIVE_002',
      'WHAKAPAPA_CULTURAL_DISTRESS_003',
    ])
  })

  it('does not manufacture an approval identity for an unregistered request', () => {
    expect(() => safetySpecificationFromRegistry('UNKNOWN', '0.1', { approvedForPilotBy: randomUUID(), approvedForPilotAt: '2026-08-12T14:00:00.000Z' })).toThrow('not registered')
  })
})
