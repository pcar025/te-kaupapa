import { cleanup, configure, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

configure({ asyncUtilTimeout: 5000 })

afterEach(() => cleanup())

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      profile: {
        id: 'test-user',
        displayName: 'Test user',
        organisation: { id: 'test-org', slug: 'test', name: 'Test organisation' },
        roles: ['KAIMAHI', 'SUPERVISOR'],
      },
    }),
  }))
})

describe('approved application smoke paths', () => {
  it('renders authorized application entry choices after the profile is confirmed', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: /nau mai,\s*haere mai/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Kaimahi — Tīmata Kōrero' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mātāmua — Supervisor View' })).toBeTruthy()
  })

  it('enters the Kaimahi application and starts a reflective session', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('button', { name: 'Kaimahi — Tīmata Kōrero' })
    await user.click(screen.getByRole('button', { name: 'Kaimahi — Tīmata Kōrero' }))
    await screen.findByText('Begin a reflective session')

    await user.click(screen.getByRole('button', { name: /Begin a reflective session/i }))

    expect(await screen.findByText('Tomokia — Setup Reflection')).toBeTruthy()
    expect(screen.getByPlaceholderText('e.g. TW-04')).toBeTruthy()
  })

  it('preserves core Kaimahi tab navigation', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('button', { name: 'Kaimahi — Tīmata Kōrero' })
    await user.click(screen.getByRole('button', { name: 'Kaimahi — Tīmata Kōrero' }))
    await screen.findByText('Begin a reflective session')
    await user.click(screen.getByRole('button', { name: 'Mahi' }))

    expect(await screen.findByRole('heading', { name: 'Ngā Mahi' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Active/ })).toBeTruthy()
  })

  it('keeps the representative Kaimahi path usable at a mobile viewport', async () => {
    const originalWidth = window.innerWidth
    const originalHeight = window.innerHeight
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
    window.dispatchEvent(new Event('resize'))

    try {
      const user = userEvent.setup()
      render(<App />)

      await screen.findByRole('button', { name: 'Kaimahi — Tīmata Kōrero' })
      await user.click(screen.getByRole('button', { name: 'Kaimahi — Tīmata Kōrero' }))
      await screen.findByText('Begin a reflective session')
      await user.click(screen.getByRole('button', { name: 'Kōrero' }))

      expect(await screen.findByPlaceholderText('Search whānau code…')).toBeTruthy()
      expect(screen.getByText('TW-04')).toBeTruthy()
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight })
      window.dispatchEvent(new Event('resize'))
    }
  })

  it('enters the Supervisor application and renders representative navigation', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('button', { name: 'Mātāmua — Supervisor View' })
    await user.click(screen.getByRole('button', { name: 'Mātāmua — Supervisor View' }))

    expect(await screen.findByText('KAIMAHI / WHĀNAU')).toBeTruthy()
    expect(screen.getByText('Aroha Ngāti')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Tirohanga/ }))
    expect(await screen.findByRole('heading', { name: 'Ata mārie, Test user' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Mātāmua Supervisor view/i }))
    expect(await screen.findByRole('heading', { name: /nau mai,\s*haere mai/i })).toBeTruthy()
  })
})
