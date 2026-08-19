import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  callbacks: {} as Record<string, ((...args: never[]) => void) | undefined>,
  startSession: vi.fn(),
  endSession: vi.fn(),
}))

vi.mock('@elevenlabs/react', () => ({
  ConversationProvider: ({ children, ...callbacks }: { children: React.ReactNode }) => {
    sdk.callbacks = callbacks as typeof sdk.callbacks
    return children
  },
  useConversationControls: () => ({ startSession: sdk.startSession, endSession: sdk.endSession }),
  useConversationStatus: () => ({ status: 'disconnected' }),
  useConversationMode: () => ({ isSpeaking: false }),
}))

import ElevenLabsConversation from './ElevenLabsConversation'

const workflowId = '22b1f80c-2c12-4f82-bdd9-65d7b30712bb'
const conversationId = '8e1fde30-c4b6-492a-8862-32200b2661a9'

function metadata(status: 'authorized' | 'active' | 'ended' = 'authorized') {
  return {
    id: conversationId,
    pouId: 'whakapapa',
    status,
    providerConversationId: 'provider-conversation-id',
    authorizedAt: '2026-08-11T00:00:00.000Z',
    connectedAt: status === 'active' ? '2026-08-11T00:01:00.000Z' : null,
    endedAt: status === 'ended' ? '2026-08-11T00:02:00.000Z' : null,
    terminationReason: status === 'ended' ? 'user_ended' : null,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
  }
}

