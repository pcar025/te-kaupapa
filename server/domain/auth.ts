export const APPLICATION_ROLES = ['KAIMAHI', 'SUPERVISOR'] as const

export type ApplicationRole = (typeof APPLICATION_ROLES)[number]
export type UserStatus = 'active' | 'inactive'

export interface AuthenticatedUser {
  id: string
  organisation: { id: string; slug: string; name: string }
  displayName: string
  status: UserStatus
  roles: ApplicationRole[]
}

export interface PublicProfile {
  id: string
  displayName: string
  organisation: { id: string; slug: string; name: string }
  roles: ApplicationRole[]
}

export class AuthorizationError extends Error {
  constructor(message = 'The signed-in user is not authorized for this operation.') {
    super(message)
    this.name = 'AuthorizationError'
  }
}

export function toPublicProfile(user: AuthenticatedUser): PublicProfile {
  return {
    id: user.id,
    displayName: user.displayName,
    organisation: user.organisation,
    roles: user.roles,
  }
}

export function hasRole(user: AuthenticatedUser, role: ApplicationRole): boolean {
  return user.status === 'active' && user.roles.includes(role)
}

export function requireRole(user: AuthenticatedUser, role: ApplicationRole): void {
  if (!hasRole(user, role)) throw new AuthorizationError()
}

export function sharesOrganisation(left: AuthenticatedUser, right: AuthenticatedUser): boolean {
  return left.organisation.id === right.organisation.id
}

export function requireOrganisationScope(actor: AuthenticatedUser, target: AuthenticatedUser): void {
  if (!sharesOrganisation(actor, target)) throw new AuthorizationError('The target is outside the signed-in user’s organisation.')
}

export function requireSupervisorRelationship(
  supervisor: AuthenticatedUser,
  kaimahiUserId: string,
  supervisedKaimahiUserIds: readonly string[],
): void {
  requireRole(supervisor, 'SUPERVISOR')
  if (!supervisedKaimahiUserIds.includes(kaimahiUserId)) {
    throw new AuthorizationError('The signed-in supervisor is not assigned to this Kaimahi.')
  }
}
