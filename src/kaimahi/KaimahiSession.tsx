import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type {
  ActiveSessionData,
  EngagementType,
  Pou,
  PouStatus,
  ActionType,
} from '../types'
import type {
  SafetyBroadClass,
  SafetyObservationConcernLevel,
  WorkflowActionInput,
  WorkflowCarryForwardSource,
  WorkflowReferralInput,
  WorkflowStage,
} from '../../shared/workflow'
import { WORKFLOW_POU_NAMES } from '../../shared/workflow'
import {
  STATUS_CONFIG,
  REFERRAL_SERVICES,
  getInitialSessionData,
  DEMO_SYNTHESIS,
} from '../data'
import {
  PouStrip,
  ActionBadge,
  StatusBadge,
  SectionLabel,
} from '../shared'
import { TE_WAHAROA_POU } from '../pou'
import { SessionHeader, WhareShell, type SessionStageKey } from './KaimahiShell'
import {
  WorkflowApiError,
  getWorkflow,
  getPouAssessmentCandidates,
  getPouReviewDraft,
  markPouReviewDraftReviewed,
  editPouReviewDraft,
  editWorkflowSynthesis,
  generateWorkflowSynthesis,
  getFinalRecord,
  getWorkflowSynthesis,
  copyFinalRecord,
  reviewPouAssessmentCandidate,
  submitWorkflowCommand,
  type Workflow,
  type WorkflowAction,
  type WorkflowCheckpoint,
  type WorkflowReferral,
  type SafetyObservationCurrentView,
  type WorkflowPersistenceState,
  type PouAssessmentCandidate,
  type PouReviewDraft,
  type PouReviewDraftState,
  type WorkflowSynthesisContent,
  type WorkflowSynthesisState,
  type FinalRecord,
} from '../workflows'
import { VoiceChunkBoundary, VoiceChunkLoading } from '../conversations/VoiceChunkBoundary'

const ElevenLabsConversation = lazy(() => import('../conversations/ElevenLabsConversation'))

// ─────────────────────────────────────────────────────────────────────────────
// SESSION STAGES
// ─────────────────────────────────────────────────────────────────────────────

// Stage 1 — Setup (entering the whare)
type ImmediateConcern = 'none' | 'unsure' | 'urgent' | null

type SafetyDraft = {
  assessmentContext: 'setup' | 'pou'
  pouId?: (typeof TE_WAHAROA_POU)[number]['id']
  broadClass: SafetyBroadClass
  concernLevel: SafetyObservationConcernLevel
  contextNote?: string
}

type PendingSafetySave = {
  expectedVersion: number
  idempotencyKey: string
  source: SafetyDraft
  retryable: boolean
}

/** Binds a human confirmation to the Pou that displayed the scoped candidate. */
export function candidateConfirmationCommand(
  candidate: PouAssessmentCandidate,
  concernLevel: SafetyObservationConcernLevel,
  pouId: (typeof TE_WAHAROA_POU)[number]['id'],
  expectedVersion: number,
) {
  if (!candidate.canonicalBroadClass) return null
  return {
    type: 'safety-observation-confirmed' as const,
    observationId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    expectedVersion,
    candidateAssessmentId: candidate.id,
    observation: { assessmentContext: 'pou' as const, pouId, broadClass: candidate.canonicalBroadClass, concernLevel },
  }
}

const SAFETY_CLASS_OPTIONS: Array<{ id: SafetyBroadClass; label: string }> = [
  { id: 'whanau_safety', label: 'Whānau safety' },
  { id: 'practice_quality', label: 'Practice quality' },
  { id: 'practitioner_wellbeing', label: 'Practitioner wellbeing' },
]

const safetyClassLabel = (value: SafetyBroadClass) => SAFETY_CLASS_OPTIONS.find((option) => option.id === value)?.label ?? value

/** Confirmation is allowed only for the authoritative revision currently displayed. */
export function canConfirmWorkflowSynthesis(input: { saving: boolean; dirty: boolean; status: WorkflowSynthesisState['status'] }): boolean {
  return !input.saving && !input.dirty && input.status === 'ready'
}

function SafetyConcernDisclosure({
  open,
  onOpenChange,
  broadClass,
  onBroadClassChange,
  contextNote,
  onContextNoteChange,
  label = 'Record this as a safety concern',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  broadClass: SafetyBroadClass | null
  onBroadClassChange: (value: SafetyBroadClass) => void
  contextNote: string
  onContextNoteChange: (value: string) => void
  label?: string
}) {
  return (
    <div style={{ backgroundColor: 'var(--color-surface)', borderLeft: `3px solid ${open ? 'var(--color-caution)' : 'var(--color-border)'}`, padding: '0.875rem 1rem' }}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="w-full flex items-center justify-between gap-3 text-left min-h-[36px]"
        aria-expanded={open}
      >
        <span className="text-sm font-medium" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>{label}</span>
        <span aria-hidden="true" style={{ color: 'var(--color-ridge)', fontFamily: 'var(--font-mono)' }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="pt-4 space-y-4">
          <fieldset>
            <legend className="text-xs mb-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}>SAFETY CLASS</legend>
            <div className="space-y-1.5">
              {SAFETY_CLASS_OPTIONS.map((option) => (
                <label key={option.id} className="flex items-center gap-3 px-3 py-3 min-h-[48px]" style={{ backgroundColor: broadClass === option.id ? 'var(--color-caution-light)' : 'var(--color-ground)', borderLeft: `3px solid ${broadClass === option.id ? 'var(--color-caution)' : 'var(--color-border)'}` }}>
                  <input type="radio" name="safety-broad-class" checked={broadClass === option.id} onChange={() => onBroadClassChange(option.id)} />
                  <span className="text-sm" style={{ color: 'var(--color-ink-secondary)' }}>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}>CONTEXT NOTE (OPTIONAL)</label>
            <textarea value={contextNote} onChange={(event) => onContextNoteChange(event.target.value)} rows={3} className="mt-2 w-full resize-none p-3 text-sm outline-none" style={{ backgroundColor: 'var(--color-ground)', color: 'var(--color-ink)', borderLeft: '3px solid var(--color-border)' }} />
          </div>
        </div>
      )}
    </div>
  )
}

function PersistenceFeedback({
  state,
  onRetry,
  onReload,
}: {
  state: WorkflowPersistenceState
  onRetry: () => void
  onReload: () => void
}) {
  if (state === 'idle' || state === 'saved') return null
  const stale = state === 'stale' || state === 'stale-safety'
  const message = state === 'failed-safety'
    ? 'The setup or Pou review was saved, but this safety concern has not been saved yet.'
    : state === 'stale-safety'
    ? 'This safety concern has changed. Reload the latest version before reviewing it again.'
    : stale
    ? 'This session was updated elsewhere. Reload the latest version to continue.'
    : state === 'saving'
      ? 'Saving…'
      : state === 'retrying'
        ? 'Retrying…'
        : 'Couldn’t save. Try again.'
  return (
    <div className="mt-3 flex items-center justify-between gap-3" aria-live="polite">
      <p className="text-xs italic leading-relaxed" style={{ fontFamily: 'var(--font-display)', color: stale ? 'var(--color-caution)' : 'var(--color-concern)' }}>
        {message}
      </p>
      {(state === 'failed' || state === 'failed-safety' || stale) && (
        <button
          onClick={stale ? onReload : onRetry}
          className="flex-shrink-0 text-xs transition-opacity hover:opacity-70"
          style={{ fontFamily: 'var(--font-mono)', color: stale ? 'var(--color-caution)' : 'var(--color-concern)' }}
        >
          {stale ? 'Reload latest' : 'Try again'}
        </button>
      )}
    </div>
  )
}

function PendingSafetySaveNotice({
  pending,
  state,
  onRetry,
  onReview,
}: {
  pending: PendingSafetySave | null
  state: WorkflowPersistenceState
  onRetry: () => void
  onReview: () => void
}) {
  if (!pending) return null
  const retrying = state === 'saving' || state === 'retrying'
  return <div className="mx-5 mt-4 px-4 py-3 flex items-center justify-between gap-3" aria-live="polite" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-caution)' }}>
    <p className="text-xs italic leading-relaxed" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>A safety concern has not yet been saved.{!pending.retryable && ' Review and reconfirm it from the current workflow.'}</p>
    <button type="button" onClick={pending.retryable ? onRetry : onReview} disabled={pending.retryable && retrying} className="flex-shrink-0 text-xs disabled:opacity-50" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-caution)' }}>{pending.retryable ? (retrying ? 'Saving…' : 'Try again') : 'Review safety concern'}</button>
  </div>
}

