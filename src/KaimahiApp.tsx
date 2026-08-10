import { useEffect, useRef, useState } from 'react'
import type {
  Pou,
  PouStatus,
  ActionType,
  WhanauRecord,
  HistoricalSession,
} from './types'
import {
  STATUS_CONFIG,
  MY_ACTIONS,
  WHANAU_RECORDS,
  makePou,
} from './data'
import {
  PouStrip,
  ActionBadge,
  StatusBadge,
  SectionLabel,
  EngagementLabel,
} from './shared'
import { TE_WAHAROA_POU } from './pou'
import {
  RecordArchiveScreen,
  ReferralsBrowseScreen,
  SettingsScreen,
  SynthesisArchiveScreen,
} from './kaimahi/SecondaryScreens'
import {
  SESSION_STAGE_LABELS,
  WhareShell,
  type SessionStageKey,
} from './kaimahi/KaimahiShell'
import { SessionShell } from './kaimahi/KaimahiSession'
import type { AuthProfile } from './auth'
import {
  WorkflowApiError,
  createWorkflow,
  getWorkflow,
  listCompletedWorkflows,
  listResumableWorkflows,
  type CompletedWorkflowListItem,
  type Workflow,
  type WorkflowPersistenceState,
} from './workflows'

// ─── Navigation types ─────────────────────────────────────────────────────────

type PrimaryTab = 'home' | 'actions' | 'reflections'
type SecondaryTab = 'referrals-browse' | 'synthesis-archive' | 'record-archive' | 'settings'
type KaimahiTab = PrimaryTab | SecondaryTab
// Greeting based on hour
function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Ata mārie'
  if (h < 17) return 'Tēnā koe'
  return 'Ahiahi mārie'
}

// ─────────────────────────────────────────────────────────────────────────────
// BOTTOM NAV — paepae of the whare
// ─────────────────────────────────────────────────────────────────────────────

interface BottomNavProps {
  active: KaimahiTab
  moreOpen: boolean
  sessionActive: boolean
  onTab: (t: KaimahiTab) => void
  onSession: () => void
  onMore: () => void
}

function BottomNav({ active, moreOpen, sessionActive, onTab, onSession, onMore }: BottomNavProps) {
  const left: { id: PrimaryTab; reo: string }[] = [
    { id: 'home', reo: 'Kāinga' },
    { id: 'actions', reo: 'Mahi' },
  ]
  const right: { id: PrimaryTab; reo: string }[] = [
    { id: 'reflections', reo: 'Kōrero' },
  ]

  const isSecondary = ['referrals-browse', 'synthesis-archive', 'record-archive', 'settings'].includes(active)

  const NavMark = ({ isActive }: { isActive: boolean }) => (
    <div className="flex flex-col items-center gap-px mb-0.5">
      <div
        style={{
          width: 16,
          height: isActive ? 12 : 6,
          backgroundColor: isActive ? 'var(--color-ridge)' : 'var(--color-border-strong)',
          transition: 'height 0.2s ease, background-color 0.2s ease',
        }}
      />
      {isActive && (
        <div style={{ width: 20, height: 2, backgroundColor: 'var(--color-ridge)' }} />
      )}
    </div>
  )

  return (
    <div
      className="flex items-end flex-shrink-0"
      style={{
        backgroundColor: 'var(--color-ground)',
        borderTop: '2px solid var(--color-border-strong)',
      }}
    >
      {/* Left tabs */}
      {left.map((t) => (
        <button
          key={t.id}
          onClick={() => onTab(t.id)}
          className="flex-1 flex flex-col items-center justify-end py-3 pb-4 gap-1 min-h-[56px] transition-opacity"
          style={{ opacity: active === t.id ? 1 : 0.5 }}
        >
          <NavMark isActive={active === t.id} />
          <span
            className="text-xs leading-none"
            style={{
              fontFamily: 'var(--font-mono)',
              color: active === t.id ? 'var(--color-ridge)' : 'var(--color-ink-muted)',
            }}
          >
            {t.reo}
          </span>
        </button>
      ))}

      {/* Centre — TĪMATA / session indicator */}
      <div className="flex-shrink-0 flex flex-col items-center pb-3 px-1 pt-1">
        <button
          onClick={onSession}
          className="relative flex flex-col items-center justify-center transition-all active:scale-95"
          style={{
            width: 56,
            height: 56,
            backgroundColor: 'var(--color-ridge)',
          }}
        >
          {sessionActive && (
            <div
              className="absolute -top-1 -right-1 w-2.5 h-2.5"
              style={{ backgroundColor: 'var(--color-growth)' }}
            />
          )}
          <div className="w-6 h-px bg-white mb-1.5" />
          <span
            className="text-white text-center leading-none"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 7.5, letterSpacing: '0.08em' }}
          >
            {sessionActive ? 'TONU' : 'TĪMATA'}
          </span>
        </button>
      </div>

      {/* Right tab */}
      {right.map((t) => (
        <button
          key={t.id}
          onClick={() => onTab(t.id)}
          className="flex-1 flex flex-col items-center justify-end py-3 pb-4 gap-1 min-h-[56px] transition-opacity"
          style={{ opacity: active === t.id ? 1 : 0.5 }}
        >
          <NavMark isActive={active === t.id} />
          <span
            className="text-xs leading-none"
            style={{
              fontFamily: 'var(--font-mono)',
              color: active === t.id ? 'var(--color-ridge)' : 'var(--color-ink-muted)',
            }}
          >
            {t.reo}
          </span>
        </button>
      ))}

      {/* More */}
      <button
        onClick={onMore}
        className="flex-1 flex flex-col items-center justify-end py-3 pb-4 gap-1 min-h-[56px] transition-opacity"
        style={{ opacity: moreOpen || isSecondary ? 1 : 0.5 }}
      >
        <div className="flex gap-0.5 mb-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: 4,
                height: 4,
                backgroundColor:
                  moreOpen || isSecondary ? 'var(--color-ridge)' : 'var(--color-border-strong)',
              }}
            />
          ))}
        </div>
        <span
          className="text-xs leading-none"
          style={{
            fontFamily: 'var(--font-mono)',
            color: moreOpen || isSecondary ? 'var(--color-ridge)' : 'var(--color-ink-muted)',
          }}
        >
          Atu
        </span>
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MORE PANEL — slides up above bottom nav
// ─────────────────────────────────────────────────────────────────────────────

