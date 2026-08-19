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

    await user.click(screen.getByRole('button', { name: 'Save Pou draft' }))
    await waitFor(() => expect(savedContent).toMatchObject({
      conversationExplorationAreas: [{ followUpGuidance: ['Invite clarification without assumptions.', 'Ask what support would be helpful.'] }],
    }))
    expect((screen.getAllByLabelText('Follow-up guidance (one item per line)')[0] as HTMLTextAreaElement).value).toBe('Invite clarification without assumptions.\nAsk what support would be helpful.')
  })

  it('requires explicit safety-policy choices instead of preselecting a mapping or human levels', async () => {
    const safetyDraft = { id: 'b782ff42-d28e-429a-9596-d0bc9d5641f2', pouId: 'whakapapa', draftVersion: '0.2', revision: 1, activatedAt: null, policy: { rules: [] }, canApproveAndActivate: false }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/safety-policy-drafts') return Promise.resolve({ ok: true, json: async () => ({ drafts: [], activePolicies: [] }) })
      if (url.endsWith('/safety-policy-drafts') && init?.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ draft: safetyDraft }) })
      return Promise.resolve({ ok: true, json: async () => ({ specifications: [{ pouId: 'whakapapa', activeVersion: '0.1', activeStatus: 'approved_for_pilot', activeSpecification: specification, draft }] }) })
    }))
    const user = userEvent.setup()
    render(<PouSpecificationsApp profile={{ id: 'editor', displayName: 'Specification editor', organisation: { id: 'organisation', slug: 'organisation', name: 'Test organisation' }, roles: ['SPECIFICATION_EDITOR'] }} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Continue v0.2 draft' }))
    await user.click(screen.getByRole('button', { name: 'Add proposed safety rule' }))
    await user.click(await screen.findByRole('button', { name: 'Add proposed safety rule' }))

    expect((screen.getByLabelText('Safety area') as HTMLSelectElement).value).toBe('')
    expect((screen.getByRole('checkbox', { name: 'possible concern' }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('checkbox', { name: 'Low' }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('button', { name: 'Save formal safety draft' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Approve and activate formal safety policy' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Choose the applicable candidate outcomes/)).toBeTruthy()
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => (options as RequestInit | undefined)?.method === 'PUT')).toBe(false)
  })

  it('keeps formal safety text fields visibly editable before focus', async () => {
    const safetyDraft = { id: 'b782ff42-d28e-429a-9596-d0bc9d5641f2', pouId: 'whakapapa', draftVersion: '0.2', revision: 1, activatedAt: null, policy: { rules: [] }, canApproveAndActivate: false }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/safety-policy-drafts') return Promise.resolve({ ok: true, json: async () => ({ drafts: [], activePolicies: [] }) })
      if (url.endsWith('/safety-policy-drafts') && init?.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ draft: safetyDraft }) })
      return Promise.resolve({ ok: true, json: async () => ({ specifications: [{ pouId: 'whakapapa', activeVersion: '0.1', activeStatus: 'approved_for_pilot', activeSpecification: specification, draft }] }) })
    }))
    const user = userEvent.setup()
    render(<PouSpecificationsApp profile={{ id: 'editor', displayName: 'Specification editor', organisation: { id: 'organisation', slug: 'organisation', name: 'Test organisation' }, roles: ['SPECIFICATION_EDITOR'] }} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Continue v0.2 draft' }))
    await user.click(screen.getByRole('button', { name: 'Add proposed safety rule' }))
    await user.click(await screen.findByRole('button', { name: 'Add proposed safety rule' }))

    for (const control of [
      screen.getByLabelText('Safety indicator — what would make you concerned?'),
      screen.getByLabelText('Why this matters'),
      screen.getByLabelText('Evidence required — what needs to be heard or established?'),
      screen.getByLabelText('Possible-concern indicators (one item per line)'),
      screen.getByLabelText('No-candidate evidence where appropriate (one item per line)'),
      screen.getByLabelText('What still needs to be explored (one item per line)'),
      screen.getByLabelText('When this rule applies (one item per line)'),
      screen.getByLabelText('When this rule does not apply (one item per line)'),
      screen.getByLabelText('Source / provenance notes (one item per line)'),
    ]) {
      expect(control.className).toContain('border')
      expect(control.className).toContain('w-full')
    }
    expect(screen.getByLabelText('Why this matters').className).toContain('resize-y')
  })

  it('shows inactive proposed safety policy changes separately from active policy', async () => {
    const safetyDraft = {
      id: 'b782ff42-d28e-429a-9596-d0bc9d5641f2', pouId: 'whakapapa', draftVersion: '0.2', revision: 1, activatedAt: null, canApproveAndActivate: false,
      policy: { rules: [{ id: 'rule', safetyIndicator: 'A bounded concern', whyThisMatters: '', evidenceRequired: ['A specific detail'], possibleConcernIndicators: ['A possible indicator'], noCandidateEvidence: ['A protective indicator'], missingInformation: ['Clarify context'], appliesWhen: ['When discussed'], doesNotApplyWhen: [], candidateOutcomes: ['possible_concern'], humanJudgement: { reportOnly: false, permittedLevels: ['watch'], broadClass: 'whanau_safety' }, evidenceScope: 'current_conversation', sourceNotes: ['Workshop note'] }] },
    }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === '/api/safety-policy-drafts') return Promise.resolve({ ok: true, json: async () => ({ drafts: [safetyDraft], activePolicies: [{ pouId: 'whakapapa', version: '0.1', ruleCount: 0 }] }) })
      return Promise.resolve({ ok: true, json: async () => ({ specifications: [{ pouId: 'whakapapa', activeVersion: '0.1', activeStatus: 'approved_for_pilot', activeSpecification: specification, draft }] }) })
    }))
    const user = userEvent.setup()
    render(<PouSpecificationsApp profile={{ id: 'editor', displayName: 'Specification editor', organisation: { id: 'organisation', slug: 'organisation', name: 'Test organisation' }, roles: ['SPECIFICATION_EDITOR'] }} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Continue v0.2 draft' }))
    await user.click(screen.getByText('Changes from active v0.1'))

    expect(screen.getByText(/1 proposed safety rule added — draft only, not active/)).toBeTruthy()
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent?.includes('Draft proposal includes: safety indicator, evidence requirement, possible-concern indicators') === true)).toBeTruthy()
    expect(screen.queryByText(/unchanged here/)).toBeNull()
  })

  it('keeps Pou and formal-safety save and activation requests on their separate routes', async () => {
    const safetyDraft = {
      id: 'b782ff42-d28e-429a-9596-d0bc9d5641f2', pouId: 'whakapapa', draftVersion: '0.2', revision: 1, activatedAt: null, canApproveAndActivate: false,
      policy: { rules: [{ id: 'rule', safetyIndicator: '', whyThisMatters: '', evidenceRequired: ['Evidence'], possibleConcernIndicators: [], noCandidateEvidence: ['Protective evidence'], missingInformation: [], appliesWhen: [], doesNotApplyWhen: [], candidateOutcomes: ['no_candidate_concern'], humanJudgement: { reportOnly: false, permittedLevels: [], broadClass: null }, evidenceScope: 'current_conversation', sourceNotes: [] }] },
    }
    const calls: Array<{ url: string; method?: string }> = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, method: init?.method })
      if (url === '/api/safety-policy-drafts') return Promise.resolve({ ok: true, json: async () => ({ drafts: [safetyDraft], activePolicies: [{ pouId: 'whakapapa', version: '0.1', ruleCount: 0 }] }) })
      if (url === `/api/pou-specification-drafts/${draft.id}`) return Promise.resolve({ ok: true, json: async () => ({ draft }) })
      if (url === `/api/safety-policy-drafts/${safetyDraft.id}`) return Promise.resolve({ ok: true, json: async () => ({ draft: safetyDraft }) })
      return Promise.resolve({ ok: true, json: async () => ({ specifications: [{ pouId: 'whakapapa', activeVersion: '0.1', activeStatus: 'approved_for_pilot', activeSpecification: specification, draft }] }) })
    }))
    const user = userEvent.setup()
    render(<PouSpecificationsApp profile={{ id: 'editor', displayName: 'Specification editor', organisation: { id: 'organisation', slug: 'organisation', name: 'Test organisation' }, roles: ['SPECIFICATION_EDITOR'] }} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Continue v0.2 draft' }))
    expect(screen.getByRole('button', { name: 'Approve & activate Pou specification' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve and activate formal safety policy' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save Pou draft' }))
    await waitFor(() => expect(calls.some((call) => call.url === `/api/pou-specification-drafts/${draft.id}` && call.method === 'PUT')).toBe(true))
    expect(calls.some((call) => call.url.includes('/safety-policy-drafts/') && call.method === 'POST')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Save formal safety draft' }))
    await waitFor(() => expect(calls.some((call) => call.url === `/api/safety-policy-drafts/${safetyDraft.id}` && call.method === 'PUT')).toBe(true))
    expect(calls.some((call) => call.url.endsWith('/approve-and-activate') && call.method === 'POST')).toBe(false)
  })
})
