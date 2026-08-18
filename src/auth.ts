import { useCallback, useEffect, useState } from 'react'

export type ApplicationRole = 'KAIMAHI' | 'SUPERVISOR' | 'SPECIFICATION_EDITOR'

export interface AuthProfile {
  id: string
  displayName: string
  organisation: { id: string; slug: string; name: string }
  roles: ApplicationRole[]
}

export type AuthState =
  | { kind: 'checking' }
  | { kind: 'authenticated'; profile: AuthProfile }
  | { kind: 'unauthenticated' }
  | { kind: 'unprovisioned' }
  | { kind: 'inactive' }
  | { kind: 'error' }

function callbackState(): 'unprovisioned' | 'inactive' | 'error' | undefined {
  const value = new URLSearchParams(window.location.search).get('auth')
  return value === 'unprovisioned' || value === 'inactive' || value === 'failed' ? value === 'failed' ? 'error' : value : undefined
}

export function useAuthState() {
  const [state, setState] = useState<AuthState>({ kind: 'checking' })

  const refresh = useCallback(async () => {
    const callbackResult = callbackState()
    if (callbackResult) {
      setState({ kind: callbackResult })
      return
    }
    setState({ kind: 'checking' })
    try {
      const response = await fetch('/api/me', { credentials: 'same-origin', headers: { accept: 'application/json' } })
      if (response.status === 401) {
        setState({ kind: 'unauthenticated' })
        return
      }
      if (!response.ok) throw new Error('Unable to load session profile.')
      const payload = await response.json() as { profile?: AuthProfile }
      if (!payload.profile) throw new Error('Profile response is incomplete.')
      setState({ kind: 'authenticated', profile: payload.profile })
    } catch {
      setState({ kind: 'error' })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const beginSignIn = useCallback(async (trustedDevice = false) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ trustedDevice }),
      })
      if (!response.ok) throw new Error('Unable to begin sign-in.')
      const payload = await response.json() as { authorizationUrl?: string }
      if (!payload.authorizationUrl) throw new Error('Sign-in authorization is unavailable.')
      window.location.assign(payload.authorizationUrl)
    } catch {
      setState({ kind: 'error' })
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      if (!response.ok) throw new Error('Unable to end session.')
      const payload = await response.json() as { logoutUrl?: string }
      if (payload.logoutUrl) {
        window.location.assign(payload.logoutUrl)
        return
      }
      setState({ kind: 'unauthenticated' })
    } catch {
      setState({ kind: 'error' })
    }
  }, [])

  return { state, refresh, beginSignIn, signOut }
}