function MorePanel({
  active,
  onSelect,
}: {
  active: KaimahiTab
  onSelect: (t: SecondaryTab) => void
}) {
  const items: { id: SecondaryTab; reo: string; en: string }[] = [
    { id: 'referrals-browse', reo: 'Ngā Ara', en: 'Referral services' },
    { id: 'synthesis-archive', reo: 'Whakaaro', en: 'Synthesis archive' },
    { id: 'record-archive', reo: 'Tohu', en: 'Session records' },
    { id: 'settings', reo: 'Tautuhinga', en: 'Settings' },
  ]

  return (
    <div
      style={{
        borderTop: '1px solid var(--color-border-strong)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className="w-full flex items-center gap-4 px-5 py-3.5 text-left transition-colors"
          style={{
            borderLeft: active === item.id ? '3px solid var(--color-ridge)' : '3px solid transparent',
            backgroundColor: active === item.id ? 'var(--color-ground)' : 'transparent',
          }}
        >
          <div
            className="flex-shrink-0"
            style={{
              width: 3,
              height: 16,
              backgroundColor: active === item.id ? 'var(--color-ridge)' : 'var(--color-border-strong)',
            }}
          />
          <div>
            <span
              className="text-sm font-medium mr-2"
              style={{ color: 'var(--color-ink)' }}
            >
              {item.reo}
            </span>
            <span
              className="text-xs"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
            >
              {item.en}
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HOME SCREEN — approaching and entering the whare
// ─────────────────────────────────────────────────────────────────────────────

// Pou label lookup (position-based — matches makePou order)
const POU_META = TE_WAHAROA_POU

function actionStripe(type: ActionType): string {
  return {
    referral: 'var(--color-growth)',
    'supervisor-review': 'var(--color-ridge)',
    escalation: 'var(--color-concern)',
    'carry-forward': 'var(--color-border-strong)',
  }[type]
}

function HomeScreen({
  onBeginSession,
  sessionActive,
  sessionRef,
  sessionStage,
  displayName,
  persistenceState,
}: {
  onBeginSession: () => void
  sessionActive: boolean
  sessionRef: string
  sessionStage: SessionStageKey
  displayName: string
  persistenceState: WorkflowPersistenceState
}) {
  const greeting = getGreeting()
  const stageMeta = SESSION_STAGE_LABELS[sessionStage]

  // Aggregate pou status per position across all my whānau latest sessions
  const myWhanau = WHANAU_RECORDS.filter((w) => w.kaimahiId === 'k1')
  const allLatestPou = myWhanau
    .map((w) => w.sessions.at(-1)?.pou ?? [])
    .filter((arr) => arr.length > 0)

  const aggregatedPou = POU_META.map((meta, i) => {
    const statuses = allLatestPou.map((arr) => arr[i]?.status).filter(Boolean) as PouStatus[]
    const worstStatus: PouStatus = statuses.includes('mataku')
      ? 'mataku'
      : statuses.includes('āta')
        ? 'āta'
        : statuses.includes('tōtika')
          ? 'tōtika'
          : 'kore'
    return { ...meta, status: worstStatus }
  })

  const pouNeedingAttention = aggregatedPou.filter(
    (p) => p.status === 'mataku' || p.status === 'āta',
  )

  // Open actions
  const openActions = MY_ACTIONS.filter((a) => !a.completed)
  const urgentActions = openActions.filter((a) => a.type !== 'carry-forward')
  const carryForwards = openActions.filter((a) => a.type === 'carry-forward')

  // Recent reflections
  const recentSessions = myWhanau
    .flatMap((w) => w.sessions.map((s) => ({ ...s, whanauCode: w.code })))
    .sort((a, b) => b.ref.localeCompare(a.ref))
    .slice(0, 3)

  return (
    <div className="flex flex-col" style={{ fontFamily: 'var(--font-body)' }}>

      {/* ── Six Safety Pou — structural ridge ── */}
      {/* Each bar is one of the six pou, coloured by the worst status
          across my current whānau caseload. Named. Present. Structural. */}
      <div className="flex w-full" style={{ gap: 1 }}>
        {aggregatedPou.map((p) => {
          const c = STATUS_CONFIG[p.status]
          const needsAttention = p.status === 'mataku' || p.status === 'āta'
          return (
            <div key={p.id} className="flex-1 flex flex-col">
              <div
                title={`${p.reo} — ${c.label}`}
                style={{
                  height: needsAttention ? 7 : 5,
                  backgroundColor: c.color,
                  opacity: p.status === 'kore' ? 0.1 : p.status === 'tōtika' ? 0.32 : 0.85,
                  transition: 'height 0.3s ease',
                }}
              />
              <div
                className="text-center pt-0.5"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.47rem',
                  letterSpacing: '0.04em',
                  color: needsAttention ? c.color : 'var(--color-ink-muted)',
                  opacity: needsAttention ? 1 : 0.6,
                }}
              >
                {p.reo}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Approach zone — exterior, before the whare ── */}
      <div className="px-6 pt-9 pb-8">
        <p
          className="text-xs tracking-widest uppercase mb-5"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}
        >
          Te Kaupapa AI
        </p>
        <h1
          className="leading-tight mb-3"
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontSize: '2rem',
            fontWeight: 500,
            color: 'var(--color-ink)',
            letterSpacing: '-0.01em',
          }}
        >
          {greeting},
          <br />
          {displayName}
        </h1>
        <p
          className="text-xs"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
        >
          Rāhoroi · 6 Ākuhata 2026
        </p>
      </div>

      {/* ── Paepae — the threshold ── */}
      <div className="relative flex items-center" style={{ marginBottom: 0 }}>
        <div className="flex-1" style={{ height: 1, backgroundColor: 'var(--color-border-strong)' }} />
        <div
          className="flex-shrink-0 flex items-center px-4 py-1.5"
          style={{ backgroundColor: 'var(--color-surface-deep)' }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.65rem',
              letterSpacing: '0.18em',
              color: 'var(--color-ink-muted)',
            }}
          >
            PAEPAE
          </span>
        </div>
        <div className="flex-1" style={{ height: 1, backgroundColor: 'var(--color-border-strong)' }} />
      </div>

      {/* ── Interior — held spaces ── */}
      <div className="px-5 pt-6 pb-10 space-y-7">

        {/* ── 1. Central action — Start Reflection ── */}
        <button
          onClick={onBeginSession}
          className="w-full text-left transition-all active:opacity-85"
        >
          {sessionActive ? (
            /* Resume in-progress session */
            <div
              style={{
                backgroundColor: 'var(--color-ridge-light)',
                borderLeft: '4px solid var(--color-ridge)',
                padding: '1.25rem 1.25rem 1.125rem',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="flex-shrink-0"
                  style={{ width: 8, height: 8, backgroundColor: 'var(--color-ridge)' }}
                />
                <span
                  className="text-xs tracking-wide"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}
                >
                  SESSION IN PROGRESS
                </span>
              </div>
              <p
                className="text-lg font-medium italic mb-1"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
              >
                Arotake tonu — continue your reflection
              </p>
              <p
                className="text-xs"
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
              >
                {sessionRef}
                {stageMeta && <> · {stageMeta.reo}</>}
                <> · Tap to return →</>
              </p>
            </div>
          ) : (
            /* Begin new session — the primary invitation */
            <div
              style={{
                backgroundColor: 'var(--color-ridge)',
                padding: '1.625rem 1.25rem 1.5rem',
              }}
            >
              {/* Six structural marks inside the panel — the pou made visible */}
              <div className="flex gap-1 mb-5" style={{ opacity: 0.22 }}>
                {aggregatedPou.map((p) => (
                  <div
                    key={p.id}
                    style={{ flex: 1, height: 3, backgroundColor: 'white' }}
                  />
                ))}
              </div>
              <p
                className="text-xs tracking-widest uppercase mb-3"
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: 'rgba(255,255,255,0.5)',
                  letterSpacing: '0.14em',
                }}
              >
                Tīmata
              </p>
              <p
                className="text-xl font-medium italic mb-2"
                style={{
                  fontFamily: 'var(--font-display)',
                  color: 'white',
                  lineHeight: 1.3,
                }}
              >
                Begin a reflective session
              </p>
              <p
                className="text-sm italic"
                style={{
                  fontFamily: 'var(--font-display)',
                  color: 'rgba(255,255,255,0.6)',
                }}
              >
                {persistenceState === 'saving'
                  ? 'Saving…'
                  : persistenceState === 'retrying'
                    ? 'Retrying…'
                    : persistenceState === 'failed'
                      ? "Couldn’t save. Try again."
                      : 'Reflect through the Pou of Te Waharoa →'}
              </p>
            </div>
          )}
        </button>

        {/* ── 2. Te Waharoa Pou — structural health ── */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <SectionLabel>Ngā Pou o Te Waharoa</SectionLabel>
            <span
              className="text-xs italic"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
            >
              {pouNeedingAttention.length === 0
                ? 'All stable'
                : `${pouNeedingAttention.length} need attention`}
            </span>
          </div>

          {/* All seven Pou — always shown, quiet */}
          <div className="space-y-px">
            {aggregatedPou.map((p) => {
              const c = STATUS_CONFIG[p.status]
              const needsAttention = p.status === 'mataku' || p.status === 'āta'
              return (
                <div
                  key={p.id}
                  className="flex items-center"
                  style={{
                    backgroundColor: needsAttention ? c.light : 'var(--color-surface)',
                    borderLeft: `3px solid ${needsAttention ? c.color : 'var(--color-border)'}`,
                    opacity: p.status === 'tōtika' ? 0.7 : 1,
                    padding: '0.625rem 0.75rem',
                  }}
                >
                  {/* Shaft mark */}
                  <div
                    className="flex-shrink-0 mr-3"
                    style={{
                      width: 2,
                      height: needsAttention ? 18 : 12,
                      backgroundColor: needsAttention ? c.color : 'var(--color-border-strong)',
                      transition: 'height 0.2s ease',
                    }}
                  />
                  <span
                    className="text-sm flex-1"
                    style={{
                      fontFamily: 'var(--font-display)',
                      color: needsAttention ? 'var(--color-ink)' : 'var(--color-ink-muted)',
                      fontWeight: needsAttention ? 500 : 400,
                    }}
                  >
                    {p.reo}
                  </span>
                  <span
                    className="text-xs mr-3"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                  >
                    {p.en}
                  </span>
                  {needsAttention ? (
                    <StatusBadge status={p.status} />
                  ) : (
                    <div style={{ width: 8, height: 8, backgroundColor: c.color, opacity: 0.35 }} />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── 3. Actions needing attention ── */}
        {openActions.length > 0 && (
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <SectionLabel>Ngā Mahi — open actions</SectionLabel>
              <span
                className="text-xs italic"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
              >
                {openActions.length} open
              </span>
            </div>
            <div className="space-y-px">
              {urgentActions.map((a) => (
                <div key={a.id} className="flex">
                  <div
                    className="flex-shrink-0 w-1"
                    style={{ backgroundColor: actionStripe(a.type) }}
                  />
                  <div
                    className="flex-1 py-3 px-3.5"
                    style={{ backgroundColor: 'var(--color-surface)' }}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <ActionBadge type={a.type} />
                      <span
                        className="text-xs"
                        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}
                      >
                        {a.whanauCode}
                      </span>
                      <span
                        className="text-xs"
                        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                      >
                        {a.date}
                      </span>
                    </div>
                    <p
                      className="text-sm leading-snug"
                      style={{ color: 'var(--color-ink-secondary)' }}
                    >
                      {a.description}
                    </p>
                  </div>
                </div>
              ))}
              {carryForwards.length > 0 && (
                <div className="flex">
                  <div
                    className="flex-shrink-0 w-1"
                    style={{ backgroundColor: 'var(--color-border-strong)' }}
                  />
                  <div
                    className="flex-1 py-3 px-3.5"
                    style={{ backgroundColor: 'var(--color-surface)', opacity: 0.7 }}
                  >
                    <p
                      className="text-xs italic"
                      style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
                    >
                      +{carryForwards.length} carried forward — review in next session
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 4. Recent reflections ── */}
        <div>
          <SectionLabel>Ngā Kōrero Tata — recent</SectionLabel>
          <div className="mt-3 space-y-px">
            {recentSessions.map((s, i) => (
              <div
                key={s.id}
                className="flex items-center gap-3 px-3"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderLeft: s.flagged
                    ? '3px solid var(--color-concern)'
                    : '3px solid var(--color-border)',
                  padding: '0.75rem 0.75rem',
                  opacity: i === 0 ? 1 : i === 1 ? 0.8 : 0.6,
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className="text-sm font-medium"
                      style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
                    >
                      {s.whanauCode}
                    </span>
                    <span
                      className="text-xs"
                      style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                    >
                      {s.ref}
                    </span>
                    {s.flagged && (
                      <div
                        className="flex-shrink-0"
                        style={{ width: 5, height: 5, backgroundColor: 'var(--color-concern)' }}
                      />
                    )}
                  </div>
                  <p
                    className="text-xs"
                    style={{ color: 'var(--color-ink-muted)' }}
                  >
                    {s.date} · <EngagementLabel type={s.engagementType} />
                  </p>
                </div>
                <div className="flex-shrink-0">
                  <PouStrip pou={s.pou} compact />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Whakataukī — closing the interior */}
        <div className="text-center pt-2">
          <p
            className="text-xs italic"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
          >
            "He whakaaro pai, he oranga tangata"
          </p>
        </div>

      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MY ACTIONS SCREEN
// ─────────────────────────────────────────────────────────────────────────────

// ─── My Actions types ─────────────────────────────────────────────────────────

type KaimahiActionStatus =
  | 'not-started'
  | 'in-progress'
  | 'waiting-whanau'
  | 'waiting-service'
  | 'completed'
  | 'closed'

type KaimahiActionPriority = 'urgent' | 'important' | 'routine'

interface KaimahiAction {
  id: string
  title: string
  type: ActionType
  whanauCode: string
  sessionRef: string
  sessionDate: string
  pouReo: string
  priority: KaimahiActionPriority
  dueDate: string
  status: KaimahiActionStatus
  notes: string
  fromPrevSession: boolean
}

const ACTION_STATUS_META: Record<KaimahiActionStatus, { label: string; color: string; bg: string }> = {
  'not-started':      { label: 'Not started',            color: 'var(--color-ink-muted)',    bg: 'var(--color-surface)'       },
  'in-progress':      { label: 'In progress',            color: 'var(--color-ridge)',        bg: 'var(--color-ridge-light)'   },
  'waiting-whanau':   { label: 'Waiting on whānau',      color: 'var(--color-caution)',      bg: 'var(--color-caution-light)' },
  'waiting-service':  { label: 'Waiting on service',     color: 'var(--color-caution)',      bg: 'var(--color-caution-light)' },
  'completed':        { label: 'Completed',              color: 'var(--color-growth)',       bg: 'var(--color-growth-light)'  },
  'closed':           { label: 'Closed / no longer req.', color: 'var(--color-ink-muted)',   bg: 'var(--color-surface-deep)'  },
}

const ACTION_PRIORITY_META: Record<KaimahiActionPriority, { label: string; color: string }> = {
  urgent:    { label: 'Urgent',    color: 'var(--color-concern)' },
  important: { label: 'Important', color: 'var(--color-caution)' },
  routine:   { label: 'Routine',   color: 'var(--color-ridge)'   },
}

const MY_KAIMAHI_ACTIONS: KaimahiAction[] = [
  {
    id: 'ka-1',
    title: 'Record supervisor review consideration — mental health concern',
    type: 'supervisor-review',
    whanauCode: 'TW-04',
    sessionRef: 'W-2838',
    sessionDate: '6 Aug 2026',
    pouReo: 'Hinengaro',
    priority: 'urgent',
    dueDate: '7 Aug 2026',
    status: 'not-started',
    notes: 'Discuss with Hemi before next whānau contact. Consider whether crisis support is needed.',
    fromPrevSession: false,
  },
  {
    id: 'ka-2',
    title: 'GP appointment — youngest child',
    type: 'referral',
    whanauCode: 'TW-04',
    sessionRef: 'W-2838',
    sessionDate: '6 Aug 2026',
    pouReo: 'Waranga',
    priority: 'important',
    dueDate: '14 Aug 2026',
    status: 'in-progress',
    notes: 'Discussed with Mere — she will call Te Whatu Ora this week. Follow up next contact.',
    fromPrevSession: false,
  },
  {
    id: 'ka-3',
    title: 'Connect to financial assistance — MSD Work & Income',
    type: 'referral',
    whanauCode: 'TW-04',
    sessionRef: 'W-2838',
    sessionDate: '6 Aug 2026',
    pouReo: 'Kāinga',
    priority: 'important',
    dueDate: '14 Aug 2026',
    status: 'not-started',
    notes: '',
    fromPrevSession: false,
  },
  {
    id: 'ka-4',
    title: 'Follow up on Kāinga Ora housing application',
    type: 'carry-forward',
    whanauCode: 'TW-04',
    sessionRef: 'W-2835',
    sessionDate: '1 Aug 2026',
    pouReo: 'Kāinga',
    priority: 'routine',
    dueDate: '20 Aug 2026',
    status: 'waiting-service',
    notes: 'Application lodged in July. Three weeks — no response. Escalate if no response by 13 Aug.',
    fromPrevSession: true,
  },
  {
    id: 'ka-5',
    title: 'Community programme engagement — follow up',
    type: 'carry-forward',
    whanauCode: 'MH-07',
    sessionRef: 'W-2832',
    sessionDate: '25 Jul 2026',
    pouReo: 'Tūhono',
    priority: 'routine',
    dueDate: '18 Aug 2026',
    status: 'waiting-whanau',
    notes: 'Rangi said he would look into the programme. Has not confirmed yet.',
    fromPrevSession: true,
  },
  {
    id: 'ka-6',
    title: 'Mental health referral preparation — Te Ara Oranga',
    type: 'referral',
    whanauCode: 'NG-11',
    sessionRef: 'W-2836',
    sessionDate: '3 Aug 2026',
    pouReo: 'Hinengaro',
    priority: 'important',
    dueDate: '10 Aug 2026',
    status: 'in-progress',
    notes: 'Referral preparation recorded. No intake appointment confirmation is represented.',
    fromPrevSession: false,
  },
  {
    id: 'ka-7',
    title: 'Supervisor review consideration — safety indicators W-2831',
    type: 'supervisor-review',
    whanauCode: 'TW-04',
    sessionRef: 'W-2831',
    sessionDate: '24 Jul 2026',
    pouReo: 'Haumaru',
    priority: 'urgent',
    dueDate: '25 Jul 2026',
    status: 'completed',
    notes: 'Demonstration record only. No supervisor review outcome is represented.',
    fromPrevSession: false,
  },
  {
    id: 'ka-8',
    title: 'Kāinga Ora referral preparation — housing navigation',
    type: 'referral',
    whanauCode: 'TW-04',
    sessionRef: 'W-2831',
    sessionDate: '24 Jul 2026',
    pouReo: 'Pakiaka',
    priority: 'important',
    dueDate: '31 Jul 2026',
    status: 'completed',
    notes: 'Demonstration record only. No referral delivery or housing navigator assignment is represented.',
    fromPrevSession: false,
  },
]

// ─── My Actions Screen ─────────────────────────────────────────────────────────

function MyActionsScreen() {
  type FilterKey = 'active' | 'urgent' | 'waiting' | 'carried' | 'done'

  const [filter, setFilter] = useState<FilterKey>('active')
  const [actions, setActions] = useState<KaimahiAction[]>(MY_KAIMAHI_ACTIONS)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const updateStatus = (id: string, status: KaimahiActionStatus) => {
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)))
    setUpdatingId(null)
  }

  const filterDefs: { id: FilterKey; label: string; count: () => number }[] = [
    {
      id: 'active',
      label: 'Active',
      count: () => actions.filter((a) => !['completed', 'closed'].includes(a.status)).length,
    },
    {
      id: 'urgent',
      label: 'Urgent',
      count: () => actions.filter((a) => a.priority === 'urgent' && !['completed', 'closed'].includes(a.status)).length,
    },
    {
      id: 'waiting',
      label: 'Waiting',
      count: () => actions.filter((a) => a.status.startsWith('waiting')).length,
    },
    {
      id: 'carried',
      label: 'Carried',
      count: () => actions.filter((a) => a.fromPrevSession && !['completed', 'closed'].includes(a.status)).length,
    },
    {
      id: 'done',
      label: 'Done',
      count: () => actions.filter((a) => ['completed', 'closed'].includes(a.status)).length,
    },
  ]

  const filtered = actions.filter((a) => {
    if (filter === 'active') return !['completed', 'closed'].includes(a.status)
    if (filter === 'urgent') return a.priority === 'urgent' && !['completed', 'closed'].includes(a.status)
    if (filter === 'waiting') return a.status.startsWith('waiting')
    if (filter === 'carried') return a.fromPrevSession && !['completed', 'closed'].includes(a.status)
    if (filter === 'done') return ['completed', 'closed'].includes(a.status)
    return true
  })

  // Group: urgent first, then by whānau code
  const sorted = [...filtered].sort((a, b) => {
    const p = { urgent: 0, important: 1, routine: 2 }
    if (p[a.priority] !== p[b.priority]) return p[a.priority] - p[b.priority]
    return a.whanauCode.localeCompare(b.whanauCode)
  })

  // Colour for left priority stripe
  const priorityStripe = (a: KaimahiAction) => {
    if (['completed', 'closed'].includes(a.status)) return 'var(--color-border)'
    return ACTION_PRIORITY_META[a.priority].color
  }

  // ── Status update drawer ──────────────────────────────────────────────────

  const StatusDrawer = ({ action }: { action: KaimahiAction }) => (
    <div
      className="px-4 py-4"
      style={{ backgroundColor: 'var(--color-ground)', borderTop: '1px solid var(--color-border)', borderLeft: `3px solid ${priorityStripe(action)}` }}
    >
      <p
        className="text-xs mb-3"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}
      >
        UPDATE STATUS
      </p>
      <div className="grid grid-cols-2 gap-px">
        {(Object.entries(ACTION_STATUS_META) as [KaimahiActionStatus, typeof ACTION_STATUS_META[KaimahiActionStatus]][]).map(([s, cfg]) => (
          <button
            key={s}
            onClick={() => updateStatus(action.id, s)}
            className="py-3 px-3 text-left text-xs transition-all min-h-[44px]"
            style={{
              backgroundColor: action.status === s ? cfg.bg : 'var(--color-surface)',
              color: action.status === s ? cfg.color : 'var(--color-ink-muted)',
              borderLeft: `3px solid ${action.status === s ? cfg.color : 'var(--color-border)'}`,
              fontFamily: 'var(--font-body)',
              fontWeight: action.status === s ? 500 : 400,
            }}
          >
            {cfg.label}
          </button>
        ))}
      </div>
      <button
        onClick={() => setUpdatingId(null)}
        className="mt-3 text-xs transition-opacity hover:opacity-70"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
      >
        Close
      </button>
    </div>
  )

  // ── Detail expand panel ──────────────────────────────────────────────────

  const DetailPanel = ({ action }: { action: KaimahiAction }) => {
    const sm = ACTION_STATUS_META[action.status]
    const pm = ACTION_PRIORITY_META[action.priority]
    return (
      <div
        style={{
          backgroundColor: 'var(--color-ground)',
          borderTop: '1px solid var(--color-border)',
          borderLeft: `3px solid ${priorityStripe(action)}`,
        }}
      >
        {/* Context strip */}
        <div className="px-4 pt-4 pb-3 space-y-2">
          {/* Linked pou + whānau */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <div style={{ width: 3, height: 14, backgroundColor: 'var(--color-ridge)' }} />
              <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>
                {action.pouReo}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div style={{ width: 3, height: 14, backgroundColor: 'var(--color-border-strong)' }} />
              <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                {action.whanauCode}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div style={{ width: 3, height: 14, backgroundColor: 'var(--color-border-strong)' }} />
              <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                {action.sessionRef} · {action.sessionDate}
              </span>
            </div>
          </div>

          {/* Status + priority + due */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="px-2 py-1 text-xs font-medium"
              style={{
                fontFamily: 'var(--font-mono)',
                backgroundColor: sm.bg,
                color: sm.color,
                letterSpacing: '0.04em',
              }}
            >
              {sm.label}
            </span>
            <span
              className="text-xs"
              style={{ fontFamily: 'var(--font-mono)', color: pm.color }}
            >
              {pm.label}
            </span>
            {action.dueDate && (
              <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                Due {action.dueDate}
              </span>
            )}
            {action.fromPrevSession && (
              <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                ↑ Carried forward
              </span>
            )}
          </div>

          {/* Notes */}
          {action.notes && (
            <p
              className="text-sm italic leading-relaxed pt-1"
              style={{
                fontFamily: 'var(--font-display)',
                color: 'var(--color-ink-secondary)',
                borderTop: '1px solid var(--color-border)',
                paddingTop: '0.75rem',
              }}
            >
              {action.notes}
            </p>
          )}
        </div>

        {/* Actions — update status or close */}
        <div
          className="flex gap-px px-4 pb-4"
          style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}
        >
          <button
            onClick={() => setUpdatingId(updatingId === action.id ? null : action.id)}
            className="flex-1 py-2.5 text-xs transition-all min-h-[40px]"
            style={{
              fontFamily: 'var(--font-mono)',
              backgroundColor: updatingId === action.id ? 'var(--color-ridge)' : 'var(--color-surface)',
              color: updatingId === action.id ? 'white' : 'var(--color-ink-secondary)',
              borderLeft: `3px solid ${updatingId === action.id ? 'transparent' : 'var(--color-border)'}`,
              letterSpacing: '0.04em',
            }}
          >
            Update status
          </button>
          {!['completed', 'closed'].includes(action.status) && (
            <button
              onClick={() => updateStatus(action.id, 'completed')}
              className="flex-1 py-2.5 text-xs transition-all ml-px min-h-[40px]"
              style={{
                fontFamily: 'var(--font-mono)',
                backgroundColor: 'var(--color-growth-light)',
                color: 'var(--color-growth)',
                borderLeft: '3px solid var(--color-growth)',
                letterSpacing: '0.04em',
              }}
            >
              Mark complete
            </button>
          )}
        </div>
        {updatingId === action.id && <StatusDrawer action={action} />}
      </div>
    )
  }

  // ── Action card ──────────────────────────────────────────────────────────

  const ActionCard = ({ action }: { action: KaimahiAction }) => {
    const isExpanded = expandedId === action.id
    const sm = ACTION_STATUS_META[action.status]
    const isDone = ['completed', 'closed'].includes(action.status)

    return (
      <div style={{ opacity: isDone ? 0.6 : 1 }}>
        <button
          onClick={() => setExpandedId(isExpanded ? null : action.id)}
          className="w-full text-left transition-all active:opacity-80"
        >
          <div className="flex items-stretch">
            {/* Priority stripe */}
            <div
              className="flex-shrink-0"
              style={{ width: 4, minHeight: 72, backgroundColor: priorityStripe(action) }}
            />
            {/* Card content */}
            <div
              className="flex-1 px-4 py-3.5 min-w-0"
              style={{ backgroundColor: 'var(--color-surface)' }}
            >
              {/* Carried badge */}
              {action.fromPrevSession && !isDone && (
                <p
                  className="text-xs mb-1.5"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                >
                  ↑ Carried forward
                </p>
              )}
              {/* Title */}
              <p
                className="text-sm font-medium leading-snug mb-2"
                style={{
                  fontFamily: 'var(--font-display)',
                  color: isDone ? 'var(--color-ink-muted)' : 'var(--color-ink)',
                  textDecoration: action.status === 'closed' ? 'line-through' : 'none',
                }}
              >
                {action.title}
              </p>
              {/* Meta row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-xs font-medium"
                  style={{ fontFamily: 'var(--font-mono)', color: sm.color }}
                >
                  {sm.label}
                </span>
                <span
                  className="text-xs"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}
                >
                  {action.pouReo}
                </span>
                <span
                  className="text-xs"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                >
                  {action.whanauCode}
                </span>
                {action.dueDate && (
                  <span
                    className="text-xs ml-auto"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                  >
                    {action.dueDate}
                  </span>
                )}
              </div>
            </div>
            {/* Expand indicator */}
            <div
              className="flex-shrink-0 flex items-center px-3"
              style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-ink-muted)' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
                {isExpanded ? '▲' : '▷'}
              </span>
            </div>
          </div>
        </button>
        {isExpanded && <DetailPanel action={action} />}
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────

  // Group active items by whānau code for context
  const whanauGroups = filter === 'active' || filter === 'urgent' || filter === 'carried'
    ? [...new Set(sorted.map((a) => a.whanauCode))]
    : null

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: 'var(--font-body)' }}>

      {/* Header */}
      <div className="px-5 pt-7 pb-4 flex-shrink-0">
        <h2
          className="text-xl font-medium mb-1"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
        >
          Ngā Mahi
        </h2>
        <p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
          What needs to be carried forward from the Whare
        </p>
      </div>

      {/* Filter bar */}
      <div
        className="flex-shrink-0 overflow-x-auto"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex px-5" style={{ minWidth: 'max-content' }}>
          {filterDefs.map((f) => {
            const count = f.count()
            const isActive = filter === f.id
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className="py-3 pr-5 flex items-center gap-1.5 min-h-[44px] transition-colors"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  color: isActive ? 'var(--color-ridge)' : 'var(--color-ink-muted)',
                  borderBottom: isActive ? '2px solid var(--color-ridge)' : '2px solid transparent',
                  marginBottom: -1,
                }}
              >
                {f.label}
                <span
                  className="text-xs px-1.5 py-0.5"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    backgroundColor: isActive && count > 0 ? 'var(--color-ridge)' : 'var(--color-surface-deep)',
                    color: isActive && count > 0 ? 'white' : 'var(--color-ink-muted)',
                    minWidth: 20,
                    textAlign: 'center',
                  }}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-6">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-8">
            <p
              className="text-sm italic text-center leading-relaxed"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
            >
              {filter === 'done'
                ? 'No completed or closed actions yet'
                : 'No actions in this view'}
            </p>
          </div>
        ) : whanauGroups ? (
          // Grouped by whānau — for active / urgent / carried views
          <div>
            {whanauGroups.map((code) => {
              const group = sorted.filter((a) => a.whanauCode === code)
              if (group.length === 0) return null
              return (
                <div key={code}>
                  {/* Whānau group header */}
                  <div
                    className="flex items-center gap-3 px-5 py-3 sticky top-0 z-10"
                    style={{ backgroundColor: 'var(--color-ground)', borderBottom: '1px solid var(--color-border)' }}
                  >
                    <div style={{ width: 3, height: 14, backgroundColor: 'var(--color-ridge)', flexShrink: 0 }} />
                    <p
                      className="text-xs font-medium"
                      style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-secondary)', letterSpacing: '0.06em' }}
                    >
                      {code}
                    </p>
                    <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                      {group.length} action{group.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="space-y-px">
                    {group.map((a) => <ActionCard key={a.id} action={a} />)}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          // Flat list — for waiting / done views
          <div className="space-y-px pt-px">
            {sorted.map((a) => <ActionCard key={a.id} action={a} />)}
          </div>
        )}

        {/* Done view note */}
        {filter === 'done' && sorted.length > 0 && (
          <div
            className="mx-5 mt-4 px-4 py-3"
            style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}
          >
            <p
              className="text-xs italic leading-relaxed"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
            >
              These actions have been completed or closed. They are kept here
              for your reference — they carry the work that was done.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// WHĀNAU REFLECTIONS SCREEN
// ─────────────────────────────────────────────────────────────────────────────

// ─── Extended whānau data ──────────────────────────────────────────────────────
// Supplementary record for richer prototype demo

const EXTENDED_WHANAU_RECORDS: WhanauRecord[] = [
  ...WHANAU_RECORDS,
  {
    id: 'w3',
    code: 'RK-02',
    kaimahiId: 'k1',
    kaimahiName: 'Aroha Ngāti',
    sessions: [
      {
        id: 's5',
        ref: 'W-2820',
        date: '18 Jul 2026',
        engagementType: 'office',
        sessionFocus: 'Safety planning and support network',
        synthesis: 'Demonstration record — an immediate safety concern was identified for reflection. Protective factors and possible follow-up are illustrative only; no notification or escalation delivery is represented.',
        pou: makePou({ haumaru: 'mataku', tuhono: 'āta', apiti: 'āta', pakiaka: 'āta', maia: 'tōtika', ara: 'āta' }),
        actions: [
          { id: 'a9', type: 'escalation', description: 'Immediate safety concern — demonstration record', pouId: 'haumaru', completed: true, sessionRef: 'W-2820', whanauCode: 'RK-02', date: '18 Jul 2026' },
          { id: 'a10', type: 'supervisor-review', description: 'Supervisor review consideration — demonstration record', pouId: 'haumaru', completed: true, sessionRef: 'W-2820', whanauCode: 'RK-02', date: '18 Jul 2026' },
        ],
        referralNames: ['Crisis Support Pathway', 'Lifeline Aotearoa'],
        flagged: true,
        supervisorReviewed: false,
        supervisorNotes: 'Demonstration note only. No notification or escalation delivery is represented here.',
        kaimahiId: 'k1',
        kaimahiName: 'Aroha Ngāti',
      },
      {
        id: 's6',
        ref: 'W-2826',
        date: '24 Jul 2026',
        engagementType: 'home-visit',
        sessionFocus: 'Follow-up — safety and stability',
        synthesis: 'Situation has stabilised following the previous session. Safety plan is being followed. Whānau member is reconnecting with sister and feels more grounded. Haumaru pou improving — watch status retained as ongoing monitoring is warranted. Kāinga remains under pressure but manageable.',
        pou: makePou({ haumaru: 'āta', tuhono: 'tōtika', apiti: 'āta', pakiaka: 'āta', maia: 'tōtika', ara: 'tōtika' }),
        actions: [
          { id: 'a11', type: 'carry-forward', description: 'Continue monitoring haumaru at next contact', pouId: 'haumaru', completed: false, sessionRef: 'W-2826', whanauCode: 'RK-02', date: '24 Jul 2026' },
        ],
        referralNames: [],
        flagged: false,
        supervisorReviewed: false,
        supervisorNotes: '',
        kaimahiId: 'k1',
        kaimahiName: 'Aroha Ngāti',
      },
    ],
  },
]

// ─── Whānau Reflections Screen ─────────────────────────────────────────────────

function WhanauReflectionsScreen() {
  const myWhanau = EXTENDED_WHANAU_RECORDS.filter((w) => w.kaimahiId === 'k1')

  type NavState =
    | { view: 'list' }
    | { view: 'whanau'; code: string }
    | { view: 'reflection'; code: string; sessionId: string }

  const [nav, setNav] = useState<NavState>({ view: 'list' })
  const [search, setSearch] = useState('')
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)

  const selectedWhanau = nav.view !== 'list'
    ? myWhanau.find((w) => w.code === (nav as { code: string }).code)
    : null

  const selectedSession = nav.view === 'reflection' && selectedWhanau
    ? selectedWhanau.sessions.find((s) => s.id === (nav as { sessionId: string }).sessionId)
    : null

  // ── Compact pou bar — 6 segments ──────────────────────────────────────────

  const PouBar = ({ pou }: { pou: Pou[] }) => (
    <div className="flex gap-px" style={{ height: 6 }}>
      {pou.map((p) => {
        const c = STATUS_CONFIG[p.status]
        return <div key={p.id} style={{ flex: 1, backgroundColor: c.color, opacity: p.status === 'kore' ? 0.15 : 1 }} />
      })}
    </div>
  )

  // Derive whānau-level concern from latest session
  const whanauConcernColor = (w: WhanauRecord) => {
    const latest = w.sessions.at(-1)
    if (!latest) return 'var(--color-border)'
    const statuses = latest.pou.map((p) => p.status)
    if (statuses.includes('mataku')) return 'var(--color-concern)'
    if (statuses.includes('āta'))    return 'var(--color-caution)'
    return 'var(--color-growth)'
  }

  const openActionCount = (w: WhanauRecord) =>
    w.sessions.flatMap((s) => s.actions).filter((a) => !a.completed).length

  const carriedCount = (w: WhanauRecord) =>
    w.sessions.flatMap((s) => s.actions).filter((a) => a.type === 'carry-forward' && !a.completed).length

  // ── Whānau list card ──────────────────────────────────────────────────────

  const WhanauCard = ({ w }: { w: WhanauRecord }) => {
    const latest = w.sessions.at(-1)
    const openActions = openActionCount(w)
    const carried = carriedCount(w)
    const borderColor = whanauConcernColor(w)
    return (
      <button
        onClick={() => setNav({ view: 'whanau', code: w.code })}
        className="w-full text-left transition-all active:opacity-75 min-h-[72px]"
      >
        <div className="flex items-stretch">
          <div className="flex-shrink-0" style={{ width: 4, backgroundColor: borderColor }} />
          <div className="flex-1 px-4 py-4" style={{ backgroundColor: 'var(--color-surface)' }}>
            {/* Top row */}
            <div className="flex items-start justify-between mb-2">
              <div>
                <p
                  className="font-medium text-base leading-snug"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
                >
                  {w.code}
                </p>
                <p className="text-xs mt-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                  {w.sessions.length} reflection{w.sessions.length !== 1 ? 's' : ''} ·{' '}
                  {latest ? latest.date : 'No sessions'}
                </p>
              </div>
              <div className="text-right">
                {openActions > 0 && (
                  <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-caution)' }}>
                    {openActions} open action{openActions !== 1 ? 's' : ''}
                  </p>
                )}
                {carried > 0 && (
                  <p className="text-xs mt-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                    {carried} carried forward
                  </p>
                )}
              </div>
            </div>
            {/* Pou bar */}
            {latest && <PouBar pou={latest.pou} />}
            {/* Focus */}
            {latest?.sessionFocus && (
              <p
                className="text-xs italic mt-2 leading-snug"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
              >
                {latest.sessionFocus}
              </p>
            )}
          </div>
          <div
            className="flex-shrink-0 flex items-center px-3"
            style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-ink-muted)' }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>▷</span>
          </div>
        </div>
      </button>
    )
  }

  // ── Reflection card (in whānau detail) ────────────────────────────────────

  const ReflectionCard = ({ s, w }: { s: HistoricalSession; w: WhanauRecord }) => {
    const isExpanded = expandedSessionId === s.id
    const concernPou = s.pou.filter((p) => p.status === 'mataku' || p.status === 'āta')
    const stablePou = s.pou.filter((p) => p.status === 'tōtika')
    const openActs = s.actions.filter((a) => !a.completed)
    const closedActs = s.actions.filter((a) => a.completed)

    return (
      <div style={{ borderBottom: '1px solid var(--color-border)' }}>
        {/* Card header — always visible */}
        <button
          onClick={() => setExpandedSessionId(isExpanded ? null : s.id)}
          className="w-full text-left transition-all active:opacity-80 min-h-[80px]"
        >
          <div className="flex items-stretch">
            <div
              className="flex-shrink-0"
              style={{
                width: 4,
                backgroundColor: s.flagged ? 'var(--color-concern)' : 'var(--color-border)',
              }}
            />
            <div className="flex-1 px-4 py-4" style={{ backgroundColor: 'var(--color-surface)' }}>
              {/* Ref + date */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <p
                    className="text-sm font-medium"
                    style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
                  >
                    {s.ref}
                  </p>
                  {s.flagged && (
                    <div style={{ width: 6, height: 6, backgroundColor: 'var(--color-concern)' }} />
                  )}
                  {s.supervisorReviewed && (
                    <span
                      className="text-xs"
                      style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)' }}
                    >
                      ✓ reviewed
                    </span>
                  )}
                </div>
                <span
                  className="text-xs"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                >
                  {s.date}
                </span>
              </div>
              {/* Engagement + focus */}
              <p
                className="text-xs mb-2.5"
                style={{ color: 'var(--color-ink-muted)' }}
              >
                <EngagementLabel type={s.engagementType} />
                {s.sessionFocus && (
                  <span className="italic" style={{ fontFamily: 'var(--font-display)' }}>
                    {' '}· {s.sessionFocus}
                  </span>
                )}
              </p>
              {/* Pou bar */}
              <PouBar pou={s.pou} />
              {/* Concern labels — compact */}
              {concernPou.length > 0 && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {concernPou.map((p) => {
                    const c = STATUS_CONFIG[p.status]
                    return (
                      <span
                        key={p.id}
                        className="text-xs"
                        style={{ fontFamily: 'var(--font-mono)', color: c.color }}
                      >
                        {p.reo}
                      </span>
                    )
                  })}
                </div>
              )}
              {/* Action badges */}
              {s.actions.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {s.actions.map((a) => <ActionBadge key={a.id} type={a.type} />)}
                </div>
              )}
            </div>
            <div
              className="flex-shrink-0 flex items-center px-3"
              style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-ink-muted)' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
                {isExpanded ? '▲' : '▷'}
              </span>
            </div>
          </div>
        </button>

        {/* Expanded detail */}
        {isExpanded && (
          <div
            style={{
              backgroundColor: 'var(--color-ground)',
              borderLeft: `3px solid ${s.flagged ? 'var(--color-concern)' : 'var(--color-border)'}`,
            }}
          >
            {/* Synthesis */}
            {s.synthesis && (
              <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <p
                  className="text-xs mb-2"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}
                >
                  HE WHAKAARO — SYNTHESIS
                </p>
                <p
                  className="text-sm italic leading-relaxed"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
                >
                  {s.synthesis}
                </p>
              </div>
            )}

            {/* Safety Pou detail */}
            <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <p
                className="text-xs mb-3"
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}
              >
                NGĀ POU HAUMARU
              </p>
              <div className="grid grid-cols-2 gap-px">
                {s.pou.map((p) => {
                  const c = STATUS_CONFIG[p.status]
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 px-3 py-2.5"
                      style={{ backgroundColor: c.light, borderLeft: `2px solid ${c.color}` }}
                    >
                      <p className="text-xs font-medium flex-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
                        {p.reo}
                      </p>
                      <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: c.color }}>
                        {c.label}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* What was held */}
            {(concernPou.length > 0 || stablePou.length > 0) && (
              <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                {concernPou.length > 0 && (
                  <div className="mb-3">
                    <p
                      className="text-xs mb-2"
                      style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-caution)', letterSpacing: '0.08em' }}
                    >
                      CONCERNS HELD
                    </p>
                    {concernPou.map((p) => {
                      const c = STATUS_CONFIG[p.status]
                      return (
                        <div key={p.id} className="flex items-start gap-2 py-1">
                          <div style={{ width: 3, height: 3, backgroundColor: c.color, flexShrink: 0, marginTop: 6 }} />
                          <p className="text-xs italic leading-relaxed" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                            {p.aiNote || `${p.reo} — flagged in this session`}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}
                {stablePou.length > 0 && (
                  <div>
                    <p
                      className="text-xs mb-2"
                      style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)', letterSpacing: '0.08em' }}
                    >
                      STABLE — DISCUSSED
                    </p>
                    <p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
                      {stablePou.map((p) => p.reo).join(', ')}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            {s.actions.length > 0 && (
              <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <p
                  className="text-xs mb-3"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}
                >
                  NGĀ MAHI — ACTIONS
                </p>
                <div className="space-y-1.5">
                  {s.actions.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-start gap-3 px-3 py-2.5"
                      style={{
                        backgroundColor: a.completed ? 'var(--color-surface)' : 'var(--color-ground)',
                        borderLeft: `2px solid ${a.completed ? 'var(--color-border)' : 'var(--color-caution)'}`,
                        opacity: a.completed ? 0.6 : 1,
                      }}
                    >
                      <ActionBadge type={a.type} />
                      <p
                        className="flex-1 text-xs leading-relaxed"
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontStyle: 'italic',
                          color: 'var(--color-ink-secondary)',
                          textDecoration: a.completed ? 'line-through' : 'none',
                        }}
                      >
                        {a.description}
                      </p>
                      {a.completed && (
                        <span className="text-xs flex-shrink-0" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)' }}>
                          ✓
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Referrals */}
            {s.referralNames.length > 0 && (
              <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <p
                  className="text-xs mb-2"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}
                >
                  NGĀ ARA TAUTOKO — REFERRALS
                </p>
                {s.referralNames.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 py-1">
                    <div style={{ width: 3, height: 3, backgroundColor: 'var(--color-growth)', flexShrink: 0 }} />
                    <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-secondary)' }}>
                      {r}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Supervisor notes */}
            {s.supervisorReviewed && s.supervisorNotes && (
              <div
                className="px-4 py-4"
                style={{ borderLeft: '3px solid var(--color-ridge)', backgroundColor: 'var(--color-ridge-light)' }}
              >
                <p
                  className="text-xs mb-2"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.08em' }}
                >
                  SUPERVISOR NOTES — {w.sessions.find((ss) => ss.id === s.id)?.kaimahiName ?? 'Hemi Parata'}
                </p>
                <p
                  className="text-sm italic leading-relaxed"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
                >
                  {s.supervisorNotes}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Whānau detail view ────────────────────────────────────────────────────

  const WhanauDetailView = ({ w }: { w: WhanauRecord }) => {
    const openActions = w.sessions.flatMap((s) => s.actions).filter((a) => !a.completed)
    const carried = openActions.filter((a) => a.type === 'carry-forward')
    const otherOpen = openActions.filter((a) => a.type !== 'carry-forward')
    const latestPou = w.sessions.at(-1)?.pou ?? []
    const borderColor = whanauConcernColor(w)

    return (
      <div className="flex flex-col h-full">
        {/* Back + header */}
        <div className="px-5 pt-5 pb-4 flex-shrink-0">
          <button
            onClick={() => { setNav({ view: 'list' }); setExpandedSessionId(null) }}
            className="text-xs mb-4 transition-opacity hover:opacity-70 active:opacity-50 min-h-[32px] flex items-center gap-1"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}
          >
            ← All whānau
          </button>
          <div className="flex items-start gap-3">
            <div style={{ width: 4, minHeight: 52, backgroundColor: borderColor, flexShrink: 0 }} />
            <div className="flex-1">
              <h2
                className="text-xl font-medium"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
              >
                {w.code}
              </h2>
              <p className="text-xs mt-1" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                {w.sessions.length} reflection{w.sessions.length !== 1 ? 's' : ''} · {w.kaimahiName}
              </p>
            </div>
          </div>
          {/* Latest pou bar */}
          {latestPou.length > 0 && (
            <div className="mt-4">
              <p className="text-xs mb-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.06em' }}>
                MOST RECENT SESSION — POU STATUS
              </p>
              <div className="flex gap-px mb-1.5" style={{ height: 8 }}>
                {latestPou.map((p) => {
                  const c = STATUS_CONFIG[p.status]
                  return <div key={p.id} style={{ flex: 1, backgroundColor: c.color }} />
                })}
              </div>
              <div className="flex gap-px">
                {latestPou.map((p) => {
                  const c = STATUS_CONFIG[p.status]
                  return (
                    <div key={p.id} style={{ flex: 1 }}>
                      <p className="text-xs text-center" style={{ fontFamily: 'var(--font-mono)', color: c.color, fontSize: '0.6rem' }}>
                        {p.reo.slice(0, 3)}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* What is still being held */}
        {(carried.length > 0 || otherOpen.length > 0) && (
          <div
            className="mx-5 mb-4 flex-shrink-0"
            style={{ backgroundColor: 'var(--color-surface)', borderLeft: `3px solid ${carried.length > 0 ? 'var(--color-border-strong)' : 'var(--color-caution)'}` }}
          >
            <div className="px-4 pt-3 pb-1">
              <p
                className="text-xs"
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}
              >
                STILL BEING HELD
              </p>
            </div>
            {carried.length > 0 && (
              <div className="px-4 pb-2">
                <p className="text-xs mb-1.5 mt-1" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                  Carried forward
                </p>
                {carried.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 py-1">
                    <div style={{ width: 3, height: 3, backgroundColor: 'var(--color-border-strong)', flexShrink: 0, marginTop: 5 }} />
                    <p className="text-xs italic leading-snug" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                      {a.description}
                      <span className="not-italic" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', marginLeft: 6 }}>
                        {a.sessionRef}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            )}
            {otherOpen.length > 0 && (
              <div className="px-4 pb-3" style={{ borderTop: carried.length > 0 ? '1px solid var(--color-border)' : 'none', paddingTop: carried.length > 0 ? '0.5rem' : 0 }}>
                <p className="text-xs mb-1.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-caution)' }}>
                  Open actions
                </p>
                {otherOpen.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 py-1">
                    <ActionBadge type={a.type} />
                    <p className="text-xs italic leading-snug" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                      {a.description}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex-shrink-0 px-5 mb-3">
          <p
            className="text-xs italic"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
          >
            Reflections — newest first
          </p>
        </div>

        {/* Reflection cards */}
        <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-px">
          {[...w.sessions].reverse().map((s) => (
            <ReflectionCard key={s.id} s={s} w={w} />
          ))}
        </div>
      </div>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────

  if (nav.view === 'whanau' && selectedWhanau) {
    return (
      <div className="flex flex-col h-full" style={{ fontFamily: 'var(--font-body)' }}>
        <WhanauDetailView w={selectedWhanau} />
      </div>
    )
  }

  // List view
  const filteredWhanau = myWhanau.filter((w) =>
    w.code.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: 'var(--font-body)' }}>
      {/* Header */}
      <div className="px-5 pt-7 pb-4 flex-shrink-0">
        <h2
          className="text-xl font-medium mb-1"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
        >
          Ngā Kōrero Whānau
        </h2>
        <p
          className="text-sm italic"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
        >
          A respectful memory of previous reflections
        </p>
      </div>

      {/* Search */}
      <div className="px-5 mb-4 flex-shrink-0">
        <div
          className="flex items-center gap-3 px-3 py-2.5"
          style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--color-ink-muted)' }}>
            ⌕
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search whānau code…"
            className="flex-1 text-sm outline-none"
            style={{
              fontFamily: 'var(--font-mono)',
              backgroundColor: 'transparent',
              color: 'var(--color-ink)',
              border: 'none',
              caretColor: 'var(--color-ridge)',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-xs transition-opacity hover:opacity-70"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Contextual summary — no KPI tiles */}
      {(() => {
        const totalOpen = myWhanau.reduce((n, w) => n + openActionCount(w), 0)
        const totalCarried = myWhanau.reduce((n, w) => n + carriedCount(w), 0)
        return (
          <div className="px-5 mb-4 flex-shrink-0">
            <p className="text-xs italic leading-relaxed" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
              {myWhanau.length} whānau held
              {totalOpen > 0 ? ` · ${totalOpen} open action${totalOpen !== 1 ? 's' : ''}` : ''}
              {totalCarried > 0 ? ` · ${totalCarried} carried forward` : ''}
            </p>
          </div>
        )
      })()}

      {/* Whānau list */}
      <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-px">
        {filteredWhanau.length === 0 && (
          <p
            className="text-sm italic py-8 text-center"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
          >
            No whānau matching "{search}"
          </p>
        )}
        {filteredWhanau.map((w) => <WhanauCard key={w.id} w={w} />)}
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// KAIMAHI APP ROOT
// ─────────────────────────────────────────────────────────────────────────────

function CompletedRecordsScreen({
  records,
  onOpen,
}: {
  records: CompletedWorkflowListItem[]
  onOpen: (workflowId: string) => void
}) {
  return (
    <div className="flex flex-col h-full" style={{ fontFamily: 'var(--font-body)' }}>
      <div className="px-5 pt-7 pb-4 flex-shrink-0">
        <h2 className="text-xl font-medium mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>Ngā Tohu</h2>
        <p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>Completed records saved in Te Kaupapa</p>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-1.5">
        {records.length === 0 && <p className="text-sm italic py-8 text-center" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>No completed records yet.</p>}
        {records.map((record) => <button key={record.id} onClick={() => onOpen(record.id)} className="w-full text-left py-3.5 px-3" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}><p className="font-medium text-sm" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>{record.reference}</p><p className="text-xs mt-1" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>{record.whanauReference ?? 'No whānau reference'} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.completedAt))}</p></button>)}
      </div>
    </div>
  )
}

export default function KaimahiApp({ onBack, profile }: { onBack: () => void; profile: AuthProfile }) {
  const [tab, setTab] = useState<KaimahiTab>('home')
  const [moreOpen, setMoreOpen] = useState(false)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [completedRecords, setCompletedRecords] = useState<CompletedWorkflowListItem[]>([])
  const [startPersistenceState, setStartPersistenceState] = useState<WorkflowPersistenceState>('idle')
  const pendingStartKey = useRef<string | null>(null)
  const startedAttempt = useRef(false)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [resumable] = await listResumableWorkflows()
        if (!resumable) return
        const current = await getWorkflow(resumable.id)
        if (active) setWorkflow(current)
      } catch {
        // The existing session remains usable; persistence feedback appears only when a workflow action is attempted.
      }
    })()
    return () => { active = false }
  }, [])

  const refreshCompletedRecords = async () => {
    try {
      setCompletedRecords(await listCompletedWorkflows())
    } catch {
      // The record archive remains empty until the authoritative list can be loaded.
    }
  }

  useEffect(() => { void refreshCompletedRecords() }, [])

  const beginOrResumeSession = async () => {
    if (workflow) {
      setSessionOpen(true)
      return
    }
    const retrying = startedAttempt.current
    startedAttempt.current = true
    const idempotencyKey = pendingStartKey.current ?? crypto.randomUUID()
    pendingStartKey.current = idempotencyKey
    setStartPersistenceState(retrying ? 'retrying' : 'saving')
    try {
      const result = await createWorkflow(idempotencyKey)
      pendingStartKey.current = null
      setWorkflow(result.workflow)
      setStartPersistenceState('saved')
      setSessionOpen(true)
    } catch (error) {
      if (error instanceof WorkflowApiError && error.code === 'active_workflow_exists') {
        try {
          const [resumable] = await listResumableWorkflows()
          if (resumable) {
            const current = await getWorkflow(resumable.id)
            pendingStartKey.current = null
            setWorkflow(current)
            setStartPersistenceState('saved')
            setSessionOpen(true)
            return
          }
        } catch {
          // Preserve the original failure state below.
        }
      }
      setStartPersistenceState('failed')
    }
  }

  const handleTab = (t: KaimahiTab) => {
    setTab(t)
    setMoreOpen(false)
  }

  const handleMoreSelect = (t: SecondaryTab) => {
    setTab(t)
    setMoreOpen(false)
  }

  // Session overlays the whole app
  if (sessionOpen && workflow) {
    return (
      <SessionShell
        displayName={profile.displayName}
        workflow={workflow}
        onWorkflowChange={setWorkflow}
        onDone={() => {
          setSessionOpen(false)
          if (workflow.status === 'completed') {
            setWorkflow(null)
            void refreshCompletedRecords()
          }
          setTab('home')
        }}
      />
    )
  }

  const renderContent = () => {
    switch (tab) {
      case 'home':             return <HomeScreen onBeginSession={() => { void beginOrResumeSession() }} sessionActive={Boolean(workflow)} sessionRef={workflow?.reference ?? ''} sessionStage={(workflow?.currentStage ?? 'pou-overview') as SessionStageKey} displayName={profile.displayName} persistenceState={startPersistenceState} />
      case 'actions':          return <MyActionsScreen />
      case 'reflections':      return <WhanauReflectionsScreen />
      case 'referrals-browse': return <ReferralsBrowseScreen />
      case 'synthesis-archive':return <SynthesisArchiveScreen />
      case 'record-archive':   return <CompletedRecordsScreen records={completedRecords} onOpen={(workflowId) => { void getWorkflow(workflowId).then((completed) => { setWorkflow(completed); setSessionOpen(true) }) }} />
      case 'settings':         return <SettingsScreen profile={profile} />
      default:                 return <HomeScreen onBeginSession={() => { void beginOrResumeSession() }} sessionActive={Boolean(workflow)} sessionRef={workflow?.reference ?? ''} sessionStage={(workflow?.currentStage ?? 'pou-overview') as SessionStageKey} displayName={profile.displayName} persistenceState={startPersistenceState} />
    }
  }

  return (
    <WhareShell>
      {/* App ridge */}
      <div className="h-1 w-full flex-shrink-0" style={{ backgroundColor: 'var(--color-ridge)' }} />

      {/* Content area */}
      <div className="flex-1 overflow-y-auto" style={{ maxWidth: 430, margin: '0 auto', width: '100%' }}>
        {renderContent()}
      </div>

      {/* More panel — slides above bottom nav */}
      {moreOpen && (
        <MorePanel active={tab} onSelect={handleMoreSelect} />
      )}

      {/* Bottom navigation — the paepae */}
      <BottomNav
        active={tab}
        moreOpen={moreOpen}
        sessionActive={Boolean(workflow)}
        onTab={handleTab}
        onSession={() => { void beginOrResumeSession() }}
        onMore={() => setMoreOpen(!moreOpen)}
      />
    </WhareShell>
  )
}
