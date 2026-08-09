import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('authenticated entry shell', () => {
  beforeEach(() => window.history.replaceState({}, '', '/'))

  it('does not display role entry cards before a session is authenticated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Waitohu mai — Sign in' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Kaimahi — Tīmata Kōrero' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mātāmua — Supervisor View' })).toBeNull()
  })

  it('renders only the authenticated person’s authorized role cards', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        profile: {
          id: 'user-1',
          displayName: 'Kaimahi test',
          organisation: { id: 'org-1', slug: 'one', name: 'Organisation one' },
          roles: ['KAIMAHI'],
        },
      }),
    }))
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Kaimahi — Tīmata Kōrero' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mātāmua — Supervisor View' })).toBeNull()
    expect(screen.getByText(/Kaimahi test · Organisation one/)).toBeTruthy()
  })
})