describe('ElevenLabsConversation', () => {
  beforeEach(() => {
    sdk.callbacks = {}
    sdk.startSession.mockReset()
    sdk.endSession.mockReset()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('does not open the microphone until deliberate Start, then passes only the temporary WebRTC token to the SDK', async () => {
    const stop = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata(), authorization: { transport: 'webrtc', conversationToken: 'temporary-token', dynamicVariables: { pou_name: 'Whakapapa', pou_opening: '', pou_guidance: 'Synthetic approved guidance' } } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata('active') }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ElevenLabsConversation workflowId={workflowId} onProceedToReview={() => undefined} />)
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()

    await waitFor(() => expect(screen.getByRole('button', { name: /begin voice reflection/i })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /begin voice reflection/i }))
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true }))
    await waitFor(() => expect(sdk.startSession).toHaveBeenCalledWith({ conversationToken: 'temporary-token', connectionType: 'webrtc', dynamicVariables: { pou_name: 'Whakapapa', pou_opening: '', pou_guidance: 'Synthetic approved guidance' } }))
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/workflows/${workflowId}/pou/whakapapa/conversations`)
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' })
    expect(stop).toHaveBeenCalledTimes(1)

    sdk.callbacks.onConnect?.({ conversationId: 'provider-conversation-id' } as never)
    await waitFor(() => expect(fetchMock.mock.calls[2]?.[0]).toBe(`/api/conversations/${conversationId}/client-connected`))
  })

  it('cleans up a deliberately ended session and transitions to post-reflection processing without another click', async () => {
    const stop = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } })
    const proceed = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata(), authorization: { transport: 'webrtc', conversationToken: 'temporary-token', dynamicVariables: { pou_name: 'Whakapapa', pou_opening: '', pou_guidance: 'Synthetic approved guidance' } } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata('active') }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata('ended') }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ElevenLabsConversation workflowId={workflowId} onProceedToReview={proceed} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /begin voice reflection/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /begin voice reflection/i }))
    await waitFor(() => expect(sdk.startSession).toHaveBeenCalled())
    sdk.callbacks.onConnect?.({ conversationId: 'provider-conversation-id' } as never)
    await waitFor(() => expect(screen.getByRole('button', { name: /end session/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /end session/i }))
    await waitFor(() => expect(sdk.endSession).toHaveBeenCalled())
    await waitFor(() => expect(fetchMock.mock.calls[3]?.[0]).toBe(`/api/conversations/${conversationId}/end`))
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('returns to post-reflection processing after refresh when the authoritative conversation is already ended', async () => {
    const proceed = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ conversation: metadata('ended') }), { status: 200 })))

    render(<ElevenLabsConversation workflowId={workflowId} onProceedToReview={() => undefined} onReflectionEnded={proceed} />)

    await waitFor(() => expect(proceed).toHaveBeenCalledTimes(1))
    expect(sdk.startSession).not.toHaveBeenCalled()
  })

  it('keeps provider captions bounded in ephemeral component state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ conversation: null }), { status: 200 })))
    render(<ElevenLabsConversation workflowId={workflowId} onProceedToReview={() => undefined} />)
    await waitFor(() => expect(sdk.callbacks.onMessage).toBeTypeOf('function'))
    const largeCaption = 'Whānau, Māori, whakapapa, pūkenga. '.repeat(700)
    await act(async () => {
      for (let index = 0; index < 21; index += 1) {
        sdk.callbacks.onMessage?.({ message: `${largeCaption}${index}`, role: 'agent' } as never)
      }
    })
    const captions = screen.getAllByText(/Whānau, Māori, whakapapa, pūkenga/).map((element) => element.textContent ?? '')
    expect(captions.length).toBeLessThanOrEqual(20)
    expect(captions.some((caption) => caption.endsWith('0'))).toBe(false)
    expect(new TextEncoder().encode(captions.join('')).byteLength).toBeLessThanOrEqual(16 * 1024)
  })

  it.each([
    ['provider error', 'onError', 'provider_error', 'Unable to start voice reflection'],
    ['unexpected disconnect', 'onDisconnect', 'connection_lost', 'Connection lost'],
  ] as const)('ends the SDK and reconciles once on %s', async (_description, callback, reason, expectedStatus) => {
    const stop = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata(), authorization: { transport: 'webrtc', conversationToken: 'temporary-token', dynamicVariables: { pou_name: 'Whakapapa', pou_opening: '', pou_guidance: 'Synthetic approved guidance' } } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata('active') }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata('ended') }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ElevenLabsConversation workflowId={workflowId} onProceedToReview={() => undefined} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /begin voice reflection/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /begin voice reflection/i }))
    await waitFor(() => expect(sdk.startSession).toHaveBeenCalled())
    sdk.callbacks.onConnect?.({ conversationId: 'provider-conversation-id' } as never)
    await waitFor(() => expect(screen.getByRole('button', { name: /end session/i })).toBeTruthy())
    sdk.callbacks.onMessage?.({ message: 'Whānau caption to clear', role: 'agent' } as never)
    await waitFor(() => expect(screen.getByText('Whānau caption to clear')).toBeTruthy())
    sdk.callbacks[callback]?.({} as never)
    await waitFor(() => expect(sdk.endSession).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ body: JSON.stringify({ reason }) }))
    sdk.callbacks.onDisconnect?.({} as never)
    expect(sdk.endSession).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls.filter(([url]) => url === `/api/conversations/${conversationId}/end`)).toHaveLength(1)
    expect(screen.getAllByText(expectedStatus)).not.toHaveLength(0)
    expect(screen.queryByText('Whānau caption to clear')).toBeNull()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('does not reconcile twice when endSession synchronously triggers onDisconnect', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata(), authorization: { transport: 'webrtc', conversationToken: 'temporary-token', dynamicVariables: { pou_name: 'Whakapapa', pou_opening: '', pou_guidance: 'Synthetic approved guidance' } } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata('active') }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata('ended') }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) } })
    sdk.endSession.mockImplementation(() => sdk.callbacks.onDisconnect?.({} as never))

    render(<ElevenLabsConversation workflowId={workflowId} onProceedToReview={() => undefined} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /begin voice reflection/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /begin voice reflection/i }))
    await waitFor(() => expect(sdk.startSession).toHaveBeenCalled())
    sdk.callbacks.onConnect?.({ conversationId: 'provider-conversation-id' } as never)
    await waitFor(() => expect(screen.getByRole('button', { name: /end session/i })).toBeTruthy())

    sdk.callbacks.onError?.({} as never)
    await waitFor(() => expect(sdk.endSession).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === `/api/conversations/${conversationId}/end`)).toHaveLength(1))
  })

  it.each([
    ['throws', () => { throw new Error('SDK end failed') }],
    ['rejects', () => Promise.reject(new Error('SDK end failed'))],
  ])('still performs local cleanup when endSession %s, and ignores late captions', async (_description, endImplementation) => {
    const stop = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } })
    const authorizationRequest = new Promise<Response>(() => undefined)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: null }), { status: 200 }))
      .mockReturnValueOnce(authorizationRequest))
    sdk.endSession.mockImplementation(endImplementation)

    render(<ElevenLabsConversation workflowId={workflowId} onProceedToReview={() => undefined} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /begin voice reflection/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /begin voice reflection/i }))
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    sdk.callbacks.onMessage?.({ message: 'Caption before terminal cleanup', role: 'agent' } as never)
    await waitFor(() => expect(screen.getByText('Caption before terminal cleanup')).toBeTruthy())

    sdk.callbacks.onError?.({} as never)
    await waitFor(() => expect(screen.getByText('Unable to start voice reflection')).toBeTruthy())
    expect(sdk.endSession).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Caption before terminal cleanup')).toBeNull()

    sdk.callbacks.onDisconnect?.({} as never)
    sdk.callbacks.onMessage?.({ message: 'Late caption must be ignored', role: 'agent' } as never)
    expect(sdk.endSession).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Late caption must be ignored')).toBeNull()
  })

  it('releases local state before a hung end reconciliation and reports the bounded failure truthfully', async () => {
    const stop = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata(), authorization: { transport: 'webrtc', conversationToken: 'temporary-token', dynamicVariables: { pou_name: 'Whakapapa', pou_opening: '', pou_guidance: 'Synthetic approved guidance' } } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata('active') }), { status: 200 }))
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        ;(init?.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ElevenLabsConversation workflowId={workflowId} onProceedToReview={() => undefined} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /begin voice reflection/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /begin voice reflection/i }))
    await waitFor(() => expect(sdk.startSession).toHaveBeenCalled())
    sdk.callbacks.onConnect?.({ conversationId: 'provider-conversation-id' } as never)
    await waitFor(() => expect(screen.getByRole('button', { name: /end session/i })).toBeTruthy())
    sdk.callbacks.onMessage?.({ message: 'Caption cleared before reconciliation', role: 'agent' } as never)
    await waitFor(() => expect(screen.getByText('Caption cleared before reconciliation')).toBeTruthy())

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /end session/i }))
    expect(sdk.endSession).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Kua mutu — reflection ended')).toBeTruthy()
    expect(screen.queryByText('Caption cleared before reconciliation')).toBeNull()
    expect(fetchMock.mock.calls[3]?.[0]).toBe(`/api/conversations/${conversationId}/end`)

    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(screen.getAllByText(/ended locally, but its status could not be confirmed/i)).not.toHaveLength(0)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('does not resume an authorized attempt after refresh and requires an explicit end before a new start', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata() }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: metadata('ended') }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })

    render(<ElevenLabsConversation workflowId={workflowId} onProceedToReview={() => undefined} />)
    await waitFor(() => expect(screen.getAllByText(/cannot safely resume after refresh/i)).not.toHaveLength(0))
    expect(getUserMedia).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /end previous attempt/i }))
    await waitFor(() => expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/conversations/${conversationId}/end`))
    await waitFor(() => expect(screen.getByRole('button', { name: /begin voice reflection/i })).toBeTruthy())
  })
})
