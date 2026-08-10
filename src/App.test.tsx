import { cleanup, configure, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { SessionShell } from './kaimahi/KaimahiSession'
import type { SafetyObservationCurrentView, Workflow } from './workflows'

const emptySafety = {
  observations: [],
  requiredConsequences: [],
  supervisorReviewRequests: [],
  indicators: { activeObservationCount: 0, urgentObservationCount: 0, supervisorReviewRequired: false, supervisorNotificationRequired: false, manualReviewRequestCount: 0, hasRetractedHistory: false },
}

function workflowFixture(overrides: Partial<Workflow> = {}): Workflow {
  const base: Workflow = {
    id: '22b1f80c-2c12-4f82-bdd9-65d7b30712bb', reference: 'TK-7K4M2P9Q', status: 'in_progress', currentStage: 'pou-review' as Workflow['currentStage'], currentPouId: 'whakapapa', version: 2,
    setup: { whanauReference: 'TW-04', engagementType: 'home-visit', sessionFocus: 'Support discussion', additionalNotes: null, immediateConcern: 'none' }, checkpoints: [], actions: [], referrals: [], safety: emptySafety,
    structuredReview: { reference: 'TK-7K4M2P9Q', setup: null, checkpoints: [], actions: [], referrals: [], createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', completedAt: null }, completedAt: null, createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
  }
  return { ...base, ...overrides }
}

function activeObservation(overrides: Partial<SafetyObservationCurrentView> = {}): SafetyObservationCurrentView {
  return {
    id: 'f5a90392-fc8e-4f4c-a4d0-e54a8a210269', assessmentContext: 'setup', pouId: null,
    broadClass: 'whanau_safety', concernLevel: 'urgent', contextNote: 'Kaimahi-confirmed context.',
    status: 'active', currentRevision: 1, confirmedAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z', retractedAt: null, ...overrides,
  }
}

function completedWorkflowWithSafety(safety: Workflow['safety'], overrides: Partial<Workflow> = {}): Workflow {
  return workflowFixture({
    status: 'completed', currentStage: 'complete', currentPouId: null, version: 8,
    completedAt: '2026-08-10T00:00:00.000Z', safety,
    ...overrides,
  })
}

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
    safety: emptySafety,
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
  it('does not promote a Pou concern or its considerations without explicit safety confirmation', async () => {
    const initial = workflowFixture()
    const acknowledged = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 3 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ workflow: acknowledged, acknowledgement: { replayed: false } }) }))
    function Harness() { const [workflow, setWorkflow] = useState(initial); return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} /> }
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Urgent concern' }))
    await user.click(screen.getByRole('button', { name: 'Referral pathway recommended' }))
    await user.click(screen.getByRole('button', { name: 'Consider supervisor review' }))
    await user.click(screen.getByRole('button', { name: /Confirm & continue to Pou 2/i }))
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1))
    const command = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    expect(command).toMatchObject({ type: 'pou-review-confirmed', userSelectedConcern: 'urgent', referralSuggested: true, supervisorReviewSuggested: true })
    expect(command.type).not.toBe('safety-observation-confirmed')
    expect(command.type).not.toBe('supervisor-review-requested')
  })

  it('submits an explicitly selected Pou safety concern after the acknowledged Pou version', async () => {
    const initial = workflowFixture()
    const pouAcknowledged = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 3 })
    const safetyAcknowledged = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 4, safety: { ...emptySafety, observations: [{ id: 'e73e9be5-7247-4fb4-a745-5b0e24e86e30', assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'practice_quality', concernLevel: 'urgent', contextNote: null, status: 'active', currentRevision: 1, confirmedAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', retractedAt: null }], indicators: { ...emptySafety.indicators, activeObservationCount: 1, urgentObservationCount: 1 } } })
    let calls = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: ++calls === 1 ? pouAcknowledged : safetyAcknowledged, acknowledgement: { replayed: false } }) })))
    function Harness() { const [workflow, setWorkflow] = useState(initial); return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} /> }
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Urgent concern' }))
    await user.click(screen.getByRole('button', { name: 'Record this as a safety concern' }))
    expect(screen.getByRole('button', { name: /Confirm & continue to Pou 2/i }).hasAttribute('disabled')).toBe(false)
    await user.click(screen.getByRole('button', { name: /Confirm & continue to Pou 2/i }))
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    await user.click(screen.getByLabelText('Practice quality'))
    await user.click(screen.getByRole('button', { name: /Confirm & continue to Pou 2/i }))
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2))
    const first = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    const second = JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))
    expect(first.type).toBe('pou-review-confirmed')
    expect(second).toMatchObject({ type: 'safety-observation-confirmed', expectedVersion: 3, observation: { assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'practice_quality', concernLevel: 'urgent' } })
  })

  it('keeps a failed opted-in Pou safety save visible and retries only the same safety command', async () => {
    const initial = workflowFixture()
    const pouAcknowledged = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 3 })
    const safetyAcknowledged = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 4, safety: { ...emptySafety, observations: [{ id: 'e73e9be5-7247-4fb4-a745-5b0e24e86e30', assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'whanau_safety', concernLevel: 'urgent', contextNote: null, status: 'active', currentRevision: 1, confirmedAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', retractedAt: null }], indicators: { ...emptySafety.indicators, activeObservationCount: 1, urgentObservationCount: 1 } } })
    let calls = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      calls += 1
      if (calls === 1) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: pouAcknowledged, acknowledgement: { replayed: false } }) })
      if (calls === 2) return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'persistence_unavailable' }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: safetyAcknowledged, acknowledgement: { replayed: false } }) })
    }))
    function Harness() { const [workflow, setWorkflow] = useState(initial); return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} /> }
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Urgent concern' }))
    await user.click(screen.getByRole('button', { name: 'Record this as a safety concern' }))
    await user.click(screen.getByLabelText('Whānau safety'))
    await user.click(screen.getByRole('button', { name: /Confirm & continue to Pou 2/i }))
    expect(await screen.findByText('A safety concern has not yet been saved.')).toBeTruthy()
    const failedSafetyCommand = String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3))
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body)).type).toBe('safety-observation-confirmed')
    expect(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body)).toBe(failedSafetyCommand)
    expect(screen.queryByText('A safety concern has not yet been saved.')).toBeNull()
  })

  it('keeps a pending safety concern visible when a later unrelated Pou command is stale', async () => {
    const initial = workflowFixture()
    const pouAcknowledged = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 3 })
    const latest = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 4 })
    let calls = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: latest }) })
      calls += 1
      if (calls === 1) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: pouAcknowledged, acknowledgement: { replayed: false } }) })
      if (calls === 2) return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'persistence_unavailable' }) })
      return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'stale_workflow', currentVersion: 4 }) })
    }))
    function Harness() { const [workflow, setWorkflow] = useState(initial); return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} /> }
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Urgent concern' }))
    await user.click(screen.getByRole('button', { name: 'Record this as a safety concern' }))
    await user.click(screen.getByLabelText('Whānau safety'))
    await user.click(screen.getByRole('button', { name: /Confirm & continue to Pou 2/i }))
    expect(await screen.findByText('A safety concern has not yet been saved.')).toBeTruthy()
    const failedSafetyCommand = String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)
    await user.click(screen.getByRole('button', { name: /Hoki/i }))
    await user.click(screen.getByRole('button', { name: /Confirm & continue to Pou 2/i }))
    expect(await screen.findByRole('button', { name: 'Review safety concern' })).toBeTruthy()
    expect(screen.getByText(/A safety concern has not yet been saved\. Review and reconfirm it from the current workflow\./)).toBeTruthy()
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4))
    expect(String(vi.mocked(fetch).mock.calls[3]?.[0])).toBe(`/api/workflows/${initial.id}`)
    const commands = vi.mocked(fetch).mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
    expect(commands.map((command) => command.type)).toEqual(['pou-review-confirmed', 'safety-observation-confirmed', 'pou-review-confirmed'])
    expect(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)).toBe(failedSafetyCommand)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('keeps an explicit manual supervisor request independent from safety concerns', async () => {
    const initial = workflowFixture()
    const pouAcknowledged = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 3 })
    const requestAcknowledged = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 4, safety: { ...emptySafety, supervisorReviewRequests: [{ id: 'd3306df2-03f5-43c3-8539-239b17c6a9e1', pouId: 'whakapapa', requestNote: null, requestedAt: '2026-08-10T00:00:00.000Z' }], indicators: { ...emptySafety.indicators, manualReviewRequestCount: 1 } } })
    let calls = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: ++calls === 1 ? pouAcknowledged : requestAcknowledged, acknowledgement: { replayed: false } }) })))
    function Harness() { const [workflow, setWorkflow] = useState(initial); return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} /> }
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Request supervisor review' }))
    await user.click(screen.getByRole('button', { name: /Confirm & continue to Pou 2/i }))
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2))
    const second = JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))
    expect(second).toMatchObject({ type: 'supervisor-review-requested', expectedVersion: 3, pouId: 'whakapapa' })
    expect(second.type).not.toBe('safety-observation-confirmed')
  })

  it('does not create a safety concern from an urgent setup selection without explicit confirmation', async () => {
    const initial: Workflow = {
      id: '22b1f80c-2c12-4f82-bdd9-65d7b30712bb', reference: 'TK-7K4M2P9Q', status: 'draft', currentStage: 'setup', currentPouId: null, version: 1,
      setup: null, checkpoints: [], actions: [], referrals: [], safety: emptySafety,
      structuredReview: { reference: 'TK-7K4M2P9Q', setup: null, checkpoints: [], actions: [], referrals: [], createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', completedAt: null }, completedAt: null, createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
    }
    const acknowledged: Workflow = { ...initial, status: 'in_progress', currentStage: 'pou-overview', currentPouId: 'whakapapa', version: 2, setup: { whanauReference: 'TW-04', engagementType: 'home-visit', sessionFocus: 'Support discussion', additionalNotes: null, immediateConcern: 'urgent' } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ workflow: acknowledged, acknowledgement: { replayed: false } }) }))
    function Harness() { const [workflow, setWorkflow] = useState(initial); return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} /> }
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByPlaceholderText('e.g. TW-04'), 'TW-04')
    await user.type(screen.getByPlaceholderText('What was the purpose or focus of this engagement?'), 'Support discussion')
    await user.click(screen.getByRole('button', { name: /An immediate concern exists/i }))
    await user.click(screen.getByRole('button', { name: /Uru atu ki te whare/i }))
    expect(await screen.findByRole('heading', { name: /Ngā Pou o Te Waharoa/i })).toBeTruthy()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).type).toBe('setup-confirmed')
  })

  it('requires a broad class and submits an explicitly selected setup safety concern after setup acknowledgement', async () => {
    const initial: Workflow = {
      id: '22b1f80c-2c12-4f82-bdd9-65d7b30712bb', reference: 'TK-7K4M2P9Q', status: 'draft', currentStage: 'setup', currentPouId: null, version: 1,
      setup: null, checkpoints: [], actions: [], referrals: [], safety: emptySafety,
      structuredReview: { reference: 'TK-7K4M2P9Q', setup: null, checkpoints: [], actions: [], referrals: [], createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', completedAt: null }, completedAt: null, createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
    }
    const setupAcknowledged: Workflow = { ...initial, status: 'in_progress', currentStage: 'pou-overview', currentPouId: 'whakapapa', version: 2, setup: { whanauReference: 'TW-04', engagementType: 'home-visit', sessionFocus: 'Support discussion', additionalNotes: null, immediateConcern: 'urgent' } }
    const safetyAcknowledged: Workflow = { ...setupAcknowledged, version: 3, safety: { ...emptySafety, observations: [{ id: 'f5a90392-fc8e-4f4c-a4d0-e54a8a210269', assessmentContext: 'setup', pouId: null, broadClass: 'whanau_safety', concernLevel: 'urgent', contextNote: null, status: 'active', currentRevision: 1, confirmedAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', retractedAt: null }], indicators: { ...emptySafety.indicators, activeObservationCount: 1, urgentObservationCount: 1, supervisorReviewRequired: true, supervisorNotificationRequired: true } } }
    let interaction = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: ++interaction === 1 ? setupAcknowledged : safetyAcknowledged, acknowledgement: { replayed: false } }) })))
    function Harness() { const [workflow, setWorkflow] = useState(initial); return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} /> }
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByPlaceholderText('e.g. TW-04'), 'TW-04')
    await user.type(screen.getByPlaceholderText('What was the purpose or focus of this engagement?'), 'Support discussion')
    await user.click(screen.getByRole('button', { name: /An immediate concern exists/i }))
    await user.click(screen.getByRole('button', { name: 'Record this as a safety concern' }))
    expect((screen.getByRole('button', { name: /Complete the fields above to continue/i }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByLabelText('Whānau safety'))
    await user.click(screen.getByRole('button', { name: /Uru atu ki te whare/i }))
    await screen.findByRole('heading', { name: /Ngā Pou o Te Waharoa/i })
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
    const first = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    const second = JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))
    expect(first.type).toBe('setup-confirmed')
    expect(second).toMatchObject({ type: 'safety-observation-confirmed', expectedVersion: 2, observation: { assessmentContext: 'setup', broadClass: 'whanau_safety', concernLevel: 'urgent' } })
  })

  it('shows authoritative urgent requirements in completed detail without reopening new safety controls', () => {
    const urgentSafety = {
      observations: [{ id: 'f5a90392-fc8e-4f4c-a4d0-e54a8a210269', assessmentContext: 'setup' as const, pouId: null, broadClass: 'whanau_safety' as const, concernLevel: 'urgent' as const, contextNote: 'Kaimahi-confirmed context.', status: 'active' as const, currentRevision: 1, confirmedAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', retractedAt: null }],
      requiredConsequences: [{ id: 'cd3792bc-8d39-4ca6-84c3-9306aa1b8c98', observationId: 'f5a90392-fc8e-4f4c-a4d0-e54a8a210269', type: 'supervisor_review_required' as const, requiredAt: '2026-08-10T00:00:00.000Z' }, { id: '346156a2-1c3a-4f41-9a77-8180832098d3', observationId: 'f5a90392-fc8e-4f4c-a4d0-e54a8a210269', type: 'supervisor_notification_required' as const, requiredAt: '2026-08-10T00:00:00.000Z' }],
      supervisorReviewRequests: [],
      indicators: { ...emptySafety.indicators, activeObservationCount: 1, urgentObservationCount: 1, supervisorReviewRequired: true, supervisorNotificationRequired: true },
    }
    const workflow: Workflow = {
      id: '22b1f80c-2c12-4f82-bdd9-65d7b30712bb', reference: 'TK-7K4M2P9Q', status: 'completed', currentStage: 'complete', currentPouId: null, version: 8,
      setup: { whanauReference: 'TW-04', engagementType: 'home-visit', sessionFocus: 'Support discussion', additionalNotes: null, immediateConcern: 'urgent' }, checkpoints: [], actions: [], referrals: [], safety: urgentSafety,
      structuredReview: { reference: 'TK-7K4M2P9Q', setup: null, checkpoints: [], actions: [], referrals: [], createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', completedAt: '2026-08-10T00:00:00.000Z' }, completedAt: '2026-08-10T00:00:00.000Z', createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
    }
    render(<SessionShell workflow={workflow} onWorkflowChange={() => undefined} displayName="Test Kaimahi" onDone={() => undefined} />)
    expect(screen.getByText('Supervisor review required')).toBeTruthy()
    expect(screen.getByText('Supervisor notification required. This has been recorded in Te Kaupapa. No notification has been sent yet.')).toBeTruthy()
    expect(screen.queryByText(/supervisor notified/i)).toBeNull()
    expect(screen.queryByText(/email sent/i)).toBeNull()
    expect(screen.queryByText(/escalation actioned/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'Correct safety concern' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retract safety concern' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record this as a safety concern' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Request supervisor review' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Add action/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Add referral/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Resume|Continue/i })).toBeNull()
  })

  it('shows a nonurgent canonical concern without deriving supervisor requirements', () => {
    const workflow = workflowFixture({
      currentStage: 'structured-review', currentPouId: null,
      safety: { ...emptySafety, observations: [activeObservation({ concernLevel: 'watch', broadClass: 'practice_quality' })] },
    })
    render(<SessionShell workflow={workflow} onWorkflowChange={() => undefined} displayName="Test Kaimahi" onDone={() => undefined} />)
    expect(screen.getByText('Safety concern · Practice quality · watch')).toBeTruthy()
    expect(screen.queryByText('Supervisor review required')).toBeNull()
    expect(screen.queryByText(/Supervisor notification required/)).toBeNull()
  })

  it('keeps a setup safety save visibly pending after its primary setup acknowledgement and retries only safety', async () => {
    const initial = workflowFixture({ status: 'draft', currentStage: 'setup', currentPouId: null, version: 1, setup: null })
    const setupAcknowledged = workflowFixture({ currentStage: 'pou-overview', currentPouId: 'whakapapa', version: 2 })
    const safetyAcknowledged = workflowFixture({ currentStage: 'pou-overview', currentPouId: 'whakapapa', version: 3, safety: { ...emptySafety, observations: [activeObservation()] } })
    let calls = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      calls += 1
      if (calls === 1) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: setupAcknowledged, acknowledgement: { replayed: false } }) })
      if (calls === 2) return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'persistence_unavailable' }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: safetyAcknowledged, acknowledgement: { replayed: false } }) })
    }))
    function Harness() { const [workflow, setWorkflow] = useState(initial); return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} /> }
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByPlaceholderText('e.g. TW-04'), 'TW-04')
    await user.type(screen.getByPlaceholderText('What was the purpose or focus of this engagement?'), 'Support discussion')
    await user.click(screen.getByRole('button', { name: /An immediate concern exists/i }))
    await user.click(screen.getByRole('button', { name: 'Record this as a safety concern' }))
    await user.click(screen.getByLabelText('Whānau safety'))
    await user.click(screen.getByRole('button', { name: /Uru atu ki te whare/i }))
    expect(await screen.findByText('A safety concern has not yet been saved.')).toBeTruthy()
    const failedSafetyCommand = String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3))
    expect(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body)).toBe(failedSafetyCommand)
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body)).type).toBe('safety-observation-confirmed')
    expect(screen.queryByText('A safety concern has not yet been saved.')).toBeNull()
  })

  it('corrects an active completed safety concern with its full current snapshot and keeps the workflow complete', async () => {
    const observation = activeObservation({ assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'practice_quality', concernLevel: 'watch', contextNote: 'Original note.', currentRevision: 4 })
    const initial = completedWorkflowWithSafety({ ...emptySafety, observations: [observation], indicators: { ...emptySafety.indicators, activeObservationCount: 1 } })
    const corrected = completedWorkflowWithSafety({ ...emptySafety, observations: [activeObservation({ ...observation, broadClass: 'practitioner_wellbeing', contextNote: 'Corrected note.', currentRevision: 5 })], indicators: { ...emptySafety.indicators, activeObservationCount: 1 } }, { version: 9 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ workflow: corrected, acknowledgement: { replayed: false } }) }))
    function Harness() { const [workflow, setWorkflow] = useState(initial); return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} /> }
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Correct safety concern' }))
    expect(screen.getByDisplayValue('Original note.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save correction' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByLabelText('Practitioner wellbeing'))
    await user.clear(screen.getByDisplayValue('Original note.'))
    await user.type(screen.getByLabelText('CONTEXT NOTE'), 'Corrected note.')
    await user.type(screen.getByLabelText('CORRECTION REASON'), 'Clarified after review')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1))
    const command = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    expect(command).toMatchObject({
      type: 'safety-observation-corrected', observationId: observation.id, expectedVersion: 8,
      expectedObservationRevision: 4, reason: 'Clarified after review',
      replacement: { assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'practitioner_wellbeing', concernLevel: 'watch', contextNote: 'Corrected note.' },
    })
    expect(command.idempotencyKey).toEqual(expect.any(String))
    expect(await screen.findByText('Safety concern · Practitioner wellbeing · watch')).toBeTruthy()
    expect(screen.getByText('Session complete')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Resume|Continue|Record this as a safety concern|Request supervisor review/i })).toBeNull()
  })

  it('retracts a completed concern with a reason and leaves retracted history without restore or correction controls', async () => {
    const observation = activeObservation({ currentRevision: 6 })
    const initial = completedWorkflowWithSafety({ ...emptySafety, observations: [observation], indicators: { ...emptySafety.indicators, activeObservationCount: 1 } })
    const retracted = completedWorkflowWithSafety({ ...emptySafety, observations: [activeObservation({ ...observation, status: 'retracted', currentRevision: 7, retractedAt: '2026-08-10T01:00:00.000Z' })], indicators: { ...emptySafety.indicators, activeObservationCount: 0, hasRetractedHistory: true } }, { version: 9 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ workflow: retracted, acknowledgement: { replayed: false } }) }))
    function Harness() { const [workflow, setWorkflow] = useState(initial); return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} /> }
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getAllByRole('button', { name: 'Retract safety concern' })[0]!)
    expect(screen.getByText('This will remain in the session history as a retracted concern.')).toBeTruthy()
    expect((screen.getAllByRole('button', { name: 'Retract safety concern' })[1] as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText('RETRACTION REASON'), 'Recorded in error')
    await user.click(screen.getAllByRole('button', { name: 'Retract safety concern' })[1]!)
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1))
    const command = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    expect(command).toMatchObject({ type: 'safety-observation-retracted', observationId: observation.id, expectedVersion: 8, expectedObservationRevision: 6, reason: 'Recorded in error' })
    expect(command.idempotencyKey).toEqual(expect.any(String))
    expect(await screen.findByText('Retracted concern retained in session history.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Correct safety concern' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Restore/i })).toBeNull()
    expect(screen.getByText('Session complete')).toBeTruthy()
  })

  it('invalidates a stale safety correction, reloads authoritative state, and does not replay it', async () => {
    const observation = activeObservation({ currentRevision: 2 })
    const initial = completedWorkflowWithSafety({ ...emptySafety, observations: [observation], indicators: { ...emptySafety.indicators, activeObservationCount: 1 } })
    const latest = completedWorkflowWithSafety({ ...emptySafety, observations: [activeObservation({ ...observation, currentRevision: 3, contextNote: 'Updated elsewhere.' })], indicators: { ...emptySafety.indicators, activeObservationCount: 1 } }, { version: 9 })
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'stale_safety_observation', currentRevision: 3 }) })
      expect(String(input)).toBe(`/api/workflows/${initial.id}`)
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: latest }) })
    }))
    function Harness() { const [workflow, setWorkflow] = useState(initial); return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} /> }
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Correct safety concern' }))
    await user.type(screen.getByLabelText('CORRECTION REASON'), 'Clarified after review')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    expect(await screen.findByText('This safety concern has changed. Reload the latest version before reviewing it again.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Reload latest' }))
    expect(await screen.findByText('Updated elsewhere.')).toBeTruthy()
    expect(screen.queryByLabelText('CORRECTION REASON')).toBeNull()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

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
      safety: emptySafety,
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
      safety: emptySafety,
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
