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
    setup: { whanauReference: 'TW-04', engagementType: 'home-visit', sessionFocus: 'Support discussion', additionalNotes: null, immediateConcern: 'none' }, checkpoints: [], actions: [], referrals: [], carryForwards: [], pouReviews: [], safety: emptySafety,
    structuredReview: { reference: 'TK-7K4M2P9Q', setup: null, checkpoints: [], actions: [], referrals: [], carryForwards: [], pouReviews: [], createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', completedAt: null }, completedAt: null, createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
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

const manualWhakapapaReview = { review: { status: 'manual', draft: null, assessmentCompleted: false, hasReviewableCandidate: false } }

function interactionCalls() {
  return vi.mocked(fetch).mock.calls.filter(([input, init]) => String(input).endsWith('/interactions') && (init as RequestInit | undefined)?.method === 'POST')
}

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
  it('keeps narrative Pou confirmation separate from formal safety and governance controls', async () => {
    const initial = workflowFixture()
    const acknowledged = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 3 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...manualWhakapapaReview, workflow: acknowledged, acknowledgement: { replayed: false } }) }))
    function Harness() { const [workflow, setWorkflow] = useState(initial); return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} /> }
    const user = userEvent.setup()
    render(<Harness />)
    await screen.findByText(/Manual Whakapapa review/i)
    expect(screen.queryByRole('button', { name: 'Urgent' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Request supervisor review/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: /Confirm & continue to Pou 2/i }))
    await waitFor(() => expect(interactionCalls()).toHaveLength(1))
    const command = JSON.parse(String(interactionCalls()[0]?.[1]?.body))
    expect(command).toMatchObject({ type: 'pou-review-confirmed' })
    expect(command.userSelectedConcern).toBeUndefined()
    expect(command.referralSuggested).toBeUndefined()
    expect(command.supervisorReviewSuggested).toBeUndefined()
    expect(command.type).not.toBe('safety-observation-confirmed')
    expect(command.type).not.toBe('supervisor-review-requested')
  })

  it('keeps an acknowledged review carry-forward on the same Pou review and restores it after reload', async () => {
    const initial = workflowFixture()
    const review = {
      status: 'ready' as const,
      assessmentCompleted: true,
      hasReviewableCandidate: false,
      draft: {
        id: 'cccd0d9f-24c2-4e86-9a02-5b95942539f1',
        revisionId: 'f90d0b5e-2794-4a1b-b719-2edc1861132b',
        revision: 1,
        overallSummary: 'Whakapapa and whānau connections were discussed.',
        strengthsSummary: 'Whānau connection is a protective factor.',
        areasForAttentionSummary: null,
        evidenceTurnIds: [],
        criterionAssessments: [{
          criterionCode: 'cultural_connection',
          label: 'Cultural connection',
          strengthsOrProtective: false,
          areasForAttention: false,
          status: 'insufficient_information' as const,
          evidenceTurnIds: [],
          missingInformationCodes: ['cultural_supports_not_explored'],
        }],
        generatedAt: '2026-08-17T00:00:00.000Z',
      },
    }
    const carriedForward = {
      id: '5e8b3ec9-3df0-43af-80fa-f5e24cbf51ae',
      pouId: 'whakapapa' as const,
      source: { kind: 'review_criterion' as const, reviewDraftRevisionId: review.draft.revisionId, criterionCode: 'cultural_connection' },
      note: null,
      createdAt: '2026-08-17T00:01:00.000Z',
    }
    // The canonical workflow deliberately remains at the overview until an
    // explicit Pou confirmation. The carry-forward itself is nonnavigational.
    const acknowledged = workflowFixture({ currentStage: 'pou-overview', currentPouId: 'whakapapa', version: 3, carryForwards: [carriedForward] })
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/review-draft')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ review }) })
      if (url.endsWith('/assessment-candidates')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ candidates: [] }) })
      if (url.endsWith('/reviewed')) return Promise.resolve({ ok: true, status: 204, json: async () => ({}) })
      if (url.endsWith('/interactions') && init?.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: acknowledged, acknowledgement: { replayed: false } }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: initial }) })
    }))
    function Harness() {
      const [workflow, setWorkflow] = useState(initial)
      return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} />
    }
    const user = userEvent.setup()
    render(<Harness />)

    expect(await screen.findByText('STILL TO EXPLORE / INFORMATION NEEDED')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Needs follow-up' }))
    await waitFor(() => expect(interactionCalls()).toHaveLength(1))
    const command = JSON.parse(String(interactionCalls()[0]?.[1]?.body))
    expect(command).toMatchObject({
      type: 'carry-forward-marked',
      pouId: 'whakapapa',
      source: { kind: 'review_criterion', reviewDraftRevisionId: review.draft.revisionId, criterionCode: 'cultural_connection' },
    })
    expect(await screen.findByText('WHAT WE HEARD — REVIEW DRAFT')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Carried forward' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /Ngā Pou o Te Waharoa/i })).toBeNull()
    expect(acknowledged.actions).toEqual([])
    expect(acknowledged.referrals).toEqual([])
    expect(acknowledged.pouReviews).toEqual([])
    expect(acknowledged.safety).toEqual(emptySafety)

    cleanup()
    render(<SessionShell workflow={acknowledged} onWorkflowChange={() => undefined} displayName="Test Kaimahi" onDone={() => undefined} />)
    expect(await screen.findByText('WHAT WE HEARD — REVIEW DRAFT')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Carried forward' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /Ngā Pou o Te Waharoa/i })).toBeNull()
  })

  it('shows only the approved manual Low/Watch/Action safety path after a deliberate human choice', async () => {
    const initial = workflowFixture()
    const pouAcknowledged = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 3 })
    const safetyAcknowledged = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 4, safety: { ...emptySafety, observations: [{ id: 'e73e9be5-7247-4fb4-a745-5b0e24e86e30', assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'practice_quality', concernLevel: 'action', contextNote: null, status: 'active', currentRevision: 1, confirmedAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', retractedAt: null }], indicators: { ...emptySafety.indicators, activeObservationCount: 1 } } })
    let calls = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve({ ok: true, status: 200, json: async () => init?.method === 'POST' ? ({ workflow: ++calls === 1 ? pouAcknowledged : safetyAcknowledged, acknowledgement: { replayed: false } }) : manualWhakapapaReview })))
    function Harness() { const [workflow, setWorkflow] = useState(initial); return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} /> }
    const user = userEvent.setup()
    render(<Harness />)
    await screen.findByText(/Manual Whakapapa review/i)
    expect(screen.queryByRole('button', { name: 'Low' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Record this as a safety concern' }))
    expect(screen.getByRole('button', { name: 'Low' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Watch' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Action' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Urgent' })).toBeNull()
    expect(screen.getByRole('button', { name: /Confirm & continue to Pou 2/i }).hasAttribute('disabled')).toBe(false)
    await user.click(screen.getByRole('button', { name: /Confirm & continue to Pou 2/i }))
    expect(interactionCalls()).toHaveLength(0)
    await user.click(screen.getByLabelText('Practice quality'))
    await user.click(screen.getByRole('button', { name: 'Action' }))
    await user.click(screen.getByRole('button', { name: /Confirm & continue to Pou 2/i }))
    await waitFor(() => expect(interactionCalls()).toHaveLength(2))
    const first = JSON.parse(String(interactionCalls()[0]?.[1]?.body))
    const second = JSON.parse(String(interactionCalls()[1]?.[1]?.body))
    expect(first.type).toBe('pou-review-confirmed')
    expect(second).toMatchObject({ type: 'safety-observation-confirmed', expectedVersion: 3, observation: { assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'practice_quality', concernLevel: 'action' } })
  })

  it('keeps a failed opted-in Pou safety save visible and retries only the same safety command', async () => {
    const initial = workflowFixture()
    const pouAcknowledged = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 3 })
    const safetyAcknowledged = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 4, safety: { ...emptySafety, observations: [{ id: 'e73e9be5-7247-4fb4-a745-5b0e24e86e30', assessmentContext: 'pou', pouId: 'whakapapa', broadClass: 'whanau_safety', concernLevel: 'watch', contextNote: null, status: 'active', currentRevision: 1, confirmedAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', retractedAt: null }], indicators: { ...emptySafety.indicators, activeObservationCount: 1 } } })
    let calls = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => manualWhakapapaReview })
      calls += 1
      if (calls === 1) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: pouAcknowledged, acknowledgement: { replayed: false } }) })
      if (calls === 2) return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'persistence_unavailable' }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: safetyAcknowledged, acknowledgement: { replayed: false } }) })
    }))
    function Harness() { const [workflow, setWorkflow] = useState(initial); return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} /> }
    const user = userEvent.setup()
    render(<Harness />)
    await screen.findByText(/Manual Whakapapa review/i)
    await user.click(screen.getByRole('button', { name: 'Record this as a safety concern' }))
    await user.click(screen.getByLabelText('Whānau safety'))
    await user.click(screen.getByRole('button', { name: 'Watch' }))
    await user.click(screen.getByRole('button', { name: /Confirm & continue to Pou 2/i }))
    expect(await screen.findByText('A safety concern has not yet been saved.')).toBeTruthy()
    const failedSafetyCommand = String(interactionCalls()[1]?.[1]?.body)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(interactionCalls()).toHaveLength(3))
    expect(JSON.parse(String(interactionCalls()[2]?.[1]?.body)).type).toBe('safety-observation-confirmed')
    expect(String(interactionCalls()[2]?.[1]?.body)).toBe(failedSafetyCommand)
    expect(screen.queryByText('A safety concern has not yet been saved.')).toBeNull()
  })

  it('does not create a safety concern from an urgent setup selection without explicit confirmation', async () => {
    const initial: Workflow = {
      id: '22b1f80c-2c12-4f82-bdd9-65d7b30712bb', reference: 'TK-7K4M2P9Q', status: 'draft', currentStage: 'setup', currentPouId: null, version: 1,
      setup: null, checkpoints: [], actions: [], referrals: [], carryForwards: [], pouReviews: [], safety: emptySafety,
      structuredReview: { reference: 'TK-7K4M2P9Q', setup: null, checkpoints: [], actions: [], referrals: [], carryForwards: [], pouReviews: [], createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', completedAt: null }, completedAt: null, createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
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
      setup: null, checkpoints: [], actions: [], referrals: [], carryForwards: [], pouReviews: [], safety: emptySafety,
      structuredReview: { reference: 'TK-7K4M2P9Q', setup: null, checkpoints: [], actions: [], referrals: [], carryForwards: [], pouReviews: [], createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', completedAt: null }, completedAt: null, createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
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
      setup: { whanauReference: 'TW-04', engagementType: 'home-visit', sessionFocus: 'Support discussion', additionalNotes: null, immediateConcern: 'urgent' }, checkpoints: [], actions: [], referrals: [], carryForwards: [], pouReviews: [], safety: urgentSafety,
      structuredReview: { reference: 'TK-7K4M2P9Q', setup: null, checkpoints: [], actions: [], referrals: [], carryForwards: [], pouReviews: [], createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', completedAt: '2026-08-10T00:00:00.000Z' }, completedAt: '2026-08-10T00:00:00.000Z', createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
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
    await waitFor(() => expect(interactionCalls()).toHaveLength(1))
    const command = JSON.parse(String(interactionCalls()[0]?.[1]?.body))
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
    await waitFor(() => expect(interactionCalls()).toHaveLength(1))
    const command = JSON.parse(String(interactionCalls()[0]?.[1]?.body))
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
      if (String(input).endsWith('/final-record')) return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'not_found' }) })
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
    expect(interactionCalls()).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('uses the acknowledged synthesis confirmation and waits for the real post-Pou transition', async () => {
    const checkpoints = ['whakapapa', 'manaakitanga', 'tikanga', 'kaitiakitanga', 'puukenga', 'haepapa', 'oranga'].map((pouId, index) => ({
      pouId: pouId as Workflow['checkpoints'][number]['pouId'], ordinal: index + 1, progress: 'confirmed' as const,
      userSelectedConcern: index === 1 ? 'action' as const : 'low' as const,
      note: index === 1 ? 'A Kaimahi-confirmed note.' : null, referralSuggested: false, supervisorReviewSuggested: false,
      confirmedAt: '2026-08-10T00:00:00.000Z',
    }))
    const pouReviews = checkpoints.map((checkpoint) => ({
      pouId: checkpoint.pouId,
      overallSummary: checkpoint.pouId === 'manaakitanga' ? 'A Kaimahi-confirmed review.' : null,
      strengthsSummary: null,
      areasForAttentionSummary: null,
      confirmedAt: checkpoint.confirmedAt,
    }))
    const initial: Workflow = {
      id: '22b1f80c-2c12-4f82-bdd9-65d7b30712bb', reference: 'TK-7K4M2P9Q', status: 'in_progress',
      currentStage: 'pou-summary', currentPouId: null, version: 9,
      setup: { whanauReference: 'TW-04', engagementType: 'home-visit', sessionFocus: 'Whānau support discussion', additionalNotes: null, immediateConcern: 'none' },
      checkpoints, actions: [], referrals: [], carryForwards: [], pouReviews, completedAt: null,
      safety: emptySafety,
      structuredReview: { reference: 'TK-7K4M2P9Q', setup: null, checkpoints, actions: [], referrals: [], carryForwards: [], pouReviews, createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', completedAt: null },
      createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
    }
    const acknowledged: Workflow = { ...initial, currentStage: 'action-planning', version: 10, structuredReview: { ...initial.structuredReview, setup: initial.setup } }
    const synthesis = {
      status: 'ready' as const,
      synthesisId: '37c15be7-6a5b-4f42-8a84-a4c5a624c9d9',
      draft: {
        id: 'd20237e9-2a21-47b2-acb4-501e3c766aea', revision: 1, source: 'generated' as const,
        content: {
          overallSummary: 'A Kaimahi-confirmed review.', keyThemes: null, strengthsSummary: null,
          areasForAttentionSummary: null, informationStillToExploreSummary: null,
          confirmedSafetyConcernsSummary: 'No human-confirmed safety concerns are recorded.',
        },
        createdAt: '2026-08-10T00:00:00.000Z',
      },
      confirmedRevisionId: null, confirmedAt: null,
    }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/synthesis')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ synthesis }) })
      if (url.endsWith('/interactions')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: acknowledged, acknowledgement: { replayed: false } }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: initial }) })
    }))
    function Harness() {
      const [workflow, setWorkflow] = useState(initial)
      return <SessionShell workflow={workflow} onWorkflowChange={setWorkflow} displayName="Test Kaimahi" onDone={() => undefined} />
    }
    const user = userEvent.setup()
    render(<Harness />)

    expect(await screen.findByText('A Kaimahi-confirmed review.')).toBeTruthy()
    expect(screen.queryByText(/Persistent low mood and sleep disruption/i)).toBeNull()
    await user.click(screen.getByRole('button', { name: /Confirm synthesis/i }))
    expect(await screen.findByRole('heading', { name: /Decide what to carry forward/i })).toBeTruthy()
    expect(screen.getByText(/No follow-up items have been carried forward/i)).toBeTruthy()
    expect(JSON.parse(String(interactionCalls()[0]?.[1]?.body))).toMatchObject({ type: 'workflow-synthesis-confirmed', synthesisRevisionId: synthesis.draft.id })
  })

  it('shows the complete confirmed canonical record before finalisation', async () => {
    const workflow = workflowFixture({
      currentStage: 'record-review', currentPouId: null,
      actions: [{ id: '24c30b9f-7161-4e2e-844b-84daee3eedb4', pouId: 'whakapapa', title: 'Arrange a reconnection kōrero', type: 'follow-up', dueDate: '2026-08-22', status: 'open', notes: null, withdrawnAt: null, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z' }],
      referrals: [{ id: 'b5bca508-eef0-4a03-9c07-f6c848af6afc', pouId: 'manaakitanga', destinationCode: null, destinationName: 'Whānau support service', reason: 'Requested support', handoverNote: null, notes: null, status: 'prepared', withdrawnAt: null, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z' }],
      safety: { ...emptySafety, observations: [activeObservation({ assessmentContext: 'pou', pouId: 'kaitiakitanga', concernLevel: 'action', contextNote: 'Human-confirmed safety context.' })], indicators: { ...emptySafety.indicators, activeObservationCount: 1 } },
    })
    const synthesis = {
      status: 'confirmed' as const, synthesisId: '67d17022-0a67-4f22-a38d-ca9301fa8ec4', confirmedRevisionId: 'c23da767-133e-4201-adc0-8af4316a0bbd', confirmedAt: '2026-08-18T00:00:00.000Z',
      draft: { id: 'c23da767-133e-4201-adc0-8af4316a0bbd', revision: 2, source: 'edited' as const, createdAt: '2026-08-18T00:00:00.000Z', content: {
        overallSummary: 'Confirmed engagement summary.', keyThemes: 'Whānau connection.', strengthsSummary: 'Strong relationships.', areasForAttentionSummary: 'Connection needs attention.', informationStillToExploreSummary: 'Support options remain to explore.', confirmedSafetyConcernsSummary: 'One human-confirmed concern is recorded.',
      } },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ synthesis }) }))
    render(<SessionShell workflow={workflow} onWorkflowChange={() => undefined} displayName="Test Kaimahi" onDone={() => undefined} />)
    expect(await screen.findByText('Confirmed engagement summary.')).toBeTruthy()
    expect(screen.getByText('Whānau connection.')).toBeTruthy()
    expect(screen.getByText('Strong relationships.')).toBeTruthy()
    expect(screen.getByText('Connection needs attention.')).toBeTruthy()
    expect(screen.getByText('Support options remain to explore.')).toBeTruthy()
    expect(screen.getByText('One human-confirmed concern is recorded.')).toBeTruthy()
    expect(screen.getByText('Human-confirmed safety context.')).toBeTruthy()
    expect(screen.getByText(/Whakapapa & Identity Safety — Arrange a reconnection kōrero — open — due 2026-08-22/)).toBeTruthy()
    expect(screen.getByText(/Manaakitanga & Duty of Care — Whānau support service — Requested support — prepared/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Finalise record and complete session/i })).toBeTruthy()
  })

  it('shows only bounded Pou and source labels for carried-forward review items', () => {
    const workflow = workflowFixture({
      currentStage: 'action-planning',
      currentPouId: null,
      carryForwards: [{
        id: 'e22f4aa5-89fd-45e6-8a80-7a5fe2c7e3ad',
        pouId: 'manaakitanga',
        source: {
          kind: 'review_criterion',
          reviewDraftRevisionId: '5ef4780b-4e6c-4c6a-8eb7-2fc7dfa4c8c1',
          criterionCode: 'whanau_support',
        },
        presentation: {
          title: 'Whānau support needs further exploration',
          sourceLabel: 'Still to explore / information needed',
        },
        note: null,
        createdAt: '2026-08-16T00:00:00.000Z',
      }],
    })
    render(<SessionShell workflow={workflow} onWorkflowChange={() => undefined} displayName="Test Kaimahi" onDone={() => undefined} />)

    expect(screen.getByText('Manaakitanga')).toBeTruthy()
    expect(screen.getByText('Whānau support needs further exploration')).toBeTruthy()
    expect(screen.getByText('Source: Still to explore / information needed')).toBeTruthy()
    expect(screen.getByText(/not yet an action, referral, safety concern, escalation, or supervisor-review request/i)).toBeTruthy()
    expect(screen.queryByText(/review item/i)).toBeNull()
    expect(screen.queryByText(/Synthetic Whakapapa reflection with strength/i)).toBeNull()
  })

  it('uses canonical confirmed narrative reviews rather than retired checkpoint concern fields in structured review', () => {
    const checkpoints: Workflow['checkpoints'] = [{
      pouId: 'whakapapa', ordinal: 1, progress: 'confirmed', userSelectedConcern: null,
      note: null, referralSuggested: false, supervisorReviewSuggested: false,
      confirmedAt: '2026-08-16T00:00:00.000Z',
    }]
    const pouReviews: Workflow['pouReviews'] = [{
      pouId: 'whakapapa',
      overallSummary: 'The Kaimahi-confirmed Whakapapa narrative.',
      strengthsSummary: 'Whānau connection.',
      areasForAttentionSummary: 'Return to identity context.',
      confirmedAt: '2026-08-16T00:00:00.000Z',
    }]
    const workflow = workflowFixture({
      currentStage: 'structured-review',
      currentPouId: null,
      checkpoints,
      pouReviews,
      structuredReview: {
        reference: 'TK-7K4M2P9Q',
        setup: workflowFixture().setup,
        checkpoints,
        actions: [],
        referrals: [],
        carryForwards: [],
        pouReviews,
        createdAt: '2026-08-16T00:00:00.000Z',
        updatedAt: '2026-08-16T00:00:00.000Z',
        completedAt: null,
      },
    })
    render(<SessionShell workflow={workflow} onWorkflowChange={() => undefined} displayName="Test Kaimahi" onDone={() => undefined} />)

    expect(screen.getByText('Whakapapa — Confirmed')).toBeTruthy()
    expect(screen.getByText('The Kaimahi-confirmed Whakapapa narrative.')).toBeTruthy()
    expect(screen.queryByText('Not confirmed')).toBeNull()
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

  it('opens the existing completed-record archive from Kāinga without mixing completed work into saved reflections', async () => {
    const completed = completedWorkflowWithSafety(emptySafety, {
      id: '9e2f895d-5487-493f-98cd-016fb808fe11', reference: 'TK-5JC3PX9K',
      completedAt: '2026-08-18T20:02:52.820Z', updatedAt: '2026-08-18T20:02:52.820Z',
    })
    const finalRecord = {
      id: '1c4f32e3-2bb8-44a1-8485-4090b1593564', reference: completed.reference, organisationName: 'Test organisation', kaimahiDisplayName: 'Test user',
      overallSummary: 'Bounded immutable final record.', keyThemes: null, strengthsSummary: null, areasForAttentionSummary: null, informationStillToExploreSummary: null,
      confirmedSafetyConcernsSummary: 'No human-confirmed safety concerns are recorded.', actions: [], referrals: [], safetyObservations: [], finalizedAt: completed.completedAt!,
    }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/workflows?status=resumable') return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [] }) })
      if (url === '/api/workflows?status=completed') return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [{ id: completed.id, reference: completed.reference, whanauReference: null, completedAt: completed.completedAt, updatedAt: completed.updatedAt, safetyIndicators: emptySafety.indicators }] }) })
      if (url === `/api/workflows/${completed.id}`) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: completed }) })
      if (url === `/api/workflows/${completed.id}/final-record`) return Promise.resolve({ ok: true, status: 200, json: async () => ({ record: finalRecord }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ profile: {
        id: 'test-user', displayName: 'Test user', organisation: { id: 'test-org', slug: 'test', name: 'Test organisation' }, roles: ['KAIMAHI'],
      } }) })
    }))
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Kaimahi — Tīmata Kōrero' }))
    expect(await screen.findByRole('button', { name: /Tohu — Session records/i })).toBeTruthy()
    expect(screen.queryByText(/Open saved reflection/i)).toBeNull()
    await user.click(screen.getByRole('button', { name: /Tohu — Session records/i }))

    expect(await screen.findByRole('heading', { name: 'Ngā Tohu' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: new RegExp(completed.reference) }))
    expect(await screen.findByText('Kua oti')).toBeTruthy()
    expect(await screen.findByText('Bounded immutable final record.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Download PDF' }).getAttribute('href')).toBe(`/api/workflows/${completed.id}/final-record.pdf`)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/workflows?status=completed', expect.anything())
    expect(vi.mocked(fetch).mock.calls.some(([input, init]) => String(input).endsWith('/interactions') && (init as RequestInit | undefined)?.method === 'POST')).toBe(false)
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

  it('starts an independent reflection without changing the existing resumable workflow', async () => {
    const existing = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 3 })
    const fresh = workflowFixture({
      id: '93ee2ae3-5c8b-4d0d-9f78-2a9cf7b05750', reference: 'TK-NEWREFL', status: 'draft', currentStage: 'setup', currentPouId: null, version: 1,
      setup: null, checkpoints: [], actions: [], referrals: [], safety: emptySafety,
    })
    let resumableListRequests = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/workflows?status=resumable') {
        resumableListRequests += 1
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: resumableListRequests === 1
          ? [{ ...existing, whanauReference: 'TW-04' }]
          : [{ ...fresh, whanauReference: null }, { ...existing, whanauReference: 'TW-04' }],
        }) })
      }
      if (url === '/api/workflows?status=completed') return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [] }) })
      if (url === `/api/workflows/${existing.id}`) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: existing }) })
      if (url === '/api/workflows' && init?.method === 'POST') return Promise.resolve({ ok: true, status: 201, json: async () => ({ workflow: fresh, acknowledgement: { replayed: false } }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ profile: {
        id: 'test-user', displayName: 'Test user', organisation: { id: 'test-org', slug: 'test', name: 'Test organisation' }, roles: ['KAIMAHI'],
      } }) })
    }))
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Kaimahi — Tīmata Kōrero' }))
    await screen.findByText('SESSION IN PROGRESS')
    await user.click(screen.getByRole('button', { name: /Start a new reflection/i }))

    expect(await screen.findByRole('heading', { name: /Pause at the entrance/i })).toBeTruthy()
    const create = vi.mocked(fetch).mock.calls.find(([input, init]) => String(input) === '/api/workflows' && init?.method === 'POST')
    expect(create?.[0]).toBe('/api/workflows')
    expect(JSON.parse(String(create?.[1]?.body)).idempotencyKey).toMatch(/[0-9a-f-]{36}/)
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input) === `/api/workflows/${existing.id}`)).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input) === `/api/workflows/${existing.id}/interactions`)).toBe(false)
  })

  it('opens an acknowledged new reflection when the follow-up resumable-list refresh is unavailable', async () => {
    const existing = workflowFixture({ currentStage: 'pou-convo', currentPouId: 'manaakitanga', version: 3 })
    const fresh = workflowFixture({
      id: '1d2634e2-35e9-4f26-9f8e-ae3cc0c04525', reference: 'TK-RETRYNEW', status: 'draft', currentStage: 'setup', currentPouId: null, version: 1,
      setup: null, checkpoints: [], actions: [], referrals: [], safety: emptySafety,
    })
    let resumableListRequests = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/workflows?status=resumable') {
        resumableListRequests += 1
        if (resumableListRequests > 1) return Promise.reject(new Error('network unavailable'))
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [{ ...existing, whanauReference: 'TW-04' }] }) })
      }
      if (url === '/api/workflows?status=completed') return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [] }) })
      if (url === `/api/workflows/${existing.id}`) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow: existing }) })
      if (url === '/api/workflows' && init?.method === 'POST') return Promise.resolve({ ok: true, status: 201, json: async () => ({ workflow: fresh, acknowledgement: { replayed: false } }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ profile: {
        id: 'test-user', displayName: 'Test user', organisation: { id: 'test-org', slug: 'test', name: 'Test organisation' }, roles: ['KAIMAHI'],
      } }) })
    }))
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Kaimahi — Tīmata Kōrero' }))
    await user.click(await screen.findByRole('button', { name: /Start a new reflection/i }))

    expect(await screen.findByRole('heading', { name: /Pause at the entrance/i })).toBeTruthy()
    expect(screen.queryByText(/Couldn’t save/i)).toBeNull()
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
