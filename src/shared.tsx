import type { Pou, PouStatus, KaimahiNavTab, SessionStage, ActionType } from './types'
import { STATUS_CONFIG } from './data'

// ─── Ridge line ───────────────────────────────────────────────────────────────

export function RidgeLine() {
  return (
    <div className="w-full flex items-center gap-3">
      <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border-strong)' }} />
      <div className="w-1.5 h-1.5 rotate-45" style={{ backgroundColor: 'var(--color-ridge)' }} />
      <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border-strong)' }} />
    </div>
  )
}

// ─── Pou dots and strips ──────────────────────────────────────────────────────

export function PouDot({ status, size = 8 }: { status: PouStatus; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundColor: STATUS_CONFIG[status].color,
        opacity: status === 'kore' ? 0.2 : 1,
        flexShrink: 0,
      }}
    />
  )
}

export function PouStrip({ pou, compact }: { pou: Pou[]; compact?: boolean }) {
  return (
    <div className="flex items-end" style={{ gap: compact ? 1 : 2 }}>
      {pou.map((p) => {
        const c = STATUS_CONFIG[p.status]
        return (
          <div
            key={p.id}
            title={`${p.reo} — ${c.label}`}
            style={{
              width: compact ? 10 : 14,
              height: compact ? 18 : 26,
              backgroundColor: c.color,
              opacity: p.status === 'kore' ? 0.15 : p.status === 'tōtika' ? 0.55 : 0.9,
              flexShrink: 0,
            }}
          />
        )
      })}
    </div>
  )
}

// ─── Badges ───────────────────────────────────────────────────────────────────

export function ActionBadge({ type }: { type: ActionType }) {
  const config = {
    referral: { label: 'Referral', bg: 'var(--color-growth)', color: 'white' },
    'supervisor-review': { label: 'Supervisor Review', bg: 'var(--color-ridge)', color: 'white' },
    escalation: { label: 'Escalation', bg: 'var(--color-concern)', color: 'white' },
    'carry-forward': { label: 'Carry Forward', bg: 'var(--color-surface-deep)', color: 'var(--color-ink-secondary)' },
  }[type]
  return (
    <span
      className="inline-block text-xs px-2 py-0.5 leading-relaxed"
      style={{ fontFamily: 'var(--font-mono)', backgroundColor: config.bg, color: config.color }}
    >
      {config.label}
    </span>
  )
}

export function StatusBadge({ status }: { status: PouStatus }) {
  const c = STATUS_CONFIG[status]
  return (
    <span
      className="inline-block text-xs px-2 py-0.5"
      style={{ fontFamily: 'var(--font-mono)', backgroundColor: c.light, color: c.color }}
    >
      {c.label}
    </span>
  )
}

// ─── Session progress header ──────────────────────────────────────────────────

const SESSION_STAGES: SessionStage[] = ['setup', 'guided', 'pou', 'risks', 'referrals', 'synthesis', 'record']

const STAGE_LABELS: Partial<Record<SessionStage, string>> = {
  setup: 'Tomokia',
  guided: 'Kōrero',
  pou: 'Ngā Pou',
  risks: 'Tūraru',
  referrals: 'Ara',
  synthesis: 'Whakaaro',
  record: 'Tohu',
}

