import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkflowSynthesisStage } from './KaimahiSession'
import type { Workflow, WorkflowSynthesisState } from '../workflows'

const workflow: Workflow = {
  id: '4dff0e1d-5ec5-4c8f-b6ca-06a8c13ab9a1', reference: 'TK-SYNTHUX', status: 'in_progress', currentStage: 'pou-summary', currentPouId: null, version: 9,
  setup: { whanauReference: 'SYNTHETIC', engagementType: 'hui', sessionFocus: 'Synthetic synthesis UX proof', additionalNotes: null, immediateConcern: 'none' },
  readiness: { verbalConsentConfirmed: true, writtenConsentConfirmed: true, initialRiskAssessmentCompleted: true },
  checkpoints: ['kaitiakitanga', 'tikanga', 'whakapapa', 'manaakitanga', 'puukenga', 'haepapa', 'oranga'].map((pouId, ordinal) => ({ pouId: pouId as Workflow['checkpoints'][number]['pouId'], ordinal: ordinal + 1, progress: 'confirmed' as const, userSelectedConcern: null, note: null, referralSuggested: false, supervisorReviewSuggested: false, confirmedAt: '2026-09-28T00:00:00.000Z' })),
  actions: [], referrals: [], carryForwards: [], pouReviews: [], safety: { observations: [], requiredConsequences: [], supervisorReviewRequests: [], indicators: { activeObservationCount: 0, urgentObservationCount: 0, supervisorReviewRequired: false, supervisorNotificationRequired: false, manualReviewRequestCount: 0, hasRetractedHistory: false } },
  structuredReview: { reference: 'TK-SYNTHUX', setup: null, checkpoints: [], actions: [], referrals: [], carryForwards: [], pouReviews: [], createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', completedAt: null },
  completedAt: null, createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z',
}

const analysing: WorkflowSynthesisState = { status: 'analysing', synthesisId: '06913a1b-726a-4b1b-b85d-399c305a3d7e', draft: null, confirmedRevisionId: null, confirmedAt: null }
const notReady: WorkflowSynthesisState = { status: 'not_ready', synthesisId: null, draft: null, confirmedRevisionId: null, confirmedAt: null }
const failed: WorkflowSynthesisState = { status: 'failed', synthesisId: '06913a1b-726a-4b1b-b85d-399c305a3d7e', draft: null, confirmedRevisionId: null, confirmedAt: null }
const ready: WorkflowSynthesisState = {
  status: 'ready', synthesisId: '06913a1b-726a-4b1b-b85d-399c305a3d7e', confirmedRevisionId: null, confirmedAt: null,
  draft: { id: 'a2c0df29-2cdf-460c-b00f-ff9e30900b8b', revision: 1, source: 'generated', createdAt: '2026-09-28T00:00:00.000Z', content: { overallSummary: 'Ready without a false unavailable state.', keyThemes: null, strengthsSummary: null, areasForAttentionSummary: null, informationStillToExploreSummary: null, confirmedSafetyConcernsSummary: 'No human-confirmed safety concerns are recorded.' } },
}

function response(synthesis: WorkflowSynthesisState) {
  return new Response(JSON.stringify({ synthesis }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function renderStage() {
  return render(<WorkflowSynthesisStage workflow={workflow} onConfirm={() => undefined} persistenceState="idle" onRetry={() => undefined} onReload={() => undefined} />)
}

function synthesisRequests() {
  return vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/synthesis'))
}

function generationRequests() {
  return vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/synthesis/generate'))
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('WorkflowSynthesisStage preparation state', () => {
  it('keeps an initial not-ready synthesis in the normal preparation state while it starts generation once', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => Promise.resolve(String(input).endsWith('/synthesis/generate') ? response(analysing) : response(notReady))))

    renderStage()

    expect(await screen.findByRole('heading', { name: 'Preparing your synthesis' })).toBeTruthy()
    expect(screen.getByText('We’re bringing together the key themes from your seven Pou. This can take up to 30 seconds.')).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    await waitFor(() => expect(generationRequests()).toHaveLength(1))
  })

  it('automatically replaces an analysing state with the ready synthesis on the next bounded poll', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(analysing))
      .mockResolvedValueOnce(response(ready))
    vi.stubGlobal('fetch', fetchMock)

    renderStage()
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('heading', { name: 'Preparing your synthesis' })).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })

    expect(screen.getByDisplayValue('Ready without a false unavailable state.')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses the longer pending copy after 30 seconds while continuing bounded automatic checks', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response(analysing))))

    renderStage()
    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })

    expect(screen.getByRole('heading', { name: 'Still preparing your synthesis' })).toBeTruthy()
    expect(screen.getByText('It’s taking a little longer than usual. You can stay on this screen while we finish preparing it.')).toBeTruthy()
    expect(synthesisRequests().length).toBeGreaterThan(1)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('shows retry only for a real failure and allows the existing safe generation retry to reach ready state', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => Promise.resolve(String(input).endsWith('/synthesis/generate') ? response(ready) : response(failed)))
    vi.stubGlobal('fetch', fetchMock)

    renderStage()
    expect(await screen.findByRole('heading', { name: 'We couldn’t prepare your synthesis' })).toBeTruthy()
    await screen.findByRole('button', { name: 'Try again' }).then((button) => { button.click(); button.click() })

    expect(await screen.findByDisplayValue('Ready without a false unavailable state.')).toBeTruthy()
    expect(generationRequests()).toHaveLength(1)
  })

  it('retries a failed analysing poll as a read without starting another generation', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(analysing))
      .mockRejectedValueOnce(new Error('Synthetic read failure'))
      .mockResolvedValueOnce(response(ready))
    vi.stubGlobal('fetch', fetchMock)

    renderStage()
    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
    expect(screen.getByRole('heading', { name: 'We couldn’t prepare your synthesis' })).toBeTruthy()
    screen.getByRole('button', { name: 'Try again' }).click()

    await act(async () => { await Promise.resolve() })
    expect(screen.getByDisplayValue('Ready without a false unavailable state.')).toBeTruthy()
    expect(generationRequests()).toHaveLength(0)
  })

  it('renders an immediately-ready synthesis without a preparation or error fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response(ready))))

    renderStage()

    expect(await screen.findByDisplayValue('Ready without a false unavailable state.')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the pending status content available in the compact mobile viewport', async () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response(analysing))))

    renderStage()

    expect(await screen.findByRole('heading', { name: 'Preparing your synthesis' })).toBeTruthy()
    expect(screen.getByText('We’re bringing together the key themes from your seven Pou. This can take up to 30 seconds.')).toBeTruthy()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  })

  it('aborts its pending synthesis read and schedules no further polling after unmount', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => undefined)
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = renderStage()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000) })

    expect(signal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not duplicate the generation command in React Strict Mode', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => Promise.resolve(String(input).endsWith('/synthesis/generate') ? response(analysing) : response(notReady))))

    render(<StrictMode><WorkflowSynthesisStage workflow={workflow} onConfirm={() => undefined} persistenceState="idle" onRetry={() => undefined} onReload={() => undefined} /></StrictMode>)

    await waitFor(() => expect(generationRequests()).toHaveLength(1))
  })
})
