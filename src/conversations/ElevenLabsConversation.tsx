import { ConversationProvider, useConversationControls, useConversationMode, useConversationStatus } from '@elevenlabs/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  acknowledgeConversationConnected,
  ConversationApiError,
  endConversation,
  getCurrentWhakapapaConversation,
  startWhakapapaConversation,
  type ConversationMetadata,
  type ConversationTerminationReason,
} from './api'

type VoiceUiState = 'checking_previous' | 'previous_attempt' | 'idle' | 'requesting_permission' | 'requesting_authorization' | 'connecting' | 'listening' | 'agent_speaking' | 'ending' | 'connection_lost' | 'error' | 'ended'

type Caption = { id: number; role: 'guide' | 'kaimahi'; text: string }
type ProviderCallbacks = {
  onConnect?: (conversationId: string) => void
  onDisconnect?: () => void
  onError?: () => void
  onMessage?: (message: string, role: 'user' | 'agent') => void
}

const MAX_CAPTION_ITEMS = 20
const MAX_CAPTION_BYTES = 16 * 1024
const textEncoder = new TextEncoder()

function boundedCaptions(previous: Caption[], next: Caption): Caption[] {
  let byteLength = 0
  let end = 0
  for (const character of next.text) {
    const characterBytes = textEncoder.encode(character).byteLength
    if (byteLength + characterBytes > MAX_CAPTION_BYTES) break
    byteLength += characterBytes
    end += character.length
  }
  const text = next.text.slice(0, end)
  if (!text) return previous

  const captions = [...previous, { ...next, text }]
  let totalBytes = captions.reduce((total, caption) => total + textEncoder.encode(caption.text).byteLength, 0)
  while (captions.length > MAX_CAPTION_ITEMS || totalBytes > MAX_CAPTION_BYTES) {
    totalBytes -= textEncoder.encode(captions.shift()?.text ?? '').byteLength
  }
  return captions
}

function releaseTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

