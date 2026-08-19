import { describe, expect, it, vi } from 'vitest'

import { endConversation } from './api'

describe('conversation API end reconciliation', () => {
  it('aborts a hung end request after the bounded mobile cleanup timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      ;(init?.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetchMock)

    const ending = endConversation('8e1fde30-c4b6-492a-8862-32200b2661a9', 'navigation').then(
      () => null,
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(4_000)
    await expect(ending).resolves.toMatchObject({ name: 'AbortError' })
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true)
    vi.useRealTimers()
  })
})