export function SessionProgressHeader({
  stage,
  onBack,
  sessionRef,
}: {
  stage: SessionStage
  onBack: () => void
  sessionRef: string
}) {
  const stageIdx = SESSION_STAGES.indexOf(stage)

  return (
    <div
      style={{ backgroundColor: 'var(--color-ground)', borderBottom: '1px solid var(--color-border)' }}
    >
      <div className="h-0.5 w-full" style={{ backgroundColor: 'var(--color-ridge)' }} />
      <div className="flex items-center justify-between px-4 py-2.5">
        <button
          onClick={onBack}
          className="text-xs transition-opacity hover:opacity-60 active:opacity-40"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
        >
          ← Hoki
        </button>
        <span
          className="text-xs tracking-wider"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}
        >
          {stage !== 'complete' ? STAGE_LABELS[stage] : ''}
        </span>
        <span
          className="text-xs"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
        >
          {sessionRef}
        </span>
      </div>
      {stage !== 'complete' && stageIdx >= 0 && (
        <div className="flex gap-0.5 px-4 pb-2">
          {SESSION_STAGES.map((s, i) => (
            <div
              key={s}
              className="flex-1 h-0.5 transition-colors"
              style={{
                backgroundColor:
                  i < stageIdx
                    ? 'var(--color-growth)'
                    : i === stageIdx
                      ? 'var(--color-ridge)'
                      : 'var(--color-border-strong)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Kaimahi bottom nav ───────────────────────────────────────────────────────

export function KaimahiBottomNav({
  active,
  onChange,
  onSession,
}: {
  active: KaimahiNavTab
  onChange: (tab: KaimahiNavTab) => void
  onSession: () => void
}) {
  const leftTabs: { id: KaimahiNavTab; label: string }[] = [
    { id: 'home', label: 'Kāinga' },
    { id: 'actions', label: 'Mahi' },
  ]
  const rightTabs: { id: KaimahiNavTab; label: string }[] = [
    { id: 'reflections', label: 'Kōrero' },
    { id: 'settings', label: 'Tautuhinga' },
  ]

  const tabStyle = (isActive: boolean) => ({
    color: isActive ? 'var(--color-ridge)' : 'var(--color-ink-muted)',
    fontFamily: 'var(--font-mono)' as const,
  })

  return (
    <div
      className="flex items-end"
      style={{
        backgroundColor: 'var(--color-ground)',
        borderTop: '1px solid var(--color-border-strong)',
      }}
    >
      {leftTabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className="flex-1 flex flex-col items-center pt-3 pb-4 gap-1.5 transition-opacity"
        >
          <div
            className="h-0.5 w-5 transition-colors"
            style={{ backgroundColor: active === t.id ? 'var(--color-ridge)' : 'var(--color-border-strong)' }}
          />
          <span className="text-xs" style={tabStyle(active === t.id)}>
            {t.label}
          </span>
        </button>
      ))}

      {/* Centre session button */}
      <div className="flex-shrink-0 flex flex-col items-center pb-4 px-3 pt-1">
        <button
          onClick={onSession}
          className="flex flex-col items-center justify-center transition-all hover:opacity-90 active:scale-95"
          style={{
            width: 52,
            height: 52,
            backgroundColor: 'var(--color-ridge)',
          }}
        >
          <div className="w-5 h-px bg-white mb-1" />
          <span
            className="text-white"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em' }}
          >
            TĪMATA
          </span>
        </button>
      </div>

      {rightTabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className="flex-1 flex flex-col items-center pt-3 pb-4 gap-1.5 transition-opacity"
        >
          <div
            className="h-0.5 w-5 transition-colors"
            style={{ backgroundColor: active === t.id ? 'var(--color-ridge)' : 'var(--color-border-strong)' }}
          />
          <span className="text-xs" style={tabStyle(active === t.id)}>
            {t.label}
          </span>
        </button>
      ))}
    </div>
  )
}

// ─── Structural panel ─────────────────────────────────────────────────────────

export function StructuralPanel({
  color,
  children,
  className,
}: {
  color?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={className}
      style={{
        borderLeft: `3px solid ${color ?? 'var(--color-border-strong)'}`,
        backgroundColor: 'var(--color-surface)',
        padding: '0.875rem 1rem',
      }}
    >
      {children}
    </div>
  )
}

// ─── Engagement label ─────────────────────────────────────────────────────────

export function EngagementLabel({ type }: { type: string }) {
  const labels: Record<string, string> = {
    'home-visit': 'Home visit',
    phone: 'Phone',
    office: 'Office',
    hui: 'Hui',
    outreach: 'Outreach',
  }
  return <>{labels[type] ?? type}</>
}

// ─── Section heading ──────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div style={{ width: 3, height: 10, backgroundColor: 'var(--color-ridge)', opacity: 0.35, flexShrink: 0 }} />
      <p
        className="text-xs tracking-wider uppercase"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.1em' }}
      >
        {children}
      </p>
    </div>
  )
}