function VoiceController({
  workflowId,
  onProceedToReview,
  registerProviderCallbacks,
}: {
  workflowId: string
  onProceedToReview: () => void
  registerProviderCallbacks: (callbacks: ProviderCallbacks) => void
}) {
  const { startSession, endSession } = useConversationControls()
  const { status } = useConversationStatus()
  const { isSpeaking } = useConversationMode()
  const [uiState, setUiState] = useState<VoiceUiState>('idle')
  const [captions, setCaptions] = useState<Caption[]>([])
  const [previousConversation, setPreviousConversation] = useState<ConversationMetadata | null>(null)
  const [endReconciliationFailed, setEndReconciliationFailed] = useState(false)
  const preflightStream = useRef<MediaStream | null>(null)
  const conversationId = useRef<string | null>(null)
  const providerConversationId = useRef<string | null>(null)
  const ending = useRef(false)
  const captionId = useRef(0)
  const isMounted = useRef(true)

  const setUiStateSafely = useCallback((state: VoiceUiState) => {
    if (isMounted.current) setUiState(state)
  }, [])

  const setCaptionsSafely = useCallback((updater: (previous: Caption[]) => Caption[]) => {
    if (isMounted.current) setCaptions(updater)
  }, [])

  const clearEphemeralState = useCallback(() => {
    releaseTracks(preflightStream.current)
    preflightStream.current = null
    conversationId.current = null
    providerConversationId.current = null
    setCaptionsSafely(() => [])
  }, [setCaptionsSafely])

  const reconcileEnd = useCallback(async (reason: ConversationTerminationReason, state: VoiceUiState, closeSdk: boolean) => {
    if (ending.current) return
    ending.current = true
    const currentConversationId = conversationId.current
    // Local resource release is deliberately first. Neither the SDK nor a
    // network reconciliation can hold a microphone track or caption in memory.
    if (closeSdk) {
      try {
        void Promise.resolve(endSession()).catch(() => undefined)
      } catch {
        // SDK shutdown is best effort; local cleanup and server reconciliation
        // remain required even if it fails synchronously.
      }
    }
    clearEphemeralState()
    setUiStateSafely(state)
    if (!currentConversationId) return

    try {
      await endConversation(currentConversationId, reason)
    } catch {
      // The bounded, idempotent reconciliation did not complete. The local
      // terminal state is still true, and a later explicit attempt is safe.
      if (isMounted.current) setEndReconciliationFailed(true)
    }
  }, [clearEphemeralState, endSession, setUiStateSafely])

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      void reconcileEnd('navigation', 'ended', true)
    }
  }, [reconcileEnd])

  useEffect(() => {
    let cancelled = false
    setUiStateSafely('checking_previous')
    void getCurrentWhakapapaConversation(workflowId).then((current) => {
      if (cancelled) return
      if (current && ['preparing', 'authorized', 'active'].includes(current.status)) {
        conversationId.current = current.id
        providerConversationId.current = current.providerConversationId
        setPreviousConversation(current)
        setUiStateSafely('previous_attempt')
        return
      }
      setUiStateSafely('idle')
    }).catch(() => {
      if (!cancelled) setUiStateSafely('error')
    })
    return () => { cancelled = true }
  }, [setUiStateSafely, workflowId])

  useEffect(() => {
    if (ending.current) return
    if (uiState === 'connecting' && status === 'connected') setUiStateSafely(isSpeaking ? 'agent_speaking' : 'listening')
    if ((uiState === 'listening' || uiState === 'agent_speaking') && status === 'connected') setUiStateSafely(isSpeaking ? 'agent_speaking' : 'listening')
  }, [isSpeaking, setUiStateSafely, status, uiState])

  const start = async () => {
    if (uiState !== 'idle' && uiState !== 'error' && uiState !== 'connection_lost') return
    ending.current = false
    setEndReconciliationFailed(false)
    setUiStateSafely('requesting_permission')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('microphone_unavailable')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (ending.current) {
        releaseTracks(stream)
        return
      }
      preflightStream.current = stream
    } catch {
      clearEphemeralState()
      setUiStateSafely('error')
      return
    }

    setUiStateSafely('requesting_authorization')
    try {
      const started = await startWhakapapaConversation(workflowId, crypto.randomUUID())
      if (ending.current) {
        void endConversation(started.conversation.id, 'navigation').catch(() => undefined)
        return
      }
      conversationId.current = started.conversation.id
      providerConversationId.current = started.conversation.providerConversationId
      if (!providerConversationId.current || started.authorization.transport !== 'webrtc') throw new Error('invalid_authorization')
      releaseTracks(preflightStream.current)
      preflightStream.current = null
      setUiStateSafely('connecting')
      startSession({ conversationToken: started.authorization.conversationToken, connectionType: 'webrtc' })
    } catch (error) {
      if (error instanceof ConversationApiError && (error.code === 'conversation_start_in_progress' || error.code === 'authorization_already_issued')) {
        releaseTracks(preflightStream.current)
        preflightStream.current = null
        try {
          const current = await getCurrentWhakapapaConversation(workflowId)
          if (current && ['preparing', 'authorized', 'active'].includes(current.status)) {
            conversationId.current = current.id
            providerConversationId.current = current.providerConversationId
            setPreviousConversation(current)
            setUiStateSafely('previous_attempt')
            return
          }
        } catch {
          // The original bounded API error is shown below.
        }
      }
      const reason: ConversationTerminationReason = error instanceof ConversationApiError && error.code === 'provider_id_mismatch'
        ? 'provider_id_mismatch'
        : 'startup_failed'
      await reconcileEnd(reason, 'error', true)
    }
  }

  const handleConnect = async (id: string) => {
    if (ending.current) return
    if (!conversationId.current || !providerConversationId.current || id !== providerConversationId.current) {
      await reconcileEnd('provider_id_mismatch', 'error', true)
      return
    }
    try {
      await acknowledgeConversationConnected(conversationId.current, id)
      setUiStateSafely(isSpeaking ? 'agent_speaking' : 'listening')
    } catch {
      await reconcileEnd('startup_failed', 'error', true)
    }
  }

  const handleDisconnect = () => {
    if (ending.current) return
    void reconcileEnd('connection_lost', 'connection_lost', true)
  }

  const handleMessage = ({ message, role }: { message: string; role: 'user' | 'agent' }) => {
    if (ending.current) return
    if (!message.trim()) return
    setCaptionsSafely((previous) => boundedCaptions(previous, {
      id: ++captionId.current,
      role: role === 'agent' ? 'guide' : 'kaimahi',
      text: message,
    }))
  }

  const abandonPreviousAttempt = async () => {
    if (!previousConversation) return
    setUiStateSafely('ending')
    try {
      await endConversation(previousConversation.id, previousConversation.status === 'active' ? 'navigation' : 'startup_failed')
      clearEphemeralState()
      setPreviousConversation(null)
      ending.current = false
      setUiStateSafely('idle')
    } catch {
      ending.current = false
      setUiStateSafely('error')
    }
  }

  useEffect(() => {
    registerProviderCallbacks({
      onConnect: (id) => { void handleConnect(id) },
      onDisconnect: handleDisconnect,
      onError: () => { void reconcileEnd(conversationId.current ? 'provider_error' : 'startup_failed', 'error', true) },
      onMessage: (message, role) => handleMessage({ message, role }),
    })
    return () => registerProviderCallbacks({})
  })

  const statusCopy: Record<VoiceUiState, { label: string; detail: string }> = {
    checking_previous: { label: 'Checking voice reflection', detail: 'Checking whether a previous voice attempt needs your attention' },
    previous_attempt: { label: 'Previous voice attempt', detail: 'This voice reflection cannot safely resume after refresh. End it before starting a new one.' },
    idle: { label: 'Tomokia — ready', detail: 'Tap below to begin your reflection' },
    requesting_permission: { label: 'Microphone access', detail: 'Allow microphone access to begin' },
    requesting_authorization: { label: 'Tomokia…', detail: 'Preparing your reflective space' },
    connecting: { label: 'Hono mai…', detail: 'Connecting your voice reflection' },
    listening: { label: 'Whakarongo — listening', detail: 'Speak when you are ready' },
    agent_speaking: { label: 'Whakaaro tonu…', detail: 'Your guide is speaking' },
    ending: { label: 'Kati kōrero…', detail: 'Ending your reflection' },
    connection_lost: { label: 'Connection lost', detail: 'Your workflow is still safe. Start a new reflection or continue to review.' },
    error: { label: 'Unable to start voice reflection', detail: 'The voice reflection could not be started. You can try again or continue to review.' },
    ended: { label: 'Kua mutu — reflection ended', detail: 'Continue to the existing Pou review when you are ready.' },
  }
  const statusText = endReconciliationFailed
    ? { ...statusCopy[uiState], detail: 'The voice reflection ended locally, but its status could not be confirmed. You can continue to review.' }
    : statusCopy[uiState]
  const canEnd = uiState === 'connecting' || uiState === 'listening' || uiState === 'agent_speaking'
  const canStart = uiState === 'idle' || uiState === 'error' || uiState === 'connection_lost'

  return (
    <div className="flex flex-col" style={{ minHeight: '82vh', fontFamily: 'var(--font-body)' }}>
      <div className="px-6 pt-9 pb-7">
        <p className="text-xs tracking-widest uppercase mb-5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}>Pou 1 o 7 — Kōrero</p>
        <h2 className="mb-3 leading-snug" style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--color-ink)' }}>Whakapapa</h2>
        <p className="text-sm italic leading-relaxed" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>A focused voice reflection for Whakapapa. The existing Pou review remains the place to record what you choose to confirm.</p>
      </div>

      <div className="mx-6" style={{ height: 1, backgroundColor: 'var(--color-border)' }} />

      <div className="flex-1 overflow-y-auto py-4">
        {captions.length === 0 ? (
          <div className="py-16 px-8 text-center">
            <p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>{statusText.detail}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {captions.map((caption) => (
              <div key={caption.id} className={caption.role === 'guide' ? 'px-5 py-4' : 'px-5 py-3.5 mx-5'} style={caption.role === 'guide'
                ? { borderLeft: '3px solid var(--color-ridge)', backgroundColor: 'var(--color-surface)' }
                : { borderLeft: '2px solid var(--color-border)' }}>
                <p className={caption.role === 'guide' ? 'italic leading-[1.85]' : 'text-sm leading-relaxed'} style={{ fontFamily: caption.role === 'guide' ? 'var(--font-display)' : 'var(--font-body)', color: caption.role === 'guide' ? 'var(--color-ink)' : 'var(--color-ink-secondary)' }}>{caption.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3 px-5 py-3" style={{ backgroundColor: 'var(--color-surface)' }}>
          <div style={{ width: 8, height: 8, backgroundColor: uiState === 'error' || uiState === 'connection_lost' ? 'var(--color-concern)' : 'var(--color-ridge)' }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium leading-tight" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink)' }}>{statusText.label}</p>
            <p className="text-xs italic leading-tight mt-0.5" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>{statusText.detail}</p>
          </div>
          {canEnd && <button type="button" onClick={() => { setUiStateSafely('ending'); void reconcileEnd('user_ended', 'ended', true) }} className="px-3 py-1.5 text-xs min-h-[36px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border-strong)' }}>End session</button>}
        </div>

        {canStart && <div className="px-5 py-5 space-y-2">
          <button type="button" onClick={() => void start()} className="w-full text-left transition-all active:opacity-85">
            <div style={{ backgroundColor: 'var(--color-ridge)', padding: '1.375rem 1.25rem' }}>
              <p className="text-lg font-medium italic mb-1" style={{ fontFamily: 'var(--font-display)', color: 'white' }}>Begin voice reflection</p>
              <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em' }}>TĪMATA KŌRERO →</p>
            </div>
          </button>
          <button type="button" onClick={onProceedToReview} className="w-full py-3 text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border-strong)' }}>Continue to Pou review</button>
        </div>}

        {uiState === 'previous_attempt' && <div className="px-5 py-5 space-y-2">
          <button type="button" onClick={() => void abandonPreviousAttempt()} className="w-full py-3 text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border-strong)' }}>End previous attempt</button>
          <button type="button" onClick={onProceedToReview} className="w-full py-3 text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border-strong)' }}>Continue to Pou review</button>
        </div>}

        {uiState === 'ended' && <div className="px-5 py-5"><button type="button" onClick={onProceedToReview} className="w-full text-left" style={{ backgroundColor: 'var(--color-ridge)', padding: '1.25rem' }}><p className="text-lg font-medium italic mb-1" style={{ fontFamily: 'var(--font-display)', color: 'white' }}>Haere tonu — Te Waharoa Pou review</p><p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.5)' }}>REVIEW THE SEVEN POU →</p></button></div>}
      </div>
    </div>
  )
}

export default function ElevenLabsConversation({ workflowId, onProceedToReview }: { workflowId: string; onProceedToReview: () => void }) {
  const callbacks = useRef<ProviderCallbacks>({})
  return (
    <ConversationProvider
      onConnect={({ conversationId }) => callbacks.current.onConnect?.(conversationId)}
      onDisconnect={() => callbacks.current.onDisconnect?.()}
      onError={() => callbacks.current.onError?.()}
      onMessage={({ message, role }) => callbacks.current.onMessage?.(message, role)}
    >
      <VoiceController workflowId={workflowId} onProceedToReview={onProceedToReview} registerProviderCallbacks={(next) => { callbacks.current = next }} />
    </ConversationProvider>
  )
}
