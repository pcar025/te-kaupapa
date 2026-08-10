import { cleanup, configure, render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { SessionShell } from './kaimahi/KaimahiSession'
import type { Workflow } from './workflows'

configure({ asyncUtilTimeout: 5000 })

afterEach(() => cleanup())

beforeEach(() => {
  const workflow = {
    id: '22b1f80c-2c12-4f82-bdd9-65d7b30712bb',
    reference: 'TK-7K4M2P9Q',
    status: 'draft',
    currentStage: 'setup',
    currentPouId: null,
    version: 1,
    setup: null,
    checkpoints: [],
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  }
  const setupConfirmedWorkflow = {
    ...workflow,
    status: 'in_progress',
    currentStage: 'pou-overview',
    currentPouId: 'whakapapa',
    version: 2,
    setup: {
      whanauReference: 'TW-04',
      engagementType: 'home-visit',
      sessionFocus: 'Whānau support discussion',
      additionalNotes: null,
      immediateConcern: 'none',
    },
  }
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/api/workflows?')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [] }) })
    }
    if (url === '/api/workflows' && init?.method === 'POST') {
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ workflow, acknowledgement: { replayed: false } }) })
    }
    if (url.includes('/api/workflows/') && url.endsWith('/interactions') && init?.method === 'POST') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: setupConfirmedWorkflow, acknowledgement: { replayed: false } }) })
    }
    return Promise.resolve({
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
    })
  }))
})

describe('approved application smoke paths', () => {
  it('uses acknowledged Pou data and waits for the real post-Pou transition', async () => {
    const checkpoints = ['whakapapa', 'manaakitanga', 'tikanga', 'kaitiakitanga', 'puukenga', 'haepapa', 'oranga'].map((pouId, index) => ({
      pouId: pouId as Workflow['checkpoints'][number]['pouId'], ordinal: index + 1, progress: 'confirmed' as const,
      userSelectedConcern: index === 1 ? 'action' as const : 'low' as const,
      note: index === 1 ? 'A Kaimahi-confirmed note.' : null, referralSuggested: false, supervisorReviewSuggested: false,
      confirmedAt: '2026-08-10T00:00:00.000Z',
    }))
    const initial: Workflow = {
      id: '22b1f80c-2c12-4f82-bdd9-65d7b30712bb', reference: 'TK-7K4M2P9Q', status: 'in_progress',
      currentStage: 'pou-summary', currentPouId: null, version: 9,
      setup: { whanauReference: 'TW-04', engagementType: 'home-visit', sessionFocus: 'Whānau support discussion', additionalNotes: null, immediateConcern: 'none' },
      checkpoints, actions: [], referrals: [], completedAt: null,
      structuredReview: { reference: 'TK-7K4M2P9Q', setup: null, checkpoints, actions: [], referrals: [], createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', completedAt: null },
      createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
    }
    const acknowledged: Workflow = { ...initial, currentStage: 'action-planning', version: 10, structuredReview: { ...initial.structuredReview, setup: initial.setup } }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/interactions')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: acknowledged, acknowledgement: { replayed: false } }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: initial }) })
    }))
    function Harness() {
      const [workflow, setWorkflow] = useState(initial)
      return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} />
    }
    const user = userEvent.setup()
    render(<Harness />)

    expect(screen.getByText('A Kaimahi-confirmed note.')).toBeTruthy()
    expect(screen.queryByText(/Persistent low mood and sleep disruption/i)).toBeNull()
    await user.click(screen.getByRole('button', { name: /Concerns & Actions/i }))
    expect(await screen.findByRole('heading', { name: /Name the actions you will carry forward/i })).toBeTruthy()
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/workflows/22b1f80c-2c12-4f82-bdd9-65d7b30712bb/interactions',
      expect.objectContaining({ method: 'POST' }),
    )
  })

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

  it('does not advance setup until its workflow confirmation is acknowledged', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('button', { name: 'Kaimahi — Tīmata Kōrero' })
    await user.click(screen.getByRole('button', { name: 'Kaimahi — Tīmata Kōrero' }))
    await user.click(screen.getByRole('button', { name: /Begin a reflective session/i }))
    await user.type(screen.getByPlaceholderText('e.g. TW-04'), 'tw-04')
    await user.type(screen.getByPlaceholderText('What was the purpose or focus of this engagement?'), 'Whānau support discussion')
    await user.click(screen.getByRole('button', { name: /No immediate concern/i }))
    await user.click(screen.getByRole('button', { name: /Uru atu ki te whare/i }))

    expect(await screen.findByRole('heading', { name: /Ngā Pou o Te Waharoa/i })).toBeTruthy()
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/workflows/22b1f80c-2c12-4f82-bdd9-65d7b30712bb/interactions',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('loads and resumes the server-authoritative workflow checkpoint after entry', async () => {
    const resumedWorkflow = {
      id: '22b1f80c-2c12-4f82-bdd9-65d7b30712bb',
      reference: 'TK-7K4M2P9Q',
      status: 'in_progress',
      currentStage: 'pou-overview',
      currentPouId: 'whakapapa',
      version: 2,
      setup: {
        whanauReference: 'TW-04',
        engagementType: 'home-visit',
        sessionFocus: 'Whānau support discussion',
        additionalNotes: null,
        immediateConcern: 'none',
      },
      checkpoints: [],
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/workflows?')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [{ ...resumedWorkflow, whanauReference: 'TW-04' }] }) })
      }
      if (url === `/api/workflows/${resumedWorkflow.id}`) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: resumedWorkflow }) })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          profile: {
            id: 'test-user',
            displayName: 'Test user',
            organisation: { id: 'test-org', slug: 'test', name: 'Test organisation' },
            roles: ['KAIMAHI'],
          },
        }),
      })
    }))
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('button', { name: 'Kaimahi — Tīmata Kōrero' })
    await user.click(screen.getByRole('button', { name: 'Kaimahi — Tīmata Kōrero' }))
    expect(await screen.findByText('SESSION IN PROGRESS')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /continue your reflection/i }))
    expect(await screen.findByRole('heading', { name: /Ngā Pou o Te Waharoa/i })).toBeTruthy()
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
