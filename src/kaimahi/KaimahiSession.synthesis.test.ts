import { describe, expect, it } from 'vitest'

import { canConfirmWorkflowSynthesis } from './KaimahiSession.js'

describe('cross-Pou synthesis confirmation', () => {
  it('does not allow a displayed unsaved edit to be silently bypassed by confirmation', () => {
    expect(canConfirmWorkflowSynthesis({ saving: false, dirty: true, status: 'ready' })).toBe(false)
    expect(canConfirmWorkflowSynthesis({ saving: true, dirty: false, status: 'ready' })).toBe(false)
    expect(canConfirmWorkflowSynthesis({ saving: false, dirty: false, status: 'ready' })).toBe(true)
  })
})
