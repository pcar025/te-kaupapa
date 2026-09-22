import { describe, expect, it } from 'vitest'

import { POU_ORDER, TE_WAHAROA_POU } from './pou.js'

describe('mandatory Te Waharoa Pou journey', () => {
  it('uses the approved mandatory journey order without changing stable Pou identities', () => {
    expect(POU_ORDER).toEqual([
      'kaitiakitanga',
      'tikanga',
      'whakapapa',
      'manaakitanga',
      'puukenga',
      'haepapa',
      'oranga',
    ])
    expect(TE_WAHAROA_POU.map((pou) => pou.full)).toEqual([
      'Kaitiakitanga & Risk Management',
      'Tikanga & Ethical Practice',
      'Whakapapa & Identity Safety',
      'Manaakitanga & Duty of Care',
      'Pūkenga & Practitioner Capability',
      'Haepapa & Accountability',
      'Oranga & Protective Factors',
    ])
    expect(new Set(POU_ORDER)).toHaveLength(7)
  })
})