function SetupStage({
  data,
  onChange,
  onConfirm,
  displayName,
  persistenceState,
  onRetry,
  onReload,
}: {
  data: ActiveSessionData
  onChange: (p: Partial<ActiveSessionData>) => void
  onConfirm: (immediateConcern: Exclude<ImmediateConcern, null>, safetyDraft?: SafetyDraft) => void
  displayName: string
  persistenceState: WorkflowPersistenceState
  onRetry: () => void
  onReload: () => void
}) {
  const [immediateConcern, setImmediateConcern] = useState<ImmediateConcern>(null)
  const [recordSafety, setRecordSafety] = useState(false)
  const [safetyClass, setSafetyClass] = useState<SafetyBroadClass | null>(null)
  const [safetyNote, setSafetyNote] = useState(data.notes)

  const canEnter =
    data.whanauCode.trim().length >= 2 &&
    data.sessionFocus.trim().length >= 3 &&
    immediateConcern !== null &&
    (!recordSafety || safetyClass !== null)

  const types: { id: EngagementType; label: string; reo: string; sub: string }[] = [
    { id: 'home-visit', label: 'Home visit',  reo: 'Kāinga',  sub: 'At whānau home' },
    { id: 'phone',      label: 'Phone',       reo: 'Waea',    sub: 'Remote contact' },
    { id: 'office',     label: 'Office',      reo: 'Tari',    sub: 'At your base'   },
    { id: 'hui',        label: 'Hui',         reo: 'Hui',     sub: 'Group setting'  },
  ]

  const concernOptions: {
    id: ImmediateConcern
    reo: string
    label: string
    sub: string
    color: string
    bg: string
    border: string
  }[] = [
    {
      id: 'none',
      reo: 'Kāore he āhuatanga',
      label: 'No immediate concern',
      sub: 'The engagement felt stable and within expected range',
      color: 'var(--color-growth)',
      bg: 'var(--color-growth-light)',
      border: 'var(--color-growth)',
    },
    {
      id: 'unsure',
      reo: 'He āhuatanga pea',
      label: "Uncertain — something didn't sit right",
      sub: 'Something felt off but I need more time to name it',
      color: 'var(--color-caution)',
      bg: 'var(--color-caution-light)',
      border: 'var(--color-caution)',
    },
    {
      id: 'urgent',
      reo: 'He āhuatanga nui',
      label: 'An immediate concern exists',
      sub: 'There is a clear risk or safety issue that needs attention now',
      color: 'var(--color-concern)',
      bg: 'var(--color-concern-light)',
      border: 'var(--color-concern)',
    },
  ]

  return (
    <div className="flex flex-col" style={{ fontFamily: 'var(--font-body)' }}>

      {/* ── Approach: orienting before the entrance ── */}
      <div className="px-6 pt-8 pb-6">
        <p
          className="text-xs tracking-widest uppercase mb-5"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}
        >
          Tomokia — Setup Reflection
        </p>
        <h2
          className="mb-4 leading-snug"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.5rem',
            fontWeight: 500,
            color: 'var(--color-ink)',
          }}
        >
          Pause at the entrance
        </h2>
        {/* Helper text — the gentle practical orientation */}
        <p
          className="text-sm italic leading-relaxed"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
        >
          This reflection will help you review the engagement, identify protective and risk
          factors, consider what needs follow-up, and prepare actions or supervision points.
        </p>
      </div>

      {/* Structural divider — first pou mark */}
      <div className="mx-6" style={{ height: 1, backgroundColor: 'var(--color-border)' }} />

      {/* ── The held spaces — each field is a room in the entrance ── */}
      <div className="px-5 pt-6 pb-4 space-y-6">

        {/* Session reference — auto-generated, anchors the session */}
        <div
          className="flex items-center gap-4 px-4 py-3"
          style={{
            backgroundColor: 'var(--color-surface)',
            borderLeft: '3px solid var(--color-ridge)',
          }}
        >
          <div>
            <p
              className="text-xs tracking-wide mb-0.5"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
            >
              SESSION REF
            </p>
            <p
              className="text-base"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}
            >
              {data.ref}
            </p>
          </div>
          <div
            className="mx-2"
            style={{ width: 1, height: 28, backgroundColor: 'var(--color-border)' }}
          />
          <div>
            <p
              className="text-xs mb-0.5"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
            >
              DATE
            </p>
            <p
              className="text-sm"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-secondary)' }}
            >
              6 Ākuhata 2026
            </p>
          </div>
        </div>

        {/* Kaimahi name — pre-filled, confirms who is reflecting */}
        <div>
          <SectionLabel>Ko wai koe — Kaimahi</SectionLabel>
          <div
            className="mt-2 flex items-center gap-3 px-4 py-3.5 min-h-[52px]"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderLeft: '3px solid var(--color-border)',
              opacity: 0.75,
            }}
          >
            <div
              className="flex-shrink-0"
              style={{ width: 2, height: 16, backgroundColor: 'var(--color-border-strong)' }}
            />
            <span
              className="text-sm"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
            >
              {displayName}
            </span>
            <span
              className="text-xs ml-auto"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
            >
              Kaimahi Tautoko
            </span>
          </div>
          <p
            className="text-xs mt-1.5 italic"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
          >
            From your profile — change in Settings
          </p>
        </div>

        {/* Whānau — coded reference for privacy */}
        <div>
          <SectionLabel>Ko wai tō whānau — Whānau</SectionLabel>
          <input
            type="text"
            value={data.whanauCode}
            onChange={(e) => onChange({ whanauCode: e.target.value.toUpperCase() })}
            placeholder="e.g. TW-04"
            className="mt-2 w-full px-4 text-sm outline-none min-h-[52px]"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '1.05rem',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-ink)',
              border: 'none',
              borderLeft: data.whanauCode.trim().length >= 2
                ? '3px solid var(--color-ridge)'
                : '3px solid var(--color-border)',
              caretColor: 'var(--color-ridge)',
              outline: 'none',
            }}
          />
          <p
            className="text-xs mt-1.5 italic"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
          >
            Coded reference only — no personal names recorded here
          </p>
        </div>

        {/* Engagement type — structural 2×2 grid */}
        <div>
          <SectionLabel>Āhua o te tūtakitanga — Type of engagement</SectionLabel>
          <div className="grid grid-cols-2 gap-px mt-2">
            {types.map((t) => {
              const active = data.engagementType === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => onChange({ engagementType: t.id })}
                  className="text-left transition-all active:opacity-80"
                  style={{
                    padding: '0.875rem 1rem',
                    minHeight: 64,
                    backgroundColor: active ? 'var(--color-ridge)' : 'var(--color-surface)',
                    borderLeft: active
                      ? '4px solid rgba(255,255,255,0.25)'
                      : '4px solid var(--color-border)',
                  }}
                >
                  <p
                    className="text-sm font-medium leading-snug"
                    style={{
                      color: active ? 'white' : 'var(--color-ink)',
                    }}
                  >
                    {t.label}
                  </p>
                  <p
                    className="text-xs mt-0.5"
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontStyle: 'italic',
                      color: active ? 'rgba(255,255,255,0.65)' : 'var(--color-ink-muted)',
                    }}
                  >
                    {t.sub}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Reason for engagement — this becomes sessionFocus */}
        <div>
          <SectionLabel>Take o te tūtakitanga — Reason for engagement</SectionLabel>
          <textarea
            value={data.sessionFocus}
            onChange={(e) => onChange({ sessionFocus: e.target.value })}
            placeholder="What was the purpose or focus of this engagement?"
            rows={3}
            className="mt-2 w-full px-4 py-3.5 text-sm leading-relaxed resize-none"
            style={{
              fontFamily: 'var(--font-body)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-ink)',
              border: 'none',
              borderLeft: data.sessionFocus.trim().length >= 3
                ? '3px solid var(--color-ridge)'
                : '3px solid var(--color-border)',
              outline: 'none',
              caretColor: 'var(--color-ridge)',
            }}
          />
        </div>

        {/* Optional notes — quiet and brief */}
        <div>
          <SectionLabel>Ngā kōrero āpiti — Additional notes (optional)</SectionLabel>
          <textarea
            value={data.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            placeholder="Anything else to note before you begin…"
            rows={2}
            className="mt-2 w-full px-4 py-3 text-sm leading-relaxed resize-none italic"
            style={{
              fontFamily: 'var(--font-display)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-ink-secondary)',
              border: 'none',
              borderLeft: '3px solid var(--color-border)',
              outline: 'none',
              caretColor: 'var(--color-ridge)',
            }}
          />
        </div>

        {/* ── Immediate concern — the most weighty question ── */}
        {/* This sits lower, after the context is established.
            It should feel considered, not rushed. */}
        <div>
          <div className="mb-3">
            <SectionLabel>He āhuatanga tūāhu — Immediate concern?</SectionLabel>
            <p
              className="text-xs italic mt-1.5"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
            >
              How did this engagement sit with you?
            </p>
          </div>

          {/* Structural divider above the concern options */}
          <div style={{ height: 1, backgroundColor: 'var(--color-border)', marginBottom: 8 }} />

          <div className="space-y-px">
            {concernOptions.map((opt) => {
              const active = immediateConcern === opt.id
              return (
                <button
                  key={opt.id}
                  onClick={() => {
                    setImmediateConcern(opt.id)
                    if (opt.id !== 'unsure' && opt.id !== 'urgent') setRecordSafety(false)
                  }}
                  className="w-full text-left transition-all active:opacity-80 min-h-[64px]"
                  style={{
                    backgroundColor: active ? opt.bg : 'var(--color-surface)',
                    borderLeft: active
                      ? `4px solid ${opt.border}`
                      : '4px solid var(--color-border)',
                    padding: '0.875rem 1rem',
                  }}
                >
                  <div className="flex items-start gap-3">
                    {/* Selection indicator — structural square */}
                    <div
                      className="flex-shrink-0 flex items-center justify-center mt-0.5"
                      style={{
                        width: 16,
                        height: 16,
                        border: `2px solid ${active ? opt.border : 'var(--color-border-strong)'}`,
                        backgroundColor: active ? opt.border : 'transparent',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {active && (
                        <div style={{ width: 6, height: 6, backgroundColor: 'white' }} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium leading-snug mb-0.5"
                        style={{ color: active ? 'var(--color-ink)' : 'var(--color-ink-secondary)' }}
                      >
                        {opt.label}
                      </p>
                      <p
                        className="text-xs italic leading-relaxed"
                        style={{
                          fontFamily: 'var(--font-display)',
                          color: active ? 'var(--color-ink-secondary)' : 'var(--color-ink-muted)',
                        }}
                      >
                        {opt.sub}
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Contextual note when urgent concern selected */}
          {immediateConcern === 'urgent' && (
            <div
              className="mt-2 px-4 py-3"
              style={{
                backgroundColor: 'var(--color-concern-light)',
                borderLeft: '3px solid var(--color-concern)',
              }}
            >
              <p
                className="text-xs italic leading-relaxed"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
              >
                You can record a safety concern here if you choose. Any safety requirements are recorded in Te Kaupapa; no notification is sent from this step.
              </p>
            </div>
          )}
          {(immediateConcern === 'unsure' || immediateConcern === 'urgent') && (
            <div className="mt-3">
              <SafetyConcernDisclosure
                open={recordSafety}
                onOpenChange={setRecordSafety}
                broadClass={safetyClass}
                onBroadClassChange={setSafetyClass}
                contextNote={safetyNote}
                onContextNoteChange={setSafetyNote}
              />
            </div>
          )}
        </div>

      </div>

      {/* ── Paepae — threshold before entering ── */}
      <div className="relative flex items-center mx-5 my-2">
        <div className="flex-1" style={{ height: 1, backgroundColor: 'var(--color-border-strong)' }} />
        <div
          className="flex-shrink-0 px-4 py-1"
          style={{ backgroundColor: 'var(--color-surface-deep)' }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.6rem',
              letterSpacing: '0.18em',
              color: 'var(--color-ink-muted)',
            }}
          >
            PAEPAE
          </span>
        </div>
        <div className="flex-1" style={{ height: 1, backgroundColor: 'var(--color-border-strong)' }} />
      </div>

      {/* ── Enter — the crossing ── */}
      <div className="px-5 pt-4 pb-8">
        <button
          onClick={() => immediateConcern && onConfirm(immediateConcern, recordSafety && safetyClass ? {
            assessmentContext: 'setup',
            broadClass: safetyClass,
            concernLevel: immediateConcern === 'urgent' ? 'urgent' : 'unsure',
            contextNote: safetyNote.trim() || undefined,
          } : undefined)}
          disabled={!canEnter || persistenceState === 'saving' || persistenceState === 'retrying'}
          className="w-full text-left transition-all active:opacity-85"
          style={{ cursor: canEnter ? 'pointer' : 'default' }}
        >
          <div
            style={{
              backgroundColor: canEnter ? 'var(--color-ridge)' : 'var(--color-surface)',
              padding: '1.25rem 1.25rem 1.125rem',
              transition: 'background-color 0.2s ease',
            }}
          >
            {canEnter ? (
              <>
                {/* Ghost pou marks inside the button — entering the whare */}
                <div className="flex gap-1 mb-4" style={{ opacity: 0.18 }}>
                  {[0,1,2,3,4,5,6].map((i) => (
                    <div key={i} style={{ flex: 1, height: 2, backgroundColor: 'white' }} />
                  ))}
                </div>
                <p
                  className="text-lg font-medium italic"
                  style={{ fontFamily: 'var(--font-display)', color: 'white', lineHeight: 1.3 }}
                >
                  Uru atu ki te whare
                </p>
                <p
                  className="text-xs mt-1.5"
                  style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.55)', letterSpacing: '0.06em' }}
                >
                  {persistenceState === 'saving' ? 'Saving…' : persistenceState === 'retrying' ? 'Retrying…' : 'BEGIN GUIDED REFLECTION →'}
                </p>
              </>
            ) : (
              <p
                className="text-sm italic text-center py-1"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
              >
                Complete the fields above to continue
              </p>
            )}
          </div>
        </button>
        <PersistenceFeedback state={persistenceState} onRetry={onRetry} onReload={onReload} />
      </div>

    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// POU DATA — full names and contextual content used throughout pou journey
// ─────────────────────────────────────────────────────────────────────────────

const POU_EXTENDED = [
  {
    ...TE_WAHAROA_POU[0],
    discussed: 'Whakapapa information was documented appropriately. Cultural identity was discussed and whānau strengths were identified alongside distress. Protective cultural factors were named and held.',
    notCovered: 'Intergenerational context and extended whānau voice were not fully explored in this session.',
    protective: ['Whakapapa information documented appropriately', 'Whānau voice captured in notes', 'Cultural identity discussed'],
    risk: ['Assumptions about whānau context not fully examined', 'Clinical language may be dominating documentation'],
    reflectivePrompts: [
      'How did I identify and uphold the identity of this whānau?',
      'Did I reduce the person to symptoms or hold their wider story?',
      'What assumptions did I make about this whānau?',
      'Did I create enough space for whānau voice?',
    ],
    safetyFlags: ['Notes focused only on deficits', 'Minimal cultural information recorded', 'Whānau strengths absent'],
  },
  {
    ...TE_WAHAROA_POU[1],
    discussed: 'Respectful communication was evident throughout. Whānau feedback on feeling heard was noted. Follow-up was completed appropriately and responsiveness to distress was documented.',
    notCovered: 'Boundary maintenance and emotional shifts in the room were not fully explored.',
    protective: ['Respectful communication evident', 'Whānau felt heard and safe', 'Follow-up completed appropriately'],
    risk: ['Missed follow-up noted', 'Response to distress may have been delayed'],
    reflectivePrompts: [
      'How did my presence impact this person?',
      'Did whānau leave feeling more diminished or more upheld?',
      'Was my communication mana enhancing?',
      'Did I respond to distress or avoid it?',
    ],
    safetyFlags: ['Missed follow-ups', 'Abrupt or clinical-only language', 'Whānau disengagement after sessions'],
  },
  {
    ...TE_WAHAROA_POU[2],
    discussed: 'Consent was completed properly. Confidentiality was explained and upheld. Ethical decision-making was documented with clear rationale. Tikanga considerations were included in planning.',
    notCovered: 'Appropriate consultation was not fully explored — some ethical tensions remain unaddressed.',
    protective: ['Consent completed properly', 'Confidentiality explained and upheld', 'Clear rationale documented'],
    risk: ['Ethical tensions not fully resolved', 'Consultation not sought during a complex situation'],
    reflectivePrompts: [
      'Did I uphold tikanga in this engagement?',
      'What ethical tensions existed?',
      'Was informed consent genuinely understood?',
      'Did I consult when I needed guidance?',
    ],
    safetyFlags: ['Missing consent documentation', 'Practitioner acting outside scope', 'Lack of consultation during risk situations'],
  },
  {
    ...TE_WAHAROA_POU[3],
    discussed: 'Risk assessment was completed. Safety plan was documented and updated. Escalations and referrals were recorded. Environmental and cultural safety were considered.',
    notCovered: 'Invisible risks and cultural safety interventions were not fully explored.',
    protective: ['Risk assessment completed', 'Safety plan documented or updated', 'Escalations and referrals recorded'],
    risk: ['Risk may have been minimised or overstated', 'Escalation may have been avoided due to discomfort'],
    reflectivePrompts: [
      'What risks were visible and invisible?',
      'Did I minimise or overstate risk?',
      'Were safety plans realistic and relational?',
      'Did I include whānau and cultural supports in planning?',
    ],
    safetyFlags: ['Incomplete risk assessments', 'High distress with low intervention', 'No evidence of safety planning'],
  },
  {
    ...TE_WAHAROA_POU[4],
    discussed: 'Supervision was attended. Reflective notes were completed. Intervention capability was demonstrated and scope of practice was adhered to. Evidence of ongoing learning was present.',
    notCovered: 'Knowledge gaps and support needs were not fully named in this session.',
    protective: ['Training completed', 'Supervision attended', 'Reflective notes completed', 'Scope of practice adhered to'],
    risk: ['Signs of reactive language in notes', 'Uncertainty not raised in supervision'],
    reflectivePrompts: [
      'What knowledge gaps showed up for me today?',
      'Did I work beyond my capability?',
      'Where did I feel uncertain?',
      'What support or supervision do I need?',
    ],
    safetyFlags: ['Working outside scope', 'Avoidance of supervision', 'Signs of compassion fatigue or burnout'],
  },
  {
    ...TE_WAHAROA_POU[5],
    discussed: 'Notes were completed on time. Reviews and reassessments were completed. Reporting obligations were met. Follow-through on previous actions was evidenced.',
    notCovered: 'Whānau feedback and supervision attendance were not fully documented.',
    protective: ['Notes completed on time', 'Reporting obligations met', 'Follow-through on actions evidenced'],
    risk: ['Documentation may be late or incomplete', 'Accountability follow-through inconsistent'],
    reflectivePrompts: [
      'Who am I accountable to in this situation?',
      'Did I follow through on commitments?',
      'Have I been transparent in my documentation?',
      'Did I avoid responsibility anywhere?',
    ],
    safetyFlags: ['Late or missing documentation', 'Repeated incomplete tasks', 'Discrepancies between notes and actions'],
  },
  {
    ...TE_WAHAROA_POU[6],
    discussed: 'Protective factors were identified and updated. Whānau strengths were documented. Connection to supports was noted. Cultural engagement was evidenced and improvements in wellbeing were tracked.',
    notCovered: 'Goal progression and mana restoration indicators were not fully explored.',
    protective: ['Protective factors identified and updated', 'Whānau strengths documented', 'Cultural engagement evidenced'],
    risk: ['No strengths documented in recent notes', 'Intervention focused solely on crisis'],
    reflectivePrompts: [
      'What sources of strength are emerging for this whānau?',
      'Did I focus too heavily on problems?',
      'How is mana being restored?',
      'What protective factors still need strengthening?',
    ],
    safetyFlags: ['No strengths documented', 'Whānau becoming increasingly isolated', 'Goals not reviewed or updated'],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// POU OVERVIEW — Safety Pou Journey entry
// Shows all seven Pou as a vertical journey before entering the first conversation
// ─────────────────────────────────────────────────────────────────────────────

function PouOverviewStage({
  data,
  onNext,
}: {
  data: ActiveSessionData
  onNext: () => void
}) {
  return (
    <div className="flex flex-col" style={{ fontFamily: 'var(--font-body)' }}>
      <div className="px-6 pt-8 pb-6">
        <p
          className="text-xs tracking-widest uppercase mb-5"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}
        >
          Ngā Pou Haumaru
        </p>
        <h2
          className="mb-3 leading-snug"
          style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--color-ink)' }}
        >
          Ngā Pou o Te Waharoa
        </h2>
        <p
          className="text-sm italic leading-relaxed"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
        >
          You will reflect through each Pou of Te Waharoa in turn — a focused
          conversation for each, then a brief review. Take each one at your own pace.
        </p>
      </div>

      {/* Six pou — architectural vertical list */}
      <div className="flex w-full mb-1" style={{ gap: 1 }}>
        {POU_EXTENDED.map((_, i) => (
          <div key={i} className="flex-1" style={{ height: 5, backgroundColor: 'var(--color-ridge)', opacity: 0.12 + i * 0.14 }} />
        ))}
      </div>

      <div className="px-5 pt-3 pb-4 space-y-px">
        {POU_EXTENDED.map((ext, i) => {
          return (
            <div
              key={i}
              className="flex items-start gap-4 px-4 py-4"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderLeft: '3px solid var(--color-border)',
              }}
            >
              {/* Pou shaft */}
              <div className="flex-shrink-0 flex flex-col items-center pt-1">
                <div style={{ width: 2, height: 28, backgroundColor: 'var(--color-ridge)', opacity: 0.25 }} />
                <p
                  className="text-center mt-1"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--color-ink-muted)', letterSpacing: '0.06em' }}
                >
                  {i + 1}
                </p>
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium leading-snug mb-0.5"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
                >
                  {ext.full}
                </p>
                <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                  {ext.domain}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Entry CTA — the beginning of the journey */}
      <div className="px-5 pt-4 pb-10">
        {/* Paepae */}
        <div className="relative flex items-center mb-6">
          <div className="flex-1" style={{ height: 1, backgroundColor: 'var(--color-border-strong)' }} />
          <div className="flex-shrink-0 px-3 py-1" style={{ backgroundColor: 'var(--color-surface-deep)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.18em', color: 'var(--color-ink-muted)' }}>
              PAEPAE
            </span>
          </div>
          <div className="flex-1" style={{ height: 1, backgroundColor: 'var(--color-border-strong)' }} />
        </div>
        <button
          onClick={onNext}
          className="w-full text-left transition-all active:opacity-85"
        >
          <div style={{ backgroundColor: 'var(--color-ridge)', padding: '1.375rem 1.25rem' }}>
            <div className="flex gap-1 mb-4" style={{ opacity: 0.18 }}>
              {[0,1,2,3,4,5,6].map((i) => (
                <div key={i} style={{ flex: 1, height: 2, backgroundColor: 'white' }} />
              ))}
            </div>
            <p className="text-lg font-medium italic mb-1" style={{ fontFamily: 'var(--font-display)', color: 'white', lineHeight: 1.3 }}>
              Tīmata — begin with Pou 1 of 7
            </p>
            <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em' }}>
              {POU_EXTENDED[0].full.toUpperCase()} →
            </p>
          </div>
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// POU CONVERSATION — Guided Reflection for one Pou of Te Waharoa
// Rich, focused reflective space scoped to the current Pou
// ─────────────────────────────────────────────────────────────────────────────

// ─── Guided Reflection types (shared with PouConversationStage) ───────────────
// Stage 2 — Guided Reflection (the central reflective space)
// ─── Guided Reflection types ──────────────────────────────────────────────────

type VoiceState =
  | 'not-connected'
  | 'connecting'
  | 'listening'
  | 'mic-active'
  | 'guide-speaking'
  | 'reconnecting'
  | 'ended'
  | 'mic-needed'
  | 'error'

interface TxMessage {
  id: string
  role: 'guide' | 'kaimahi'
  text: string
  time: string
}

// ─── Guided Reflection Stage ──────────────────────────────────────────────────

function GuidedReflectionStage({
  data,
  onChange,
  onNext,
  pouIdx,
}: {
  data: ActiveSessionData
  onChange: (p: Partial<ActiveSessionData>) => void
  onNext: () => void
  pouIdx?: number
}) {
  const pouExt = pouIdx !== undefined ? POU_EXTENDED[pouIdx] : undefined
  const [voiceState, setVoiceState] = useState<VoiceState>('not-connected')
  const [transcript, setTranscript] = useState<TxMessage[]>([])
  const [micActive, setMicActive] = useState(false)
  const [textFallback, setTextFallback] = useState(false)
  const [textInput, setTextInput] = useState('')
  const [pouDrawerOpen, setPouDrawerOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll transcript to bottom as messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [transcript])

  const nowTime = () =>
    new Date().toLocaleTimeString('en-NZ', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

  const addMessage = (role: 'guide' | 'kaimahi', text: string) => {
    setTranscript((prev) => [
      ...prev,
      { id: String(Date.now() + Math.random()), role, text, time: nowTime() },
    ])
  }

  // Demo: simulate connecting → first guide message → listening
  const handleConnect = (withText = false) => {
    if (withText) setTextFallback(true)
    setVoiceState('connecting')
    const openingMessage = pouExt
      ? `Nau mai — let us focus on ${pouExt.full}. Take a breath. What did you notice in this area for this whānau? What felt present, and what felt absent?`
      : "Nau mai — welcome. Take a breath and settle into this space. When you are ready, tell me about today's engagement. What happened?"
    setTimeout(() => {
      setVoiceState('guide-speaking')
      addMessage('guide', openingMessage)
      setTimeout(() => setVoiceState('listening'), 2600)
    }, 1800)
  }

  // Demo: mic toggle — tap to start, tap again to submit
  const handleMicToggle = () => {
    if (voiceState === 'listening' && !micActive) {
      setMicActive(true)
    } else if (voiceState === 'listening' && micActive) {
      setMicActive(false)
      // Simulate a kaimahi utterance being received
      addMessage(
        'kaimahi',
        "We visited the home today. Mere was there with two of the tamariki — she seemed tired but she was engaged. There were some concerns about the youngest child, something didn't feel settled."
      )
      setVoiceState('guide-speaking')
      setTimeout(() => {
        addMessage(
          'guide',
          "You noticed she was tired, and yet still present — that speaks to something real about her strength. What did you observe about the connection between Mere and the tamariki in that moment?"
        )
        setTimeout(() => setVoiceState('listening'), 2600)
      }, 500)
    }
  }

  // Demo: text submission
  const handleSendText = () => {
    if (!textInput.trim() || voiceState !== 'listening') return
    const text = textInput.trim()
    setTextInput('')
    addMessage('kaimahi', text)
    setVoiceState('guide-speaking')
    setTimeout(() => {
      addMessage(
        'guide',
        "That is important to hold. What felt protective in this engagement — something that gave you a sense of safety or stability for this whānau?"
      )
      setTimeout(() => setVoiceState('listening'), 2200)
    }, 600)
  }

  // End the voice session — write transcript to koreroText for downstream use
  const handleEndSession = () => {
    const text = transcript
      .map((m) => `[${m.role === 'guide' ? 'Ārahi' : 'Aroha'}] ${m.text}`)
      .join('\n\n')
    onChange({ koreroText: text })
    setVoiceState('ended')
  }

  // ── Status display config ────────────────────────────────────────────────

  const statusDisplay: Record<
    VoiceState,
    { label: string; sub: string; dotColor: string; pulse: boolean }
  > = {
    'not-connected':  { label: 'Tomokia — ready',              sub: 'Tap below to begin your reflection',                        dotColor: 'var(--color-border-strong)', pulse: false },
    connecting:       { label: 'Tomokia…',                     sub: 'Preparing your reflective space',                            dotColor: 'var(--color-ridge)',          pulse: true  },
    listening:        { label: 'Whakarongo — listening',       sub: textFallback ? 'Type your response below' : micActive ? 'Speaking — tap to finish' : 'Tap the circle to speak', dotColor: 'var(--color-growth)', pulse: false },
    'mic-active':     { label: 'Speaking…',                    sub: 'Tap to finish',                                              dotColor: 'var(--color-growth)',         pulse: true  },
    'guide-speaking': { label: 'Whakaaro tonu…',               sub: 'A question is coming',                                       dotColor: 'var(--color-ridge)',          pulse: true  },
    reconnecting:     { label: 'Hono anō…',                    sub: 'Restoring your reflective space',                            dotColor: 'var(--color-caution)',        pulse: true  },
    ended:            { label: 'Kua whiwhi — received',        sub: 'Your kōrero has been held',                                  dotColor: 'var(--color-growth)',         pulse: false },
    'mic-needed':     { label: 'Microphone needed',            sub: 'Allow microphone access, or use text below',                 dotColor: 'var(--color-caution)',        pulse: false },
    error:            { label: 'Unable to reach your space',   sub: 'Check your connection and try again',                        dotColor: 'var(--color-concern)',        pulse: false },
  }

  const status = statusDisplay[voiceState]
  const isActive = !['not-connected', 'mic-needed', 'error'].includes(voiceState)
  const isEnded = voiceState === 'ended'
  const micCanToggle = voiceState === 'listening'
  const isMicLive = voiceState === 'listening' && micActive

  // ── PRE-SESSION: not-connected / mic-needed / error ──────────────────────

  if (!isActive && !isEnded) {
    return (
      <div className="flex flex-col" style={{ minHeight: '82vh', fontFamily: 'var(--font-body)' }}>

        {/* Orientation */}
        <div className="px-6 pt-9 pb-7">
          <p
            className="text-xs tracking-widest uppercase mb-5"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}
          >
            {pouExt ? `Pou ${(pouIdx ?? 0) + 1} o 7 — Kōrero` : 'Kōrero Mai — Guided Reflection'}
          </p>
          <h2
            className="mb-3 leading-snug"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.5rem',
              fontWeight: 500,
              color: 'var(--color-ink)',
            }}
          >
            {pouExt ? pouExt.full : 'The reflective space is ready'}
          </h2>
          {pouExt && (
            <p className="text-xs mb-3" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.04em' }}>
              {pouExt.domain}
            </p>
          )}
          <p
            className="text-sm italic leading-relaxed"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
          >
            {pouExt
              ? `A focused conversation to explore ${pouExt.full.split(',')[0]} for this whānau. What did you notice, what was present, and what remains unclear?`
              : 'A guided conversation will help you review what happened, name what you noticed, and consider how the seven Te Waharoa Pou were present in this engagement.'}
          </p>
        </div>

        <div className="mx-6" style={{ height: 1, backgroundColor: 'var(--color-border)' }} />

        <div className="px-5 py-5 flex-1">
          {/* Session context */}
          <div
            className="flex items-center gap-4 px-4 py-3 mb-6"
            style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-ridge)' }}
          >
            <div>
              <p className="text-xs mb-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                WHĀNAU
              </p>
              <p className="text-sm font-medium" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
                {data.whanauCode || '—'}
              </p>
            </div>
            <div style={{ width: 1, height: 24, backgroundColor: 'var(--color-border)' }} />
            <div>
              <p className="text-xs mb-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                REF
              </p>
              <p className="text-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>
                {data.ref}
              </p>
            </div>
            <div className="ml-auto flex-shrink-0">
              <PouStrip pou={data.pou} compact />
            </div>
          </div>

          {/* Error / mic-needed callout */}
          {voiceState === 'error' && (
            <div
              className="px-4 py-3 mb-5"
              style={{ backgroundColor: 'var(--color-concern-light)', borderLeft: '3px solid var(--color-concern)' }}
            >
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-concern)' }}>
                Unable to connect
              </p>
              <p className="text-xs italic leading-relaxed" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                Check your connection and try again. If the problem persists, use text input instead.
              </p>
            </div>
          )}
          {voiceState === 'mic-needed' && (
            <div
              className="px-4 py-3 mb-5"
              style={{ backgroundColor: 'var(--color-caution-light)', borderLeft: '3px solid var(--color-caution)' }}
            >
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-caution)' }}>
                Microphone access needed
              </p>
              <p className="text-xs italic leading-relaxed" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                Allow microphone access in your browser or device settings. Or use text input below.
              </p>
            </div>
          )}

          {/* Privacy note */}
          <p
            className="text-xs italic mb-5"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
          >
            Your kōrero is held securely — not stored on this device.
          </p>
        </div>

        {/* Entry options */}
        <div className="px-5 pb-8 space-y-2">
          {/* Primary: begin voice */}
          <button
            onClick={() => handleConnect(false)}
            className="w-full text-left transition-all active:opacity-85"
          >
            <div style={{ backgroundColor: 'var(--color-ridge)', padding: '1.375rem 1.25rem' }}>
              <div className="flex gap-1 mb-4" style={{ opacity: 0.18 }}>
                {[0,1,2,3,4,5,6].map((i) => (
                  <div key={i} style={{ flex: 1, height: 2, backgroundColor: 'white' }} />
                ))}
              </div>
              <p
                className="text-lg font-medium italic mb-1"
                style={{ fontFamily: 'var(--font-display)', color: 'white', lineHeight: 1.3 }}
              >
                Begin voice reflection
              </p>
              <p
                className="text-xs"
                style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em' }}
              >
                TĪMATA KŌRERO →
              </p>
            </div>
          </button>

          {/* Secondary: text instead */}
          <button
            onClick={() => handleConnect(true)}
            className="w-full text-left px-4 py-3.5 transition-opacity hover:opacity-80 min-h-[48px]"
            style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}
          >
            <span
              className="text-sm"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.03em' }}
            >
              Use text instead — for private settings
            </span>
          </button>
        </div>

      </div>
    )
  }

  // ── ACTIVE / ENDED session ───────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes pulse-dot-breath {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes mic-ring-expand {
          0% { transform: scale(1); opacity: 0.55; }
          100% { transform: scale(2); opacity: 0; }
        }
        @keyframes guide-border-breath {
          0%, 100% { border-left-color: rgba(19,102,204,0.3); }
          50% { border-left-color: rgba(19,102,204,0.95); }
        }
      `}</style>

      <div
        className="flex flex-col"
        style={{ height: '100%', minHeight: '82vh', fontFamily: 'var(--font-body)' }}
      >

        {/* ── Compact header: whānau · ref + pou ── */}
        <div
          className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5"
          style={{
            backgroundColor: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span
              className="text-xs font-medium"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
            >
              {data.whanauCode || '—'}
            </span>
            <div style={{ width: 1, height: 10, backgroundColor: 'var(--color-border-strong)', flexShrink: 0 }} />
            <span
              className="text-xs"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}
            >
              {data.ref}
            </span>
            <span
              className="text-xs italic"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
            >
              {data.sessionFocus ? `· ${data.sessionFocus}` : ''}
            </span>
          </div>

          {/* Safety Pou — compact tappable strip */}
          <button
            onClick={() => setPouDrawerOpen((o) => !o)}
            className="flex-shrink-0 flex items-center gap-1.5 transition-opacity hover:opacity-80 active:opacity-60 min-h-[36px]"
            title="Te Waharoa Pou — tap to view"
          >
            <PouStrip pou={data.pou} compact />
            <span
              className="text-xs"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
            >
              Pou
            </span>
          </button>
        </div>

        {/* ── Pou drawer ── */}
        {pouDrawerOpen && (
          <div
            className="flex-shrink-0"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <div className="px-4 pt-3 pb-4">
              <p
                className="text-xs tracking-wide mb-3"
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
              >
                SAFETY POU — being considered through this kōrero
              </p>
              <div className="grid grid-cols-2 gap-px">
                {data.pou.map((p) => {
                  const c = STATUS_CONFIG[p.status]
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-2.5 py-2 px-3"
                      style={{
                        backgroundColor: 'var(--color-ground)',
                        borderLeft: `2px solid ${c.color}`,
                        opacity: p.status === 'kore' ? 0.5 : 1,
                      }}
                    >
                      <span
                        className="text-xs font-medium flex-1"
                        style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
                      >
                        {p.reo}
                      </span>
                      <span
                        className="text-xs"
                        style={{ fontFamily: 'var(--font-mono)', color: c.color }}
                      >
                        {p.status === 'kore' ? '—' : c.label}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p
                className="text-xs italic mt-2.5"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
              >
                Te Waharoa Pou review follows this step.
              </p>
            </div>
          </div>
        )}

        {/* ── Transcript — the central reflective space ── */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
          style={{ minHeight: 0 }}
        >
          {/* Empty / connecting state */}
          {transcript.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
              {voiceState === 'connecting' && (
                <>
                  <div className="flex items-end gap-1.5 mb-6">
                    {[0, 0.25, 0.5].map((d, i) => (
                      <div
                        key={i}
                        style={{
                          width: 6,
                          height: 6,
                          backgroundColor: 'var(--color-ridge)',
                          animation: `pulse-dot-breath 1s ease-in-out infinite`,
                          animationDelay: `${d}s`,
                        }}
                      />
                    ))}
                  </div>
                  <p
                    className="text-sm italic"
                    style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
                  >
                    Preparing your reflective space…
                  </p>
                </>
              )}
            </div>
          )}

          {/* Message stream */}
          <div className="py-4 space-y-2">
            {transcript.map((msg, i) => {
              const isLatestGuide =
                msg.role === 'guide' &&
                voiceState === 'guide-speaking' &&
                i === transcript.length - 1

              if (msg.role === 'guide') {
                return (
                  <div
                    key={msg.id}
                    className="px-5 py-4"
                    style={{
                      borderLeft: '3px solid var(--color-ridge)',
                      backgroundColor: 'var(--color-surface)',
                      animation: isLatestGuide
                        ? 'guide-border-breath 1.5s ease-in-out infinite'
                        : 'none',
                    }}
                  >
                    <p
                      className="italic leading-[1.85]"
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '0.95rem',
                        color: 'var(--color-ink)',
                      }}
                    >
                      {msg.text}
                    </p>
                    <p
                      className="text-xs mt-2"
                      style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                    >
                      {msg.time}
                    </p>
                  </div>
                )
              }

              // Kaimahi message — indented, quieter
              return (
                <div
                  key={msg.id}
                  className="px-5 py-3.5 mx-5"
                  style={{
                    borderLeft: '2px solid var(--color-border)',
                  }}
                >
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: 'var(--color-ink-secondary)' }}
                  >
                    {msg.text}
                  </p>
                  <p
                    className="text-xs mt-1.5"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                  >
                    {msg.time} · Aroha
                  </p>
                </div>
              )
            })}

            {/* Whakaaro tonu — reflecting indicator */}
            {voiceState === 'guide-speaking' && transcript.length > 0 && (
              <div
                className="flex items-center gap-3 px-5 py-3"
                style={{ borderLeft: '3px solid var(--color-ridge)', animation: 'guide-border-breath 1.5s ease-in-out infinite' }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    backgroundColor: 'var(--color-ridge)',
                    animation: 'pulse-dot-breath 1.5s ease-in-out infinite',
                  }}
                />
                <p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
                  Whakaaro tonu…
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Controls — always visible at the bottom ── */}
        <div
          className="flex-shrink-0"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          {/* Status strip — what is happening + what to do */}
          <div
            className="flex items-center gap-3 px-5 py-3"
            style={{ backgroundColor: 'var(--color-surface)' }}
          >
            <div
              className="flex-shrink-0"
              style={{
                width: 8,
                height: 8,
                backgroundColor: status.dotColor,
                animation: status.pulse ? 'pulse-dot-breath 1s ease-in-out infinite' : 'none',
              }}
            />
            <div className="flex-1 min-w-0">
              <p
                className="text-xs font-medium leading-tight"
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink)' }}
              >
                {status.label}
              </p>
              <p
                className="text-xs italic leading-tight mt-0.5"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
              >
                {status.sub}
              </p>
            </div>
            {/* End button — once session has exchanges */}
            {!isEnded && transcript.length >= 2 && (
              <button
                onClick={handleEndSession}
                className="flex-shrink-0 px-3 py-1.5 text-xs transition-opacity hover:opacity-70 active:opacity-50 min-h-[36px]"
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-ink-muted)',
                  border: '1px solid var(--color-border-strong)',
                  letterSpacing: '0.04em',
                }}
              >
                End session
              </button>
            )}
          </div>

          {/* Text fallback input — only when in text mode and it's kaimahi turn */}
          {textFallback && voiceState === 'listening' && (
            <div
              className="flex items-end gap-2 px-4 py-3"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendText()
                  }
                }}
                placeholder="Type your response…"
                rows={2}
                className="flex-1 text-sm leading-relaxed resize-none px-3 py-2.5"
                style={{
                  fontFamily: 'var(--font-body)',
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-ink)',
                  border: 'none',
                  borderLeft: '3px solid var(--color-ridge)',
                  outline: 'none',
                  caretColor: 'var(--color-ridge)',
                }}
                autoFocus
              />
              <button
                onClick={handleSendText}
                disabled={!textInput.trim()}
                className="flex-shrink-0 px-4 transition-opacity min-h-[52px] min-w-[52px]"
                style={{
                  backgroundColor: textInput.trim() ? 'var(--color-ridge)' : 'var(--color-surface)',
                  color: textInput.trim() ? 'white' : 'var(--color-ink-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  letterSpacing: '0.06em',
                }}
              >
                Send
              </button>
            </div>
          )}

          {/* Voice controls — not ended, not text-mode */}
          {!isEnded && !textFallback && (
            <div className="flex items-center justify-center gap-10 px-5 py-5">
              {/* Text fallback toggle */}
              <button
                onClick={() => setTextFallback(true)}
                className="text-xs transition-opacity hover:opacity-70 min-h-[44px] px-2"
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
              >
                Use text
              </button>

              {/* Primary mic button */}
              <div className="relative flex items-center justify-center">
                {/* Pulse ring — only when mic is live */}
                {isMicLive && (
                  <div
                    className="absolute"
                    style={{
                      width: 72,
                      height: 72,
                      border: '2px solid var(--color-growth)',
                      animation: 'mic-ring-expand 1.1s ease-out infinite',
                    }}
                  />
                )}
                <button
                  onClick={handleMicToggle}
                  disabled={voiceState !== 'listening'}
                  className="relative flex flex-col items-center justify-center transition-all active:scale-95"
                  style={{
                    width: 72,
                    height: 72,
                    backgroundColor: isMicLive
                      ? 'var(--color-growth)'
                      : voiceState === 'listening'
                        ? 'var(--color-ridge)'
                        : 'var(--color-surface)',
                    cursor: voiceState === 'listening' ? 'pointer' : 'default',
                    opacity: voiceState === 'listening' ? 1 : 0.35,
                    transition: 'background-color 0.2s ease',
                  }}
                >
                  {/* Structural mic mark */}
                  <div
                    style={{
                      width: 2,
                      height: isMicLive ? 22 : 16,
                      backgroundColor: voiceState === 'listening' ? 'white' : 'var(--color-ink-muted)',
                      marginBottom: 3,
                      transition: 'height 0.2s ease',
                    }}
                  />
                  <div
                    style={{
                      width: 12,
                      height: 2,
                      backgroundColor: voiceState === 'listening' ? 'white' : 'var(--color-ink-muted)',
                    }}
                  />
                </button>
              </div>

              {/* Reconnect or spacer */}
              {voiceState === 'reconnecting' ? (
                <button
                  onClick={() => handleConnect(textFallback)}
                  className="text-xs transition-opacity hover:opacity-70 min-h-[44px] px-2"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-caution)' }}
                >
                  Retry
                </button>
              ) : (
                <div style={{ width: 60 }} aria-hidden />
              )}
            </div>
          )}

          {/* Voice mode — switch to voice when in text mode */}
          {!isEnded && textFallback && (
            <div className="flex justify-center py-4">
              <button
                onClick={() => setTextFallback(false)}
                className="text-xs px-4 py-2 min-h-[40px] transition-opacity hover:opacity-70"
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-ink-muted)',
                  border: '1px solid var(--color-border-strong)',
                }}
              >
                Switch to voice
              </button>
            </div>
          )}

          {/* Ended — proceed to Safety Pou review */}
          {isEnded && (
            <div className="px-5 py-5">
              <button
                onClick={onNext}
                className="w-full text-left transition-all active:opacity-85"
              >
                <div style={{ backgroundColor: 'var(--color-ridge)', padding: '1.25rem 1.25rem' }}>
                  <div className="flex gap-1 mb-4" style={{ opacity: 0.18 }}>
                    {[0,1,2,3,4,5,6].map((i) => (
                      <div key={i} style={{ flex: 1, height: 2, backgroundColor: 'white' }} />
                    ))}
                  </div>
                  <p
                    className="text-lg font-medium italic mb-1"
                    style={{ fontFamily: 'var(--font-display)', color: 'white', lineHeight: 1.3 }}
                  >
                    Haere tonu — Te Waharoa Pou review
                  </p>
                  <p
                    className="text-xs"
                    style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em' }}
                  >
                    REVIEW THE SEVEN POU →
                  </p>
                </div>
              </button>
            </div>
          )}

        </div>
      </div>
    </>
  )
}

// Synthesising loader
// ─── Pou Conversation Stage ───────────────────────────────────────────────────
// Thin wrapper: GuidedReflectionStage focused on a single Pou of Te Waharoa

function PouConversationStage({
  data,
  onChange,
  onNext,
  onReflectionEnded,
  pouIdx,
  workflowId,
}: {
  data: ActiveSessionData
  onChange: (p: Partial<ActiveSessionData>) => void
  onNext: () => void
  onReflectionEnded: () => void
  pouIdx: number
  workflowId: string
}) {
  return (
    <VoiceChunkBoundary onProceedToReview={onNext}>
      <Suspense fallback={<VoiceChunkLoading onProceedToReview={onNext} />}>
        <ElevenLabsConversation workflowId={workflowId} pouId={TE_WAHAROA_POU[pouIdx]!.id} onProceedToReview={onNext} onReflectionEnded={onReflectionEnded} />
      </Suspense>
    </VoiceChunkBoundary>
  )
}

// ─── Single Pou Review Stage ──────────────────────────────────────────────────
// Structured review of one Te Waharoa Pou — what was held, what it means, next move

type ConcernLevel = 'low' | 'watch' | 'action' | 'urgent'

const CONCERN_META: Record<ConcernLevel, { label: string; color: string; bg: string }> = {
  low:    { label: 'Low concern',       color: 'var(--color-growth)',  bg: '#f0f9e4' },
  watch:  { label: 'Watch closely',     color: 'var(--color-caution)', bg: '#fffbe0' },
  action: { label: 'Action needed',     color: 'var(--color-concern)', bg: '#fff1f0' },
  urgent: { label: 'Urgent concern', color: 'var(--color-concern)', bg: '#fee8e6' },
}

export function PouAssessmentCandidates({
  workflowId,
  pouId,
  hasReviewableCandidate = false,
  onConfirm,
  onReviewableCandidatesChange,
}: {
  workflowId: string
  pouId: (typeof TE_WAHAROA_POU)[number]['id']
  /** Authoritative review-read signal; the lookup itself remains read-only. */
  hasReviewableCandidate?: boolean
  onConfirm: (candidate: PouAssessmentCandidate, level: SafetyObservationConcernLevel, pouId: (typeof TE_WAHAROA_POU)[number]['id']) => boolean | void | Promise<boolean | void>
  /** Lets the Pou confirmation control truthfully mirror the authoritative candidate read. */
  onReviewableCandidatesChange?: (hasUnresolvedCandidates: boolean) => void
}) {
  const [candidates, setCandidates] = useState<PouAssessmentCandidate[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [selected, setSelected] = useState<Record<string, SafetyObservationConcernLevel | undefined>>({})
  const activeCandidateRequest = useRef<number | null>(null)
  const candidateRequestGeneration = useRef(0)
  const automaticallyLoadedFor = useRef<string | null>(null)
  const load = () => {
    if (activeCandidateRequest.current !== null) return
    const requestGeneration = ++candidateRequestGeneration.current
    activeCandidateRequest.current = requestGeneration
    setState('loading')
    void getPouAssessmentCandidates(workflowId, pouId).then((items) => {
      if (activeCandidateRequest.current !== requestGeneration) return
      activeCandidateRequest.current = null
      setCandidates(items)
      onReviewableCandidatesChange?.(items.length > 0)
      setState('idle')
    }).catch(() => {
      if (activeCandidateRequest.current !== requestGeneration) return
      activeCandidateRequest.current = null
      setState('failed')
    })
  }
  useEffect(() => {
    candidateRequestGeneration.current += 1
    activeCandidateRequest.current = null
    automaticallyLoadedFor.current = null
    setCandidates([])
    setSelected({})
    setState('idle')
    return () => {
      candidateRequestGeneration.current += 1
      activeCandidateRequest.current = null
    }
  }, [workflowId, pouId, onReviewableCandidatesChange])
  useEffect(() => {
    if (!hasReviewableCandidate) return
    const key = `${workflowId}:${pouId}`
    if (automaticallyLoadedFor.current === key) return
    automaticallyLoadedFor.current = key
    load()
  }, [hasReviewableCandidate, workflowId, pouId])
  if (!candidates.length && state === 'idle') return <div className="flex justify-between gap-3 px-4 py-3" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}><p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>You can check whether a formal safety concern needs your review.</p><button type="button" onClick={load} className="text-xs flex-shrink-0" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>Check again</button></div>
  return <div className="space-y-3" aria-live="polite">
    {state === 'loading' && <p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>Checking whether a formal safety concern needs your review…</p>}
    {state === 'failed' && <div className="flex justify-between gap-3"><p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>The formal safety review could not be loaded. Your Pou review remains available.</p><button type="button" onClick={load} className="text-xs flex-shrink-0" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>Check again</button></div>}
    {candidates.map((candidate) => candidate.outcome === 'possible_concern' ? <div key={candidate.id} className="p-4 space-y-3" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-caution)' }}>
      <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-caution)', letterSpacing: '0.08em' }}>POSSIBLE CONCERN FOR YOUR REVIEW</p>
      <p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>The reflection suggests this may need your attention. This has not been confirmed.</p>
      <p className="text-sm" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>{candidate.title}</p>
      <p className="text-xs" style={{ color: 'var(--color-ink-secondary)' }}>{candidate.description}</p>
      <fieldset><legend className="text-xs mb-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>HOW WOULD YOU ASSESS THIS?</legend><div className="grid grid-cols-2 gap-1.5">{candidate.permittedHumanConcernLevels.map((level) => <button type="button" key={level} onClick={() => setSelected((current) => ({ ...current, [candidate.id]: level }))} className="px-3 py-2 text-left text-xs" style={{ backgroundColor: selected[candidate.id] === level ? 'var(--color-caution-light)' : 'var(--color-ground)', borderLeft: `3px solid ${selected[candidate.id] === level ? 'var(--color-caution)' : 'var(--color-border)'}`, fontFamily: 'var(--font-mono)', color: 'var(--color-ink-secondary)' }}>{level[0]!.toUpperCase() + level.slice(1)}</button>)}</div></fieldset>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={!selected[candidate.id]}
          onClick={() => { if (!selected[candidate.id]) return; void Promise.resolve(onConfirm(candidate, selected[candidate.id]!, pouId)).then((confirmed) => { if (confirmed !== false) load() }).catch(() => undefined) }}
          className="min-h-11 px-4 py-3 text-sm disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ backgroundColor: 'var(--color-concern)', color: 'white', fontFamily: 'var(--font-mono)' }}
        >
          Confirm concern
        </button>
        <button
          type="button"
          onClick={() => void reviewPouAssessmentCandidate(workflowId, candidate.id, 'dismissed').then(load).catch(() => setState('failed'))}
          className="min-h-11 px-4 py-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-ridge)', color: 'var(--color-ridge)', fontFamily: 'var(--font-mono)' }}
        >
          Dismiss suggestion
        </button>
      </div>
    </div> : candidate.outcome === 'insufficient_information' ? <div key={candidate.id} className="p-4 space-y-2" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border-strong)' }}><p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>MORE INFORMATION MAY BE NEEDED</p><p className="text-xs" style={{ color: 'var(--color-ink-secondary)' }}>This formal safety review needs more information before you can continue. Acknowledging this records only that you have reviewed the information state; it does not record a safety concern.</p><button type="button" onClick={() => void reviewPouAssessmentCandidate(workflowId, candidate.id, 'insufficient_information_acknowledged').then(load).catch(() => setState('failed'))} className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>Acknowledge information still needed</button></div> : null)}
  </div>
}

export function PouNarrativeReview({
  workflowId,
  pouId,
  onDraftState,
  carriedSources = new Set(),
  onMarkCarryForward = () => undefined,
  presentation = 'review',
  onReviewReady,
  onManualReview,
}: {
  workflowId: string
  pouId: (typeof TE_WAHAROA_POU)[number]['id']
  onDraftState: (state: { reviewDraftRevisionId?: string; hasUnsavedChanges: boolean; loaded: boolean; hasReviewableCandidate?: boolean }) => void
  carriedSources?: Set<string>
  onMarkCarryForward?: (source: WorkflowCarryForwardSource) => void
  presentation?: 'review' | 'processing'
  onReviewReady?: () => void
  onManualReview?: () => void
}) {
  const REVIEW_DRAFT_POLL_INTERVAL_MILLISECONDS = 4_000
  const MAXIMUM_AUTOMATIC_REVIEW_DRAFT_POLLS = 15
  const [review, setReview] = useState<PouReviewDraftState | null>(null)
  const [draft, setDraft] = useState<PouReviewDraft | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [saveError, setSaveError] = useState<'failed' | 'ambiguous' | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [automaticPollCount, setAutomaticPollCount] = useState(0)
  const activeReviewRequest = useRef<number | null>(null)
  const reviewRequestGeneration = useRef(0)
  const readyTransitionRevision = useRef<string | null>(null)
  const load = (preserveLocalDraftOnFailure = false, resetAutomaticPolling = false) => {
    if (resetAutomaticPolling) setAutomaticPollCount(0)
    if (activeReviewRequest.current !== null) return
    const requestGeneration = ++reviewRequestGeneration.current
    activeReviewRequest.current = requestGeneration
    setLoadError(false)
    void getPouReviewDraft(workflowId, pouId).then((next) => {
      if (activeReviewRequest.current !== requestGeneration) return
      activeReviewRequest.current = null
      setReview(next)
      setDraft(next.draft)
      setDirty(false)
      setSaveError(null)
      // A formal candidate is independently authoritative. A failed/manual
      // narrative draft must not hide it or enable Pou confirmation.
      onDraftState({ reviewDraftRevisionId: next.draft?.revisionId, hasUnsavedChanges: false, loaded: true, hasReviewableCandidate: next.hasReviewableCandidate })
      setAutomaticPollCount((current) => next.status === 'analysing' ? (resetAutomaticPolling ? 1 : current + 1) : 0)
      if (next.draft && presentation !== 'processing') void markPouReviewDraftReviewed(workflowId, pouId, next.draft.id).catch(() => undefined)
    }).catch(() => {
      if (activeReviewRequest.current !== requestGeneration) return
      activeReviewRequest.current = null
      if (preserveLocalDraftOnFailure && draft) {
        setSaveError('ambiguous')
        return
      }
      setLoadError(true)
      onDraftState({ hasUnsavedChanges: false, loaded: false })
    })
  }
  useEffect(() => {
    reviewRequestGeneration.current += 1
    activeReviewRequest.current = null
    setAutomaticPollCount(0)
    load()
    return () => {
      reviewRequestGeneration.current += 1
      activeReviewRequest.current = null
    }
  }, [workflowId, pouId])
  useEffect(() => {
    if (review?.status !== 'analysing' || automaticPollCount >= MAXIMUM_AUTOMATIC_REVIEW_DRAFT_POLLS || activeReviewRequest.current !== null) return
    const timer = window.setTimeout(load, REVIEW_DRAFT_POLL_INTERVAL_MILLISECONDS)
    return () => window.clearTimeout(timer)
  }, [review, automaticPollCount, workflowId, pouId])
  useEffect(() => {
    const revisionId = presentation === 'processing' && review?.status === 'ready' ? draft?.revisionId : undefined
    if (!revisionId || readyTransitionRevision.current === revisionId) return
    readyTransitionRevision.current = revisionId
    onReviewReady?.()
  }, [draft?.revisionId, onReviewReady, presentation, review?.status])
  const update = (field: 'overallSummary' | 'strengthsSummary' | 'areasForAttentionSummary', value: string) => {
    if (!draft) return
    const next = { ...draft, [field]: value.trim() ? value : null }
    setDraft(next); setDirty(true); onDraftState({ reviewDraftRevisionId: draft.revisionId, hasUnsavedChanges: true, loaded: true })
  }
  const save = () => {
    if (!draft) return
    setSaving(true)
    void editPouReviewDraft(workflowId, pouId, { reviewDraftId: draft.id, expectedRevision: draft.revision, overallSummary: draft.overallSummary, strengthsSummary: draft.strengthsSummary, areasForAttentionSummary: draft.areasForAttentionSummary, evidenceTurnIds: draft.evidenceTurnIds })
      .then((saved) => { setDraft(saved); setDirty(false); setSaveError(null); onDraftState({ reviewDraftRevisionId: saved.revisionId, hasUnsavedChanges: false, loaded: true }) })
      .catch((error) => setSaveError(error instanceof WorkflowApiError && error.code === 'stale_review_draft' ? 'ambiguous' : 'failed')).finally(() => setSaving(false))
  }
  if (presentation === 'processing') {
    if (loadError) return <PostReflectionProcessingScreen state="lookup-failed" onCheckAgain={() => load(false, true)} />
    if (!review || review.status === 'analysing') return <PostReflectionProcessingScreen state={automaticPollCount >= MAXIMUM_AUTOMATIC_REVIEW_DRAFT_POLLS ? 'waiting' : 'processing'} onCheckAgain={automaticPollCount >= MAXIMUM_AUTOMATIC_REVIEW_DRAFT_POLLS ? () => load(false, true) : undefined} />
    if (review.status === 'ready' && draft) return <PostReflectionProcessingScreen state="opening" />
    if (review.status === 'failed') return <PostReflectionProcessingScreen state="failed" onContinueManual={onManualReview} />
    return <PostReflectionProcessingScreen state="manual" onContinueManual={onManualReview} />
  }
  if (loadError) return <div style={{ borderLeft: '3px solid var(--color-border-strong)', backgroundColor: 'var(--color-surface)', padding: '0.875rem 1rem' }}><p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>The reflection review could not be loaded. Manual Pou review remains available.</p><button type="button" onClick={() => load(false, true)} className="text-xs mt-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>Check again</button></div>
  if (!review || review.status === 'analysing') return <div aria-live="polite" style={{ borderLeft: '3px solid var(--color-ridge)', backgroundColor: 'var(--color-surface)', padding: '0.875rem 1rem' }}><p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>Analysing your reflection…</p><p className="text-xs mt-1" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>{automaticPollCount >= MAXIMUM_AUTOMATIC_REVIEW_DRAFT_POLLS ? 'Processing is still underway. Check again when you are ready.' : 'Your Pou review remains yours to complete.'}</p>{automaticPollCount >= MAXIMUM_AUTOMATIC_REVIEW_DRAFT_POLLS && <button type="button" onClick={() => load(false, true)} className="text-xs mt-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>Check again</button>}</div>
  if (review.status === 'failed') return <div style={{ borderLeft: '3px solid var(--color-border-strong)', backgroundColor: 'var(--color-surface)', padding: '0.875rem 1rem' }}><p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>A reflection draft could not be prepared.</p><p className="text-xs mt-1" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>Manual Pou review remains available. This does not change any safety decision.</p></div>
  if (review.status === 'manual' || !draft) return <div style={{ borderLeft: '3px solid var(--color-border)', backgroundColor: 'var(--color-surface)', padding: '0.875rem 1rem' }}><p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>Manual {TE_WAHAROA_POU.find((pou) => pou.id === pouId)?.reo} review</p><p className="text-xs mt-1" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>No reflection draft is available. Complete your own Pou review below.</p></div>
  return <div className="space-y-3" aria-live="polite">
    <div style={{ borderLeft: '3px solid var(--color-ridge)', backgroundColor: 'var(--color-surface)', padding: '0.875rem 1rem' }}>
      <p className="text-xs mb-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.08em' }}>WHAT WE HEARD — REVIEW DRAFT</p>
      <p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>This is a noncanonical draft from the reflection. Edit it before you confirm your Pou review.</p>
    </div>
    {draft.criterionAssessments && <StructuredCriterionReview draft={draft} carriedSources={carriedSources} onMarkCarryForward={onMarkCarryForward} />}
    {([['overallSummary', 'OVERALL REFLECTION'], ['strengthsSummary', 'STRENGTHS / PROTECTIVE FACTORS'], ['areasForAttentionSummary', 'AREAS FOR ATTENTION']] as const).map(([field, label]) => <div key={field} style={{ borderLeft: '3px solid var(--color-border)', backgroundColor: 'var(--color-surface)', padding: '0.875rem 1rem' }}><p className="text-xs mb-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}>{label}</p><textarea value={draft[field] ?? ''} disabled={saving} onChange={(event) => update(field, event.target.value)} placeholder="Not identified in this reflection" rows={field === 'overallSummary' ? 4 : 3} className="w-full resize-none text-sm leading-relaxed outline-none disabled:opacity-70" style={{ color: 'var(--color-ink-secondary)', backgroundColor: 'transparent', fontFamily: 'var(--font-body)' }} /></div>)}
    {saveError === 'failed' && <div style={{ borderLeft: '3px solid var(--color-border-strong)', backgroundColor: 'var(--color-surface)', padding: '0.875rem 1rem' }}><p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>Your review changes could not be saved. They are still shown here and have not been confirmed.</p><button type="button" onClick={save} disabled={saving} className="text-xs mt-2 disabled:opacity-50" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>Try saving again</button></div>}
    {saveError === 'ambiguous' && <div style={{ borderLeft: '3px solid var(--color-border-strong)', backgroundColor: 'var(--color-surface)', padding: '0.875rem 1rem' }}><p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>We could not confirm whether your changes were saved. Your wording is still shown here and has not been confirmed.</p><button type="button" onClick={() => load(true, true)} className="text-xs mt-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>Load current saved review</button></div>}
    {dirty && <button type="button" onClick={save} disabled={saving} className="w-full px-4 py-3 text-sm disabled:opacity-50" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-ridge)', color: 'var(--color-ridge)', fontFamily: 'var(--font-mono)' }}>{saving ? 'Saving review…' : 'Save review changes'}</button>}
    {review.assessmentCompleted && !review.hasReviewableCandidate && <SafetyReviewCompleteNotice resolvedSafetyReview={review.resolvedSafetyReview} />}
  </div>
}

function SafetyReviewCompleteNotice({
  resolvedSafetyReview = { confirmedCount: 0, dismissedCount: 0, insufficientInformationAcknowledgedCount: 0 },
}: {
  resolvedSafetyReview?: { confirmedCount: number; dismissedCount: number; insufficientInformationAcknowledgedCount: number }
}) {
  const { confirmedCount, dismissedCount, insufficientInformationAcknowledgedCount } = resolvedSafetyReview
  const message = confirmedCount > 0
    ? 'All identified safety concerns from this reflection have been reviewed.'
    : insufficientInformationAcknowledgedCount > 0 && dismissedCount > 0
      ? 'Suggested safety concerns and information still needed for the safety review have been reviewed.'
      : insufficientInformationAcknowledgedCount > 0
        ? 'Information still needed for the safety review has been acknowledged.'
        : dismissedCount > 1
          ? 'The suggested safety concerns have been reviewed.'
          : dismissedCount === 1
            ? 'The suggested safety concern has been reviewed.'
            : 'No formal safety concern was identified for review.'
  return <div style={{ borderLeft: '3px solid var(--color-growth)', backgroundColor: 'var(--color-surface)', padding: '0.875rem 1rem' }}>
    <p className="text-sm" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>Safety review complete</p>
    <p className="text-xs mt-1 italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>{message}</p>
  </div>
}

function PostReflectionProcessingScreen({
  state,
  onCheckAgain,
  onContinueManual,
}: {
  state: 'processing' | 'waiting' | 'opening' | 'lookup-failed' | 'failed' | 'manual'
  onCheckAgain?: () => void
  onContinueManual?: () => void
}) {
  const waiting = state === 'processing' || state === 'waiting' || state === 'opening'
  const heading = state === 'waiting'
    ? 'Still bringing your reflection together…'
    : state === 'opening'
      ? 'Opening your Pou review…'
      : 'Bringing together your reflection…'
  const detail = state === 'waiting'
    ? 'We’re still preparing your Pou review.'
    : 'We’re reviewing what you’ve shared and preparing your Pou review.'

  return (
    <div className="flex flex-col items-center justify-center text-center px-6" style={{ minHeight: '72vh', fontFamily: 'var(--font-body)' }} aria-live="polite">
      {waiting && <>
        <div className="flex items-end gap-1.5 mb-10" style={{ height: 54 }} role="img" aria-label="Preparing your Pou review">
          {[30, 46, 24, 52, 38, 28, 44].map((height, index) => (
            <div
              key={height}
              className="reflection-processing-pou"
              style={{ width: 7, height, backgroundColor: 'var(--color-ridge)', animationDelay: `${index * 0.24}s` }}
            />
          ))}
        </div>
        <p className="text-xl italic mb-3" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>{heading}</p>
        <p className="text-sm italic leading-relaxed max-w-sm" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>{detail}</p>
        {state !== 'opening' && <p className="text-xs mt-5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>This can take around 30 seconds.</p>}
        {onCheckAgain && <button type="button" onClick={onCheckAgain} className="text-xs mt-5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>Check again</button>}
      </>}
      {state === 'lookup-failed' && <>
        <p className="text-xl italic mb-3" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>We couldn’t check whether your review is ready.</p>
        <p className="text-sm italic leading-relaxed max-w-sm" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>Your reflection remains available. Check again when you are ready.</p>
        {onCheckAgain && <button type="button" onClick={onCheckAgain} className="mt-6 px-4 py-3 text-sm" style={{ borderLeft: '3px solid var(--color-ridge)', backgroundColor: 'var(--color-surface)', color: 'var(--color-ridge)', fontFamily: 'var(--font-mono)' }}>Check again</button>}
      </>}
      {state === 'failed' && <>
        <p className="text-xl italic mb-3" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>We couldn’t finish preparing your review.</p>
        <p className="text-sm italic leading-relaxed max-w-sm" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>Your reflection has been saved. You can continue with your own Pou review.</p>
        {onContinueManual && <button type="button" onClick={onContinueManual} className="mt-6 px-4 py-3 text-sm" style={{ backgroundColor: 'var(--color-ridge)', color: 'white', fontFamily: 'var(--font-mono)' }}>Continue with Pou review</button>}
      </>}
      {state === 'manual' && <>
        <p className="text-xl italic mb-3" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>Your Pou review is ready for you.</p>
        <p className="text-sm italic leading-relaxed max-w-sm" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>No reflection draft is available for this Pou.</p>
        {onContinueManual && <button type="button" onClick={onContinueManual} className="mt-6 px-4 py-3 text-sm" style={{ backgroundColor: 'var(--color-ridge)', color: 'white', fontFamily: 'var(--font-mono)' }}>Continue with Pou review</button>}
      </>}
    </div>
  )
}

export function PouReviewProcessingStage({
  workflowId,
  pouId,
  onReady,
  onManualReview,
}: {
  workflowId: string
  pouId: (typeof TE_WAHAROA_POU)[number]['id']
  onReady: () => void
  onManualReview: () => void
}) {
  return <PouNarrativeReview
    workflowId={workflowId}
    pouId={pouId}
    presentation="processing"
    onDraftState={() => undefined}
    onReviewReady={onReady}
    onManualReview={onManualReview}
  />
}

function StructuredCriterionReview({
  draft,
  carriedSources,
  onMarkCarryForward,
}: {
  draft: PouReviewDraft
  carriedSources: Set<string>
  onMarkCarryForward: (source: WorkflowCarryForwardSource) => void
}) {
  const assessments = draft.criterionAssessments ?? []
  const established = assessments.filter(({ status }) => status === 'evidenced')
  const strengths = assessments.filter(({ strengthsOrProtective, status }) => strengthsOrProtective && (status === 'evidenced' || status === 'partially_evidenced'))
  const stillToExplore = assessments.filter(({ status }) => status === 'not_explored' || status === 'insufficient_information' || status === 'partially_evidenced')
  const attention = assessments.filter(({ areasForAttention, status }) => areasForAttention && (status === 'partially_evidenced' || status === 'not_explored' || status === 'insufficient_information'))
  const criterionSource = (criterionCode: string): WorkflowCarryForwardSource => ({ kind: 'review_criterion', reviewDraftRevisionId: draft.revisionId, criterionCode })
  const sourceKey = (source: WorkflowCarryForwardSource) => source.kind === 'review_criterion' ? `criterion:${source.reviewDraftRevisionId}:${source.criterionCode}` : source.kind === 'areas_for_attention' ? `attention:${source.reviewDraftRevisionId}` : `safety:${source.observationId}`
  const list = (items: typeof assessments, empty: string, showCarryForward = false) => items.length ? <div className="space-y-1.5">{items.map((assessment) => {
    const source = criterionSource(assessment.criterionCode)
    const key = sourceKey(source)
    return <div key={assessment.criterionCode} className="flex items-center justify-between gap-3 px-3 py-2.5" style={{ backgroundColor: 'var(--color-ground)', borderLeft: '2px solid var(--color-border)' }}><div><p className="text-sm" style={{ color: 'var(--color-ink-secondary)' }}>{assessment.label}</p><p className="text-xs mt-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>{assessment.status === 'partially_evidenced' ? 'Partly established — more kōrero may help' : assessment.status === 'not_explored' ? 'Not explored in this reflection' : assessment.status === 'insufficient_information' ? 'More information may be needed' : 'Established in this reflection'}</p></div>{showCarryForward && <button type="button" disabled={carriedSources.has(key)} onClick={() => onMarkCarryForward(source)} className="flex-shrink-0 text-xs disabled:opacity-55" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>{carriedSources.has(key) ? 'Carried forward' : 'Needs follow-up'}</button>}</div>
  })}</div> : <p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>{empty}</p>
  return <>
    <div style={{ borderLeft: '3px solid var(--color-border)', backgroundColor: 'var(--color-surface)', padding: '0.875rem 1rem' }}><p className="text-xs mb-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.08em' }}>WHAT WAS ESTABLISHED</p>{list(established, 'No criterion was established from this reflection.')}</div>
    <div style={{ borderLeft: '3px solid var(--color-growth)', backgroundColor: 'var(--color-surface)', padding: '0.875rem 1rem' }}><p className="text-xs mb-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)', letterSpacing: '0.08em' }}>STRENGTHS / PROTECTIVE FACTORS</p>{list(strengths, 'No strength or protective factor was established in this reflection.')}</div>
    <div style={{ borderLeft: '3px solid var(--color-border-strong)', backgroundColor: 'var(--color-surface)', padding: '0.875rem 1rem' }}><p className="text-xs mb-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}>STILL TO EXPLORE / INFORMATION NEEDED</p>{list(stillToExplore, 'No further exploration was identified from the approved criteria.', true)}<p className="text-xs mt-2 italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>Not explored is not evidence that an issue is absent.</p></div>
    <div style={{ borderLeft: '3px solid var(--color-caution)', backgroundColor: 'var(--color-surface)', padding: '0.875rem 1rem' }}><p className="text-xs mb-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-caution)', letterSpacing: '0.08em' }}>AREAS FOR ATTENTION</p>{list(attention, 'No additional area was identified from the approved review criteria.', true)}{draft.areasForAttentionSummary && <button type="button" disabled={carriedSources.has(`attention:${draft.revisionId}`)} onClick={() => onMarkCarryForward({ kind: 'areas_for_attention', reviewDraftRevisionId: draft.revisionId })} className="text-xs mt-3 disabled:opacity-55" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>{carriedSources.has(`attention:${draft.revisionId}`) ? 'Review area carried forward' : 'Carry review area forward'}</button>}<p className="text-xs mt-2 italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>These are review matters for the Kaimahi to keep in view, not formal safety findings.</p></div>
  </>
}

/** Phase 5C test/import compatibility; all active Pou now use the generic view. */
export function WhakapapaNarrativeReview(props: {
  workflowId: string
  onDraftState: (state: { reviewDraftRevisionId?: string; hasUnsavedChanges: boolean; loaded: boolean }) => void
}) {
  return <PouNarrativeReview workflowId={props.workflowId} onDraftState={props.onDraftState} pouId="whakapapa" carriedSources={new Set()} onMarkCarryForward={() => undefined} />
}

export function SinglePouReviewStage({
  pouIdx,
  checkpoint,
  onConfirm,
  workflowId,
  carryForwards,
  safetyObservations,
  onMarkCarryForward = () => undefined,
  onCandidateConfirm,
  persistenceState,
  onRetry,
  onReload,
}: {
  pouIdx: number
  checkpoint?: WorkflowCheckpoint
  onConfirm: (review: {
    note?: string
    reviewDraftRevisionId?: string
  }, safetyDraft?: SafetyDraft, supervisorReviewRequest?: { note?: string }) => void
  workflowId: string
  carryForwards?: Workflow['carryForwards']
  safetyObservations?: Workflow['safety']['observations']
  onMarkCarryForward?: (source: WorkflowCarryForwardSource) => void
  onCandidateConfirm: (candidate: PouAssessmentCandidate, level: SafetyObservationConcernLevel, pouId: (typeof TE_WAHAROA_POU)[number]['id']) => boolean | void | Promise<boolean | void>
  persistenceState: WorkflowPersistenceState
  onRetry: () => void
  onReload: () => void
}) {
  const ext = POU_EXTENDED[pouIdx]
  const [recordSafety, setRecordSafety] = useState(false)
  const [safetyClass, setSafetyClass] = useState<SafetyBroadClass | null>(null)
  const [safetyNote, setSafetyNote] = useState('')
  const [manualSafetyLevel, setManualSafetyLevel] = useState<SafetyObservationConcernLevel>('low')
  const [reviewDraftRevisionId, setReviewDraftRevisionId] = useState<string | undefined>()
  const [hasUnsavedReviewDraftChanges, setHasUnsavedReviewDraftChanges] = useState(false)
  const [reviewDraftLoaded, setReviewDraftLoaded] = useState(false)
  const [hasReviewableCandidate, setHasReviewableCandidate] = useState(false)

  useEffect(() => {
    setHasReviewableCandidate(false)
  }, [workflowId, pouIdx])

  const handleConfirm = () => {
    if (recordSafety && !safetyClass) return
    if (!reviewDraftLoaded) return
    if (hasUnsavedReviewDraftChanges || hasReviewableCandidate) return
    onConfirm({
      reviewDraftRevisionId,
    }, recordSafety && safetyClass ? {
      assessmentContext: 'pou',
      pouId: TE_WAHAROA_POU[pouIdx]!.id,
      broadClass: safetyClass,
      concernLevel: manualSafetyLevel,
      contextNote: safetyNote.trim() || undefined,
    } : undefined)
  }
  const carriedSources = new Set((carryForwards ?? []).map((item) => item.source.kind === 'review_criterion'
    ? `criterion:${item.source.reviewDraftRevisionId}:${item.source.criterionCode}`
    : item.source.kind === 'areas_for_attention' ? `attention:${item.source.reviewDraftRevisionId}` : `safety:${item.source.observationId}`))
  const currentPouSafety = (safetyObservations ?? []).filter((observation) => observation.status === 'active' && observation.assessmentContext === 'pou' && observation.pouId === TE_WAHAROA_POU[pouIdx]!.id)

  if (persistenceState === 'saving' || persistenceState === 'retrying') {
    return (
      <div className="flex flex-col items-center justify-center" style={{ minHeight: '70vh', fontFamily: 'var(--font-body)' }}>
        <div className="flex gap-1 mb-6">
          {[0,1,2,3,4,5,6].map((i) => (
            <div
              key={i}
              style={{
                width: 2,
                height: i <= pouIdx ? 28 : 14,
                backgroundColor: 'var(--color-ridge)',
                opacity: i <= pouIdx ? 0.7 : 0.15,
              }}
            />
          ))}
        </div>
        <p className="text-sm italic mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
          {persistenceState === 'retrying' ? 'Retrying…' : 'Saving…'}
        </p>
        <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
          {pouIdx < 6 ? POU_EXTENDED[pouIdx + 1]?.full : 'Final Pou Summary'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col pb-16" style={{ fontFamily: 'var(--font-body)' }}>
      {/* Pou header */}
      <div className="px-6 pt-7 pb-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <p className="text-xs tracking-widest uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}>
          Arotake — Pou {pouIdx + 1} o 7
        </p>
        <h2 className="mb-1 leading-snug" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 500, color: 'var(--color-ink)' }}>
          {ext.full}
        </h2>
        <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
          {ext.domain}
        </p>
      </div>

      <div className="px-5 pt-5 space-y-5">
        <PouNarrativeReview workflowId={workflowId} pouId={TE_WAHAROA_POU[pouIdx]!.id} carriedSources={carriedSources} onMarkCarryForward={onMarkCarryForward} onDraftState={({ reviewDraftRevisionId: id, hasUnsavedChanges, loaded, hasReviewableCandidate: nextHasReviewableCandidate }) => { setReviewDraftRevisionId(id); setHasUnsavedReviewDraftChanges(hasUnsavedChanges); setReviewDraftLoaded(loaded); if (typeof nextHasReviewableCandidate === 'boolean') setHasReviewableCandidate(nextHasReviewableCandidate) }} />
        <PouAssessmentCandidates workflowId={workflowId} pouId={TE_WAHAROA_POU[pouIdx]!.id} hasReviewableCandidate={hasReviewableCandidate} onConfirm={onCandidateConfirm} onReviewableCandidatesChange={setHasReviewableCandidate} />
        {currentPouSafety.length > 0 && <div className="p-4 space-y-2" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-caution)' }}>
          <SectionLabel>Confirmed safety concerns</SectionLabel>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-ink-secondary)' }}>These are human-confirmed concerns. They remain separate from this Pou review.</p>
          {currentPouSafety.map((observation) => <div key={observation.id} className="flex items-center justify-between gap-3 px-3 py-2.5" style={{ backgroundColor: 'var(--color-ground)', borderLeft: '2px solid var(--color-caution)' }}><p className="text-xs" style={{ color: 'var(--color-ink-secondary)' }}>{safetyClassLabel(observation.broadClass)} · {observation.concernLevel}</p><button type="button" disabled={carriedSources.has(`safety:${observation.id}`)} onClick={() => onMarkCarryForward({ kind: 'safety_observation', observationId: observation.id })} className="flex-shrink-0 text-xs disabled:opacity-55" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>{carriedSources.has(`safety:${observation.id}`) ? 'Carried forward' : 'Carry forward'}</button></div>)}
        </div>}
        <SafetyConcernDisclosure
          open={recordSafety}
          onOpenChange={setRecordSafety}
          broadClass={safetyClass}
          onBroadClassChange={setSafetyClass}
          contextNote={safetyNote}
          onContextNoteChange={setSafetyNote}
          label={hasReviewableCandidate ? 'Record a different concern manually' : undefined}
        />
        {recordSafety && <fieldset className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-caution)' }}><legend className="text-xs px-1" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>HOW WOULD YOU ASSESS THIS CONCERN?</legend><div className="grid grid-cols-3 gap-1.5 mt-2">{(['low', 'watch', 'action'] as SafetyObservationConcernLevel[]).map((level) => <button key={level} type="button" onClick={() => setManualSafetyLevel(level)} className="px-3 py-2 text-xs" style={{ fontFamily: 'var(--font-mono)', backgroundColor: manualSafetyLevel === level ? 'var(--color-caution-light)' : 'var(--color-ground)', color: manualSafetyLevel === level ? 'var(--color-caution)' : 'var(--color-ink-muted)', borderLeft: `3px solid ${manualSafetyLevel === level ? 'var(--color-caution)' : 'var(--color-border)'}` }}>{level[0]!.toUpperCase() + level.slice(1)}</button>)}</div></fieldset>}

        {/* Paepae before confirm */}
        <div className="relative flex items-center pt-2">
          <div className="flex-1" style={{ height: 1, backgroundColor: 'var(--color-border-strong)' }} />
          <div className="flex-shrink-0 px-3 py-1" style={{ backgroundColor: 'var(--color-surface-deep)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', letterSpacing: '0.18em', color: 'var(--color-ink-muted)' }}>
              PAEPAE
            </span>
          </div>
          <div className="flex-1" style={{ height: 1, backgroundColor: 'var(--color-border-strong)' }} />
        </div>

        {hasReviewableCandidate && <div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-caution)' }}><p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>Resolve each formal safety review above before confirming this Pou. You can still record a different concern manually if needed.</p></div>}

        {/* Confirm CTA */}
        <button
          onClick={handleConfirm}
          disabled={hasUnsavedReviewDraftChanges || !reviewDraftLoaded || hasReviewableCandidate}
          className="w-full transition-all active:opacity-85 disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-ridge)', padding: '1.125rem 1.25rem' }}
        >
          <p className="text-sm font-medium" style={{ fontFamily: 'var(--font-mono)', color: 'white', letterSpacing: '0.06em' }}>
            {hasUnsavedReviewDraftChanges ? 'Save review changes before confirming' : !reviewDraftLoaded ? 'Loading reflection review…' : hasReviewableCandidate ? 'Resolve formal safety review before confirming' : pouIdx < 6 ? `Whakaū — Confirm & continue to Pou ${pouIdx + 2}` : 'Whakaū — Confirm & review all seven Pou'}
          </p>
        </button>
        <PersistenceFeedback state={persistenceState} onRetry={onRetry} onReload={onReload} />
      </div>
    </div>
  )
}

// ─── Pou Summary Stage ────────────────────────────────────────────────────────
// All seven Te Waharoa Pou reviewed — a full structural overview before Risks & Actions

function PouSummaryStage({ data, onNext }: { data: ActiveSessionData; onNext: () => void }) {
  const CONCERN_DEMO: ConcernLevel[] = ['watch', 'action', 'low', 'watch', 'low', 'watch', 'low']

  return (
    <div className="flex flex-col pb-16" style={{ fontFamily: 'var(--font-body)' }}>
      <div className="px-6 pt-7 pb-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <p className="text-xs tracking-widest uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}>
          Whakarāpopoto — Final Summary
        </p>
        <h2 className="mb-2 leading-snug" style={{ fontFamily: 'var(--font-display)', fontSize: '1.375rem', fontWeight: 500, color: 'var(--color-ink)' }}>
          Ngā Pou o Te Waharoa — all seven reviewed
        </h2>
        <p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
          A structural overview of what was held in this conversation.
        </p>
      </div>

      {/* Ridge bar: six pou colored by concern */}
      <div className="flex w-full" style={{ gap: 1 }}>
        {CONCERN_DEMO.map((c, i) => (
          <div key={i} style={{ flex: 1, height: 5, backgroundColor: CONCERN_META[c].color }} />
        ))}
      </div>

      <div className="px-5 pt-5 space-y-px">
        {POU_EXTENDED.map((ext, i) => {
          const concern = CONCERN_DEMO[i]
          const meta = CONCERN_META[concern]
          return (
            <div key={i} className="px-4 py-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: `3px solid ${meta.color}` }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
                  {ext.full}
                </p>
                <span className="text-xs px-2 py-0.5" style={{ fontFamily: 'var(--font-mono)', backgroundColor: meta.bg, color: meta.color, fontSize: '0.6rem' }}>
                  {meta.label}
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-ink-muted)' }}>
                {ext.discussed.slice(0, 100)}{ext.discussed.length > 100 ? '…' : ''}
              </p>
              {(ext.protective.length > 0 || ext.risk.length > 0) && (
                <div className="flex gap-3 mt-2">
                  {ext.protective.length > 0 && (
                    <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)' }}>
                      {ext.protective.length} protective
                    </p>
                  )}
                  {ext.risk.length > 0 && (
                    <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-concern)' }}>
                      {ext.risk.length} risk
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="px-5 pt-8">
        <div className="relative flex items-center mb-6">
          <div className="flex-1" style={{ height: 1, backgroundColor: 'var(--color-border-strong)' }} />
          <div className="flex-shrink-0 px-3 py-1" style={{ backgroundColor: 'var(--color-surface-deep)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', letterSpacing: '0.18em', color: 'var(--color-ink-muted)' }}>
              PAEPAE
            </span>
          </div>
          <div className="flex-1" style={{ height: 1, backgroundColor: 'var(--color-border-strong)' }} />
        </div>
        <button
          onClick={onNext}
          className="w-full transition-all active:opacity-85"
          style={{ backgroundColor: 'var(--color-ridge)', padding: '1.125rem 1.25rem' }}
        >
          <p className="text-sm font-medium" style={{ fontFamily: 'var(--font-mono)', color: 'white', letterSpacing: '0.06em' }}>
            Haere tonu — Risks &amp; Actions
          </p>
        </button>
      </div>
    </div>
  )
}

function SynthesisingStage() {
  const [dot, setDot] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setDot((d) => (d + 1) % 4), 500)
    return () => clearInterval(t)
  }, [])

  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ minHeight: '80vh', padding: '3rem 2rem', fontFamily: 'var(--font-body)' }}
    >
      {/* Six pou — the whare breathing while waiting */}
      <div className="flex items-end gap-1.5 mb-10" style={{ height: 56 }}>
        {[32, 48, 24, 52, 40, 28].map((h, i) => (
          <div
            key={i}
            style={{
              width: 8,
              height: h,
              backgroundColor: 'var(--color-ridge)',
              animation: 'pou-breathe 2.2s ease-in-out infinite',
              animationDelay: `${i * 0.28}s`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes pou-breathe {
          0%, 100% { opacity: 0.2; transform: scaleY(0.75); transform-origin: bottom; }
          50% { opacity: 0.9; transform: scaleY(1); transform-origin: bottom; }
        }
      `}</style>
      <p
        className="text-xl italic mb-2"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
      >
        He whakaaro ana{'.'.repeat(dot + 1)}
      </p>
      <p
        className="text-sm italic mb-3"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
      >
        Your kōrero is being gathered and held
      </p>
      <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
        Weaving meaning across the seven Pou of Te Waharoa
      </p>
    </div>
  )
}

