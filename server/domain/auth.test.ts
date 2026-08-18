import { describe, expect, it } from 'vitest'

import {
  AuthorizationError,
  hasRole,
  requireOrganisationScope,
  requireRole,
  requireSupervisorRelationship,
  type AuthenticatedUser,
} from './auth.js'

const dualRoleUser: AuthenticatedUser = {
  id: 'user-1',
  displayName: 'Dual role user',
  status: 'active',
  organisation: { id: 'org-1', slug: 'one', name: 'Organisation one' },
  roles: ['KAIMAHI', 'SUPERVISOR'],
}

describe('role authorization', () => {
  it('permits a person with both approved roles to enter either application context', () => {
    expect(hasRole(dualRoleUser, 'KAIMAHI')).toBe(true)
    expect(hasRole(dualRoleUser, 'SUPERVISOR')).toBe(true)
  })

  it('keeps specification editing as an independent additive capability', () => {
    const editor: AuthenticatedUser = { ...dualRoleUser, roles: ['SPECIFICATION_EDITOR'] }
    expect(() => requireRole(editor, 'SPECIFICATION_EDITOR')).not.toThrow()
    expect(() => requireRole(editor, 'KAIMAHI')).toThrow(AuthorizationError)
    expect(() => requireRole(dualRoleUser, 'SPECIFICATION_EDITOR')).toThrow(AuthorizationError)
  })

  it('denies role access for an inactive user even when an assignment remains', () => {
    const inactive = { ...dualRoleUser, status: 'inactive' as const }
    expect(() => requireRole(inactive, 'KAIMAHI')).toThrow(AuthorizationError)
  })

  it('denies cross-organisation access and unassigned supervisor access', () => {
    const anotherOrganisationUser = {
      ...dualRoleUser,
      id: 'user-2',
      organisation: { id: 'org-2', slug: 'two', name: 'Organisation two' },
    }
    expect(() => requireOrganisationScope(dualRoleUser, anotherOrganisationUser)).toThrow(AuthorizationError)
    expect(() => requireSupervisorRelationship(dualRoleUser, 'kaimahi-1', [])).toThrow(AuthorizationError)
    expect(() => requireSupervisorRelationship(dualRoleUser, 'kaimahi-1', ['kaimahi-1'])).not.toThrow()
  })
})
