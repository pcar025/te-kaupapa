import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PouSpecificationsApp from './PouSpecificationsApp'

const specification = {
  purpose: 'Understand the person’s whakapapa, identity, and whānau context.',
  openingReflectionQuestion: null,
  openingReflectionQuestionProvenance: null,
  conversationExplorationAreas: [{
    code: 'identity_context', label: 'Identity context', intent: 'Explore identity where it is meaningful.', explorationMode: 'core', conditionalTrigger: null,
    followUpGuidance: ['Invite clarification without assumptions.'], evidenceScope: 'current_conversation', sourceItemReferences: ['pou-1'],
  }],
  evidenceCriteria: [{
    criterionCode: 'identity_context', label: 'Identity context', description: 'Meaningful identity context is described.', evidenceScope: 'current_conversation', sourceItemReferences: ['pou-1'],
    strengthsOrProtective: true, areasForAttention: true, followUpGuidance: ['Clarify the context when needed.'], missingInformationCodes: ['identity_not_explored'], applicabilityRule: null,
  }],
  reviewSynthesisGuidance: ['Keep the wider story visible.'],
  safetyRuleReferences: [],
}

const draft = {
  id: 'b782ff42-d28e-429a-9596-d0bc9d5641f1', pouId: 'whakapapa', draftVersion: '0.2', revision: 1, approvedAt: null, activatedAt: null,
  specification, proposedSafetyRuleNotes: [], canApproveAndActivate: false,
  preview: {
    opening: null, openingStatus: 'sme_input_required' as const,
    conversationStart: 'Kia ora. We’re reflecting on Whakapapa.',
    conversationGuidance: { purpose: specification.purpose, explorationAreas: specification.conversationExplorationAreas, constraints: ['Do not infer missing information.'] },
    review: { criteria: specification.evidenceCriteria, synthesisGuidance: specification.reviewSynthesisGuidance }, safetyRuleReferences: [],
  },
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ specifications: [{ pouId: 'whakapapa', activeVersion: '0.1', activeStatus: 'approved_for_pilot', activeSpecification: specification, draft }] }) }))
})

afterEach(() => cleanup())

