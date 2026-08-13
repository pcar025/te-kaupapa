import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WhakapapaNarrativeReview } from './KaimahiSession'

const workflowId = '11111111-1111-4111-8111-111111111111'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('WhakapapaNarrativeReview', () => {
  it('shows analysing without inventing a safety outcome while a transcript is being processed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ review: { status: 'analysing', draft: null, assessmentCompleted: false, hasReviewableCandidate: false } }), { status: 200 })))
    render(<WhakapapaNarrativeReview workflowId={workflowId} onDraftState={() => undefined} />)
    expect(await screen.findByText('Analysing your reflection…')).toBeTruthy()
    expect(screen.queryByText(/No additional safety concern/i)).toBeNull()
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