// Stage 3 — Safety Pou Review
// ─── Safety Pou Review types ──────────────────────────────────────────────────

interface PouReview {
  concernLevel: ConcernLevel
  actionRequired: boolean
  note: string
  confirmed: boolean
}

const CONCERN_CONFIG: Record<
  ConcernLevel,
  { label: string; reo: string; sub: string; color: string; bg: string; status: PouStatus }
> = {
  low: {
    label: 'Low concern',       reo: 'He tōtika', sub: 'Stable — continue to monitor',
    color: 'var(--color-growth)',  bg: 'var(--color-growth-light)',  status: 'tōtika',
  },
  watch: {
    label: 'Watch closely',     reo: 'He āta',    sub: 'Something to hold and return to',
    color: 'var(--color-caution)', bg: 'var(--color-caution-light)', status: 'āta',
  },
  action: {
    label: 'Action needed',     reo: 'He tūraru', sub: 'Requires follow-up this session',
    color: 'var(--color-concern)', bg: 'var(--color-concern-light)', status: 'mataku',
  },
  urgent: {
    label: 'Urgent escalation', reo: 'He mataku', sub: 'Immediate action required',
    color: 'var(--color-concern)', bg: 'var(--color-concern-light)', status: 'mataku',
  },
}

// ─── Safety Pou Stage ─────────────────────────────────────────────────────────