describe('SME Pou specification authoring controls', () => {
  it('shows the server-derived generic orientation while a draft opening is incomplete', async () => {
    const user = userEvent.setup()
    render(<PouSpecificationsApp profile={{ id: 'editor', displayName: 'Specification editor', organisation: { id: 'organisation', slug: 'organisation', name: 'Test organisation' }, roles: ['SPECIFICATION_EDITOR'] }} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Continue v0.2 draft' }))

    expect(screen.getByText('Opening reflection question not yet defined.')).toBeTruthy()
    expect(screen.getByText(/Kia ora\. We’re reflecting on Whakapapa\./)).toBeTruthy()
  })

  it('previews an SME-authored draft opening without making it live', async () => {
    const opening = 'What would be most helpful to begin with in this reflection?'
    const completedDraft = {
      ...draft,
      specification: { ...specification, openingReflectionQuestion: opening, openingReflectionQuestionProvenance: 'sme_authored' as const },
      preview: { ...draft.preview, opening, openingStatus: 'ready' as const, conversationStart: `Kia ora. We’re reflecting on Whakapapa. ${opening}` },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ specifications: [{ pouId: 'whakapapa', activeVersion: '0.1', activeStatus: 'approved_for_pilot', activeSpecification: specification, draft: completedDraft }] }) }))
    const user = userEvent.setup()
    render(<PouSpecificationsApp profile={{ id: 'editor', displayName: 'Specification editor', organisation: { id: 'organisation', slug: 'organisation', name: 'Test organisation' }, roles: ['SPECIFICATION_EDITOR'] }} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Continue v0.2 draft' }))

    expect(screen.getByDisplayValue(opening)).toBeTruthy()
    expect(screen.getByText(`Kia ora. We’re reflecting on Whakapapa. ${opening}`)).toBeTruthy()
    expect(screen.getByText('Working-draft revision 1. Compared with active v0.1; this is not live.')).toBeTruthy()
  })

  it('shows workshop-ready exploration, review, and separate safety information in Preview', async () => {
    const user = userEvent.setup()
    render(<PouSpecificationsApp profile={{ id: 'editor', displayName: 'Specification editor', organisation: { id: 'organisation', slug: 'organisation', name: 'Test organisation' }, roles: ['SPECIFICATION_EDITOR'] }} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Continue v0.2 draft' }))

    expect(screen.getByRole('heading', { name: 'What the conversation will explore' })).toBeTruthy()
    expect(screen.getAllByText('Explore identity where it is meaningful.').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Follow-up guidance')).toBeTruthy()
    expect(screen.getAllByText('Invite clarification without assumptions.').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('heading', { name: 'What the post-conversation review will look for' })).toBeTruthy()
    expect(screen.getAllByText('Meaningful identity context is described.').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Strength / protective factor').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Area for attention').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Information that may still need clarification')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Formal safety rules' })).toBeTruthy()
    expect(screen.getByText('No approved formal runtime safety rules are attached to this Pou.')).toBeTruthy()
  })

  it('describes textual exploration changes even when the active and draft counts match', async () => {
    const changedDraft = {
      ...draft,
      specification: {
        ...specification,
        conversationExplorationAreas: [{ ...specification.conversationExplorationAreas[0], followUpGuidance: ['Invite clarification with the person.'] }],
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ specifications: [{ pouId: 'whakapapa', activeVersion: '0.1', activeStatus: 'approved_for_pilot', activeSpecification: specification, draft: changedDraft }] }) }))
    const user = userEvent.setup()
    render(<PouSpecificationsApp profile={{ id: 'editor', displayName: 'Specification editor', organisation: { id: 'organisation', slug: 'organisation', name: 'Test organisation' }, roles: ['SPECIFICATION_EDITOR'] }} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Continue v0.2 draft' }))

    expect(screen.getByText('Working-draft revision 1. Compared with active v0.1; this is not live.')).toBeTruthy()
    expect(screen.getByText('Identity context has been updated.')).toBeTruthy()
  })

  it('uses full-width, comfortably resizable controls for authored text without widening short selects', async () => {
    const user = userEvent.setup()
    render(<PouSpecificationsApp profile={{ id: 'editor', displayName: 'Specification editor', organisation: { id: 'organisation', slug: 'organisation', name: 'Test organisation' }, roles: ['SPECIFICATION_EDITOR'] }} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Continue v0.2 draft' }))

    const multiLineControls = [
      screen.getByLabelText('Purpose'),
      screen.getByPlaceholderText('SME input required'),
      screen.getByLabelText('Exploration intent'),
      screen.getByLabelText('What good evidence looks like'),
      screen.getByLabelText('When information is missing (one code per line)'),
      screen.getByLabelText('Review guidance (one item per line)'),
      ...screen.getAllByLabelText('Follow-up guidance (one item per line)'),
    ]
    for (const control of multiLineControls) {
      expect(control.className).toContain('w-full')
      expect(control.className).toContain('min-h-28')
      expect(control.className).toContain('resize-y')
    }
    expect(screen.getByLabelText('Area').className).toContain('w-full')
    expect(screen.getByLabelText('Exploration approach').className).toContain('w-full sm:w-auto')
    expect(screen.getByLabelText('Evidence source').className).toContain('w-full sm:w-auto')
  })

  it('keeps Enter-created follow-up lines while editing and persists them only when Save draft is clicked', async () => {
    let persistedDraft = draft
    let savedContent: unknown
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        savedContent = JSON.parse(String(init.body)).content
        persistedDraft = {
          ...draft,
          revision: 2,
          specification: { ...specification, conversationExplorationAreas: (savedContent as { conversationExplorationAreas: typeof specification.conversationExplorationAreas }).conversationExplorationAreas },
        }
        return Promise.resolve({ ok: true, json: async () => ({ draft: persistedDraft }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ specifications: [{ pouId: 'whakapapa', activeVersion: '0.1', activeStatus: 'approved_for_pilot', activeSpecification: specification, draft: persistedDraft }] }) })
    }))
    const user = userEvent.setup()
    render(<PouSpecificationsApp profile={{ id: 'editor', displayName: 'Specification editor', organisation: { id: 'organisation', slug: 'organisation', name: 'Test organisation' }, roles: ['SPECIFICATION_EDITOR'] }} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Continue v0.2 draft' }))
    const followUp = screen.getAllByLabelText('Follow-up guidance (one item per line)')[0] as HTMLTextAreaElement
    await user.click(followUp)
    await user.keyboard('{End}{Enter}Ask what support would be helpful.')

    expect(followUp.value).toBe('Invite clarification without assumptions.\nAsk what support would be helpful.')
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(savedContent).toMatchObject({
      conversationExplorationAreas: [{ followUpGuidance: ['Invite clarification without assumptions.', 'Ask what support would be helpful.'] }],
    }))
    expect((screen.getAllByLabelText('Follow-up guidance (one item per line)')[0] as HTMLTextAreaElement).value).toBe('Invite clarification without assumptions.\nAsk what support would be helpful.')
  })
})
