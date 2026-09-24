import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SupervisorEscalationsApp from './SupervisorEscalationsApp'

const profile = {
  id: 'supervisor-id', displayName: 'Assigned Supervisor',
  organisation: { id: 'organisation-id', slug: 'test', name: 'Test organisation' }, roles: ['SUPERVISOR' as const],
}

const listItem = {
  id: '4f7f6df9-babc-46d8-bf01-e88904723bca', workflowReference: 'TK-7K4M2P9Q',
  kaimahiDisplayName: 'Assigned Kaimahi', createdAt: '2026-09-23T00:00:00.000Z', status: 'provider_accepted',
}

afterEach(() => cleanup())

describe('SupervisorEscalationsApp', () => {
  it('keeps the exact score out of the list and renders it only after the assigned supervisor opens the read-only detail', async () => {
    const calls: Array<{ path: string; method?: string }> = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input); calls.push({ path, method: init?.method })
      if (path === '/api/phq9-escalations/assigned') return Promise.resolve({ ok: true, json: async () => ({ escalations: [listItem] }) })
      if (path === `/api/phq9-escalations/assigned/${listItem.id}`) return Promise.resolve({ ok: true, json: async () => ({ escalation: { ...listItem, confirmedTotalScore: 12, ruleCode: 'PHQ9_CONFIRMED_SCORE_GTE_12_SUPERVISOR_ESCALATION', ruleVersion: 1, contextSummary: 'Persisted Kaitiakitanga context only.' } }) })
      return Promise.resolve({ ok: false, json: async () => ({ error: 'not_found' }) })
    }))
    const user = userEvent.setup()
    render(<SupervisorEscalationsApp profile={profile} onBack={() => undefined} />)

    await screen.findByText('Supervisor review required')
    expect(screen.queryByText('12')).toBeNull()
    expect(screen.queryByText('Persisted Kaitiakitanga context only.')).toBeNull()
    expect(screen.getByText('Kaitiakitanga / PHQ-9', { exact: false })).toBeTruthy()
    expect(screen.getByText('Sent to email service')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /supervisor review required/i }))
    expect(await screen.findByText('CONFIRMED PHQ-9 TOTAL SCORE')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText(/Confirmed PHQ-9 total score ≥12 requires supervisor escalation/)).toBeTruthy()
    expect(screen.getByText('KAITIAKITANGA CONTEXT SUMMARY')).toBeTruthy()
    expect(screen.getByText('Persisted Kaitiakitanga context only.')).toBeTruthy()
    expect(calls).toEqual([
      { path: '/api/phq9-escalations/assigned', method: undefined },
      { path: `/api/phq9-escalations/assigned/${listItem.id}`, method: undefined },
    ])
  })

  it('does not poll or send a mutation when a detail is opened', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/phq9-escalations/assigned') return Promise.resolve({ ok: true, json: async () => ({ escalations: [listItem] }) })
      return Promise.resolve({ ok: true, json: async () => ({ escalation: { ...listItem, confirmedTotalScore: 12, ruleCode: 'PHQ9_CONFIRMED_SCORE_GTE_12_SUPERVISOR_ESCALATION', ruleVersion: 1, contextSummary: 'Persisted Kaitiakitanga context only.' } }) })
    }))
    const user = userEvent.setup()
    render(<SupervisorEscalationsApp profile={profile} onBack={() => undefined} />)
    await screen.findByText('Supervisor review required')
    await user.click(screen.getByRole('button', { name: /supervisor review required/i }))
    await screen.findByText('CONFIRMED PHQ-9 TOTAL SCORE')
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !(init as RequestInit | undefined)?.method)).toBe(true)
  })
})