function SafetyPouStage({
  data,
  onChange,
  onNext,
}: {
  data: ActiveSessionData
  onChange: (p: Partial<ActiveSessionData>) => void
  onNext: () => void
}) {
  const initReviews = (): PouReview[] =>
    data.pou.map((p) => ({
      concernLevel:
        p.status === 'mataku' ? 'action' : p.status === 'āta' ? 'watch' : 'low',
      actionRequired: p.status === 'mataku',
      note: p.kaimahiNote || '',
      confirmed: false,
    }))

  const [currentIdx, setCurrentIdx] = useState(0)
  const [reviews, setReviews] = useState<PouReview[]>(initReviews)
  const [showSummary, setShowSummary] = useState(false)

  const update = (idx: number, patch: Partial<PouReview>) =>
    setReviews((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))

  const handleConfirm = () => {
    update(currentIdx, { confirmed: true })
    if (currentIdx < 6) {
      setCurrentIdx(currentIdx + 1)
    } else {
      setShowSummary(true)
    }
  }

  const handleProceed = () => {
    const updatedPou = data.pou.map((p, i) => ({
      ...p,
      status: CONCERN_CONFIG[reviews[i].concernLevel].status,
      kaimahiNote: reviews[i].note,
      discussed: true,
    }))
    onChange({ pou: updatedPou })
    onNext()
  }

  // ── Summary view — after all 6 confirmed ─────────────────────────────────

  if (showSummary) {
    return (
      <div style={{ fontFamily: 'var(--font-body)' }}>
        <div className="px-6 pt-8 pb-6">
          <p
            className="text-xs tracking-widest uppercase mb-5"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}
          >
            Ngā Pou — Review complete
          </p>
          <h2
            className="mb-3 leading-snug"
            style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--color-ink)' }}
          >
            All six supports reviewed
          </h2>
          <p
            className="text-sm italic leading-relaxed"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
          >
            Here is a summary of what was identified across the seven Pou of Te Waharoa.
            Review and edit before continuing.
          </p>
        </div>

        {/* Six pou summary — full-width bar shows overall composition */}
        <div className="flex w-full mb-5">
          {data.pou.map((_, i) => {
            const c = CONCERN_CONFIG[reviews[i].concernLevel]
            return (
              <div key={i} className="flex-1" style={{ height: 5, backgroundColor: c.color }} />
            )
          })}
        </div>

        <div className="px-5 space-y-px mb-6">
          {data.pou.map((p, i) => {
            const rev = reviews[i]
            const cc = CONCERN_CONFIG[rev.concernLevel]
            const ext = POU_EXTENDED[i]
            return (
              <div
                key={p.id}
                className="flex items-start gap-4 px-4 py-4"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderLeft: `4px solid ${cc.color}`,
                }}
              >
                {/* Pou shaft */}
                <div
                  className="flex-shrink-0 mt-1"
                  style={{ width: 2, height: 28, backgroundColor: cc.color }}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium leading-snug mb-0.5"
                    style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
                  >
                    {ext.full}
                  </p>
                  <p
                    className="text-xs"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                  >
                    {ext.domain}
                  </p>
                  {rev.actionRequired && (
                    <p
                      className="text-xs mt-1.5"
                      style={{ fontFamily: 'var(--font-mono)', color: cc.color }}
                    >
                      Action required
                    </p>
                  )}
                </div>
                <div className="flex-shrink-0 text-right">
                  <p
                    className="text-xs font-medium"
                    style={{ fontFamily: 'var(--font-mono)', color: cc.color }}
                  >
                    {cc.reo}
                  </p>
                  <button
                    onClick={() => { setCurrentIdx(i); setShowSummary(false) }}
                    className="text-xs mt-1 transition-opacity hover:opacity-70"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Actions needed count */}
        {reviews.some((r) => r.actionRequired) && (
          <div
            className="mx-5 mb-5 px-4 py-3"
            style={{ backgroundColor: 'var(--color-concern-light)', borderLeft: '3px solid var(--color-concern)' }}
          >
            <p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
              {reviews.filter((r) => r.actionRequired).length} pou flagged for action — you will select specific actions in the next step.
            </p>
          </div>
        )}

        <div className="px-5 pb-8">
          <button
            onClick={handleProceed}
            className="w-full text-left transition-all active:opacity-85"
          >
            <div style={{ backgroundColor: 'var(--color-ridge)', padding: '1.25rem 1.25rem' }}>
              <div className="flex gap-1 mb-4" style={{ opacity: 0.18 }}>
                {[0,1,2,3,4,5,6].map((i) => (
                  <div key={i} style={{ flex: 1, height: 2, backgroundColor: 'white' }} />
                ))}
              </div>
              <p className="text-lg font-medium italic mb-1"
                 style={{ fontFamily: 'var(--font-display)', color: 'white', lineHeight: 1.3 }}>
                Haere tonu — Risks & Actions
              </p>
              <p className="text-xs"
                 style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em' }}>
                IDENTIFY WHAT NEEDS TO HAPPEN →
              </p>
            </div>
          </button>
        </div>
      </div>
    )
  }

  // ── Stepper view — one pou at a time ────────────────────────────────────

  const currentPou = data.pou[currentIdx]
  const currentReview = reviews[currentIdx]
  const cc = CONCERN_CONFIG[currentReview.concernLevel]
  const ext = POU_EXTENDED[currentIdx]

  return (
    <div style={{ fontFamily: 'var(--font-body)' }}>

      {/* ── Six structural columns — the whare navigation ── */}
      {/* Each column: rises when current, settles when confirmed */}
      <div
        className="flex w-full"
        style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {data.pou.map((_, i) => {
          const rev = reviews[i]
          const isCurrent = i === currentIdx
          const isConfirmed = rev.confirmed
          const colColor = isConfirmed || isCurrent
            ? CONCERN_CONFIG[rev.concernLevel].color
            : 'var(--color-border-strong)'
          const colHeight = isCurrent ? 18 : isConfirmed ? 10 : 6

          return (
            <button
              key={i}
              onClick={() => setCurrentIdx(i)}
              className="flex-1 flex flex-col items-center pb-2.5 pt-3 transition-all active:opacity-70 min-h-[48px]"
            >
              <div
                style={{
                  width: '80%',
                  height: colHeight,
                  backgroundColor: colColor,
                  opacity: isCurrent ? 1 : isConfirmed ? 0.75 : 0.25,
                  transition: 'height 0.25s ease, opacity 0.2s ease',
                }}
              />
              <p
                className="mt-1.5 text-center"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.6rem',
                  color: isCurrent ? 'var(--color-ink)' : 'var(--color-ink-muted)',
                  fontWeight: isCurrent ? 600 : 400,
                  lineHeight: 1,
                }}
              >
                {i + 1}
              </p>
            </button>
          )
        })}
      </div>

      {/* ── Pou heading ── */}
      <div
        className="px-5 pt-6 pb-5"
        style={{ borderLeft: `4px solid ${cc.color}`, backgroundColor: cc.bg, margin: '0 0' }}
      >
        <p
          className="text-xs tracking-wide mb-2"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
        >
          POU {currentIdx + 1} OF 6
        </p>
        <h3
          className="leading-snug mb-1"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.2rem',
            fontWeight: 500,
            color: 'var(--color-ink)',
          }}
        >
          {ext.full}
        </h3>
        <p
          className="text-xs"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
        >
          {ext.domain}
        </p>
      </div>

      {/* ── Body sections ── */}
      <div className="px-5 py-5 space-y-5">

        {/* What was discussed */}
        {ext.discussed && (
          <div>
            <SectionLabel>I kōrerohia — Discussed in this session</SectionLabel>
            <div
              className="mt-2 px-4 py-4"
              style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-ridge)' }}
            >
              <p
                className="text-sm italic leading-relaxed"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
              >
                {ext.discussed}
              </p>
            </div>
          </div>
        )}

        {/* What was not covered — framed gently */}
        {ext.notCovered && (
          <div>
            <SectionLabel>Kāore i kōrerohia — Not covered in this session</SectionLabel>
            <div
              className="mt-2 px-4 py-3"
              style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)', opacity: 0.75 }}
            >
              <p
                className="text-sm italic leading-relaxed"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
              >
                {ext.notCovered}
              </p>
              <p
                className="text-xs mt-2"
                style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', color: 'var(--color-ink-muted)', opacity: 0.7 }}
              >
                Consider raising this in a future session.
              </p>
            </div>
          </div>
        )}

        {/* Protective factors */}
        {ext.protective.length > 0 && (
          <div>
            <SectionLabel>Ngā āhuatanga haumaru — Protective factors</SectionLabel>
            <div className="mt-2 space-y-px">
              {ext.protective.map((f, fi) => (
                <div
                  key={fi}
                  className="flex items-start gap-3 px-4 py-2.5"
                  style={{ backgroundColor: 'var(--color-growth-light)', borderLeft: '3px solid var(--color-growth)' }}
                >
                  <div
                    className="flex-shrink-0 mt-1"
                    style={{ width: 6, height: 6, backgroundColor: 'var(--color-growth)' }}
                  />
                  <p className="text-sm leading-snug" style={{ color: 'var(--color-ink-secondary)' }}>
                    {f}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Risk factors */}
        {ext.risk.length > 0 && (
          <div>
            <SectionLabel>Ngā tūraru — Risk factors</SectionLabel>
            <div className="mt-2 space-y-px">
              {ext.risk.map((f, fi) => (
                <div
                  key={fi}
                  className="flex items-start gap-3 px-4 py-2.5"
                  style={{ backgroundColor: 'var(--color-concern-light)', borderLeft: '3px solid var(--color-concern)' }}
                >
                  <div
                    className="flex-shrink-0 mt-1"
                    style={{ width: 6, height: 6, backgroundColor: 'var(--color-concern)' }}
                  />
                  <p className="text-sm leading-snug" style={{ color: 'var(--color-ink-secondary)' }}>
                    {f}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Concern level — 2×2 structural grid ── */}
        <div>
          <SectionLabel>He aha tō taumata ārai? — Concern level</SectionLabel>
          <div className="mt-2 grid grid-cols-2 gap-px">
            {(Object.entries(CONCERN_CONFIG) as [ConcernLevel, typeof CONCERN_CONFIG[ConcernLevel]][]).map(([level, cfg]) => {
              const isSelected = currentReview.concernLevel === level
              return (
                <button
                  key={level}
                  onClick={() => update(currentIdx, { concernLevel: level })}
                  className="text-left transition-all active:opacity-75 min-h-[64px]"
                  style={{
                    padding: '0.875rem 1rem',
                    backgroundColor: isSelected ? cfg.color : 'var(--color-surface)',
                    borderLeft: isSelected
                      ? '4px solid rgba(255,255,255,0.3)'
                      : `4px solid ${cfg.color}`,
                  }}
                >
                  <p
                    className="text-sm font-medium leading-snug"
                    style={{ color: isSelected ? 'white' : 'var(--color-ink)' }}
                  >
                    {cfg.label}
                  </p>
                  <p
                    className="text-xs mt-0.5 italic"
                    style={{
                      fontFamily: 'var(--font-display)',
                      color: isSelected ? 'rgba(255,255,255,0.65)' : 'var(--color-ink-muted)',
                    }}
                  >
                    {cfg.sub}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Action required ── */}
        <div>
          <SectionLabel>He mahi e hiahiatia ana? — Action required?</SectionLabel>
          <div className="mt-2 grid grid-cols-2 gap-px">
            {([true, false] as const).map((val) => {
              const isSelected = currentReview.actionRequired === val
              return (
                <button
                  key={String(val)}
                  onClick={() => update(currentIdx, { actionRequired: val })}
                  className="py-4 px-4 text-left transition-all min-h-[52px]"
                  style={{
                    backgroundColor: isSelected
                      ? val ? 'var(--color-concern)' : 'var(--color-growth)'
                      : 'var(--color-surface)',
                    borderLeft: isSelected
                      ? '4px solid rgba(255,255,255,0.3)'
                      : `4px solid var(--color-border)`,
                  }}
                >
                  <p
                    className="text-sm font-medium"
                    style={{ color: isSelected ? 'white' : 'var(--color-ink-secondary)' }}
                  >
                    {val ? 'Āe — Yes' : 'Kāo — No'}
                  </p>
                  <p
                    className="text-xs mt-0.5 italic"
                    style={{
                      fontFamily: 'var(--font-display)',
                      color: isSelected ? 'rgba(255,255,255,0.65)' : 'var(--color-ink-muted)',
                    }}
                  >
                    {val ? 'Select action in next step' : 'No action at this time'}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Kaimahi note ── */}
        <div>
          <SectionLabel>Tō kōrero ake — Your note (optional)</SectionLabel>
          <textarea
            value={currentReview.note}
            onChange={(e) => update(currentIdx, { note: e.target.value })}
            placeholder="Add any additional observation about this pou…"
            rows={2}
            className="mt-2 w-full px-4 py-3 text-sm leading-relaxed resize-none italic"
            style={{
              fontFamily: 'var(--font-display)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-ink-secondary)',
              border: 'none',
              borderLeft: '3px solid var(--color-border)',
              outline: 'none',
              caretColor: 'var(--color-ridge)',
            }}
          />
        </div>

      </div>

      {/* ── Navigation + Confirm ── */}
      <div
        className="px-5 pb-8 pt-4 space-y-2"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        {/* Confirm this pou */}
        <button
          onClick={handleConfirm}
          className="w-full text-left transition-all active:opacity-85"
        >
          <div
            style={{
              backgroundColor: cc.color,
              padding: '1rem 1.25rem',
            }}
          >
            <p
              className="text-base font-medium italic"
              style={{ fontFamily: 'var(--font-display)', color: 'white', lineHeight: 1.3 }}
            >
              Whakaae — Confirm this pou
            </p>
            <p
              className="text-xs mt-0.5"
              style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.55)', letterSpacing: '0.05em' }}
            >
              {currentIdx < 6 ? `NEXT: POU ${currentIdx + 2} →` : 'REVIEW SUMMARY →'}
            </p>
          </div>
        </button>

        {/* Prev / Next secondary navigation */}
        <div className="flex gap-2">
          <button
            onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
            disabled={currentIdx === 0}
            className="flex-1 py-3 text-xs transition-opacity min-h-[44px]"
            style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-ink-muted)',
              border: '1px solid var(--color-border-strong)',
              opacity: currentIdx === 0 ? 0.3 : 1,
              cursor: currentIdx === 0 ? 'default' : 'pointer',
            }}
          >
            ← Pou {currentIdx}
          </button>
          <button
            onClick={() => setCurrentIdx(Math.min(5, currentIdx + 1))}
            disabled={currentIdx === 5}
            className="flex-1 py-3 text-xs transition-opacity min-h-[44px]"
            style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-ink-muted)',
              border: '1px solid var(--color-border-strong)',
              opacity: currentIdx === 5 ? 0.3 : 1,
              cursor: currentIdx === 5 ? 'default' : 'pointer',
            }}
          >
            Pou {currentIdx + 2} →
          </button>
        </div>

        {/* Skip to summary — available once any pou has been visited */}
        <button
          onClick={() => setShowSummary(true)}
          className="w-full py-2 text-xs transition-opacity hover:opacity-70"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
        >
          Skip to summary
        </button>
      </div>

    </div>
  )
}

// Stage 4 — Risks & Actions
// ─── Risks & Actions types ────────────────────────────────────────────────────

type ActionPriority = 'routine' | 'important' | 'urgent'
type ActionRunStatus = 'open' | 'in-progress' | 'complete' | 'carried-forward'
type ActionOwner = 'kaimahi' | 'supervisor' | 'referral-service' | 'shared'

interface RichAction {
  id: string
  title: string
  type: ActionType
  pouIdx: number | null
  factorText: string
  factorType: 'risk' | 'protective' | null
  owner: ActionOwner
  priority: ActionPriority
  dueDate: string
  status: ActionRunStatus
  notes: string
  referralLink: string
  supervisorReview: boolean
  fromPrevSession: boolean
}

const PRIORITY_CONFIG: Record<ActionPriority, { label: string; color: string; bg: string }> = {
  urgent:    { label: 'Urgent',    color: 'var(--color-concern)', bg: 'var(--color-concern-light)' },
  important: { label: 'Important', color: 'var(--color-caution)', bg: 'var(--color-caution-light)' },
  routine:   { label: 'Routine',   color: 'var(--color-ridge)',   bg: 'var(--color-ridge-light)'   },
}

const RUN_STATUS_CONFIG: Record<ActionRunStatus, { label: string; color: string }> = {
  'open':            { label: 'Open',            color: 'var(--color-ridge)'     },
  'in-progress':     { label: 'In progress',     color: 'var(--color-caution)'   },
  'complete':        { label: 'Complete',        color: 'var(--color-growth)'    },
  'carried-forward': { label: 'Carried forward', color: 'var(--color-ink-muted)' },
}

const OWNER_OPTIONS: { id: ActionOwner; label: string }[] = [
  { id: 'kaimahi',          label: 'Aroha (kaimahi)'    },
  { id: 'supervisor',       label: 'Hemi (supervisor)'  },
  { id: 'referral-service', label: 'Referral service'   },
  { id: 'shared',           label: 'Shared'             },
]

// Short pou label by index — first significant word from POU_EXTENDED
const pouShortLabel = (idx: number) =>
  POU_EXTENDED[idx]?.full.split(/[,&]/)[0].trim() ?? `Pou ${idx + 1}`

// Default demo actions — realistically pre-populated
const DEMO_RICH_ACTIONS: RichAction[] = [
  {
    id: 'ra-1',
    title: 'Request supervisor review — mental health concern',
    type: 'supervisor-review',
    pouIdx: 1,
    factorText: 'Persistent low mood and sleep disruption over past fortnight',
    factorType: 'risk',
    owner: 'kaimahi',
    priority: 'urgent',
    dueDate: '2026-08-07',
    status: 'open',
    notes: 'Discuss with supervisor before next contact. Consider whether crisis support is needed.',
    referralLink: '',
    supervisorReview: true,
    fromPrevSession: false,
  },
  {
    id: 'ra-2',
    title: 'Arrange GP appointment — youngest child',
    type: 'referral',
    pouIdx: 2,
    factorText: 'Medical appointments overdue for youngest child',
    factorType: 'risk',
    owner: 'kaimahi',
    priority: 'important',
    dueDate: '2026-08-14',
    status: 'open',
    notes: 'Discuss with Mere — she may need support to make this happen.',
    referralLink: 'Te Whatu Ora',
    supervisorReview: false,
    fromPrevSession: false,
  },
  {
    id: 'ra-3',
    title: 'Connect to financial assistance — utility bills',
    type: 'referral',
    pouIdx: 4,
    factorText: 'Financial pressure — utility bills behind, causing anxiety',
    factorType: 'risk',
    owner: 'kaimahi',
    priority: 'important',
    dueDate: '2026-08-14',
    status: 'open',
    notes: '',
    referralLink: 'MSD Work & Income',
    supervisorReview: false,
    fromPrevSession: false,
  },
  {
    id: 'ra-cf1',
    title: 'Follow up on housing application progress',
    type: 'carry-forward',
    pouIdx: 4,
    factorText: 'Kāinga Ora application lodged — no update received',
    factorType: 'risk',
    owner: 'kaimahi',
    priority: 'routine',
    dueDate: '2026-08-20',
    status: 'carried-forward',
    notes: 'Application was lodged three weeks ago. Mere said she has heard nothing.',
    referralLink: 'Kāinga Ora',
    supervisorReview: false,
    fromPrevSession: true,
  },
]

// ─── Risks & Actions Stage ─────────────────────────────────────────────────────

function RisksActionsStage({
  data,
  onChange,
  onNext,
}: {
  data: ActiveSessionData
  onChange: (p: Partial<ActiveSessionData>) => void
  onNext: () => void
}) {
  const [actions, setActions] = useState<RichAction[]>(DEMO_RICH_ACTIONS)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'carried'>('all')
  const [addingNew, setAddingNew] = useState(false)
  const [draft, setDraft] = useState<Partial<RichAction>>({
    title: '', type: 'carry-forward', pouIdx: null, factorText: '',
    factorType: null, owner: 'kaimahi', priority: 'routine',
    dueDate: '', status: 'open', notes: '', referralLink: '',
    supervisorReview: false, fromPrevSession: false,
  })

  const updateAction = (id: string, patch: Partial<RichAction>) =>
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)))

  const removeAction = (id: string) =>
    setActions((prev) => prev.filter((a) => a.id !== id))

  const addAction = () => {
    if (!draft.title?.trim()) return
    setActions((prev) => [
      ...prev,
      {
        id: `ra-new-${Date.now()}`,
        title: draft.title!.trim(),
        type: draft.type ?? 'carry-forward',
        pouIdx: draft.pouIdx ?? null,
        factorText: draft.factorText ?? '',
        factorType: draft.factorType ?? null,
        owner: draft.owner ?? 'kaimahi',
        priority: draft.priority ?? 'routine',
        dueDate: draft.dueDate ?? '',
        status: draft.status ?? 'open',
        notes: draft.notes ?? '',
        referralLink: draft.referralLink ?? '',
        supervisorReview: draft.supervisorReview ?? false,
        fromPrevSession: false,
      },
    ])
    setDraft({
      title: '', type: 'carry-forward', pouIdx: null, factorText: '',
      factorType: null, owner: 'kaimahi', priority: 'routine',
      dueDate: '', status: 'open', notes: '', referralLink: '',
      supervisorReview: false, fromPrevSession: false,
    })
    setAddingNew(false)
  }

  const handleProceed = () => {
    // Write unique action types back to data for downstream compatibility
    const types = [
      ...new Set(
        actions
          .filter((a) => a.status !== 'complete')
          .map((a) => a.type)
      ),
    ] as ActionType[]
    onChange({ selectedActions: types })
    onNext()
  }

  const activeActions = actions.filter((a) => !a.fromPrevSession && a.status !== 'carried-forward')
  const carriedActions = actions.filter((a) => a.fromPrevSession || a.status === 'carried-forward')

  const displayActions =
    filter === 'active' ? activeActions :
    filter === 'carried' ? carriedActions :
    [...activeActions, ...carriedActions]

  const flaggedPou = data.pou.filter((p) => p.status === 'mataku' || p.status === 'āta')

  // ── Inline edit drawer for an action ────────────────────────────────────

  const EditDrawer = ({ action }: { action: RichAction }) => {
    const pc = PRIORITY_CONFIG[action.priority]
    return (
      <div
        className="px-4 py-4 space-y-4"
        style={{
          backgroundColor: 'var(--color-ground)',
          borderLeft: `3px solid ${pc.color}`,
          borderTop: '1px solid var(--color-border)',
        }}
      >
        {/* Title */}
        <div>
          <SectionLabel>Action title</SectionLabel>
          <input
            type="text"
            value={action.title}
            onChange={(e) => updateAction(action.id, { title: e.target.value })}
            className="mt-1.5 w-full px-3 py-3 text-sm outline-none"
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-ink)',
              border: 'none',
              borderLeft: '3px solid var(--color-ridge)',
              caretColor: 'var(--color-ridge)',
            }}
          />
        </div>

        {/* Type + Priority — side by side */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <SectionLabel>Type</SectionLabel>
            <div className="mt-1.5 space-y-px">
              {(['referral', 'supervisor-review', 'escalation', 'carry-forward'] as ActionType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => updateAction(action.id, { type: t })}
                  className="w-full text-left px-3 py-2 text-xs transition-all min-h-[36px]"
                  style={{
                    backgroundColor: action.type === t ? 'var(--color-ridge)' : 'var(--color-surface)',
                    color: action.type === t ? 'white' : 'var(--color-ink-muted)',
                    borderLeft: `3px solid ${action.type === t ? 'transparent' : 'var(--color-border)'}`,
                  }}
                >
                  <ActionBadge type={t} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <SectionLabel>Priority</SectionLabel>
            <div className="mt-1.5 space-y-px">
              {(Object.entries(PRIORITY_CONFIG) as [ActionPriority, typeof PRIORITY_CONFIG[ActionPriority]][]).map(([p, cfg]) => (
                <button
                  key={p}
                  onClick={() => updateAction(action.id, { priority: p })}
                  className="w-full text-left px-3 py-2.5 text-xs transition-all min-h-[36px]"
                  style={{
                    backgroundColor: action.priority === p ? cfg.color : 'var(--color-surface)',
                    color: action.priority === p ? 'white' : 'var(--color-ink-muted)',
                    borderLeft: `3px solid ${action.priority === p ? 'transparent' : cfg.color}`,
                  }}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Linked pou */}
        <div>
          <SectionLabel>Linked Te Waharoa Pou</SectionLabel>
          <div className="mt-1.5 flex flex-wrap gap-px">
            {data.pou.map((_, i) => (
              <button
                key={i}
                onClick={() => updateAction(action.id, { pouIdx: i })}
                className="px-3 py-2 text-xs transition-all"
                style={{
                  backgroundColor: action.pouIdx === i ? 'var(--color-ridge)' : 'var(--color-surface)',
                  color: action.pouIdx === i ? 'white' : 'var(--color-ink-muted)',
                  fontFamily: 'var(--font-mono)',
                  borderLeft: `2px solid ${action.pouIdx === i ? 'transparent' : 'var(--color-border)'}`,
                  minHeight: 36,
                }}
              >
                {pouShortLabel(i)}
              </button>
            ))}
          </div>
        </div>

        {/* Factor text */}
        <div>
          <SectionLabel>Linked factor</SectionLabel>
          <input
            type="text"
            value={action.factorText}
            onChange={(e) => updateAction(action.id, { factorText: e.target.value })}
            placeholder="Brief description of the risk or protective factor"
            className="mt-1.5 w-full px-3 py-2.5 text-xs outline-none"
            style={{
              fontFamily: 'var(--font-body)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-ink-secondary)',
              border: 'none',
              borderLeft: '3px solid var(--color-border)',
              caretColor: 'var(--color-ridge)',
            }}
          />
        </div>

        {/* Owner + Due date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <SectionLabel>Owner</SectionLabel>
            <div className="mt-1.5 space-y-px">
              {OWNER_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  onClick={() => updateAction(action.id, { owner: o.id })}
                  className="w-full text-left px-3 py-2 text-xs transition-all min-h-[36px]"
                  style={{
                    backgroundColor: action.owner === o.id ? 'var(--color-ridge)' : 'var(--color-surface)',
                    color: action.owner === o.id ? 'white' : 'var(--color-ink-muted)',
                    borderLeft: `3px solid ${action.owner === o.id ? 'transparent' : 'var(--color-border)'}`,
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <SectionLabel>Status</SectionLabel>
            <div className="mt-1.5 space-y-px">
              {(Object.entries(RUN_STATUS_CONFIG) as [ActionRunStatus, typeof RUN_STATUS_CONFIG[ActionRunStatus]][]).map(([s, cfg]) => (
                <button
                  key={s}
                  onClick={() => updateAction(action.id, { status: s })}
                  className="w-full text-left px-3 py-2 text-xs transition-all min-h-[36px]"
                  style={{
                    backgroundColor: action.status === s ? 'var(--color-surface-deep)' : 'var(--color-surface)',
                    color: action.status === s ? cfg.color : 'var(--color-ink-muted)',
                    borderLeft: `3px solid ${action.status === s ? cfg.color : 'var(--color-border)'}`,
                    fontWeight: action.status === s ? 500 : 400,
                  }}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Due date */}
        <div>
          <SectionLabel>Due date</SectionLabel>
          <input
            type="date"
            value={action.dueDate}
            onChange={(e) => updateAction(action.id, { dueDate: e.target.value })}
            className="mt-1.5 w-full px-3 py-2.5 text-xs outline-none"
            style={{
              fontFamily: 'var(--font-mono)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-ink-secondary)',
              border: 'none',
              borderLeft: '3px solid var(--color-border)',
            }}
          />
        </div>

        {/* Referral link */}
        <div>
          <SectionLabel>Referral service (if applicable)</SectionLabel>
          <input
            type="text"
            value={action.referralLink}
            onChange={(e) => updateAction(action.id, { referralLink: e.target.value })}
            placeholder="Service name"
            className="mt-1.5 w-full px-3 py-2.5 text-xs outline-none"
            style={{
              fontFamily: 'var(--font-mono)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-ink-secondary)',
              border: 'none',
              borderLeft: '3px solid var(--color-border)',
              caretColor: 'var(--color-ridge)',
            }}
          />
        </div>

        {/* Notes */}
        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea
            value={action.notes}
            onChange={(e) => updateAction(action.id, { notes: e.target.value })}
            placeholder="Any additional context or next steps…"
            rows={2}
            className="mt-1.5 w-full px-3 py-2.5 text-xs leading-relaxed resize-none"
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-ink-secondary)',
              border: 'none',
              borderLeft: '3px solid var(--color-border)',
              outline: 'none',
              caretColor: 'var(--color-ridge)',
            }}
          />
        </div>

        {/* Supervisor review toggle */}
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--color-ink-secondary)' }}>
              Flag for supervisor review
            </p>
            <p className="text-xs italic mt-0.5" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
              Supervisor will be notified at the Record step
            </p>
          </div>
          <button
            onClick={() => updateAction(action.id, { supervisorReview: !action.supervisorReview })}
            className="flex-shrink-0 relative transition-colors ml-4"
            style={{
              width: 40,
              height: 22,
              backgroundColor: action.supervisorReview ? 'var(--color-ridge)' : 'var(--color-border-strong)',
            }}
          >
            <div
              className="absolute top-0.5 transition-all"
              style={{
                width: 18, height: 18,
                backgroundColor: 'white',
                left: action.supervisorReview ? 20 : 2,
              }}
            />
          </button>
        </div>

        {/* Delete */}
        <div className="pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button
            onClick={() => { removeAction(action.id); setExpandedId(null) }}
            className="text-xs transition-opacity hover:opacity-70"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-concern)', letterSpacing: '0.04em' }}
          >
            Remove this action
          </button>
        </div>
      </div>
    )
  }

  // ── Collapsed action card ────────────────────────────────────────────────

  const ActionCard = ({ action }: { action: RichAction }) => {
    const pc = PRIORITY_CONFIG[action.priority]
    const sc = RUN_STATUS_CONFIG[action.status]
    const isExpanded = expandedId === action.id
    const isCarried = action.fromPrevSession || action.status === 'carried-forward'

    return (
      <div style={{ opacity: action.status === 'complete' ? 0.5 : 1 }}>
        <button
          onClick={() => setExpandedId(isExpanded ? null : action.id)}
          className="w-full text-left transition-all active:opacity-80"
        >
          <div
            className="flex items-start gap-0"
            style={{
              backgroundColor: isCarried ? 'var(--color-surface)' : 'var(--color-surface)',
            }}
          >
            {/* Priority stripe */}
            <div
              className="flex-shrink-0"
              style={{
                width: 4,
                minHeight: 72,
                backgroundColor: isCarried ? 'var(--color-border-strong)' : pc.color,
              }}
            />
            {/* Card content */}
            <div className="flex-1 px-4 py-3.5 min-w-0">
              {/* Carried-from-prev badge */}
              {action.fromPrevSession && (
                <p
                  className="text-xs mb-1.5"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                >
                  ↑ From previous session
                </p>
              )}
              {/* Title */}
              <p
                className="text-sm font-medium leading-snug mb-2"
                style={{
                  fontFamily: 'var(--font-display)',
                  color: isCarried ? 'var(--color-ink-secondary)' : 'var(--color-ink)',
                }}
              >
                {action.title}
              </p>
              {/* Meta row */}
              <div className="flex items-center gap-2 flex-wrap">
                <ActionBadge type={action.type} />
                {action.pouIdx !== null && (
                  <span
                    className="text-xs"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}
                  >
                    {pouShortLabel(action.pouIdx)}
                  </span>
                )}
                <span
                  className="text-xs"
                  style={{ fontFamily: 'var(--font-mono)', color: sc.color }}
                >
                  {sc.label}
                </span>
                {action.dueDate && (
                  <span
                    className="text-xs"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                  >
                    {action.dueDate}
                  </span>
                )}
              </div>
              {/* Factor */}
              {action.factorText && (
                <p
                  className="text-xs italic mt-1.5"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
                >
                  {action.factorText}
                </p>
              )}
              {/* Referral link */}
              {action.referralLink && (
                <p
                  className="text-xs mt-1"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)' }}
                >
                  → {action.referralLink}
                </p>
              )}
              {/* Supervisor flag */}
              {action.supervisorReview && (
                <p
                  className="text-xs mt-1"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}
                >
                  ⊕ Supervisor review flagged
                </p>
              )}
            </div>
            {/* Expand indicator */}
            <div
              className="flex-shrink-0 flex items-center px-3 pt-4"
              style={{ color: 'var(--color-ink-muted)' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
                {isExpanded ? '▲' : '▽'}
              </span>
            </div>
          </div>
        </button>
        {isExpanded && <EditDrawer action={action} />}
      </div>
    )
  }

  // ── Add action form ──────────────────────────────────────────────────────

  const AddActionForm = () => (
    <div
      className="px-4 py-5 space-y-4"
      style={{ backgroundColor: 'var(--color-surface)', borderLeft: '4px solid var(--color-ridge)' }}
    >
      <p
        className="text-xs tracking-wide"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}
      >
        NEW ACTION
      </p>
      <div>
        <SectionLabel>Title</SectionLabel>
        <input
          type="text"
          value={draft.title ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          placeholder="What needs to happen?"
          className="mt-1.5 w-full px-3 py-3 text-sm outline-none"
          autoFocus
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            backgroundColor: 'var(--color-ground)',
            color: 'var(--color-ink)',
            border: 'none',
            borderLeft: '3px solid var(--color-ridge)',
            caretColor: 'var(--color-ridge)',
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <SectionLabel>Type</SectionLabel>
          <div className="mt-1.5 space-y-px">
            {(['referral', 'supervisor-review', 'carry-forward', 'escalation'] as ActionType[]).map((t) => (
              <button
                key={t}
                onClick={() => setDraft((d) => ({ ...d, type: t }))}
                className="w-full text-left px-2 py-2 text-xs transition-all min-h-[32px]"
                style={{
                  backgroundColor: draft.type === t ? 'var(--color-ridge)' : 'var(--color-ground)',
                  color: draft.type === t ? 'white' : 'var(--color-ink-muted)',
                  borderLeft: `2px solid ${draft.type === t ? 'transparent' : 'var(--color-border)'}`,
                }}
              >
                {t.replace('-', ' ')}
              </button>
            ))}
          </div>
        </div>
        <div>
          <SectionLabel>Priority</SectionLabel>
          <div className="mt-1.5 space-y-px">
            {(Object.entries(PRIORITY_CONFIG) as [ActionPriority, typeof PRIORITY_CONFIG[ActionPriority]][]).map(([p, cfg]) => (
              <button
                key={p}
                onClick={() => setDraft((d) => ({ ...d, priority: p }))}
                className="w-full text-left px-2 py-2 text-xs transition-all min-h-[32px]"
                style={{
                  backgroundColor: draft.priority === p ? cfg.color : 'var(--color-ground)',
                  color: draft.priority === p ? 'white' : 'var(--color-ink-muted)',
                  borderLeft: `2px solid ${draft.priority === p ? 'transparent' : cfg.color}`,
                }}
              >
                {cfg.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <SectionLabel>Linked Te Waharoa Pou (optional)</SectionLabel>
        <div className="mt-1.5 flex flex-wrap gap-px">
          {data.pou.map((_, i) => (
            <button
              key={i}
              onClick={() => setDraft((d) => ({ ...d, pouIdx: d.pouIdx === i ? null : i }))}
              className="px-3 py-1.5 text-xs transition-all"
              style={{
                backgroundColor: draft.pouIdx === i ? 'var(--color-ridge)' : 'var(--color-ground)',
                color: draft.pouIdx === i ? 'white' : 'var(--color-ink-muted)',
                fontFamily: 'var(--font-mono)',
                borderLeft: `2px solid ${draft.pouIdx === i ? 'transparent' : 'var(--color-border)'}`,
                minHeight: 32,
              }}
            >
              {pouShortLabel(i)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>Notes (optional)</SectionLabel>
        <textarea
          value={draft.notes ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          placeholder="Any context or next steps…"
          rows={2}
          className="mt-1.5 w-full px-3 py-2.5 text-xs leading-relaxed resize-none italic"
          style={{
            fontFamily: 'var(--font-display)',
            backgroundColor: 'var(--color-ground)',
            color: 'var(--color-ink-secondary)',
            border: 'none',
            borderLeft: '3px solid var(--color-border)',
            outline: 'none',
          }}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={addAction}
          disabled={!draft.title?.trim()}
          className="flex-1 py-3 text-xs font-medium tracking-wide transition-all"
          style={{
            backgroundColor: draft.title?.trim() ? 'var(--color-ridge)' : 'var(--color-surface-deep)',
            color: draft.title?.trim() ? 'white' : 'var(--color-ink-muted)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.06em',
          }}
        >
          Add action
        </button>
        <button
          onClick={() => setAddingNew(false)}
          className="px-4 py-3 text-xs transition-opacity hover:opacity-70"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: 'var(--font-body)' }}>

      {/* Orientation */}
      <div className="px-6 pt-8 pb-6">
        <p
          className="text-xs tracking-widest uppercase mb-5"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}
        >
          Ngā Mahi — Risks & Actions
        </p>
        <h2
          className="mb-3 leading-snug"
          style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--color-ink)' }}
        >
          Turning reflection into care
        </h2>
        <p
          className="text-sm italic leading-relaxed"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
        >
          Review what was identified across the Pou of Te Waharoa and confirm what needs
          to happen next. Actions are linked to the factors that named them.
        </p>
      </div>

      {/* Risk factor summary — compact, from pou review */}
      {flaggedPou.length > 0 && (
        <div className="px-5 mb-5">
          <SectionLabel>Ngā tūraru i kitea — Risks identified across this session</SectionLabel>
          <div className="mt-2 space-y-px">
            {flaggedPou.map((p, i) => {
              const cc = STATUS_CONFIG[p.status]
              const ext = POU_EXTENDED[data.pou.findIndex((dp) => dp.id === p.id)]
              return (
                <div
                  key={p.id}
                  className="flex items-start gap-3 px-4 py-3"
                  style={{ backgroundColor: cc.light, borderLeft: `3px solid ${cc.color}` }}
                >
                  <div className="flex-shrink-0 mt-0.5" style={{ width: 2, height: 16, backgroundColor: cc.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
                      {ext?.full ?? p.reo}
                    </p>
                    {ext?.risk.slice(0, 1).map((r, ri) => (
                      <p key={ri} className="text-xs italic mt-0.5" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
                        {r}
                      </p>
                    ))}
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="mx-5 mb-4" style={{ height: 1, backgroundColor: 'var(--color-border)' }} />

      {/* Filter tabs */}
      <div
        className="flex px-5 mb-4"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        {([
          { id: 'all', label: `All (${actions.length})` },
          { id: 'active', label: `Active (${activeActions.length})` },
          { id: 'carried', label: `Carried (${carriedActions.length})` },
        ] as const).map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className="px-1 py-2.5 mr-5 text-xs transition-colors min-h-[40px]"
            style={{
              fontFamily: 'var(--font-mono)',
              color: filter === f.id ? 'var(--color-ridge)' : 'var(--color-ink-muted)',
              borderBottom: filter === f.id ? '2px solid var(--color-ridge)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Action cards */}
      <div className="px-5 space-y-px mb-4">
        {displayActions.length === 0 && (
          <p
            className="text-sm italic py-6 text-center"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
          >
            No actions in this view
          </p>
        )}
        {displayActions.map((action) => (
          <ActionCard key={action.id} action={action} />
        ))}
      </div>

      {/* Carried forward note */}
      {carriedActions.length > 0 && filter !== 'active' && (
        <div
          className="mx-5 mb-4 px-4 py-3"
          style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}
        >
          <p
            className="text-xs italic leading-relaxed"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
          >
            Carried-forward actions travel with you to the next session. They are held here — visible and present, not lost.
          </p>
        </div>
      )}

      {/* Add action */}
      <div className="px-5 mb-5">
        {!addingNew ? (
          <button
            onClick={() => setAddingNew(true)}
            className="w-full py-3.5 text-left px-4 transition-opacity hover:opacity-80 min-h-[52px]"
            style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}
          >
            <span
              className="text-sm"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.04em' }}
            >
              + Add action
            </span>
          </button>
        ) : (
          <AddActionForm />
        )}
      </div>

      {/* Proceed */}
      <div className="px-5 pb-8" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem' }}>
        <button
          onClick={handleProceed}
          className="w-full text-left transition-all active:opacity-85"
        >
          <div style={{ backgroundColor: 'var(--color-ridge)', padding: '1.25rem 1.25rem' }}>
            <div className="flex gap-1 mb-4" style={{ opacity: 0.18 }}>
              {[0,1,2,3,4,5,6].map((i) => (
                <div key={i} style={{ flex: 1, height: 2, backgroundColor: 'white' }} />
              ))}
            </div>
            <p
              className="text-lg font-medium italic mb-1"
              style={{ fontFamily: 'var(--font-display)', color: 'white', lineHeight: 1.3 }}
            >
              Haere tonu — Referral Pathways
            </p>
            <p
              className="text-xs"
              style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em' }}
            >
              {actions.filter((a) => a.status !== 'complete').length} ACTION{actions.filter((a) => a.status !== 'complete').length !== 1 ? 'S' : ''} CONFIRMED →
            </p>
          </div>
        </button>
      </div>

    </div>
  )
}

// Stage 5 — Referrals (within session)
// ─── Referral Pathways types ───────────────────────────────────────────────────

type ReferralStatus = 'suggested' | 'prepared' | 'sent' | 'declined'
type PathwayScope = 'internal' | 'external' | 'crisis'

interface PathwayItem {
  id: string
  name: string
  description: string
  scope: PathwayScope
  contact: string
  pouIdx: number | null
  factorText: string
  factorType: 'risk' | 'protective' | null
  status: ReferralStatus
  notes: string
  handoverTo: string
}

const PATHWAY_STATUS_CONFIG: Record<ReferralStatus, { label: string; color: string; bg: string }> = {
  suggested: { label: 'Suggested',  color: 'var(--color-ink-muted)',  bg: 'var(--color-surface)'        },
  prepared:  { label: 'Prepared',   color: 'var(--color-ridge)',      bg: 'var(--color-ridge-light)'    },
  sent:      { label: 'Sent',       color: 'var(--color-growth)',     bg: 'var(--color-growth-light)'   },
  declined:  { label: 'Declined',   color: 'var(--color-ink-muted)',  bg: 'var(--color-surface-deep)'   },
}

const PATHWAY_SCOPE_CONFIG: Record<PathwayScope, { label: string; color: string }> = {
  internal: { label: 'Internal',  color: 'var(--color-ridge)'   },
  external: { label: 'External',  color: 'var(--color-growth)'  },
  crisis:   { label: 'Crisis',    color: 'var(--color-concern)' },
}

// Full catalog — internal pathways are within the team/org
const INTERNAL_PATHWAY_CATALOG: Omit<PathwayItem, 'pouIdx' | 'factorText' | 'factorType' | 'status' | 'notes' | 'handoverTo'>[] = [
  {
    id: 'ip-1',
    name: 'Cultural Support Lead',
    description: 'Tikanga-based guidance, cultural reconnection and mana-enhancing support within the team',
    scope: 'internal',
    contact: 'Internal — contact your team coordinator',
  },
  {
    id: 'ip-2',
    name: 'Clinical Review / Supervisor Discussion',
    description: 'Clinical oversight, reflective supervision, and shared decision-making with your supervisor',
    scope: 'internal',
    contact: 'Internal — arrange through your coordinator',
  },
  {
    id: 'ip-3',
    name: 'Whānau Engagement Support',
    description: 'Additional kaimahi capacity to support complex or high-need whānau engagement',
    scope: 'internal',
    contact: 'Internal — contact your team leader',
  },
  {
    id: 'ip-4',
    name: 'Care Navigation Support',
    description: 'Integrated navigation across health, housing and social services for whānau with complex needs',
    scope: 'internal',
    contact: 'Internal — contact care navigator',
  },
]

const EXTERNAL_PATHWAY_CATALOG: Omit<PathwayItem, 'pouIdx' | 'factorText' | 'factorType' | 'status' | 'notes' | 'handoverTo'>[] = [
  {
    id: 'ep-1',
    name: 'GP / Primary Care',
    description: 'Primary health care including GP enrolment, health checks and specialist referrals',
    scope: 'external',
    contact: 'Te Whatu Ora — 0800 855 066',
  },
  {
    id: 'ep-2',
    name: 'AOD Support Service',
    description: 'Free, confidential alcohol and other drug support — kaimahi and whānau both welcome',
    scope: 'external',
    contact: 'Alcohol & Drug Helpline — 0800 787 797',
  },
  {
    id: 'ep-3',
    name: 'Housing Support Partner',
    description: 'Housing navigation, applications, emergency placement and tenancy support',
    scope: 'external',
    contact: 'Kāinga Ora — 0800 801 601',
  },
  {
    id: 'ep-4',
    name: 'Crisis Support Pathway',
    description: '24/7 crisis response, immediate safety planning and emergency intervention',
    scope: 'crisis',
    contact: 'Lifeline Aotearoa — 0800 543 354',
  },
]

// Demo pathways — pre-suggested from the pou review outcomes
const DEMO_PATHWAYS: PathwayItem[] = [
  {
    id: 'pw-1',
    name: 'Clinical Review / Supervisor Discussion',
    description: 'Clinical oversight, reflective supervision, and shared decision-making with your supervisor',
    scope: 'internal',
    contact: 'Internal — arrange through your coordinator',
    pouIdx: 1,
    factorText: 'Persistent low mood and sleep disruption over the past fortnight',
    factorType: 'risk',
    status: 'suggested',
    notes: '',
    handoverTo: '',
  },
  {
    id: 'pw-2',
    name: 'GP / Primary Care',
    description: 'Primary health care including GP enrolment, health checks and specialist referrals',
    scope: 'external',
    contact: 'Te Whatu Ora — 0800 855 066',
    pouIdx: 2,
    factorText: 'Medical appointments overdue for youngest child',
    factorType: 'risk',
    status: 'suggested',
    notes: '',
    handoverTo: '',
  },
  {
    id: 'pw-3',
    name: 'Housing Support Partner',
    description: 'Housing navigation, applications, emergency placement and tenancy support',
    scope: 'external',
    contact: 'Kāinga Ora — 0800 801 601',
    pouIdx: 4,
    factorText: 'Kāinga Ora application lodged — no response in three weeks',
    factorType: 'risk',
    status: 'suggested',
    notes: '',
    handoverTo: '',
  },
]

const HANDOVER_OPTIONS = [
  'Aroha (kaimahi)',
  'Hemi (supervisor)',
  'Care navigator',
  'Whānau to self-refer',
  'Shared with whānau',
]

// ─── Referrals Stage ───────────────────────────────────────────────────────────

function ReferralsStage({
  data,
  onChange,
  onNext,
}: {
  data: ActiveSessionData
  onChange: (p: Partial<ActiveSessionData>) => void
  onNext: () => void
}) {
  const [pathways, setPathways] = useState<PathwayItem[]>(DEMO_PATHWAYS)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browseTab, setBrowseTab] = useState<'internal' | 'external'>('internal')

  const updatePathway = (id: string, patch: Partial<PathwayItem>) =>
    setPathways((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))

  const addPathway = (template: Omit<PathwayItem, 'pouIdx' | 'factorText' | 'factorType' | 'status' | 'notes' | 'handoverTo'>) => {
    if (pathways.find((p) => p.id === template.id)) return
    setPathways((prev) => [
      ...prev,
      { ...template, pouIdx: null, factorText: '', factorType: null, status: 'suggested', notes: '', handoverTo: '' },
    ])
    setBrowseOpen(false)
    setExpandedId(template.id)
  }

  const removePathway = (id: string) => {
    setPathways((prev) => prev.filter((p) => p.id !== id))
    setExpandedId(null)
  }

  const handleProceed = () => {
    const activeIds = pathways
      .filter((p) => p.status !== 'declined')
      .map((p) => p.id)
    onChange({ selectedReferralIds: activeIds })
    onNext()
  }

  const preparedCount = pathways.filter((p) => p.status === 'prepared' || p.status === 'sent').length
  const activePathways = pathways.filter((p) => p.status !== 'declined')
  const declinedPathways = pathways.filter((p) => p.status === 'declined')

  // ── Scope stripe ─────────────────────────────────────────────────────────

  const scopeColor = (scope: PathwayScope) => PATHWAY_SCOPE_CONFIG[scope].color

  // ── Prepare panel (inline edit drawer) ──────────────────────────────────

  const PreparePanel = ({ pathway }: { pathway: PathwayItem }) => {
    const sc = PATHWAY_STATUS_CONFIG[pathway.status]
    return (
      <div
        className="px-4 py-5 space-y-4"
        style={{
          backgroundColor: 'var(--color-ground)',
          borderLeft: `3px solid ${scopeColor(pathway.scope)}`,
          borderTop: '1px solid var(--color-border)',
        }}
      >
        {/* Reason */}
        <div>
          <SectionLabel>Linked Te Waharoa Pou</SectionLabel>
          <div className="mt-1.5 flex flex-wrap gap-px">
            {data.pou.map((_, i) => (
              <button
                key={i}
                onClick={() => updatePathway(pathway.id, { pouIdx: i })}
                className="px-3 py-2 text-xs transition-all"
                style={{
                  backgroundColor: pathway.pouIdx === i ? scopeColor(pathway.scope) : 'var(--color-surface)',
                  color: pathway.pouIdx === i ? 'white' : 'var(--color-ink-muted)',
                  fontFamily: 'var(--font-mono)',
                  borderLeft: `2px solid ${pathway.pouIdx === i ? 'transparent' : 'var(--color-border)'}`,
                  minHeight: 36,
                }}
              >
                {pouShortLabel(i)}
              </button>
            ))}
          </div>
        </div>

        {/* Factor */}
        <div>
          <SectionLabel>Reason for referral</SectionLabel>
          <input
            type="text"
            value={pathway.factorText}
            onChange={(e) => updatePathway(pathway.id, { factorText: e.target.value })}
            placeholder="The risk or protective factor that prompted this referral"
            className="mt-1.5 w-full px-3 py-2.5 text-xs outline-none"
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-ink-secondary)',
              border: 'none',
              borderLeft: '3px solid var(--color-border)',
              caretColor: scopeColor(pathway.scope),
            }}
          />
          <div className="flex gap-px mt-1.5">
            {(['risk', 'protective'] as const).map((ft) => (
              <button
                key={ft}
                onClick={() => updatePathway(pathway.id, { factorType: ft })}
                className="px-3 py-1.5 text-xs transition-all"
                style={{
                  backgroundColor: pathway.factorType === ft ? 'var(--color-surface-deep)' : 'var(--color-surface)',
                  color: pathway.factorType === ft
                    ? (ft === 'risk' ? 'var(--color-concern)' : 'var(--color-growth)')
                    : 'var(--color-ink-muted)',
                  fontFamily: 'var(--font-mono)',
                  borderLeft: `2px solid ${pathway.factorType === ft ? 'transparent' : 'var(--color-border)'}`,
                  minHeight: 32,
                }}
              >
                {ft === 'risk' ? 'Risk factor' : 'Protective factor'}
              </button>
            ))}
          </div>
        </div>

        {/* Contact */}
        <div
          className="px-3 py-3"
          style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}
        >
          <p className="text-xs mb-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.06em' }}>
            CONTACT
          </p>
          <p className="text-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-secondary)' }}>
            {pathway.contact}
          </p>
        </div>

        {/* Handover */}
        <div>
          <SectionLabel>Who follows this up</SectionLabel>
          <div className="mt-1.5 flex flex-wrap gap-px">
            {HANDOVER_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => updatePathway(pathway.id, { handoverTo: opt })}
                className="px-3 py-2 text-xs transition-all"
                style={{
                  backgroundColor: pathway.handoverTo === opt ? scopeColor(pathway.scope) : 'var(--color-surface)',
                  color: pathway.handoverTo === opt ? 'white' : 'var(--color-ink-muted)',
                  borderLeft: `2px solid ${pathway.handoverTo === opt ? 'transparent' : 'var(--color-border)'}`,
                  minHeight: 36,
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <SectionLabel>Notes for referral summary</SectionLabel>
          <textarea
            value={pathway.notes}
            onChange={(e) => updatePathway(pathway.id, { notes: e.target.value })}
            placeholder="Context to include when preparing the referral…"
            rows={2}
            className="mt-1.5 w-full px-3 py-2.5 text-xs leading-relaxed resize-none"
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-ink-secondary)',
              border: 'none',
              borderLeft: '3px solid var(--color-border)',
              outline: 'none',
            }}
          />
        </div>

        {/* Status */}
        <div>
          <SectionLabel>Status</SectionLabel>
          <div className="mt-1.5 grid grid-cols-2 gap-px">
            {(Object.entries(PATHWAY_STATUS_CONFIG) as [ReferralStatus, typeof PATHWAY_STATUS_CONFIG[ReferralStatus]][]).map(([s, cfg]) => (
              <button
                key={s}
                onClick={() => updatePathway(pathway.id, { status: s })}
                className="py-2.5 px-3 text-xs text-left transition-all"
                style={{
                  backgroundColor: pathway.status === s ? cfg.bg : 'var(--color-surface)',
                  color: pathway.status === s ? cfg.color : 'var(--color-ink-muted)',
                  borderLeft: `3px solid ${pathway.status === s ? cfg.color : 'var(--color-border)'}`,
                  fontWeight: pathway.status === s ? 500 : 400,
                  minHeight: 40,
                }}
              >
                {cfg.label}
              </button>
            ))}
          </div>
        </div>

        {/* Remove */}
        <div className="pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button
            onClick={() => removePathway(pathway.id)}
            className="text-xs transition-opacity hover:opacity-70"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-concern)', letterSpacing: '0.04em' }}
          >
            Remove this pathway
          </button>
        </div>
      </div>
    )
  }

  // ── Pathway card ─────────────────────────────────────────────────────────

  const PathwayCard = ({ pathway, muted }: { pathway: PathwayItem; muted?: boolean }) => {
    const isExpanded = expandedId === pathway.id
    const sc = PATHWAY_STATUS_CONFIG[pathway.status]
    const scopeCfg = PATHWAY_SCOPE_CONFIG[pathway.scope]

    return (
      <div style={{ opacity: muted ? 0.55 : 1 }}>
        <button
          onClick={() => setExpandedId(isExpanded ? null : pathway.id)}
          className="w-full text-left transition-all active:opacity-80"
        >
          <div className="flex items-stretch">
            {/* Scope stripe */}
            <div
              className="flex-shrink-0"
              style={{ width: 4, minHeight: 72, backgroundColor: scopeColor(pathway.scope) }}
            />
            {/* Card body */}
            <div
              className="flex-1 px-4 py-3.5 min-w-0"
              style={{ backgroundColor: 'var(--color-surface)' }}
            >
              {/* Top row — name + scope badge */}
              <div className="flex items-start gap-2 mb-2">
                <p
                  className="flex-1 text-sm font-medium leading-snug"
                  style={{ fontFamily: 'var(--font-display)', color: muted ? 'var(--color-ink-secondary)' : 'var(--color-ink)' }}
                >
                  {pathway.name}
                </p>
                <span
                  className="flex-shrink-0 px-1.5 py-0.5 text-xs"
                  style={{ fontFamily: 'var(--font-mono)', color: scopeCfg.color, backgroundColor: 'transparent', border: `1px solid ${scopeCfg.color}`, opacity: 0.8 }}
                >
                  {scopeCfg.label}
                </span>
              </div>

              {/* Reason — pou + factor */}
              {(pathway.pouIdx !== null || pathway.factorText) && (
                <div className="flex items-start gap-2 mb-2">
                  {pathway.pouIdx !== null && (
                    <span
                      className="flex-shrink-0 text-xs"
                      style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}
                    >
                      {pouShortLabel(pathway.pouIdx)}
                    </span>
                  )}
                  {pathway.factorText && (
                    <p
                      className="text-xs italic leading-relaxed"
                      style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
                    >
                      {pathway.factorText}
                    </p>
                  )}
                </div>
              )}

              {/* Bottom row — status + handover */}
              <div className="flex items-center gap-3">
                <span
                  className="text-xs font-medium"
                  style={{ fontFamily: 'var(--font-mono)', color: sc.color }}
                >
                  {sc.label}
                </span>
                {pathway.handoverTo && (
                  <span
                    className="text-xs"
                    style={{ color: 'var(--color-ink-muted)' }}
                  >
                    → {pathway.handoverTo}
                  </span>
                )}
              </div>
            </div>
            {/* Expand indicator */}
            <div
              className="flex-shrink-0 flex items-center px-3 pt-3"
              style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-ink-muted)' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
                {isExpanded ? '▲' : '▽'}
              </span>
            </div>
          </div>
        </button>
        {isExpanded && <PreparePanel pathway={pathway} />}
      </div>
    )
  }

  // ── Browse panel ──────────────────────────────────────────────────────────

  const BrowsePanel = () => {
    const catalog = browseTab === 'internal' ? INTERNAL_PATHWAY_CATALOG : EXTERNAL_PATHWAY_CATALOG
    return (
      <div
        style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}
      >
        {/* Browse tabs */}
        <div
          className="flex"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          {(['internal', 'external'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setBrowseTab(tab)}
              className="flex-1 py-3 text-xs transition-colors"
              style={{
                fontFamily: 'var(--font-mono)',
                color: browseTab === tab ? PATHWAY_SCOPE_CONFIG[tab].color : 'var(--color-ink-muted)',
                borderBottom: browseTab === tab ? `2px solid ${PATHWAY_SCOPE_CONFIG[tab].color}` : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {tab === 'internal' ? 'Within team' : 'External services'}
            </button>
          ))}
        </div>
        {/* Service list */}
        <div className="space-y-px py-1">
          {catalog.map((item) => {
            const alreadyAdded = !!pathways.find((p) => p.id === item.id)
            return (
              <button
                key={item.id}
                onClick={() => !alreadyAdded && addPathway(item)}
                disabled={alreadyAdded}
                className="w-full text-left px-4 py-3.5 transition-opacity"
                style={{ opacity: alreadyAdded ? 0.4 : 1 }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex-shrink-0 mt-0.5"
                    style={{ width: 3, height: 36, backgroundColor: scopeColor(item.scope) }}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium mb-0.5" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
                      {item.name}
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--color-ink-muted)' }}>
                      {item.description}
                    </p>
                    <p className="text-xs mt-1.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                      {item.contact}
                    </p>
                  </div>
                  {alreadyAdded ? (
                    <span className="flex-shrink-0 text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>Added</span>
                  ) : (
                    <span className="flex-shrink-0 text-xs" style={{ fontFamily: 'var(--font-mono)', color: scopeColor(item.scope) }}>+ Add</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        {/* Close */}
        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button
            onClick={() => setBrowseOpen(false)}
            className="text-xs transition-opacity hover:opacity-70"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: 'var(--font-body)' }}>

      {/* Orientation */}
      <div className="px-6 pt-8 pb-6">
        <p
          className="text-xs tracking-widest uppercase mb-5"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)', letterSpacing: '0.14em' }}
        >
          Ngā Ara Tautoko — Referral Pathways
        </p>
        <h2
          className="mb-3 leading-snug"
          style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--color-ink)' }}
        >
          Support pathways extending from the Whare
        </h2>
        <p
          className="text-sm italic leading-relaxed"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
        >
          Each pathway below is linked to a Pou of Te Waharoa and to the specific
          factor that named it. Prepare the referrals you want to carry forward
          from this session.
        </p>
      </div>

      {/* Scope legend */}
      <div className="px-5 mb-5 flex gap-4">
        {(Object.entries(PATHWAY_SCOPE_CONFIG) as [PathwayScope, typeof PATHWAY_SCOPE_CONFIG[PathwayScope]][]).map(([scope, cfg]) => (
          <div key={scope} className="flex items-center gap-1.5">
            <div style={{ width: 10, height: 10, backgroundColor: cfg.color }} />
            <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
              {cfg.label}
            </span>
          </div>
        ))}
      </div>

      <div className="mx-5 mb-5" style={{ height: 1, backgroundColor: 'var(--color-border)' }} />

      {/* Suggested pathways */}
      <div className="px-5 mb-2">
        <SectionLabel>Suggested from this session</SectionLabel>
        <p
          className="text-xs italic mt-1 mb-3"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
        >
          Based on what was named across the Te Waharoa Pou review
        </p>
      </div>
      <div className="px-5 space-y-px mb-5">
        {activePathways.map((pathway) => (
          <PathwayCard key={pathway.id} pathway={pathway} />
        ))}
        {activePathways.length === 0 && (
          <p
            className="text-sm italic py-4"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
          >
            No active pathways — add one below
          </p>
        )}
      </div>

      {/* Declined — held at foot */}
      {declinedPathways.length > 0 && (
        <div className="px-5 mb-5">
          <SectionLabel>Declined this session</SectionLabel>
          <div className="mt-2 space-y-px">
            {declinedPathways.map((pathway) => (
              <PathwayCard key={pathway.id} pathway={pathway} muted />
            ))}
          </div>
        </div>
      )}

      {/* Add pathway */}
      <div className="px-5 mb-5">
        {!browseOpen ? (
          <button
            onClick={() => setBrowseOpen(true)}
            className="w-full py-3.5 text-left px-4 transition-opacity hover:opacity-80 min-h-[52px]"
            style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}
          >
            <span
              className="text-sm"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)', letterSpacing: '0.04em' }}
            >
              + Add a support pathway
            </span>
          </button>
        ) : (
          <BrowsePanel />
        )}
      </div>

      {/* Prepared summary */}
      {preparedCount > 0 && (
        <div
          className="mx-5 mb-5 px-4 py-4"
          style={{ backgroundColor: 'var(--color-growth-light)', borderLeft: '3px solid var(--color-growth)' }}
        >
          <p
            className="text-xs font-medium mb-2"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)', letterSpacing: '0.06em' }}
          >
            {preparedCount} PATHWAY{preparedCount !== 1 ? 'S' : ''} PREPARED
          </p>
          {pathways
            .filter((p) => p.status === 'prepared' || p.status === 'sent')
            .map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-1" style={{ borderTop: '1px solid rgba(116,196,0,0.15)' }}>
                <div style={{ width: 3, height: 14, backgroundColor: scopeColor(p.scope), flexShrink: 0 }} />
                <p className="text-xs" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                  {p.name}
                </p>
                {p.handoverTo && (
                  <p className="text-xs ml-auto" style={{ color: 'var(--color-ink-muted)' }}>
                    → {p.handoverTo}
                  </p>
                )}
              </div>
            ))}
        </div>
      )}

      {/* Proceed */}
      <div className="px-5 pb-8" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem' }}>
        <button
          onClick={handleProceed}
          className="w-full text-left transition-all active:opacity-85"
        >
          <div style={{ backgroundColor: 'var(--color-ridge)', padding: '1.25rem 1.25rem' }}>
            <div className="flex gap-1 mb-4" style={{ opacity: 0.18 }}>
              {[0,1,2,3,4,5,6].map((i) => (
                <div key={i} style={{ flex: 1, height: 2, backgroundColor: 'white' }} />
              ))}
            </div>
            <p
              className="text-lg font-medium italic mb-1"
              style={{ fontFamily: 'var(--font-display)', color: 'white', lineHeight: 1.3 }}
            >
              Haere tonu — Synthesis
            </p>
            <p
              className="text-xs"
              style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em' }}
            >
              {activePathways.length} PATHWAY{activePathways.length !== 1 ? 'S' : ''} FROM THIS SESSION →
            </p>
          </div>
        </button>
      </div>

    </div>
  )
}

// ─── Synthesis types ───────────────────────────────────────────────────────────

type SynthesisLoadState = 'loading' | 'ready' | 'regenerating' | 'saved'

interface SynthesisSection {
  id: string
  label: string
  reoLabel: string
  content: string
  editable: boolean
  sourceItems: string[]
}

const INITIAL_SYNTHESIS_SECTIONS: SynthesisSection[] = [
  {
    id: 'reason',
    label: 'Reason for reflection',
    reoLabel: 'Te take',
    content: 'Scheduled home visit following the previous session. Aroha requested this session to review progress on housing support and discuss emerging concerns around wellbeing.',
    editable: true,
    sourceItems: ['Home visit — scheduled engagement', 'Follow-up from W-2835', 'Initiated by kaimahi and whānau together'],
  },
  {
    id: 'engagement',
    label: 'Summary of whānau engagement',
    reoLabel: 'He kōrero whānau',
    content: 'Mere was present for the full session. Engagement was open and reflective — she spoke candidly about current pressures and acknowledged areas of strength within her whānau. The therapeutic relationship remains strong. She described feeling safe to speak honestly, and raised concerns she had not shared in previous sessions.',
    editable: true,
    sourceItems: ['Full session attendance', 'Voice engagement — 42 minutes', 'Described as open and reflective by kaimahi', 'New concerns raised voluntarily'],
  },
  {
    id: 'protective',
    label: 'Protective factors',
    reoLabel: 'Ngā āhuatanga tiaki',
    content: 'Strong whanaungatanga is present — Mere describes close relationships with her siblings and the extended whānau network. She demonstrates significant personal resilience, having navigated multiple adversities while maintaining her role as a parent and carer. Cultural connection through regular marae involvement was identified as a source of grounding and identity.',
    editable: true,
    sourceItems: [
      'Strong whānau relationships (Whakapapa, Mana & Whanaungatanga)',
      'Personal resilience and determination (Māia)',
      'Marae involvement — cultural grounding and belonging (Wairua)',
      'Consistent therapeutic engagement across sessions',
    ],
  },
  {
    id: 'risk',
    label: 'Risk factors',
    reoLabel: 'Ngā tūraru',
    content: 'Persistent low mood and sleep disruption have been present for approximately two weeks. This is occurring alongside significant financial pressure — utility bills are behind and creating acute stress in the home. Medical appointments for the youngest child are overdue. The Kāinga Ora housing application lodged three weeks ago has received no response, adding material uncertainty to an already stretched situation.',
    editable: true,
    sourceItems: [
      'Low mood and sleep disruption — two weeks duration (Hinengaro — urgent)',
      'Medical appointments overdue for youngest child (Waranga — watch)',
      'Utility bills behind — financial anxiety (Kāinga — watch)',
      'Housing application — no response in three weeks (Kāinga — watch)',
    ],
  },
  {
    id: 'pou',
    label: 'Te Waharoa Pou reviewed',
    reoLabel: 'Ngā Pou Haumaru',
    content: 'All seven Te Waharoa Pou were reviewed in this session. Kaitiakitanga and Oranga were identified as requiring close attention. Reflective practice demonstrated through each Pou. Protective factors documented and accountability evidenced. Supervision points noted for follow-up.',
    editable: false,
    sourceItems: [
      'Whakapapa, Mana & Whanaungatanga — tōtika (stable)',
      'Hinengaro & Whatumanawa — mataku (urgent attention)',
      'Waranga, Tinana & Daily Functioning — āta (watch)',
      'Wairua, Mauri & Cultural Connection — tōtika (stable)',
      'Kāinga, Taiao & Material Stability — āta (watch)',
      'Mana Motuhake & Ara Tautoko — tōtika (stable)',
    ],
  },
  {
    id: 'actions',
    label: 'Actions agreed',
    reoLabel: 'Ngā mahi',
    content: 'Three actions were agreed from this session. A supervisor review has been requested as a priority action linked to the mental health concern — this is to be arranged before the next whānau contact. A GP appointment for the youngest child has been identified for follow-up by Aroha within the coming week. A connection to financial assistance through Work & Income will be pursued. The housing application follow-up has been carried forward from the previous session.',
    editable: true,
    sourceItems: [
      'Supervisor review — urgent, before next contact (Hinengaro)',
      'GP appointment — important, within one week (Waranga)',
      'Financial assistance — MSD Work & Income (Kāinga)',
      'Housing application follow-up — carried forward from W-2835',
    ],
  },
  {
    id: 'referrals',
    label: 'Referrals and pathways',
    reoLabel: 'Ngā ara tautoko',
    content: 'A clinical review with the supervisor has been prepared as an internal pathway, linked to the identified mental health concern. An external referral to Te Whatu Ora has been prepared for GP enrolment and the outstanding health appointments for the youngest child. A housing support pathway through Kāinga Ora is in progress from a previous session and continues to be monitored.',
    editable: true,
    sourceItems: [
      'Clinical review — supervisor (internal, prepared)',
      'GP / Primary Care — Te Whatu Ora 0800 855 066 (external, prepared)',
      'Housing support — Kāinga Ora (external, carried from W-2835)',
    ],
  },
  {
    id: 'followup',
    label: 'Follow-up required',
    reoLabel: 'Ngā mahi whai ake',
    content: 'Supervisor review to be arranged before next whānau contact. Progress on the GP appointment to be confirmed at the next session. Financial assistance connection to be followed up within one week. Housing application status to be checked — escalate to housing support partner if no response is received within five working days.',
    editable: true,
    sourceItems: [
      'Supervisor review — before next contact (urgent)',
      'GP appointment confirmation — next session',
      'MSD Work & Income connection — within one week',
      'Kāinga Ora status check — escalate if no response in 5 working days',
    ],
  },
  {
    id: 'notes',
    label: 'Kaimahi reflection notes',
    reoLabel: 'He whakaaro kaimahi',
    content: '',
    editable: true,
    sourceItems: [],
  },
]

// ─── Synthesis Stage ───────────────────────────────────────────────────────────

function SynthesisStage({
  data,
  onChange,
  onNext,
}: {
  data: ActiveSessionData
  onChange: (p: Partial<ActiveSessionData>) => void
  onNext: () => void
}) {
  const selectedRefs = REFERRAL_SERVICES.filter((s) => data.selectedReferralIds.includes(s.id))
  const [loadState, setLoadState] = useState<SynthesisLoadState>('loading')
  const [sections, setSections] = useState<SynthesisSection[]>(INITIAL_SYNTHESIS_SECTIONS)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [savedDraft, setSavedDraft] = useState(false)

  // Simulate thin-client synthesis delivery on mount
  useEffect(() => {
    const t = setTimeout(() => setLoadState('ready'), 1800)
    return () => clearTimeout(t)
  }, [])

  const updateSection = (id: string, content: string) =>
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, content } : s)))

  const startEdit = (sec: SynthesisSection) => {
    setEditingId(sec.id)
    setEditDraft(sec.content)
  }

  const commitEdit = () => {
    if (editingId) updateSection(editingId, editDraft)
    setEditingId(null)
    setEditDraft('')
  }

  const handleCopy = () => {
    const fullText = sections
      .filter((s) => s.content.trim())
      .map((s) => `${s.label.toUpperCase()}\n${s.content}`)
      .join('\n\n')
    navigator.clipboard.writeText(fullText).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const handleRegenerate = () => {
    setLoadState('regenerating')
    setSections(INITIAL_SYNTHESIS_SECTIONS)
    setTimeout(() => setLoadState('ready'), 2000)
  }

  const handleSaveDraft = () => {
    setSavedDraft(true)
    setTimeout(() => setSavedDraft(false), 3000)
  }

  // ── Loading shimmer ──────────────────────────────────────────────────────

  if (loadState === 'loading' || loadState === 'regenerating') {
    const label = loadState === 'regenerating' ? 'He whakaaro anō — gathering again…' : 'He whakaaro tonu — your synthesis is arriving…'
    return (
      <div style={{ fontFamily: 'var(--font-body)' }}>
        <style>{`
          @keyframes shimmer {
            0% { opacity: 0.35; }
            50% { opacity: 0.7; }
            100% { opacity: 0.35; }
          }
          .syn-shimmer { animation: shimmer 1.6s ease-in-out infinite; }
        `}</style>

        {/* Header */}
        <div className="px-6 pt-8 pb-6">
          <p className="text-xs tracking-widest uppercase mb-5"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}>
            He Whakaaro — Synthesis
          </p>
          <h2 className="mb-3" style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--color-ink)' }}>
            {label}
          </h2>
          <p className="text-sm italic leading-relaxed"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
            Your kōrero, Te Waharoa Pou review, and agreed actions are being
            woven into a synthesis. It will appear here in a moment for your
            review and editing.
          </p>
        </div>

        {/* Shimmer blocks */}
        <div className="px-5 space-y-3 pb-10">
          {[72, 48, 96, 56, 80, 48].map((h, i) => (
            <div key={i} className="syn-shimmer" style={{ animationDelay: `${i * 0.18}s` }}>
              <div style={{ height: 10, width: '35%', backgroundColor: 'var(--color-border-strong)', marginBottom: 10 }} />
              <div style={{ height: h, backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Section card ─────────────────────────────────────────────────────────

  const SectionCard = ({ sec }: { sec: SynthesisSection }) => {
    const isEditing = editingId === sec.id
    const hasSource = sec.sourceItems.length > 0
    const sourceOpen = expandedSourceId === sec.id
    const isEmpty = !sec.content.trim()

    return (
      <div
        className="mb-px"
        style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}
      >
        {/* Section header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div>
            <p
              className="text-xs tracking-wide"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.08em' }}
            >
              {sec.reoLabel.toUpperCase()}
            </p>
            <p
              className="text-xs mt-0.5"
              style={{ color: 'var(--color-ink-muted)' }}
            >
              {sec.label}
            </p>
          </div>
          {sec.editable && !isEditing && (
            <button
              onClick={() => startEdit(sec)}
              className="text-xs px-2.5 py-1.5 transition-opacity hover:opacity-70"
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-ink-muted)',
                border: '1px solid var(--color-border)',
                letterSpacing: '0.04em',
              }}
            >
              Edit
            </button>
          )}
        </div>

        {/* Content — synthesis text */}
        <div className="px-4 pb-3">
          {isEditing ? (
            <div>
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                autoFocus
                rows={Math.max(4, Math.ceil(editDraft.length / 72))}
                className="w-full px-3 py-3 text-sm leading-relaxed resize-none"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontStyle: 'italic',
                  backgroundColor: 'var(--color-ground)',
                  color: 'var(--color-ink)',
                  border: 'none',
                  borderLeft: '3px solid var(--color-ridge)',
                  outline: 'none',
                  caretColor: 'var(--color-ridge)',
                }}
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={commitEdit}
                  className="px-4 py-2 text-xs transition-opacity hover:opacity-90"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    backgroundColor: 'var(--color-ridge)',
                    color: 'white',
                    letterSpacing: '0.06em',
                  }}
                >
                  Done
                </button>
                <button
                  onClick={() => { setEditingId(null); setEditDraft('') }}
                  className="px-4 py-2 text-xs transition-opacity hover:opacity-70"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--color-ink-muted)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : isEmpty && sec.id === 'notes' ? (
            <button
              onClick={() => startEdit(sec)}
              className="w-full text-left py-4 px-3 transition-opacity hover:opacity-80"
              style={{
                fontFamily: 'var(--font-display)',
                fontStyle: 'italic',
                color: 'var(--color-ink-muted)',
                fontSize: '0.875rem',
                borderLeft: '2px dashed var(--color-border)',
              }}
            >
              Add your reflection notes…
            </button>
          ) : (
            <p
              className="text-sm leading-relaxed"
              style={{
                fontFamily: 'var(--font-display)',
                fontStyle: 'italic',
                color: 'var(--color-ink)',
                lineHeight: 1.75,
              }}
            >
              {sec.content}
            </p>
          )}
        </div>

        {/* Source data toggle */}
        {hasSource && (
          <div style={{ borderTop: '1px solid var(--color-border)' }}>
            <button
              onClick={() => setExpandedSourceId(sourceOpen ? null : sec.id)}
              className="w-full text-left px-4 py-2.5 flex items-center gap-2 transition-opacity hover:opacity-70"
            >
              <span
                className="text-xs"
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.04em' }}
              >
                {sourceOpen ? '▲' : '▷'} SOURCE DATA ({sec.sourceItems.length})
              </span>
            </button>
            {sourceOpen && (
              <div className="px-4 pb-3 space-y-1.5">
                {sec.sourceItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div
                      className="flex-shrink-0 mt-1.5"
                      style={{ width: 3, height: 3, backgroundColor: 'var(--color-ink-muted)' }}
                    />
                    <p
                      className="text-xs leading-relaxed"
                      style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                    >
                      {item}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: 'var(--font-body)' }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .syn-fadein { animation: fadeIn 0.4s ease-out forwards; }
      `}</style>

      {/* Orientation */}
      <div className="px-6 pt-8 pb-5">
        <p
          className="text-xs tracking-widest uppercase mb-5"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}
        >
          He Whakaaro — Synthesis
        </p>
        <h2
          className="mb-3 leading-snug"
          style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--color-ink)' }}
        >
          Gathering the kōrero into a record
        </h2>
        <p
          className="text-sm italic leading-relaxed mb-4"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
        >
          This synthesis was prepared by Te Kaupapa from the reflection, Safety
          Pou review, actions, and referrals. Review each section and edit
          anything that does not reflect what was held in the session.
        </p>

        {/* Session meta */}
        <div
          className="flex items-center justify-between px-3 py-2.5"
          style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}
        >
          <div>
            <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
              {data.ref} · {data.whanauCode || 'TW-04'} · {data.engagementType.replace('-', ' ')}
            </p>
            <p className="text-xs mt-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
              Generated 6 Aug 2026, 14:32 — Te Kaupapa AI
            </p>
          </div>
          <div
            className="px-2 py-1"
            style={{ backgroundColor: 'var(--color-growth-light)', border: '1px solid var(--color-growth)' }}
          >
            <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)' }}>Draft</p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div
        className="flex items-center gap-px px-5 mb-5"
        style={{ borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)', paddingTop: '0.75rem', paddingBottom: '0.75rem' }}
      >
        <button
          onClick={handleRegenerate}
          className="flex-1 py-2.5 text-xs transition-opacity hover:opacity-70 flex items-center justify-center gap-1.5"
          style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-ink-secondary)',
            backgroundColor: 'var(--color-surface)',
            letterSpacing: '0.04em',
          }}
        >
          <span>↻</span> Regenerate
        </button>
        <button
          onClick={handleCopy}
          className="flex-1 py-2.5 text-xs transition-opacity hover:opacity-70 flex items-center justify-center gap-1.5 mx-px"
          style={{
            fontFamily: 'var(--font-mono)',
            color: copied ? 'var(--color-growth)' : 'var(--color-ink-secondary)',
            backgroundColor: copied ? 'var(--color-growth-light)' : 'var(--color-surface)',
            letterSpacing: '0.04em',
          }}
        >
          {copied ? '✓ Copied' : '⎘ Copy note'}
        </button>
        <button
          onClick={handleSaveDraft}
          className="flex-1 py-2.5 text-xs transition-opacity hover:opacity-70 flex items-center justify-center gap-1.5"
          style={{
            fontFamily: 'var(--font-mono)',
            color: savedDraft ? 'var(--color-ridge)' : 'var(--color-ink-secondary)',
            backgroundColor: savedDraft ? 'var(--color-ridge-light)' : 'var(--color-surface)',
            letterSpacing: '0.04em',
          }}
        >
          {savedDraft ? '✓ Saved' : '⤓ Save draft'}
        </button>
      </div>

      {/* Synthesis sections */}
      <div className="px-5 mb-5 syn-fadein">
        {sections.map((sec) => (
          <SectionCard key={sec.id} sec={sec} />
        ))}
      </div>

      {/* Safety Pou quick-view */}
      <div className="px-5 mb-5">
        <SectionLabel>Ngā Pou — at a glance</SectionLabel>
        <div className="mt-2 grid grid-cols-2 gap-px">
          {data.pou.map((p) => {
            const c = STATUS_CONFIG[p.status]
            return (
              <div
                key={p.id}
                className="flex items-center gap-2 px-3 py-2.5"
                style={{ backgroundColor: c.light, borderLeft: `3px solid ${c.color}` }}
              >
                <p className="text-xs font-medium" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
                  {p.reo}
                </p>
                <p className="text-xs ml-auto" style={{ fontFamily: 'var(--font-mono)', color: c.color }}>
                  {STATUS_CONFIG[p.status].label}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Proceed */}
      <div className="px-5 pb-8" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem' }}>
        <button
          onClick={() => { onChange({ notes: sections.find((s) => s.id === 'notes')?.content ?? '' }); onNext() }}
          className="w-full text-left transition-all active:opacity-85"
        >
          <div style={{ backgroundColor: 'var(--color-ridge)', padding: '1.25rem 1.25rem' }}>
            <div className="flex gap-1 mb-4" style={{ opacity: 0.18 }}>
              {[0,1,2,3,4,5,6].map((i) => (
                <div key={i} style={{ flex: 1, height: 2, backgroundColor: 'white' }} />
              ))}
            </div>
            <p
              className="text-lg font-medium italic mb-1"
              style={{ fontFamily: 'var(--font-display)', color: 'white', lineHeight: 1.3 }}
            >
              Haere tonu — Record
            </p>
            <p
              className="text-xs"
              style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em' }}
            >
              SYNTHESIS REVIEWED — PROCEED TO RECORD →
            </p>
          </div>
        </button>
      </div>

    </div>
  )
}

// ─── Record Stage types ────────────────────────────────────────────────────────

type CopyState = 'ready' | 'copying' | 'copied'
type EmailSendState = 'idle' | 'sending' | 'sent' | 'unable-to-send'

// ─── Record Stage ──────────────────────────────────────────────────────────────

function RecordStage({ data, onNext }: { data: ActiveSessionData; onNext: () => void }) {
  const needsSupervisor = data.selectedActions.includes('supervisor-review') || data.selectedActions.includes('escalation')
  const needsReferral = data.selectedReferralIds.length > 0
  const hasCarryForward = data.selectedActions.includes('carry-forward')
  const isEscalation = data.selectedActions.includes('escalation')

  const [copyState, setCopyState] = useState<CopyState>('ready')
  const [emailState, setEmailState] = useState<EmailSendState>('idle')
  const [recipientEmail, setRecipientEmail] = useState('hemi.parata@tekaupapa.nz')
  const [savedRecord, setSavedRecord] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['details']))

  const toggleSection = (id: string) =>
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const handleCopy = () => {
    setCopyState('copying')
    const text = [
      `TE KAUPAPA AI — SESSION RECORD`,
      `Session: ${data.ref}  ·  Whānau: ${data.whanauCode || 'TW-04'}  ·  Date: 6 Ākuhata 2026`,
      `Kaimahi: Aroha Ngāti  ·  Type: ${data.engagementType.replace('-', ' ')}`,
      ``,
      `NGĀ POU HAUMARU — SAFETY POU`,
      ...data.pou.map((p) => `  ${p.reo}: ${STATUS_CONFIG[p.status].label}`),
      ``,
      `NGĀ MAHI — ACTIONS`,
      ...data.selectedActions.map((a) => `  · ${a.replace('-', ' ')}`),
      ``,
      `NGĀ ARA TAUTOKO — REFERRALS`,
      data.selectedReferralIds.length > 0
        ? `  ${data.selectedReferralIds.length} referral pathway(s) prepared`
        : `  No referrals initiated`,
      ``,
      `HE WHAKAARO KAIMAHI — NOTES`,
      data.notes || `  No additional notes recorded.`,
    ].join('\n')
    setTimeout(() => {
      navigator.clipboard.writeText(text).catch(() => {})
      setCopyState('copied')
      setTimeout(() => setCopyState('ready'), 2500)
    }, 350)
  }

  const handleSend = () => {
    if (!recipientEmail.trim()) return
    setEmailState('sending')
    // Simulate server-side API call
    setTimeout(() => {
      // 90% success rate in demo
      setEmailState(Math.random() > 0.1 ? 'sent' : 'unable-to-send')
    }, 1800)
  }

  const handleSaveRecord = () => {
    setSavedRecord(true)
  }

  // ── Record preview section ──────────────────────────────────────────────

  const RecordSection = ({
    id, label, reoLabel, children,
  }: { id: string; label: string; reoLabel: string; children: React.ReactNode }) => {
    const open = expandedSections.has(id)
    return (
      <div style={{ borderBottom: '1px solid var(--color-border)' }}>
        <button
          onClick={() => toggleSection(id)}
          className="w-full flex items-center justify-between px-4 py-3.5 min-h-[52px]"
        >
          <div className="text-left">
            <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.06em' }}>
              {reoLabel.toUpperCase()}
            </p>
            <p className="text-sm font-medium mt-0.5" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
              {label}
            </p>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--color-ink-muted)' }}>
            {open ? '▲' : '▷'}
          </span>
        </button>
        {open && <div className="px-4 pb-4">{children}</div>}
      </div>
    )
  }

  // ── Email send state UI ─────────────────────────────────────────────────

  const emailConfig: Record<EmailSendState, { label: string; sub: string; color: string; bg: string }> = {
    idle:           { label: 'Send record',   sub: '',                                                                    color: 'var(--color-ridge)',   bg: 'var(--color-ridge)'   },
    sending:        { label: 'Tukuna…',       sub: 'Delivering your record',                                             color: 'var(--color-ridge)',   bg: 'var(--color-ridge)'   },
    sent:           { label: 'Tukuna ana',    sub: 'Record delivered — the recipient will receive it shortly',           color: 'var(--color-growth)', bg: 'var(--color-growth)'  },
    'unable-to-send': { label: 'Kāore i tukuna', sub: 'Could not deliver. Try again or copy and share the record manually.', color: 'var(--color-concern)', bg: 'var(--color-concern)' },
  }

  // ── Main render ─────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: 'var(--font-body)' }}>
      <style>{`
        @keyframes sendPulse {
          0% { opacity: 1; }
          50% { opacity: 0.55; }
          100% { opacity: 1; }
        }
        .send-pulsing { animation: sendPulse 1.2s ease-in-out infinite; }
      `}</style>

      {/* Orientation */}
      <div className="px-6 pt-8 pb-6">
        <p
          className="text-xs tracking-widest uppercase mb-5"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)', letterSpacing: '0.14em' }}
        >
          Tohu — Record
        </p>
        <h2
          className="mb-3 leading-snug"
          style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--color-ink)' }}
        >
          Carrying the kōrero forward
        </h2>
        <p
          className="text-sm italic leading-relaxed"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
        >
          Review the completed record below. Copy it, send it to your supervisor,
          or save it to your session history — then carry forward what needs to
          follow into the next session.
        </p>
      </div>

      {/* Session identity */}
      <div className="px-5 mb-5">
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            borderTop: '3px solid var(--color-ridge)',
          }}
        >
          {/* Six-pou structural stripe */}
          <div className="flex" style={{ height: 3 }}>
            {data.pou.map((p) => {
              const c = STATUS_CONFIG[p.status]
              return <div key={p.id} style={{ flex: 1, backgroundColor: c.color }} />
            })}
          </div>
          <div className="px-4 py-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p
                  className="text-base font-medium"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
                >
                  Session Record
                </p>
                <p
                  className="text-xs mt-0.5"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                >
                  {data.ref} · {data.whanauCode || 'TW-04'} · 6 Ākuhata 2026
                </p>
              </div>
              <div
                className="px-2 py-1"
                style={{ backgroundColor: savedRecord ? 'var(--color-growth-light)' : 'var(--color-surface-deep)', border: `1px solid ${savedRecord ? 'var(--color-growth)' : 'var(--color-border-strong)'}` }}
              >
                <p
                  className="text-xs"
                  style={{ fontFamily: 'var(--font-mono)', color: savedRecord ? 'var(--color-growth)' : 'var(--color-ink-muted)' }}
                >
                  {savedRecord ? 'Saved' : 'Draft'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {[
                { label: 'Kaimahi', value: 'Aroha Ngāti' },
                { label: 'Supervisor', value: 'Hemi Parata' },
                { label: 'Engagement', value: data.engagementType.replace(/-/g, ' ') },
                { label: 'Focus', value: data.sessionFocus || 'Housing & wellbeing' },
              ].map((f) => (
                <div key={f.label}>
                  <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                    {f.label}
                  </p>
                  <p className="text-xs mt-0.5 capitalize" style={{ color: 'var(--color-ink-secondary)' }}>
                    {f.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Collapsible record sections */}
      <div
        className="mx-5 mb-5"
        style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}
      >
        {/* Safety Pou */}
        <RecordSection id="pou" label="Te Waharoa Pou reviewed" reoLabel="Ngā Pou o Te Waharoa">
          <div className="grid grid-cols-2 gap-px">
            {data.pou.map((p) => {
              const c = STATUS_CONFIG[p.status]
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-2 px-3 py-2.5"
                  style={{ backgroundColor: c.light, borderLeft: `2px solid ${c.color}` }}
                >
                  <p className="text-xs font-medium" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)', flex: 1 }}>
                    {p.reo}
                  </p>
                  <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: c.color }}>
                    {STATUS_CONFIG[p.status].label}
                  </p>
                </div>
              )
            })}
          </div>
        </RecordSection>

        {/* Protective factors */}
        <RecordSection id="protective" label="Protective factors" reoLabel="Ngā āhuatanga tiaki">
          <div className="space-y-1.5">
            {[
              'Strong whānau relationships and whanaungatanga',
              'Personal resilience and determination as a parent',
              'Cultural connection — regular marae involvement',
              'Consistent therapeutic engagement across sessions',
            ].map((f, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-shrink-0 mt-1.5" style={{ width: 3, height: 3, backgroundColor: 'var(--color-growth)' }} />
                <p className="text-sm italic leading-snug" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                  {f}
                </p>
              </div>
            ))}
          </div>
        </RecordSection>

        {/* Risk factors */}
        <RecordSection id="risk" label="Risk factors identified" reoLabel="Ngā tūraru">
          <div className="space-y-1.5">
            {[
              'Persistent low mood and sleep disruption — two weeks',
              'Medical appointments overdue — youngest child',
              'Utility bills behind — financial pressure',
              'Housing application — no response in three weeks',
            ].map((f, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-shrink-0 mt-1.5" style={{ width: 3, height: 3, backgroundColor: 'var(--color-caution)' }} />
                <p className="text-sm italic leading-snug" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                  {f}
                </p>
              </div>
            ))}
          </div>
        </RecordSection>

        {/* Actions */}
        <RecordSection id="actions" label="Actions from this session" reoLabel="Ngā mahi">
          <div className="space-y-2">
            {[
              { title: 'Supervisor review — mental health concern', type: 'supervisor-review' as ActionType, priority: 'Urgent', due: '7 Aug 2026' },
              { title: 'GP appointment — youngest child', type: 'referral' as ActionType, priority: 'Important', due: '14 Aug 2026' },
              { title: 'Financial assistance — MSD Work & Income', type: 'referral' as ActionType, priority: 'Important', due: '14 Aug 2026' },
              { title: 'Housing application follow-up', type: 'carry-forward' as ActionType, priority: 'Routine', due: '20 Aug 2026' },
            ].map((a, i) => (
              <div
                key={i}
                className="flex items-start gap-3 py-2.5 px-3"
                style={{ backgroundColor: 'var(--color-ground)', borderLeft: `2px solid var(--color-border)` }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
                    {a.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <ActionBadge type={a.type} />
                    <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                      {a.priority} · {a.due}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </RecordSection>

        {/* Referrals */}
        <RecordSection id="referrals" label="Referrals and pathways" reoLabel="Ngā ara tautoko">
          <div className="space-y-2">
            {[
              { name: 'Clinical Review / Supervisor Discussion', scope: 'Internal', status: 'Prepared' },
              { name: 'GP / Primary Care — Te Whatu Ora', scope: 'External', status: 'Prepared' },
              { name: 'Housing Support — Kāinga Ora', scope: 'External', status: 'In progress (W-2835)' },
            ].map((r, i) => (
              <div key={i} className="flex items-center gap-3 py-2 px-3" style={{ backgroundColor: 'var(--color-ground)' }}>
                <div
                  className="flex-shrink-0"
                  style={{ width: 3, height: 32, backgroundColor: r.scope === 'Internal' ? 'var(--color-ridge)' : 'var(--color-growth)' }}
                />
                <div className="flex-1">
                  <p className="text-sm" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
                    {r.name}
                  </p>
                  <p className="text-xs mt-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                    {r.scope} · {r.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </RecordSection>

        {/* Kaimahi notes */}
        <RecordSection id="notes" label="Kaimahi reflection notes" reoLabel="He whakaaro kaimahi">
          {data.notes ? (
            <p className="text-sm italic leading-relaxed" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
              {data.notes}
            </p>
          ) : (
            <p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
              No additional notes recorded.
            </p>
          )}
        </RecordSection>
      </div>

      {/* Actions bar — copy, save */}
      <div className="px-5 mb-5">
        <SectionLabel>Record actions</SectionLabel>
        <div className="mt-2 flex gap-px">
          <button
            onClick={handleCopy}
            disabled={copyState === 'copying'}
            className={`flex-1 py-3 text-xs transition-all min-h-[44px] ${copyState === 'copying' ? 'send-pulsing' : ''}`}
            style={{
              fontFamily: 'var(--font-mono)',
              backgroundColor: copyState === 'copied' ? 'var(--color-growth-light)' : 'var(--color-surface)',
              color: copyState === 'copied' ? 'var(--color-growth)' : 'var(--color-ink-secondary)',
              borderLeft: `3px solid ${copyState === 'copied' ? 'var(--color-growth)' : 'var(--color-border)'}`,
              letterSpacing: '0.04em',
            }}
          >
            {copyState === 'copying' ? 'Copying…' : copyState === 'copied' ? '✓ Copied' : '⎘ Copy record'}
          </button>
          <button
            onClick={handleSaveRecord}
            className="flex-1 py-3 text-xs transition-all ml-px min-h-[44px]"
            style={{
              fontFamily: 'var(--font-mono)',
              backgroundColor: savedRecord ? 'var(--color-ridge-light)' : 'var(--color-surface)',
              color: savedRecord ? 'var(--color-ridge)' : 'var(--color-ink-secondary)',
              borderLeft: `3px solid ${savedRecord ? 'var(--color-ridge)' : 'var(--color-border)'}`,
              letterSpacing: '0.04em',
            }}
          >
            {savedRecord ? '✓ Saved to history' : '⤓ Save record'}
          </button>
        </div>
      </div>

      {/* Email section */}
      <div className="px-5 mb-6">
        <SectionLabel>Send by email</SectionLabel>
        <p
          className="text-xs italic mt-1 mb-3"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
        >
          Delivered securely — not sent from your personal device.
        </p>

        {/* Recipient field */}
        <div
          className="mb-px"
          style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}
        >
          <div className="px-3 pt-3 pb-1">
            <p className="text-xs mb-1" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.06em' }}>
              TO
            </p>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => { setRecipientEmail(e.target.value); setEmailState('idle') }}
              placeholder="supervisor@organisation.nz"
              className="w-full py-1.5 text-sm outline-none"
              style={{
                fontFamily: 'var(--font-mono)',
                backgroundColor: 'transparent',
                color: 'var(--color-ink)',
                border: 'none',
                caretColor: 'var(--color-ridge)',
              }}
            />
          </div>

          {/* Supervisor note — if flagged */}
          {needsSupervisor && (
            <div
              className="mx-3 mb-3 px-3 py-2"
              style={{ backgroundColor: 'var(--color-ridge-light)', borderLeft: '2px solid var(--color-ridge)' }}
            >
              <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>
                {isEscalation ? '⚠ Escalation flagged — supervisor will be notified urgently' : 'Supervisor review requested for this session'}
              </p>
            </div>
          )}
        </div>

        {/* Additional recipients */}
        {needsReferral && (
          <div
            className="mb-3 px-3 py-3"
            style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}
          >
            <p className="text-xs mb-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.06em' }}>
              ALSO NOTIFYING
            </p>
            {[
              'Clinical review coordinator (internal)',
              'Te Whatu Ora GP referral inbox',
            ].map((r, i) => (
              <div key={i} className="flex items-center gap-2 py-1">
                <div style={{ width: 3, height: 3, backgroundColor: 'var(--color-growth)', flexShrink: 0 }} />
                <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-secondary)' }}>
                  {r}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={emailState === 'sending' || emailState === 'sent' || !recipientEmail.trim()}
          className={`w-full py-4 text-sm font-medium transition-all min-h-[56px] ${emailState === 'sending' ? 'send-pulsing' : ''}`}
          style={{
            fontFamily: 'var(--font-mono)',
            backgroundColor: emailState === 'sent'
              ? 'var(--color-growth)'
              : emailState === 'unable-to-send'
              ? 'var(--color-concern)'
              : emailState === 'sending'
              ? 'var(--color-ridge)'
              : recipientEmail.trim() ? 'var(--color-ridge)' : 'var(--color-surface-deep)',
            color: emailState === 'idle' && !recipientEmail.trim() ? 'var(--color-ink-muted)' : 'white',
            letterSpacing: '0.06em',
          }}
        >
          {emailState === 'idle' && 'Send record'}
          {emailState === 'sending' && 'Sending via Te Kaupapa…'}
          {emailState === 'sent' && '✓ Record sent'}
          {emailState === 'unable-to-send' && 'Unable to send — retry or copy manually'}
        </button>

        {/* Unable to send — fallback */}
        {emailState === 'unable-to-send' && (
          <div
            className="mt-2 px-4 py-3"
            style={{ backgroundColor: 'var(--color-concern-light)', borderLeft: '3px solid var(--color-concern)' }}
          >
            <p className="text-xs leading-relaxed" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', color: 'var(--color-ink-secondary)' }}>
              The record could not be delivered right now. Your session has been saved.
              Copy the record and send from your email client, or try again when
              you have a stable connection.
            </p>
            <button
              onClick={handleSend}
              className="mt-2 text-xs transition-opacity hover:opacity-70"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-concern)', letterSpacing: '0.04em' }}
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/* Carried-forward actions */}
      {hasCarryForward && (
        <div className="px-5 mb-5">
          <SectionLabel>Carried into next session</SectionLabel>
          <div
            className="mt-2 px-4 py-4"
            style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border-strong)' }}
          >
            <p
              className="text-xs italic mb-3"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
            >
              These actions are held in your session history and will surface at
              the start of the next engagement.
            </p>
            {[
              'Housing application follow-up — check status with Kāinga Ora',
            ].map((a, i) => (
              <div key={i} className="flex items-start gap-2 py-1.5">
                <div className="flex-shrink-0 mt-1.5" style={{ width: 3, height: 3, backgroundColor: 'var(--color-border-strong)' }} />
                <p className="text-xs" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', color: 'var(--color-ink-secondary)' }}>
                  {a}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Proceed to complete */}
      <div className="px-5 pb-8" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem' }}>
        <button
          onClick={onNext}
          className="w-full text-left transition-all active:opacity-85"
        >
          <div style={{ backgroundColor: 'var(--color-growth)', padding: '1.25rem 1.25rem' }}>
            <div className="flex gap-1 mb-4" style={{ opacity: 0.18 }}>
              {[0,1,2,3,4,5,6].map((i) => (
                <div key={i} style={{ flex: 1, height: 2, backgroundColor: 'white' }} />
              ))}
            </div>
            <p
              className="text-lg font-medium italic mb-1"
              style={{ fontFamily: 'var(--font-display)', color: 'white', lineHeight: 1.3 }}
            >
              Kua oti — Complete session
            </p>
            <p
              className="text-xs"
              style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em' }}
            >
              RECORD READY · RETURN TO HOME →
            </p>
          </div>
        </button>
      </div>

    </div>
  )
}

// Stage 8 — Complete
function CompleteStage({ data, onDone }: { data: ActiveSessionData; onDone: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ minHeight: '80vh', padding: '3rem 2rem', fontFamily: 'var(--font-body)' }}
    >
      <div
        className="mb-8 flex items-center justify-center"
        style={{ width: 56, height: 56, backgroundColor: 'var(--color-growth-light)' }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M4 12.5l5 5 11-11" stroke="var(--color-growth)" strokeWidth="2.5" strokeLinecap="square" />
        </svg>
      </div>

      <p className="text-2xl font-medium mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
        Kua oti
      </p>
      <p className="text-sm italic mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
        Session complete
      </p>
      <p className="text-xs mb-10" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
        {data.ref} · {data.whanauCode} · 6 Ākuhata 2026
      </p>

      <div
        className="w-full text-left px-4 py-4 mb-4"
        style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-growth)' }}
      >
        <SectionLabel>Carried forward</SectionLabel>
        <ul className="mt-2 space-y-1.5">
          <li className="text-sm" style={{ color: 'var(--color-ink-secondary)' }}>· Session saved to your personal record</li>
          {data.selectedActions.includes('supervisor-review') && (
            <li className="text-sm" style={{ color: 'var(--color-ink-secondary)' }}>· Supervisor review requested — Hemi Parata notified</li>
          )}
          {data.selectedActions.includes('escalation') && (
            <li className="text-sm" style={{ color: 'var(--color-concern)' }}>· Escalation actioned — supervisor notified immediately</li>
          )}
          {data.selectedReferralIds.length > 0 && (
            <li className="text-sm" style={{ color: 'var(--color-ink-secondary)' }}>· {data.selectedReferralIds.length} referral(s) initiated</li>
          )}
        </ul>
      </div>

      {/* Paepae — threshold before returning */}
      <div className="w-full flex items-center gap-3 mb-6">
        <div className="flex-1" style={{ height: 1, backgroundColor: 'var(--color-border-strong)' }} />
        <div style={{ width: 5, height: 5, backgroundColor: 'var(--color-border-strong)', transform: 'rotate(45deg)' }} />
        <div className="flex-1" style={{ height: 1, backgroundColor: 'var(--color-border-strong)' }} />
      </div>
      <button
        onClick={onDone}
        className="w-full py-4 text-sm font-medium tracking-wide transition-opacity hover:opacity-80 min-h-[56px]"
        style={{ backgroundColor: 'var(--color-ridge)', color: 'white', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}
      >
        Hoki ki te Kāinga
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION SHELL — linear session flow, overlays the tab navigation
// ─────────────────────────────────────────────────────────────────────────────

function SafetyRequirements({ workflow }: { workflow: Workflow }) {
  const types = new Set(workflow.safety.requiredConsequences.map((consequence) => consequence.type))
  if (types.size === 0) return null
  return <div className="p-4 space-y-2" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-caution)' }}>
    <SectionLabel>Safety requirements</SectionLabel>
    {types.has('supervisor_review_required') && <p className="text-xs" style={{ color: 'var(--color-ink-secondary)' }}>Supervisor review required</p>}
    {types.has('supervisor_notification_required') && <p className="text-xs leading-relaxed" style={{ color: 'var(--color-ink-secondary)' }}>Supervisor notification required. This has been recorded in Te Kaupapa. No notification has been sent yet.</p>}
  </div>
}

function SafetyConcernList({ observations }: { observations: SafetyObservationCurrentView[] }) {
  if (observations.length === 0) return <p className="text-xs mt-2" style={{ color: 'var(--color-ink-muted)' }}>No safety concerns recorded.</p>
  return <div className="space-y-2 mt-2">{observations.map((observation) => <div key={observation.id} className="px-3 py-3" style={{ backgroundColor: 'var(--color-ground)', borderLeft: `3px solid ${observation.status === 'retracted' ? 'var(--color-border-strong)' : 'var(--color-caution)'}` }}><p className="text-xs font-medium" style={{ color: 'var(--color-ink)' }}>Safety concern · {safetyClassLabel(observation.broadClass)} · {observation.concernLevel}</p>{observation.contextNote && <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-ink-secondary)' }}>{observation.contextNote}</p>}{observation.status === 'retracted' && <p className="text-xs mt-1" style={{ color: 'var(--color-ink-muted)' }}>Retracted concern retained in session history.</p>}</div>)}</div>
}

function CarryForwardSourceList({ items }: { items: Workflow['carryForwards'] }) {
  if (items.length === 0) return <p className="text-xs mt-2 italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>No follow-up items have been carried forward from the Pou reviews. Is there anything else you want to record or follow up?</p>
  return <div className="mt-2 space-y-2">{items.map((item) => {
    const fallbackSource = item.source.kind === 'areas_for_attention' ? 'Areas for attention' : item.source.kind === 'safety_observation' ? 'Confirmed safety concern' : 'Review item'
    return <div key={item.id} className="px-3 py-2" style={{ backgroundColor: 'var(--color-ground)', borderLeft: '2px solid var(--color-ridge)' }}>
      <p className="text-xs" style={{ color: 'var(--color-ink-secondary)' }}>{TE_WAHAROA_POU.find((pou) => pou.id === item.pouId)?.reo}</p>
      <p className="text-sm mt-1" style={{ color: 'var(--color-ink)' }}>{item.presentation?.title ?? item.note ?? fallbackSource}</p>
      <p className="text-xs mt-1" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>Source: {item.presentation?.sourceLabel ?? fallbackSource}</p>
      {item.source.kind !== 'safety_observation' && <p className="text-xs mt-1 italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>This is a follow-up item, not yet an action, referral, safety concern, escalation, or supervisor-review request.</p>}
    </div>
  })}</div>
}

function WorkflowSynthesisStage({
  workflow,
  onConfirm,
  persistenceState,
  onRetry,
  onReload,
}: {
  workflow: Workflow
  onConfirm: (revisionId: string) => void
  persistenceState: WorkflowPersistenceState
  onRetry: () => void
  onReload: () => void
}) {
  const [synthesis, setSynthesis] = useState<WorkflowSynthesisState | null>(null)
  const [content, setContent] = useState<WorkflowSynthesisContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = async () => {
    try {
      const current = await getWorkflowSynthesis(workflow.id)
      setSynthesis(current)
      if (current.draft) { setContent(current.draft.content); setDirty(false) }
      return current
    } catch {
      setError('The synthesis could not be loaded. Check your connection and try again.')
      return null
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [workflow.id])
  useEffect(() => {
    if (synthesis?.status !== 'not_ready') return
    setLoading(true)
    void generateWorkflowSynthesis(workflow.id).then((next) => { setSynthesis(next); if (next.draft) setContent(next.draft.content) }).catch(() => setError('The synthesis could not be generated. Nothing has been confirmed.')).finally(() => setLoading(false))
  }, [synthesis?.status, workflow.id])
  useEffect(() => {
    if (synthesis?.status !== 'analysing') return
    const timer = window.setTimeout(() => void load(), 3_000)
    return () => window.clearTimeout(timer)
  }, [synthesis?.status])
  const update = (key: keyof WorkflowSynthesisContent, value: string) => { setDirty(true); setContent((current) => current ? { ...current, [key]: value.trim() || null } : current) }
  const save = async () => {
    if (!synthesis?.draft || !synthesis.synthesisId || !content) return
    setSaving(true); setError(null)
    try { const next = await editWorkflowSynthesis(workflow.id, { synthesisId: synthesis.synthesisId, expectedRevision: synthesis.draft.revision, content }); setSynthesis(next); setContent(next.draft?.content ?? null); setDirty(false) }
    catch (failure) { setError(failure instanceof WorkflowApiError && failure.code === 'stale_synthesis' ? 'This synthesis changed elsewhere. Reload the saved version before editing again.' : 'The synthesis could not be saved. Nothing has been confirmed.') }
    finally { setSaving(false) }
  }
  const sections: Array<[keyof WorkflowSynthesisContent, string, string]> = [
    ['overallSummary', 'Overall reflection', 'This brings together what emerged across all seven Pou.'],
    ['keyThemes', 'Key themes', ''], ['strengthsSummary', 'Strengths and protective factors', ''], ['areasForAttentionSummary', 'Areas requiring attention', ''], ['informationStillToExploreSummary', 'Information still to explore', ''], ['confirmedSafetyConcernsSummary', 'Confirmed safety concerns', 'Only human-confirmed safety state appears here.'],
  ]
  if (loading || !synthesis || synthesis.status === 'analysing') return <div className="px-6 py-10 text-center" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>Bringing together the confirmed reflections…</div>
  if (synthesis.status === 'failed' || !synthesis.draft || !content) return <div className="px-6 py-10 space-y-4" style={{ fontFamily: 'var(--font-body)' }}><p className="text-sm" style={{ color: 'var(--color-ink-secondary)' }}>{error ?? 'The synthesis is not available yet. Nothing has been confirmed.'}</p><button onClick={() => { setLoading(true); void generateWorkflowSynthesis(workflow.id).then((next) => { setSynthesis(next); if (next.draft) setContent(next.draft.content) }).catch(() => setError('The synthesis could not be generated.')).finally(() => setLoading(false)) }} className="text-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>Try again</button></div>
  return (
    <div className="flex flex-col pb-16" style={{ fontFamily: 'var(--font-body)' }}>
      <div className="px-6 pt-7 pb-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <p className="text-xs tracking-widest uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}>
          Whakarāpopoto — Cross-Pou synthesis
        </p>
        <h2 className="mb-2 leading-snug" style={{ fontFamily: 'var(--font-display)', fontSize: '1.375rem', fontWeight: 500, color: 'var(--color-ink)' }}>
          Bring the seven Pou together
        </h2>
        <p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
          Review and edit this draft before you confirm it. It does not make a safety, action, referral, or escalation decision.
        </p>
      </div>
      <div className="px-5 pt-5 space-y-4">
        {sections.map(([key, title, helper]) => <label key={key} className="block p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}>
          <SectionLabel>{title}</SectionLabel>{helper && <p className="text-xs mt-2" style={{ color: 'var(--color-ink-muted)' }}>{helper}</p>}
          <textarea value={content[key] ?? ''} onChange={(event) => update(key, event.target.value)} rows={key === 'overallSummary' ? 5 : 3} disabled={saving || synthesis.status === 'confirmed'} className="mt-3 w-full resize-y p-3 text-sm outline-none disabled:opacity-70" style={{ fontFamily: 'var(--font-display)', backgroundColor: 'var(--color-ground)', color: 'var(--color-ink-secondary)', borderLeft: '3px solid var(--color-border)' }} />
        </label>)}
      </div>
      <div className="px-5 pt-8">
        {error && <p className="text-xs mb-3" style={{ color: 'var(--color-concern)' }}>{error}</p>}
        <button onClick={() => void save()} disabled={saving || synthesis.status === 'confirmed'} className="w-full py-3 mb-3 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-ridge)', fontFamily: 'var(--font-mono)', borderLeft: '3px solid var(--color-ridge)' }}>Save synthesis</button>
        {dirty && <p className="text-xs mb-3" style={{ color: 'var(--color-caution)' }}>Save your edits before confirming this synthesis.</p>}
        <button onClick={() => onConfirm(synthesis.draft!.id)} disabled={!canConfirmWorkflowSynthesis({ saving, dirty, status: synthesis.status })} className="w-full transition-all active:opacity-85 disabled:opacity-40" style={{ backgroundColor: 'var(--color-ridge)', padding: '1.125rem 1.25rem' }}>
          <p className="text-sm font-medium" style={{ fontFamily: 'var(--font-mono)', color: 'white', letterSpacing: '0.06em' }}>Whakaū — Confirm synthesis</p>
        </button>
        <PersistenceFeedback state={persistenceState} onRetry={onRetry} onReload={onReload} />
      </div>
    </div>
  )
}

type ManualAction = WorkflowActionInput
type ManualReferral = WorkflowReferralInput

function RealActionsStage({
  workflow,
  onConfirm,
  persistenceState,
  onRetry,
  onReload,
}: {
  workflow: Workflow
  onConfirm: (actions: ManualAction[]) => void
  persistenceState: WorkflowPersistenceState
  onRetry: () => void
  onReload: () => void
}) {
  const [actions, setActions] = useState<ManualAction[]>(() => workflow.actions
    .filter(({ status }) => status !== 'withdrawn')
    .map((action) => ({
      id: action.id, title: action.title, type: action.type, pouId: action.pouId ?? undefined,
      dueDate: action.dueDate ?? undefined, status: action.status === 'completed' ? 'completed' : 'open', notes: action.notes ?? undefined,
    })))
  const update = (id: string, patch: Partial<ManualAction>) => setActions((items) => items.map((action) => action.id === id ? { ...action, ...patch } : action))
  const add = () => setActions((items) => [...items, { id: crypto.randomUUID(), title: '', type: 'follow-up', status: 'open' }])
  return (
    <div className="flex flex-col pb-16" style={{ fontFamily: 'var(--font-body)' }}>
      <div className="px-6 pt-7 pb-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <p className="text-xs tracking-widest uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}>Mahere mahi — Action planning</p>
        <h2 className="mb-2 leading-snug" style={{ fontFamily: 'var(--font-display)', fontSize: '1.375rem', fontWeight: 500, color: 'var(--color-ink)' }}>Decide what to carry forward</h2>
        <p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>This is where you decide whether a carried-forward item becomes an action, a referral, future follow-up, or needs no further action. Nothing is created automatically.</p>
      </div>
      <div className="px-5 pt-5 space-y-3">
        <div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}>
          <SectionLabel>From the Pou reviews</SectionLabel>
          <CarryForwardSourceList items={workflow.carryForwards}/>
        </div>
        {actions.map((action, index) => (
          <div key={action.id} className="p-4 space-y-3" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-ridge)' }}>
            <div className="flex items-center justify-between gap-3"><SectionLabel>Action {index + 1}</SectionLabel><button onClick={() => setActions((items) => items.filter((item) => item.id !== action.id))} className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-concern)' }}>Remove</button></div>
            <input value={action.title} onChange={(event) => update(action.id, { title: event.target.value })} placeholder="Action title" className="w-full px-3 py-3 text-sm outline-none" style={{ fontFamily: 'var(--font-display)', backgroundColor: 'var(--color-ground)', color: 'var(--color-ink)', borderLeft: '3px solid var(--color-border)' }} />
            <div className="grid grid-cols-2 gap-2">
              <select value={action.type} onChange={(event) => update(action.id, { type: event.target.value as ManualAction['type'] })} className="px-3 py-3 text-xs" style={{ backgroundColor: 'var(--color-ground)', color: 'var(--color-ink-secondary)', border: '1px solid var(--color-border)' }}><option value="follow-up">Follow-up</option><option value="support">Support</option><option value="other">Other</option></select>
              <select value={action.status} onChange={(event) => update(action.id, { status: event.target.value as ManualAction['status'] })} className="px-3 py-3 text-xs" style={{ backgroundColor: 'var(--color-ground)', color: 'var(--color-ink-secondary)', border: '1px solid var(--color-border)' }}><option value="open">Open</option><option value="completed">Completed</option></select>
            </div>
            <select value={action.pouId ?? ''} onChange={(event) => update(action.id, { pouId: event.target.value ? event.target.value as ManualAction['pouId'] : undefined })} className="w-full px-3 py-3 text-xs" style={{ backgroundColor: 'var(--color-ground)', color: 'var(--color-ink-secondary)', border: '1px solid var(--color-border)' }}><option value="">No linked Pou</option>{TE_WAHAROA_POU.map((pou) => <option key={pou.id} value={pou.id}>{pou.reo}</option>)}</select>
            <input type="date" value={action.dueDate ?? ''} onChange={(event) => update(action.id, { dueDate: event.target.value || undefined })} className="w-full px-3 py-3 text-xs" style={{ backgroundColor: 'var(--color-ground)', color: 'var(--color-ink-secondary)', border: '1px solid var(--color-border)' }} />
            <textarea value={action.notes ?? ''} onChange={(event) => update(action.id, { notes: event.target.value || undefined })} placeholder="Notes (optional)" rows={2} className="w-full px-3 py-3 text-sm outline-none resize-none" style={{ fontFamily: 'var(--font-display)', backgroundColor: 'var(--color-ground)', color: 'var(--color-ink-secondary)', borderLeft: '3px solid var(--color-border)' }} />
          </div>
        ))}
        <button onClick={add} className="w-full px-4 py-3 text-left" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)', fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>+ Add action</button>
      </div>
      <div className="px-5 pt-6"><button onClick={() => onConfirm(actions)} disabled={actions.some((action) => !action.title.trim())} className="w-full py-4 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--color-ridge)', color: 'white', fontFamily: 'var(--font-mono)' }}>Whakaū — Confirm actions</button><PersistenceFeedback state={persistenceState} onRetry={onRetry} onReload={onReload} /></div>
    </div>
  )
}

function RealReferralsStage({
  workflow,
  onConfirm,
  persistenceState,
  onRetry,
  onReload,
}: {
  workflow: Workflow
  onConfirm: (referrals: ManualReferral[]) => void
  persistenceState: WorkflowPersistenceState
  onRetry: () => void
  onReload: () => void
}) {
  const [referrals, setReferrals] = useState<ManualReferral[]>(() => workflow.referrals
    .filter(({ status }) => status !== 'withdrawn')
    .map((referral) => ({ ...referral, pouId: referral.pouId ?? undefined, destinationCode: referral.destinationCode ?? undefined, handoverNote: referral.handoverNote ?? undefined, notes: referral.notes ?? undefined, status: referral.status as ManualReferral['status'] })))
  const update = (id: string, patch: Partial<ManualReferral>) => setReferrals((items) => items.map((referral) => referral.id === id ? { ...referral, ...patch } : referral))
  const add = () => setReferrals((items) => [...items, { id: crypto.randomUUID(), destinationName: '', reason: '', status: 'draft' }])
  return (
    <div className="flex flex-col pb-16" style={{ fontFamily: 'var(--font-body)' }}>
      <div className="px-6 pt-7 pb-5" style={{ borderBottom: '1px solid var(--color-border)' }}><p className="text-xs tracking-widest uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)', letterSpacing: '0.14em' }}>Ngā Ara Tautoko — Referrals</p><h2 className="mb-2 leading-snug" style={{ fontFamily: 'var(--font-display)', fontSize: '1.375rem', fontWeight: 500, color: 'var(--color-ink)' }}>Prepare the pathways you choose</h2><p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>Prepared means recorded within Te Kaupapa only. Nothing is sent externally.</p></div>
      <div className="px-5 pt-5 space-y-3">{referrals.map((referral, index) => <div key={referral.id} className="p-4 space-y-3" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-growth)' }}><div className="flex items-center justify-between gap-3"><SectionLabel>Referral {index + 1}</SectionLabel><button onClick={() => setReferrals((items) => items.filter((item) => item.id !== referral.id))} className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-concern)' }}>Remove</button></div><input value={referral.destinationName} onChange={(event) => update(referral.id, { destinationName: event.target.value })} placeholder="Destination name" className="w-full px-3 py-3 text-sm outline-none" style={{ fontFamily: 'var(--font-display)', backgroundColor: 'var(--color-ground)', color: 'var(--color-ink)', borderLeft: '3px solid var(--color-border)' }} /><input value={referral.destinationCode ?? ''} onChange={(event) => update(referral.id, { destinationCode: event.target.value || undefined })} placeholder="Destination code (optional)" className="w-full px-3 py-3 text-sm outline-none" style={{ fontFamily: 'var(--font-display)', backgroundColor: 'var(--color-ground)', color: 'var(--color-ink-secondary)', borderLeft: '3px solid var(--color-border)' }} /><textarea value={referral.reason} onChange={(event) => update(referral.id, { reason: event.target.value })} placeholder="Reason for referral" rows={2} className="w-full px-3 py-3 text-sm outline-none resize-none" style={{ fontFamily: 'var(--font-display)', backgroundColor: 'var(--color-ground)', color: 'var(--color-ink-secondary)', borderLeft: '3px solid var(--color-border)' }} /><select value={referral.pouId ?? ''} onChange={(event) => update(referral.id, { pouId: event.target.value ? event.target.value as ManualReferral['pouId'] : undefined })} className="w-full px-3 py-3 text-xs" style={{ backgroundColor: 'var(--color-ground)', color: 'var(--color-ink-secondary)', border: '1px solid var(--color-border)' }}><option value="">No linked Pou</option>{TE_WAHAROA_POU.map((pou) => <option key={pou.id} value={pou.id}>{pou.reo}</option>)}</select><select value={referral.status} onChange={(event) => update(referral.id, { status: event.target.value as ManualReferral['status'] })} className="w-full px-3 py-3 text-xs" style={{ backgroundColor: 'var(--color-ground)', color: 'var(--color-ink-secondary)', border: '1px solid var(--color-border)' }}><option value="draft">Draft</option><option value="prepared">Prepared in Te Kaupapa</option><option value="declined">Declined</option></select><textarea value={referral.handoverNote ?? ''} onChange={(event) => update(referral.id, { handoverNote: event.target.value || undefined })} placeholder="Handover note (optional)" rows={2} className="w-full px-3 py-3 text-sm outline-none resize-none" style={{ fontFamily: 'var(--font-display)', backgroundColor: 'var(--color-ground)', color: 'var(--color-ink-secondary)', borderLeft: '3px solid var(--color-border)' }} /><textarea value={referral.notes ?? ''} onChange={(event) => update(referral.id, { notes: event.target.value || undefined })} placeholder="Notes (optional)" rows={2} className="w-full px-3 py-3 text-sm outline-none resize-none" style={{ fontFamily: 'var(--font-display)', backgroundColor: 'var(--color-ground)', color: 'var(--color-ink-secondary)', borderLeft: '3px solid var(--color-border)' }} /></div>)}<button onClick={add} className="w-full px-4 py-3 text-left" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)', fontFamily: 'var(--font-mono)', color: 'var(--color-growth)' }}>+ Add referral</button></div>
      <div className="px-5 pt-6"><button onClick={() => onConfirm(referrals)} disabled={referrals.some((referral) => !referral.destinationName.trim() || !referral.reason.trim())} className="w-full py-4 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--color-ridge)', color: 'white', fontFamily: 'var(--font-mono)' }}>Haere tonu — Structured review</button><PersistenceFeedback state={persistenceState} onRetry={onRetry} onReload={onReload} /></div>
    </div>
  )
}

function RealStructuredReviewStage({
  workflow,
  onConfirm,
  persistenceState,
  onRetry,
  onReload,
}: {
  workflow: Workflow
  onConfirm: () => void
  persistenceState: WorkflowPersistenceState
  onRetry: () => void
  onReload: () => void
}) {
  const review = workflow.structuredReview
  return <div className="flex flex-col pb-16" style={{ fontFamily: 'var(--font-body)' }}>
    <div className="px-6 pt-7 pb-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <p className="text-xs tracking-widest uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}>He Arotake Hanganga — Structured review</p>
      <h2 className="mb-2 leading-snug" style={{ fontFamily: 'var(--font-display)', fontSize: '1.375rem', fontWeight: 500, color: 'var(--color-ink)' }}>Review the confirmed record</h2>
      <p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>This record is assembled from the Pou reviews and safety concerns you explicitly confirmed. It is not a new AI or safety decision.</p>
    </div>
    <div className="px-5 pt-5 space-y-4">
      <div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-ridge)' }}>
        <SectionLabel>Session</SectionLabel>
        <p className="text-sm mt-2" style={{ color: 'var(--color-ink-secondary)' }}>{review.reference} · {review.setup?.whanauReference ?? 'Setup not confirmed'}</p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-ink-muted)' }}>{review.setup?.sessionFocus}</p>
      </div>
      <div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}>
        <SectionLabel>Confirmed Pou reviews</SectionLabel>
        {review.pouReviews.length === 0
          ? <p className="text-xs mt-2" style={{ color: 'var(--color-ink-muted)' }}>No canonical Pou reviews are available.</p>
          : review.pouReviews.map((pouReview) => <div key={pouReview.pouId} className="mt-3 px-3 py-3" style={{ backgroundColor: 'var(--color-ground)', borderLeft: '2px solid var(--color-ridge)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--color-ink)' }}>{TE_WAHAROA_POU.find((pou) => pou.id === pouReview.pouId)?.reo} — Confirmed</p>
              {pouReview.overallSummary && <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-ink-secondary)' }}>{pouReview.overallSummary}</p>}
              {pouReview.strengthsSummary && <p className="text-xs mt-1" style={{ color: 'var(--color-growth)' }}>Strengths: {pouReview.strengthsSummary}</p>}
              {pouReview.areasForAttentionSummary && <p className="text-xs mt-1" style={{ color: 'var(--color-caution)' }}>Attention: {pouReview.areasForAttentionSummary}</p>}
            </div>)}
      </div>
      <div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-caution)' }}><SectionLabel>Safety concerns</SectionLabel><SafetyConcernList observations={workflow.safety.observations} /></div>
      <SafetyRequirements workflow={workflow}/>
      <div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-ridge)' }}><SectionLabel>Items carried forward</SectionLabel><CarryForwardSourceList items={workflow.carryForwards}/></div>
      <div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}><SectionLabel>Actions</SectionLabel>{review.actions.length ? review.actions.map((action) => <p key={action.id} className="text-xs mt-2" style={{ color: 'var(--color-ink-secondary)' }}>{action.title} · {action.status}</p>) : <p className="text-xs mt-2" style={{ color: 'var(--color-ink-muted)' }}>No actions confirmed.</p>}</div>
      <div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}><SectionLabel>Referral drafts</SectionLabel>{review.referrals.length ? review.referrals.map((referral) => <p key={referral.id} className="text-xs mt-2" style={{ color: 'var(--color-ink-secondary)' }}>{referral.destinationName} · {referral.status}</p>) : <p className="text-xs mt-2" style={{ color: 'var(--color-ink-muted)' }}>No referrals confirmed.</p>}</div>
      <div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-ridge)' }}><SectionLabel>Supervisor review requests</SectionLabel>{workflow.safety.supervisorReviewRequests.length ? workflow.safety.supervisorReviewRequests.map((request) => <p key={request.id} className="text-xs mt-2" style={{ color: 'var(--color-ink-secondary)' }}>Request recorded in Te Kaupapa{request.requestNote ? ` — ${request.requestNote}` : ''}</p>) : <p className="text-xs mt-2" style={{ color: 'var(--color-ink-muted)' }}>No supervisor review requests recorded.</p>}</div>
    </div>
    <div className="px-5 pt-6"><button onClick={onConfirm} className="w-full py-4 text-sm" style={{ backgroundColor: 'var(--color-ridge)', color: 'white', fontFamily: 'var(--font-mono)' }}>Whakaū — Review record</button><PersistenceFeedback state={persistenceState} onRetry={onRetry} onReload={onReload} /></div>
  </div>
}

function StructuredReviewStage({ workflow, onConfirm, persistenceState, onRetry, onReload }: { workflow: Workflow; onConfirm: () => void; persistenceState: WorkflowPersistenceState; onRetry: () => void; onReload: () => void }) {
  const review = workflow.structuredReview
  return <div className="flex flex-col pb-16" style={{ fontFamily: 'var(--font-body)' }}><div className="px-6 pt-7 pb-5" style={{ borderBottom: '1px solid var(--color-border)' }}><p className="text-xs tracking-widest uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}>He Arotake Hanganga — Structured review</p><h2 className="mb-2 leading-snug" style={{ fontFamily: 'var(--font-display)', fontSize: '1.375rem', fontWeight: 500, color: 'var(--color-ink)' }}>Review the confirmed record</h2><p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>This review is assembled from confirmed Te Kaupapa information. It is not AI-generated.</p></div><div className="px-5 pt-5 space-y-4"><div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-ridge)' }}><SectionLabel>Session</SectionLabel><p className="text-sm mt-2" style={{ color: 'var(--color-ink-secondary)' }}>{review.reference} · {review.setup?.whanauReference ?? 'Setup not confirmed'}</p><p className="text-xs mt-1" style={{ color: 'var(--color-ink-muted)' }}>{review.setup?.sessionFocus}</p></div><div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}><SectionLabel>Confirmed Pou responses</SectionLabel>{review.checkpoints.map((checkpoint) => <p key={checkpoint.pouId} className="text-xs mt-2" style={{ color: 'var(--color-ink-secondary)' }}>{TE_WAHAROA_POU.find((pou) => pou.id === checkpoint.pouId)?.reo}: {checkpoint.userSelectedConcern ? CONCERN_META[checkpoint.userSelectedConcern as ConcernLevel].label : 'Not confirmed'}{checkpoint.note ? ` — ${checkpoint.note}` : ''}</p>)}</div><div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}><SectionLabel>Actions</SectionLabel>{review.actions.length ? review.actions.map((action) => <p key={action.id} className="text-xs mt-2" style={{ color: 'var(--color-ink-secondary)' }}>{action.title} · {action.status}</p>) : <p className="text-xs mt-2" style={{ color: 'var(--color-ink-muted)' }}>No actions confirmed.</p>}</div><div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}><SectionLabel>Referral drafts</SectionLabel>{review.referrals.length ? review.referrals.map((referral) => <p key={referral.id} className="text-xs mt-2" style={{ color: 'var(--color-ink-secondary)' }}>{referral.destinationName} · {referral.status}</p>) : <p className="text-xs mt-2" style={{ color: 'var(--color-ink-muted)' }}>No referrals confirmed.</p>}</div><div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-caution)' }}><SectionLabel>Safety concerns</SectionLabel><SafetyConcernList observations={workflow.safety.observations} /></div><SafetyRequirements workflow={workflow}/><div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-ridge)' }}><SectionLabel>Supervisor review requests</SectionLabel>{workflow.safety.supervisorReviewRequests.length ? workflow.safety.supervisorReviewRequests.map((request) => <p key={request.id} className="text-xs mt-2" style={{ color: 'var(--color-ink-secondary)' }}>Request recorded in Te Kaupapa{request.requestNote ? ` — ${request.requestNote}` : ''}</p>) : <p className="text-xs mt-2" style={{ color: 'var(--color-ink-muted)' }}>No supervisor review requests recorded.</p>}</div></div><div className="px-5 pt-6"><button onClick={onConfirm} className="w-full py-4 text-sm" style={{ backgroundColor: 'var(--color-ridge)', color: 'white', fontFamily: 'var(--font-mono)' }}>Whakaū — Review record</button><PersistenceFeedback state={persistenceState} onRetry={onRetry} onReload={onReload} /></div></div>
}

function RecordReviewStage({ workflow, onComplete, persistenceState, onRetry, onReload }: { workflow: Workflow; onComplete: () => void; persistenceState: WorkflowPersistenceState; onRetry: () => void; onReload: () => void }) {
  const [synthesis, setSynthesis] = useState<WorkflowSynthesisState | null>(null)
  useEffect(() => { void getWorkflowSynthesis(workflow.id).then(setSynthesis).catch(() => setSynthesis(null)) }, [workflow.id])
  const content = synthesis?.draft?.content
  const actions = workflow.actions.filter((action) => action.status !== 'withdrawn')
  const referrals = workflow.referrals.filter((referral) => referral.status !== 'withdrawn')
  const activeObservations = workflow.safety.observations.filter((observation) => observation.status === 'active')
  const sections: Array<{ label: string; value: string | null; color: string }> = content ? [
    { label: 'Confirmed engagement summary', value: content.overallSummary, color: 'var(--color-ridge)' },
    { label: 'Key themes', value: content.keyThemes, color: 'var(--color-ridge)' },
    { label: 'Strengths and protective factors', value: content.strengthsSummary, color: 'var(--color-growth)' },
    { label: 'Areas requiring attention', value: content.areasForAttentionSummary, color: 'var(--color-caution)' },
    { label: 'Information still to explore', value: content.informationStillToExploreSummary, color: 'var(--color-ridge)' },
    { label: 'Confirmed safety concerns', value: content.confirmedSafetyConcernsSummary, color: 'var(--color-caution)' },
  ] : []
  return <div className="flex flex-col pb-16" style={{ fontFamily: 'var(--font-body)' }}>
    <div className="px-6 pt-7 pb-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <p className="text-xs tracking-widest uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)', letterSpacing: '0.14em' }}>Tohu — Final record review</p>
      <h2 className="mb-2 leading-snug" style={{ fontFamily: 'var(--font-display)', fontSize: '1.375rem', fontWeight: 500, color: 'var(--color-ink)' }}>Review the final Te Kaupapa record</h2>
      <p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>Finalising creates an immutable record from the synthesis you confirmed and the current acknowledged workflow state. It does not send anything externally.</p>
    </div>
    <div className="px-5 pt-5 space-y-4">
      <div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-growth)' }}>
        <p className="text-sm" style={{ color: 'var(--color-ink-secondary)' }}>Reference: {workflow.reference}</p>
        <p className="text-xs mt-2" style={{ color: 'var(--color-ink-muted)' }}>{actions.length} acknowledged action(s) · {referrals.length} referral draft(s)</p>
      </div>
      {sections.map((section) => section.value && <div key={section.label} className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: `3px solid ${section.color}` }}>
        <SectionLabel>{section.label}</SectionLabel>
        <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--color-ink-secondary)' }}>{section.value}</p>
      </div>)}
      <div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-caution)' }}><SectionLabel>Confirmed safety observations</SectionLabel><SafetyConcernList observations={activeObservations}/></div>
      <div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}><SectionLabel>Actions / follow-up</SectionLabel>{actions.length ? actions.map((action) => <p key={action.id} className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--color-ink-secondary)' }}>{[action.pouId ? WORKFLOW_POU_NAMES[action.pouId] : null, action.title, action.status, action.dueDate ? `due ${action.dueDate}` : null].filter(Boolean).join(' — ')}</p>) : <p className="text-xs mt-2" style={{ color: 'var(--color-ink-muted)' }}>No actions confirmed.</p>}</div>
      <div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}><SectionLabel>Referrals</SectionLabel>{referrals.length ? referrals.map((referral) => <p key={referral.id} className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--color-ink-secondary)' }}>{[referral.pouId ? WORKFLOW_POU_NAMES[referral.pouId] : null, referral.destinationName, referral.reason, referral.status].filter(Boolean).join(' — ')}</p>) : <p className="text-xs mt-2" style={{ color: 'var(--color-ink-muted)' }}>No referrals confirmed.</p>}</div>
      <SafetyRequirements workflow={workflow}/>
    </div>
    <div className="px-5 pt-6"><button onClick={onComplete} className="w-full py-4 text-sm" style={{ backgroundColor: 'var(--color-growth)', color: 'white', fontFamily: 'var(--font-mono)' }}>Kua oti — Finalise record and complete session</button><PersistenceFeedback state={persistenceState} onRetry={onRetry} onReload={onReload} /></div>
  </div>
}

function FinalRecordCompletion({ workflow }: { workflow: Workflow }) {
  const [record, setRecord] = useState<FinalRecord | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => { void getFinalRecord(workflow.id).then(setRecord).catch(() => setRecord(null)) }, [workflow.id])
  const copy = async () => {
    try { await navigator.clipboard.writeText(await copyFinalRecord(workflow.id)); setCopyState('copied') } catch { setCopyState('failed') }
  }
  if (!record) return null
  return <div className="space-y-4 text-left"><div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-growth)' }}><SectionLabel>Final record</SectionLabel><p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--color-ink-secondary)' }}>{record.overallSummary}</p>{record.strengthsSummary && <p className="text-xs mt-2" style={{ color: 'var(--color-growth)' }}>Strengths: {record.strengthsSummary}</p>}{record.areasForAttentionSummary && <p className="text-xs mt-2" style={{ color: 'var(--color-caution)' }}>Attention: {record.areasForAttentionSummary}</p>}</div><div className="grid grid-cols-2 gap-3"><button onClick={() => void copy()} className="py-3 text-xs" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-ridge)', fontFamily: 'var(--font-mono)', borderLeft: '3px solid var(--color-ridge)' }}>Copy summary</button><a href={`/api/workflows/${encodeURIComponent(workflow.id)}/final-record.pdf`} className="py-3 text-center text-xs" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-ridge)', fontFamily: 'var(--font-mono)', borderLeft: '3px solid var(--color-ridge)' }}>Download PDF</a></div>{copyState === 'copied' && <p className="text-xs" style={{ color: 'var(--color-growth)' }}>Summary copied.</p>}{copyState === 'failed' && <p className="text-xs" style={{ color: 'var(--color-concern)' }}>Copy was not available. You can download the PDF instead.</p>}</div>
}

function MilestoneThreeCompleteStage({
  workflow,
  onDone,
  onCorrect,
  onRetract,
  persistenceState,
  onRetry,
  onReload,
}: {
  workflow: Workflow
  onDone: () => void
  onCorrect: (observation: SafetyObservationCurrentView, replacement: SafetyDraft, reason: string) => void
  onRetract: (observation: SafetyObservationCurrentView, reason: string) => void
  persistenceState: WorkflowPersistenceState
  onRetry: () => void
  onReload: () => void
}) {
  const completed = workflow.completedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(workflow.completedAt)) : ''
  const [editing, setEditing] = useState<SafetyObservationCurrentView | null>(null)
  const [retracting, setRetracting] = useState<SafetyObservationCurrentView | null>(null)
  const [assessmentContext, setAssessmentContext] = useState<'setup' | 'pou'>('setup')
  const [pouId, setPouId] = useState<(typeof TE_WAHAROA_POU)[number]['id'] | null>(null)
  const [broadClass, setBroadClass] = useState<SafetyBroadClass | null>(null)
  const [concernLevel, setConcernLevel] = useState<SafetyObservationConcernLevel>('unsure')
  const [contextNote, setContextNote] = useState('')
  const [reason, setReason] = useState('')
  const openCorrection = (observation: SafetyObservationCurrentView) => {
    setEditing(observation); setRetracting(null); setAssessmentContext(observation.assessmentContext); setPouId(observation.pouId); setBroadClass(observation.broadClass); setConcernLevel(observation.concernLevel); setContextNote(observation.contextNote ?? ''); setReason('')
  }
  const openRetraction = (observation: SafetyObservationCurrentView) => { setRetracting(observation); setEditing(null); setReason('') }
  useEffect(() => { setEditing(null); setRetracting(null); setReason('') }, [workflow.version])
  const correctionLevels: SafetyObservationConcernLevel[] = assessmentContext === 'setup' ? ['unsure', 'urgent'] : ['low', 'watch', 'action', 'urgent']
  return <div className="flex flex-col px-5 py-8 pb-16" style={{ minHeight: '80vh', fontFamily: 'var(--font-body)' }}><div className="text-center"><div className="mb-6 mx-auto flex items-center justify-center" style={{ width: 56, height: 56, backgroundColor: 'var(--color-growth-light)' }}>✓</div><p className="text-2xl font-medium mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>Kua oti</p><p className="text-sm italic mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>Session complete</p><p className="text-sm mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>Saved in Te Kaupapa.</p><p className="text-xs mb-8" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>Reference: {workflow.reference}<br />Completed: {completed}</p></div><div className="w-full text-left px-4 py-4 mb-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-growth)' }}><p className="text-sm" style={{ color: 'var(--color-ink-secondary)' }}>{workflow.structuredReview.actions.length} acknowledged action(s) · {workflow.structuredReview.referrals.length} referral draft(s)</p></div><div className="space-y-4 text-left"><div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-caution)' }}><SectionLabel>Safety concerns</SectionLabel><SafetyConcernList observations={workflow.safety.observations}/>{workflow.safety.observations.filter((observation) => observation.status === 'active').map((observation) => <div key={`${observation.id}-actions`} className="flex gap-3 mt-3"><button onClick={() => openCorrection(observation)} className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>Correct safety concern</button><button onClick={() => openRetraction(observation)} className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-concern)' }}>Retract safety concern</button></div>)}</div><SafetyRequirements workflow={workflow}/><div className="p-4" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-ridge)' }}><SectionLabel>Supervisor review requests</SectionLabel>{workflow.safety.supervisorReviewRequests.length ? workflow.safety.supervisorReviewRequests.map((request) => <p key={request.id} className="text-xs mt-2" style={{ color: 'var(--color-ink-secondary)' }}>Request recorded in Te Kaupapa{request.requestNote ? ` — ${request.requestNote}` : ''}</p>) : <p className="text-xs mt-2" style={{ color: 'var(--color-ink-muted)' }}>No supervisor review requests recorded.</p>}</div>{editing && <div className="p-4 space-y-3" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-ridge)' }}><SectionLabel>Correct safety concern</SectionLabel><p className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>Context: {editing.assessmentContext === 'pou' ? `Pou — ${TE_WAHAROA_POU.find((pou) => pou.id === editing.pouId)?.reo ?? ''}` : 'Setup'}</p><fieldset><legend className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>SAFETY CLASS</legend>{SAFETY_CLASS_OPTIONS.map((option) => <label key={option.id} className="flex gap-2 py-2 text-sm"><input type="radio" name="correction-safety-class" checked={broadClass === option.id} onChange={() => setBroadClass(option.id)}/>{option.label}</label>)}</fieldset><label className="block text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>CONCERN LEVEL<select value={concernLevel} onChange={(event) => setConcernLevel(event.target.value as SafetyObservationConcernLevel)} className="mt-2 w-full p-3 text-sm" style={{ backgroundColor: 'var(--color-ground)', color: 'var(--color-ink)', border: '1px solid var(--color-border)' }}>{correctionLevels.map((level) => <option key={level} value={level}>{level}</option>)}</select></label><label className="block text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>CONTEXT NOTE<textarea value={contextNote} onChange={(event) => setContextNote(event.target.value)} rows={2} className="mt-2 w-full resize-none p-3 text-sm" style={{ backgroundColor: 'var(--color-ground)', color: 'var(--color-ink)', borderLeft: '3px solid var(--color-border)' }}/></label><label className="block text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>CORRECTION REASON<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} className="mt-2 w-full resize-none p-3 text-sm" style={{ backgroundColor: 'var(--color-ground)', color: 'var(--color-ink)', borderLeft: '3px solid var(--color-border)' }}/></label><div className="flex gap-3"><button onClick={() => broadClass && reason.trim() && onCorrect(editing, { assessmentContext: editing.assessmentContext, pouId: editing.pouId ?? undefined, broadClass, concernLevel, contextNote: contextNote.trim() || undefined }, reason.trim())} disabled={!broadClass || !reason.trim()} className="text-xs disabled:opacity-40" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>Save correction</button><button onClick={() => setEditing(null)} className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>Cancel</button></div></div>}{retracting && <div className="p-4 space-y-3" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-concern)' }}><SectionLabel>Retract safety concern</SectionLabel><p className="text-xs leading-relaxed" style={{ color: 'var(--color-ink-secondary)' }}>This will remain in the session history as a retracted concern.</p><label className="block text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>RETRACTION REASON<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} className="mt-2 w-full resize-none p-3 text-sm" style={{ backgroundColor: 'var(--color-ground)', color: 'var(--color-ink)', borderLeft: '3px solid var(--color-border)' }}/></label><div className="flex gap-3"><button onClick={() => reason.trim() && onRetract(retracting, reason.trim())} disabled={!reason.trim()} className="text-xs disabled:opacity-40" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-concern)' }}>Retract safety concern</button><button onClick={() => setRetracting(null)} className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>Cancel</button></div></div>}<PersistenceFeedback state={persistenceState} onRetry={onRetry} onReload={onReload}/></div><button onClick={onDone} className="w-full py-4 mt-6 text-sm" style={{ backgroundColor: 'var(--color-ridge)', color: 'white', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>Hoki ki te Kāinga</button></div>
}

function sessionStageForWorkflow(stage: WorkflowStage): SessionStageKey {
  if (stage === 'action-planning') return 'risks'
  if (stage === 'referral-planning') return 'referrals'
  if (stage === 'structured-review') return 'synthesis'
  if (stage === 'record-review') return 'record'
  return stage
}

function workflowToSessionData(workflow: Workflow): ActiveSessionData {
  const initial = getInitialSessionData()
  return {
    ...initial,
    ref: workflow.reference,
    ...(workflow.setup
      ? {
          whanauCode: workflow.setup.whanauReference,
          engagementType: workflow.setup.engagementType,
          sessionFocus: workflow.setup.sessionFocus,
          notes: workflow.setup.additionalNotes ?? '',
        }
      : {}),
  }
}

export function SessionShell({
  onDone,
  displayName,
  workflow,
  onWorkflowChange,
}: {
  onDone: () => void
  displayName: string
  workflow: Workflow
  onWorkflowChange: (workflow: Workflow) => void
}) {
  const initialPouIdx = Math.max(0, TE_WAHAROA_POU.findIndex((pou) => pou.id === workflow.currentPouId))
  const [stage, setStage] = useState<SessionStageKey>(sessionStageForWorkflow(workflow.currentStage))
  const [currentPouIdx, setCurrentPouIdx] = useState(initialPouIdx)
  const [data, setData] = useState<ActiveSessionData>(() => workflowToSessionData(workflow))
  const [persistenceState, setPersistenceState] = useState<WorkflowPersistenceState>('idle')
  const [pendingSafetySave, setPendingSafetySave] = useState<PendingSafetySave | null>(null)
  const retrySubmission = useRef<(() => Promise<void>) | null>(null)
  const pendingSafetyRetry = useRef<(() => Promise<void>) | null>(null)
  const preserveNextWorkflowStage = useRef(false)

  const patch = (update: Partial<ActiveSessionData>) => setData((p) => ({ ...p, ...update }))

  useEffect(() => {
    const nextPouIdx = Math.max(0, TE_WAHAROA_POU.findIndex((pou) => pou.id === workflow.currentPouId))
    const preserveLocalStage = preserveNextWorkflowStage.current
    const hasCurrentPouCarryForward = workflow.currentPouId !== null && (workflow.carryForwards ?? []).some((item) => item.pouId === workflow.currentPouId)
    preserveNextWorkflowStage.current = false
    if (!preserveLocalStage) {
      // A carry-forward is created from the current Pou review but does not
      // advance canonical workflow state. Reopening that workflow must return
      // the Kaimahi to the same review, not the canonical overview/conversation.
      setStage(hasCurrentPouCarryForward ? 'pou-review' : sessionStageForWorkflow(workflow.currentStage))
      setCurrentPouIdx(nextPouIdx)
    }
    setData((current) => ({
      ...current,
      ref: workflow.reference,
      ...(workflow.setup
        ? {
            whanauCode: workflow.setup.whanauReference,
            engagementType: workflow.setup.engagementType,
            sessionFocus: workflow.setup.sessionFocus,
            notes: workflow.setup.additionalNotes ?? '',
          }
        : {}),
    }))
  }, [workflow])

  useEffect(() => {
    setPendingSafetySave((pending) => {
      if (!pending || !pending.retryable || pending.expectedVersion === workflow.version) return pending
      pendingSafetyRetry.current = null
      return { ...pending, retryable: false }
    })
  }, [workflow.version])

  const reloadLatest = () => {
    void getWorkflow(workflow.id)
      .then((latest) => {
        onWorkflowChange(latest)
        setPersistenceState('idle')
        retrySubmission.current = null
      })
      .catch(() => setPersistenceState('stale'))
  }

  const persist = async (
    submit: () => Promise<{ workflow: Workflow }>,
    retrying = false,
    preserveLocalStage = false,
  ) => {
    setPersistenceState(retrying ? 'retrying' : 'saving')
    try {
      const result = await submit()
      retrySubmission.current = null
      setPersistenceState('saved')
      if (preserveLocalStage) preserveNextWorkflowStage.current = true
      onWorkflowChange(result.workflow)
    } catch (error) {
      setPersistenceState(error instanceof WorkflowApiError && error.code === 'stale_workflow' ? 'stale' : 'failed')
    }
  }

  const retryLatestSubmission = () => {
    if (retrySubmission.current) void retrySubmission.current()
  }

  const retryPendingSafetySave = () => {
    if (pendingSafetyRetry.current) void pendingSafetyRetry.current()
  }

  const reviewPendingSafetySave = () => {
    if (!pendingSafetySave || pendingSafetySave.retryable) return
    if (pendingSafetySave.source.assessmentContext === 'setup') {
      setStage('setup')
      return
    }
    const pouIndex = TE_WAHAROA_POU.findIndex((pou) => pou.id === pendingSafetySave.source.pouId)
    if (pouIndex >= 0) {
      setCurrentPouIdx(pouIndex)
      setStage('pou-review')
    }
  }

  const setFollowUpFailure = (error: unknown, retry: () => Promise<void>, pendingSafety?: Omit<PendingSafetySave, 'retryable'>) => {
    if (error instanceof WorkflowApiError && error.code === 'stale_safety_observation') {
      retrySubmission.current = null
      if (pendingSafety) {
        pendingSafetyRetry.current = null
        setPendingSafetySave({ ...pendingSafety, retryable: false })
        void reloadLatest()
      }
      setPersistenceState('stale-safety')
    } else if (error instanceof WorkflowApiError && error.code === 'stale_workflow') {
      retrySubmission.current = null
      if (pendingSafety) {
        pendingSafetyRetry.current = null
        setPendingSafetySave({ ...pendingSafety, retryable: false })
        setPersistenceState('stale-safety')
      } else {
        setPersistenceState('stale')
      }
      void reloadLatest()
    } else {
      retrySubmission.current = retry
      setPersistenceState(pendingSafety ? 'failed-safety' : 'failed')
      if (pendingSafety) {
        pendingSafetyRetry.current = retry
        setPendingSafetySave({ ...pendingSafety, retryable: true })
      }
    }
  }

  const submitSupervisorReviewRequest = (current: Workflow, request: { pouId?: (typeof TE_WAHAROA_POU)[number]['id']; note?: string }) => {
    const command = {
      type: 'supervisor-review-requested' as const,
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: current.version,
      pouId: request.pouId,
      requestNote: request.note,
    }
    const attempt = async (retrying = false) => {
      setPersistenceState(retrying ? 'retrying' : 'saving')
      try {
        const result = await submitWorkflowCommand(current.id, command)
        retrySubmission.current = null
        setPersistenceState('saved')
        onWorkflowChange(result.workflow)
      } catch (error) {
        setFollowUpFailure(error, () => attempt(true))
      }
    }
    void attempt()
  }

  const submitSafetyConcern = (current: Workflow, safetyDraft: SafetyDraft, supervisorRequest?: { pouId?: (typeof TE_WAHAROA_POU)[number]['id']; note?: string }) => {
    const command = {
      type: 'safety-observation-confirmed' as const,
      observationId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: current.version,
      observation: safetyDraft,
    }
    const pendingSafety = {
      expectedVersion: command.expectedVersion,
      idempotencyKey: command.idempotencyKey,
      source: safetyDraft,
    }
    const attempt = async (retrying = false) => {
      setPersistenceState(retrying ? 'retrying' : 'saving')
      try {
        const result = await submitWorkflowCommand(current.id, command)
        onWorkflowChange(result.workflow)
        setPendingSafetySave(null)
        pendingSafetyRetry.current = null
        if (supervisorRequest) {
          submitSupervisorReviewRequest(result.workflow, supervisorRequest)
          return
        }
        retrySubmission.current = null
        setPersistenceState('saved')
      } catch (error) {
        setFollowUpFailure(error, () => attempt(true), pendingSafety)
      }
    }
    void attempt()
  }

  const confirmAssessmentCandidate = async (candidate: PouAssessmentCandidate, concernLevel: SafetyObservationConcernLevel, pouId: (typeof TE_WAHAROA_POU)[number]['id']): Promise<boolean> => {
    const command = candidateConfirmationCommand(candidate, concernLevel, pouId, workflow.version)
    if (!command) return false
    const attempt = async (retrying = false): Promise<boolean> => {
      setPersistenceState(retrying ? 'retrying' : 'saving')
      try {
        const result = await submitWorkflowCommand(workflow.id, command)
        retrySubmission.current = null
        setPersistenceState('saved')
        // Candidate resolution is a safety-only command. Keep the populated
        // Pou review mounted while its authoritative workflow snapshot updates.
        preserveNextWorkflowStage.current = true
        onWorkflowChange(result.workflow)
        return true
      } catch (error) {
        setFollowUpFailure(error, async () => { await attempt(true) })
        return false
      }
    }
    return attempt()
  }

  const correctSafetyConcern = (observation: SafetyObservationCurrentView, replacement: SafetyDraft, reason: string) => {
    const command = { type: 'safety-observation-corrected' as const, observationId: observation.id, expectedObservationRevision: observation.currentRevision, idempotencyKey: crypto.randomUUID(), expectedVersion: workflow.version, replacement, reason }
    const attempt = async (retrying = false) => {
      setPersistenceState(retrying ? 'retrying' : 'saving')
      try {
        const result = await submitWorkflowCommand(workflow.id, command)
        retrySubmission.current = null
        setPersistenceState('saved')
        onWorkflowChange(result.workflow)
      } catch (error) {
        setFollowUpFailure(error, () => attempt(true))
      }
    }
    void attempt()
  }

  const retractSafetyConcern = (observation: SafetyObservationCurrentView, reason: string) => {
    const command = { type: 'safety-observation-retracted' as const, observationId: observation.id, expectedObservationRevision: observation.currentRevision, idempotencyKey: crypto.randomUUID(), expectedVersion: workflow.version, reason }
    const attempt = async (retrying = false) => {
      setPersistenceState(retrying ? 'retrying' : 'saving')
      try {
        const result = await submitWorkflowCommand(workflow.id, command)
        retrySubmission.current = null
        setPersistenceState('saved')
        onWorkflowChange(result.workflow)
      } catch (error) {
        setFollowUpFailure(error, () => attempt(true))
      }
    }
    void attempt()
  }

  const confirmSetup = (immediateConcern: Exclude<ImmediateConcern, null>, safetyDraft?: SafetyDraft) => {
    const command = {
      type: 'setup-confirmed' as const,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: workflow.version,
      whanauReference: data.whanauCode,
      engagementType: data.engagementType,
      sessionFocus: data.sessionFocus,
      additionalNotes: data.notes || undefined,
      immediateConcern,
    }
    const attempt = async (retrying = false) => {
      setPersistenceState(retrying ? 'retrying' : 'saving')
      try {
        const result = await submitWorkflowCommand(workflow.id, command)
        onWorkflowChange(result.workflow)
        if (safetyDraft) {
          submitSafetyConcern(result.workflow, safetyDraft)
          return
        }
        retrySubmission.current = null
        setPersistenceState('saved')
      } catch (error) {
        setFollowUpFailure(error, () => attempt(true))
      }
    }
    void attempt()
  }

  const confirmPouReview = (review: {
    note?: string
  }, safetyDraft?: SafetyDraft, supervisorReviewRequest?: { note?: string }) => {
    const command = {
      type: 'pou-review-confirmed' as const,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: workflow.version,
      pouId: TE_WAHAROA_POU[currentPouIdx]!.id,
      ...review,
    }
    const attempt = async (retrying = false) => {
      setPersistenceState(retrying ? 'retrying' : 'saving')
      try {
        const result = await submitWorkflowCommand(workflow.id, command)
        onWorkflowChange(result.workflow)
        const request = supervisorReviewRequest ? { ...supervisorReviewRequest, pouId: command.pouId } : undefined
        if (safetyDraft) {
          submitSafetyConcern(result.workflow, safetyDraft, request)
          return
        }
        if (request) {
          submitSupervisorReviewRequest(result.workflow, request)
          return
        }
        retrySubmission.current = null
        setPersistenceState('saved')
      } catch (error) {
        setFollowUpFailure(error, () => attempt(true))
      }
    }
    void attempt()
  }

  const markCarryForward = (source: WorkflowCarryForwardSource) => {
    const command = {
      type: 'carry-forward-marked' as const,
      itemId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: workflow.version,
      pouId: TE_WAHAROA_POU[currentPouIdx]!.id,
      source,
    }
    const submit = () => submitWorkflowCommand(workflow.id, command)
    retrySubmission.current = () => persist(submit, true, true)
    void persist(submit, false, true)
  }

  const confirmDownstream = (
    command:
      | { type: 'workflow-synthesis-confirmed'; synthesisRevisionId: string }
      | { type: 'pou-summary-confirmed' | 'structured-review-confirmed' | 'workflow-completed' }
      | { type: 'action-plan-confirmed'; actions: ManualAction[] }
      | { type: 'referral-plan-confirmed'; referrals: ManualReferral[] },
  ) => {
    const submission = command.type === 'action-plan-confirmed' || command.type === 'referral-plan-confirmed'
      ? { ...command, idempotencyKey: crypto.randomUUID(), expectedVersion: workflow.version }
      : { ...command, idempotencyKey: crypto.randomUUID(), expectedVersion: workflow.version }
    const submit = () => submitWorkflowCommand(workflow.id, submission)
    retrySubmission.current = () => persist(submit, true)
    void persist(submit)
  }

  // Pou-by-pou flow:
  // setup → pou-overview → pou-convo(0) → pou-review(0) → pou-convo(1) → pou-review(1) → …
  // → pou-convo(5) → pou-review(5) → server-acknowledged downstream stages
  const advance = () => {
    setPersistenceState('idle')
    if (stage === 'setup') { return }
    if (stage === 'pou-overview') { setCurrentPouIdx(0); setStage('pou-convo'); return }
    if (stage === 'pou-convo') { setStage('pou-review'); return }
    if (stage === 'pou-processing') { return }
    if (stage === 'pou-review') {
      if (currentPouIdx < 6) {
        setCurrentPouIdx((i) => i + 1)
        setStage('pou-convo')
      } else {
        setStage('pou-summary')
      }
      return
    }
    // Downstream progress is advanced only by an acknowledged workflow command.
  }

  const back = () => {
    if (stage === 'setup') { onDone(); return }
    if (stage === 'pou-overview') { setStage('setup'); return }
    if (stage === 'pou-convo' && currentPouIdx === 0) { setStage('pou-overview'); return }
    if (stage === 'pou-convo') { setCurrentPouIdx((i) => i - 1); setStage('pou-review'); return }
    if (stage === 'pou-processing') { setStage('pou-convo'); return }
    if (stage === 'pou-review') { setStage('pou-convo'); return }
    if (stage === 'pou-summary') { setCurrentPouIdx(6); setStage('pou-review'); return }
    const linear: SessionStageKey[] = ['risks', 'referrals', 'synthesis', 'record']
    const li = linear.indexOf(stage)
    if (li === 0) { setStage('pou-summary'); return }
    if (li > 0) { setStage(linear[li - 1]); return }
    onDone()
  }

  if (stage === 'complete') {
    return (
      <WhareShell>
        <SessionHeader stage="complete" sessionRef={data.ref} whanauCode={data.whanauCode} onBack={onDone} />
        <div className="flex-1 overflow-y-auto">
          <PendingSafetySaveNotice pending={pendingSafetySave} state={persistenceState} onRetry={retryPendingSafetySave} onReview={reviewPendingSafetySave} />
          <MilestoneThreeCompleteStage workflow={workflow} onDone={onDone} onCorrect={correctSafetyConcern} onRetract={retractSafetyConcern} persistenceState={persistenceState} onRetry={retryLatestSubmission} onReload={reloadLatest} />
          <div className="px-5 pb-8"><FinalRecordCompletion workflow={workflow} /></div>
        </div>
      </WhareShell>
    )
  }

  const pouReo = POU_EXTENDED[currentPouIdx]?.full.split(',')[0].trim()

  return (
    <WhareShell>
      <SessionHeader
        stage={stage}
        sessionRef={data.ref}
        whanauCode={data.whanauCode}
        onBack={back}
        pouIdx={currentPouIdx}
        pouReo={pouReo}
      />
      <div className="flex-1 overflow-y-auto">
        <PendingSafetySaveNotice pending={pendingSafetySave} state={persistenceState} onRetry={retryPendingSafetySave} onReview={reviewPendingSafetySave} />
        {stage === 'setup'        && <SetupStage data={data} onChange={patch} onConfirm={confirmSetup} displayName={displayName} persistenceState={persistenceState} onRetry={retryLatestSubmission} onReload={reloadLatest} />}
        {stage === 'pou-overview' && <PouOverviewStage data={data} onNext={advance} />}
        {stage === 'pou-overview' && !pendingSafetySave && <div className="px-5 pb-4"><PersistenceFeedback state={persistenceState} onRetry={retryLatestSubmission} onReload={reloadLatest} /></div>}
        {stage === 'pou-convo'    && <PouConversationStage data={data} onChange={patch} onNext={advance} onReflectionEnded={() => setStage('pou-processing')} pouIdx={currentPouIdx} workflowId={workflow.id} />}
        {stage === 'pou-convo'    && !pendingSafetySave && <div className="px-5 pb-4"><PersistenceFeedback state={persistenceState} onRetry={retryLatestSubmission} onReload={reloadLatest} /></div>}
        {stage === 'pou-processing' && <PouReviewProcessingStage workflowId={workflow.id} pouId={TE_WAHAROA_POU[currentPouIdx]!.id} onReady={() => setStage('pou-review')} onManualReview={() => setStage('pou-review')} />}
        {stage === 'pou-review'   && <SinglePouReviewStage pouIdx={currentPouIdx} checkpoint={workflow.checkpoints.find((checkpoint) => checkpoint.pouId === TE_WAHAROA_POU[currentPouIdx]?.id)} onConfirm={confirmPouReview} workflowId={workflow.id} carryForwards={workflow.carryForwards} safetyObservations={workflow.safety.observations} onMarkCarryForward={markCarryForward} onCandidateConfirm={confirmAssessmentCandidate} persistenceState={persistenceState} onRetry={retryLatestSubmission} onReload={reloadLatest} />}
        {stage === 'pou-summary'  && <WorkflowSynthesisStage workflow={workflow} onConfirm={(synthesisRevisionId) => confirmDownstream({ type: 'workflow-synthesis-confirmed', synthesisRevisionId })} persistenceState={persistenceState} onRetry={retryLatestSubmission} onReload={reloadLatest} />}
        {stage === 'risks'        && <RealActionsStage key={workflow.version} workflow={workflow} onConfirm={(actions) => confirmDownstream({ type: 'action-plan-confirmed', actions })} persistenceState={persistenceState} onRetry={retryLatestSubmission} onReload={reloadLatest} />}
        {stage === 'referrals'    && <RealReferralsStage key={workflow.version} workflow={workflow} onConfirm={(referrals) => confirmDownstream({ type: 'referral-plan-confirmed', referrals })} persistenceState={persistenceState} onRetry={retryLatestSubmission} onReload={reloadLatest} />}
        {stage === 'synthesis'    && <RealStructuredReviewStage workflow={workflow} onConfirm={() => confirmDownstream({ type: 'structured-review-confirmed' })} persistenceState={persistenceState} onRetry={retryLatestSubmission} onReload={reloadLatest} />}
        {stage === 'record'       && <RecordReviewStage workflow={workflow} onComplete={() => confirmDownstream({ type: 'workflow-completed' })} persistenceState={persistenceState} onRetry={retryLatestSubmission} onReload={reloadLatest} />}
      </div>
    </WhareShell>
  )
}
