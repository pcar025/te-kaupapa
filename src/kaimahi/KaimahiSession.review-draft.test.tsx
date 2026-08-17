import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { candidateConfirmationCommand, PouAssessmentCandidates, PouNarrativeReview, SinglePouReviewStage, WhakapapaNarrativeReview } from './KaimahiSession'
import { TE_WAHAROA_POU } from '../pou'

const workflowId = '11111111-1111-4111-8111-111111111111'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('WhakapapaNarrativeReview', () => {
  it('shows analysing without inventing a safety outcome while a transcript is being processed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ review: { status: 'analysing', draft: null, assessmentCompleted: false, hasReviewableCandidate: false } }), { status: 200 })))
    render(<WhakapapaNarrativeReview workflowId={workflowId} onDraftState={() => undefined} />)
    expect(await screen.findByText('Analysing your reflection…')).toBeTruthy()
    expect(screen.queryByText(/No additional safety concern/i)).toBeNull()
  })

  it('continues polling while review generation remains analysing, then reconciles the ready draft', async () => {
    vi.useFakeTimers()
    const readyDraft = {
      id: '22222222-2222-4222-8222-222222222222', revisionId: '33333333-3333-4333-8333-333333333333', revision: 1,
      overallSummary: 'Identity context was explored.', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: [], generatedAt: '2026-08-17T00:00:00.000Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ review: { status: 'analysing', draft: null, assessmentCompleted: false, hasReviewableCandidate: false } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ review: { status: 'analysing', draft: null, assessmentCompleted: true, hasReviewableCandidate: false } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ review: { status: 'ready', assessmentCompleted: true, hasReviewableCandidate: false, draft: readyDraft } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<WhakapapaNarrativeReview workflowId={workflowId} onDraftState={() => undefined} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('Analysing your reflection…')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(screen.getByText('Analysing your reflection…')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(screen.getByText(/WHAT WE HEARD — REVIEW DRAFT/i)).toBeTruthy()
    expect(screen.getByDisplayValue(readyDraft.overallSummary)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('caps automatic review polling and leaves a deliberate check-again recovery', async () => {
    vi.useFakeTimers()
    const analysing = () => new Response(JSON.stringify({ review: { status: 'analysing', draft: null, assessmentCompleted: false, hasReviewableCandidate: false } }), { status: 200 })
    const readyDraft = { id: '22222222-2222-4222-8222-222222222222', revisionId: '33333333-3333-4333-8333-333333333333', revision: 1, overallSummary: 'Authoritative review.', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: [], generatedAt: '2026-08-17T00:00:00.000Z' }
    let resolveManualRead: (response: Response) => void = () => undefined
    const manualRead = new Promise<Response>((resolve) => { resolveManualRead = resolve })
    let reviewReadCount = 0
    const fetchMock = vi.fn((path: string) => {
      if (String(path).endsWith('/reviewed')) return Promise.resolve(new Response(null, { status: 204 }))
      reviewReadCount += 1
      return reviewReadCount === 16 ? manualRead : Promise.resolve(analysing())
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WhakapapaNarrativeReview workflowId={workflowId} onDraftState={() => undefined} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    for (let poll = 1; poll < 15; poll += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    }
    expect(fetchMock).toHaveBeenCalledTimes(15)
    expect(screen.getByText(/Processing is still underway/i)).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    expect(fetchMock).toHaveBeenCalledTimes(15)

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(16)
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    expect(fetchMock).toHaveBeenCalledTimes(16)

    resolveManualRead(new Response(JSON.stringify({ review: { status: 'ready', assessmentCompleted: true, hasReviewableCandidate: false, draft: readyDraft } }), { status: 200 }))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByDisplayValue(readyDraft.overallSummary)).toBeTruthy()
  })

  it('ignores a stale review response after workflow navigation', async () => {
    let resolveFirstRead: (response: Response) => void = () => undefined
    const firstRead = new Promise<Response>((resolve) => { resolveFirstRead = resolve })
    const replacementWorkflowId = '55555555-5555-4555-8555-555555555555'
    const secondDraft = { id: '66666666-6666-4666-8666-666666666666', revisionId: '77777777-7777-4777-8777-777777777777', revision: 1, overallSummary: 'Current workflow review.', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: [], generatedAt: '2026-08-17T00:00:00.000Z' }
    const fetchMock = vi.fn((path: string) => {
      if (String(path).endsWith('/reviewed')) return Promise.resolve(new Response(null, { status: 204 }))
      return String(path).includes(workflowId)
        ? firstRead
        : Promise.resolve(new Response(JSON.stringify({ review: { status: 'ready', assessmentCompleted: true, hasReviewableCandidate: false, draft: secondDraft } }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = render(<WhakapapaNarrativeReview workflowId={workflowId} onDraftState={() => undefined} />)
    view.rerender(<WhakapapaNarrativeReview workflowId={replacementWorkflowId} onDraftState={() => undefined} />)
    expect(await screen.findByDisplayValue(secondDraft.overallSummary)).toBeTruthy()
    resolveFirstRead(new Response(JSON.stringify({ review: { status: 'analysing', draft: null, assessmentCompleted: false, hasReviewableCandidate: false } }), { status: 200 }))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByDisplayValue(secondDraft.overallSummary)).toBeTruthy()
    expect(screen.queryByText('Analysing your reflection…')).toBeNull()
  })

  it('resets the automatic polling budget after a failed read is deliberately retried', async () => {
    vi.useFakeTimers()
    const analysing = () => new Response(JSON.stringify({ review: { status: 'analysing', draft: null, assessmentCompleted: false, hasReviewableCandidate: false } }), { status: 200 })
    let reviewReadCount = 0
    const fetchMock = vi.fn(() => {
      reviewReadCount += 1
      return Promise.resolve(reviewReadCount === 16 ? new Response(JSON.stringify({ error: 'review_draft_unavailable' }), { status: 503 }) : analysing())
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WhakapapaNarrativeReview workflowId={workflowId} onDraftState={() => undefined} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    for (let poll = 1; poll < 15; poll += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(fetchMock).toHaveBeenCalledTimes(18)
  })

  it('does not apply a late review response after unmount', async () => {
    let resolveRead: (response: Response) => void = () => undefined
    const delayedRead = new Promise<Response>((resolve) => { resolveRead = resolve })
    vi.stubGlobal('fetch', vi.fn(() => delayedRead))
    const onDraftState = vi.fn()

    const view = render(<WhakapapaNarrativeReview workflowId={workflowId} onDraftState={onDraftState} />)
    view.unmount()
    resolveRead(new Response(JSON.stringify({ review: { status: 'analysing', draft: null, assessmentCompleted: false, hasReviewableCandidate: false } }), { status: 200 }))
    await act(async () => { await Promise.resolve() })
    expect(onDraftState).not.toHaveBeenCalled()
  })

  it('renders a noncanonical editable draft and a separate no-candidate completion notice', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ review: { status: 'ready', assessmentCompleted: true, hasReviewableCandidate: false, draft: { id: '22222222-2222-4222-8222-222222222222', revisionId: '33333333-3333-4333-8333-333333333333', revision: 1, overallSummary: 'Identity context was explored.', strengthsSummary: 'Whānau strengths were named.', areasForAttentionSummary: null, evidenceTurnIds: ['44444444-4444-4444-8444-444444444444'], generatedAt: '2026-08-13T00:00:00.000Z' } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<WhakapapaNarrativeReview workflowId={workflowId} onDraftState={() => undefined} />)
    expect(await screen.findByText(/WHAT WE HEARD — REVIEW DRAFT/i)).toBeTruthy()
    expect(screen.getByText(/No additional safety concern was suggested/i)).toBeTruthy()
    expect(screen.getByDisplayValue('Identity context was explored.')).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('44444444-4444-4444-8444-444444444444')
  })

  it('uses generic narrative headings for Manaakitanga rather than Whakapapa labels', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ review: { status: 'ready', assessmentCompleted: true, hasReviewableCandidate: false, draft: { id: '22222222-2222-4222-8222-222222222222', revisionId: '33333333-3333-4333-8333-333333333333', revision: 1, overallSummary: 'Duty of care was discussed.', strengthsSummary: null, areasForAttentionSummary: null, evidenceTurnIds: [], generatedAt: '2026-08-14T00:00:00.000Z' } } }), { status: 200 })))
    render(<PouNarrativeReview workflowId={workflowId} pouId="manaakitanga" onDraftState={() => undefined} />)
    expect(await screen.findByText('OVERALL REFLECTION')).toBeTruthy()
    expect(screen.getByText('STRENGTHS / PROTECTIVE FACTORS')).toBeTruthy()
    expect(screen.queryByText(/WHAKAPAPA — IDENTITY CONTEXT/i)).toBeNull()
  })

  it('shows structured review evidence without legacy mock findings or an always-on concern grid', async () => {
    const onMarkCarryForward = vi.fn()
    const draft = {
      id: '22222222-2222-4222-8222-222222222222', revisionId: '33333333-3333-4333-8333-333333333333', revision: 1,
      overallSummary: 'A bounded practitioner review.', strengthsSummary: null, areasForAttentionSummary: 'A grounded area to keep in view.', evidenceTurnIds: [], generatedAt: '2026-08-14T00:00:00.000Z',
      criterionAssessments: [
        { criterionCode: 'IDENTITY_CONTEXT', label: 'Identity and wider context', status: 'evidenced', evidenceTurnIds: [], strengthsOrProtective: false, areasForAttention: false },
        { criterionCode: 'WHANAU_STRENGTHS', label: 'Whānau strengths', status: 'evidenced', evidenceTurnIds: [], strengthsOrProtective: true, areasForAttention: false },
        { criterionCode: 'CULTURAL_CONNECTION', label: 'Cultural connection', status: 'not_explored', evidenceTurnIds: [], strengthsOrProtective: false, areasForAttention: true },
      ],
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ review: { status: 'ready', assessmentCompleted: true, hasReviewableCandidate: false, draft } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SinglePouReviewStage
      pouIdx={1}
      workflowId={workflowId}
      onConfirm={() => undefined}
      carryForwards={[]}
      onMarkCarryForward={onMarkCarryForward}
      onCandidateConfirm={() => undefined}
      persistenceState="idle"
      onRetry={() => undefined}
      onReload={() => undefined}
    />)
    expect(await screen.findByText('WHAT WAS ESTABLISHED')).toBeTruthy()
    expect(screen.getByText('Identity and wider context')).toBeTruthy()
    expect(screen.getAllByText('Whānau strengths')).toHaveLength(2)
    expect(screen.getAllByText('STRENGTHS / PROTECTIVE FACTORS')).toHaveLength(2)
    expect(screen.getByText('STILL TO EXPLORE / INFORMATION NEEDED')).toBeTruthy()
    expect(screen.getAllByText('Cultural connection')).toHaveLength(2)
    expect(screen.getAllByText('AREAS FOR ATTENTION')).toHaveLength(2)
    expect(screen.getByText('Not explored is not evidence that an issue is absent.')).toBeTruthy()
    expect(screen.queryByText(/Reflective prompts/i)).toBeNull()
    expect(screen.queryByText(/Safety flags/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Urgent' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Low' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Watch' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Action' })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Needs follow-up' })[0]!)
    expect(onMarkCarryForward).toHaveBeenCalledWith({ kind: 'review_criterion', reviewDraftRevisionId: draft.revisionId, criterionCode: 'CULTURAL_CONNECTION' })
  })

  it('keeps the Manaakitanga confirmation disabled until its reflection draft has loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)))
    render(<SinglePouReviewStage
      pouIdx={1}
      workflowId={workflowId}
      onConfirm={() => undefined}
      onCandidateConfirm={() => undefined}
      persistenceState="idle"
      onRetry={() => undefined}
      onReload={() => undefined}
    />)
    const confirmation = screen.getByRole('button', { name: 'Loading reflection review…' })
    expect((confirmation as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the Manaakitanga confirmation disabled when its reflection review cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'review_draft_unavailable' }), { status: 503 })))
    render(<SinglePouReviewStage
      pouIdx={1}
      workflowId={workflowId}
      onConfirm={() => undefined}
      onCandidateConfirm={() => undefined}
      persistenceState="idle"
      onRetry={() => undefined}
      onReload={() => undefined}
    />)
    expect(await screen.findByText(/reflection review could not be loaded/i)).toBeTruthy()
    const confirmation = screen.getByRole('button', { name: 'Loading reflection review…' })
    expect((confirmation as HTMLButtonElement).disabled).toBe(true)
  })

  it.each(TE_WAHAROA_POU)('smokes the normal manual-review confirmation path for $full without cross-Pou routing', async (pou) => {
    const pouIdx = TE_WAHAROA_POU.findIndex((candidate) => candidate.id === pou.id)
    const onConfirm = vi.fn()
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ review: { status: 'manual', draft: null, assessmentCompleted: false, hasReviewableCandidate: false } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SinglePouReviewStage
      pouIdx={pouIdx}
      workflowId={workflowId}
      onConfirm={onConfirm}
      onCandidateConfirm={() => undefined}
      persistenceState="idle"
      onRetry={() => undefined}
      onReload={() => undefined}
    />)
    expect(await screen.findByText(`Manual ${pou.reo} review`)).toBeTruthy()
    expect(screen.getByRole('heading', { name: pou.full })).toBeTruthy()
    const confirmation = screen.getByRole('button', { name: pouIdx < 6 ? `Whakaū — Confirm & continue to Pou ${pouIdx + 2}` : 'Whakaū — Confirm & review all seven Pou' })
    expect((confirmation as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(confirmation)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/pou/${pou.id}/review-draft`)
    cleanup()
  })

  it('passes the current Pou into an explicit candidate confirmation and never falls back to Whakapapa', async () => {
    const candidate = { id: '22222222-2222-4222-8222-222222222222', outcome: 'possible_concern' as const, title: 'Bounded candidate', description: 'Requires human review.', ruleCode: 'MANA_TEST_001', ruleVersion: 1, matchedProtectiveIndicatorCodes: [], matchedConcernIndicatorCodes: ['attention'], missingInformationCodes: [], permittedHumanConcernLevels: ['watch' as const], canonicalBroadClass: 'practice_quality' as const }
    const command = candidateConfirmationCommand(candidate, 'watch', 'manaakitanga', 7)
    expect(command?.observation).toMatchObject({ assessmentContext: 'pou', pouId: 'manaakitanga', broadClass: 'practice_quality', concernLevel: 'watch' })
    const onConfirm = vi.fn()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [candidate] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<PouAssessmentCandidates workflowId={workflowId} pouId="manaakitanga" onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Watch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm concern' }))
    expect(onConfirm).toHaveBeenCalledWith(candidate, 'watch', 'manaakitanga')
  })

  it('keeps manual review available when narrative generation failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ review: { status: 'failed', draft: null, assessmentCompleted: true, hasReviewableCandidate: true } }), { status: 200 })))
    render(<WhakapapaNarrativeReview workflowId={workflowId} onDraftState={() => undefined} />)
    expect(await screen.findByText(/could not be prepared/i)).toBeTruthy()
    expect(screen.getByText(/Manual Pou review remains available/i)).toBeTruthy()
  })

  it('keeps the saved one-word edit visible and reloads the authoritative edited revision', async () => {
    const generated = {
      id: '22222222-2222-4222-8222-222222222222', revisionId: '33333333-3333-4333-8333-333333333333', revision: 1,
      overallSummary: 'Identity context was explored.', strengthsSummary: 'Whānau strengths were named.', areasForAttentionSummary: null,
      evidenceTurnIds: ['44444444-4444-4444-8444-444444444444'], generatedAt: '2026-08-13T00:00:00.000Z',
    }
    const edited = { ...generated, revisionId: '55555555-5555-4555-8555-555555555555', revision: 2, overallSummary: 'Identity context was carefully explored.' }
    const response = (draft: typeof generated | typeof edited) => new Response(JSON.stringify({ review: { status: 'ready', assessmentCompleted: true, hasReviewableCandidate: false, draft } }), { status: 200 })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(generated))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ draft: edited }), { status: 200 }))
      .mockResolvedValueOnce(response(edited))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = render(<WhakapapaNarrativeReview workflowId={workflowId} onDraftState={() => undefined} />)
    const summary = await screen.findByDisplayValue(generated.overallSummary)
    fireEvent.change(summary, { target: { value: edited.overallSummary } })
    fireEvent.click(screen.getByRole('button', { name: 'Save review changes' }))
    expect(await screen.findByDisplayValue(edited.overallSummary)).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const [, saveOptions] = fetchMock.mock.calls[2]!
    expect(JSON.parse(saveOptions.body)).toMatchObject({ reviewDraftId: generated.id, expectedRevision: 1, overallSummary: edited.overallSummary })

    first.unmount()
    render(<WhakapapaNarrativeReview workflowId={workflowId} onDraftState={() => undefined} />)
    expect(await screen.findByDisplayValue(edited.overallSummary)).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
  })

  it('retains an unsaved edit and confirmation block when saving fails, then retries without losing the wording', async () => {
    const generated = {
      id: '22222222-2222-4222-8222-222222222222', revisionId: '33333333-3333-4333-8333-333333333333', revision: 1,
      overallSummary: 'Identity context was explored.', strengthsSummary: 'Whānau strengths were named.', areasForAttentionSummary: null,
      evidenceTurnIds: ['44444444-4444-4444-8444-444444444444'], generatedAt: '2026-08-13T00:00:00.000Z',
    }
    const edited = { ...generated, revisionId: '55555555-5555-4555-8555-555555555555', revision: 2, overallSummary: 'Identity context was carefully explored.' }
    const states = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ review: { status: 'ready', assessmentCompleted: true, hasReviewableCandidate: false, draft: generated } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'review_draft_unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ draft: edited }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const view = render(<WhakapapaNarrativeReview workflowId={workflowId} onDraftState={states} />)
    fireEvent.change(await view.findByDisplayValue(generated.overallSummary), { target: { value: edited.overallSummary } })
    fireEvent.click(view.getByRole('button', { name: 'Save review changes' }))
    expect(await view.findByText(/could not be saved/i)).toBeTruthy()
    expect(view.getByDisplayValue(edited.overallSummary)).toBeTruthy()
    expect(view.getByRole('button', { name: 'Save review changes' })).toBeTruthy()
    expect(states).toHaveBeenLastCalledWith({ reviewDraftRevisionId: generated.revisionId, hasUnsavedChanges: true, loaded: true })

    fireEvent.click(view.getByRole('button', { name: 'Try saving again' }))
    expect(await view.findByDisplayValue(edited.overallSummary)).toBeTruthy()
    await waitFor(() => expect(view.queryByText(/could not be saved/i)).toBeNull())
    expect(states).toHaveBeenLastCalledWith({ reviewDraftRevisionId: edited.revisionId, hasUnsavedChanges: false, loaded: true })
  })

  it('does not permit a second edit to be lost while the first save is pending', async () => {
    const generated = {
      id: '22222222-2222-4222-8222-222222222222', revisionId: '33333333-3333-4333-8333-333333333333', revision: 1,
      overallSummary: 'Identity context was explored.', strengthsSummary: 'Whānau strengths were named.', areasForAttentionSummary: null,
      evidenceTurnIds: ['44444444-4444-4444-8444-444444444444'], generatedAt: '2026-08-13T00:00:00.000Z',
    }
    const saved = { ...generated, revisionId: '55555555-5555-4555-8555-555555555555', revision: 2, overallSummary: 'Identity context was carefully explored.' }
    let resolveSave: (response: Response) => void = () => undefined
    const pendingSave = new Promise<Response>((resolve) => { resolveSave = resolve })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ review: { status: 'ready', assessmentCompleted: true, hasReviewableCandidate: false, draft: generated } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockReturnValueOnce(pendingSave)
    vi.stubGlobal('fetch', fetchMock)

    const view = render(<WhakapapaNarrativeReview workflowId={workflowId} onDraftState={() => undefined} />)
    const summary = await view.findByDisplayValue(generated.overallSummary)
    fireEvent.change(summary, { target: { value: saved.overallSummary } })
    fireEvent.click(view.getByRole('button', { name: 'Save review changes' }))
    expect(summary.hasAttribute('disabled')).toBe(true)

    resolveSave(new Response(JSON.stringify({ draft: saved }), { status: 200 }))
    expect(await view.findByDisplayValue(saved.overallSummary)).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Save review changes' })).toBeNull()
  })

  it('requires deliberate reconciliation after an acknowledgement-loss stale retry', async () => {
    const generated = {
      id: '22222222-2222-4222-8222-222222222222', revisionId: '33333333-3333-4333-8333-333333333333', revision: 1,
      overallSummary: 'Identity context was explored.', strengthsSummary: 'Whānau strengths were named.', areasForAttentionSummary: null,
      evidenceTurnIds: ['44444444-4444-4444-8444-444444444444'], generatedAt: '2026-08-13T00:00:00.000Z',
    }
    const edited = { ...generated, revisionId: '55555555-5555-4555-8555-555555555555', revision: 2, overallSummary: 'Identity context was carefully explored.' }
    const states = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ review: { status: 'ready', assessmentCompleted: true, hasReviewableCandidate: false, draft: generated } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      // Simulates a server commit whose acknowledgement was lost.
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'request_failed' }), { status: 503 }))
      // Retrying revision 1 is correctly stale because revision 2 now exists.
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'stale_review_draft', currentRevision: 2 }), { status: 409 }))
      // The first deliberate reconciliation read also has a transient failure.
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'review_draft_unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ review: { status: 'ready', assessmentCompleted: true, hasReviewableCandidate: false, draft: edited } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const view = render(<WhakapapaNarrativeReview workflowId={workflowId} onDraftState={states} />)
    fireEvent.change(await view.findByDisplayValue(generated.overallSummary), { target: { value: edited.overallSummary } })
    fireEvent.click(view.getByRole('button', { name: 'Save review changes' }))
    expect(await view.findByText(/could not be saved/i)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Try saving again' }))
    expect(await view.findByText(/could not confirm whether your changes were saved/i)).toBeTruthy()
    expect(view.getByDisplayValue(edited.overallSummary)).toBeTruthy()
    expect(states).toHaveBeenLastCalledWith({ reviewDraftRevisionId: generated.revisionId, hasUnsavedChanges: true, loaded: true })

    fireEvent.click(view.getByRole('button', { name: 'Load current saved review' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    expect(await view.findByText(/could not confirm whether your changes were saved/i)).toBeTruthy()
    expect(view.getByDisplayValue(edited.overallSummary)).toBeTruthy()
    expect(states).toHaveBeenLastCalledWith({ reviewDraftRevisionId: generated.revisionId, hasUnsavedChanges: true, loaded: true })

    fireEvent.click(view.getByRole('button', { name: 'Load current saved review' }))
    expect(await view.findByDisplayValue(edited.overallSummary)).toBeTruthy()
    await waitFor(() => expect(states).toHaveBeenLastCalledWith({ reviewDraftRevisionId: edited.revisionId, hasUnsavedChanges: false, loaded: true }))
  })
})
