import { useState } from 'react'
import type {
  KaimahiRecord,
  WhanauRecord,
  HistoricalSession,
  SupervisorView,
  PouStatus,
  Pou,
} from './types'
import {
  STATUS_CONFIG,
  KAIMAHI_RECORDS,
  WHANAU_RECORDS,
  getLatestSession,
  getLatestPouStatus,
  getAllSessions,
} from './data'
import {
  ActionBadge,
  StatusBadge,
  SectionLabel,
  EngagementLabel,
} from './shared'

// ─── Constants ────────────────────────────────────────────────────────────────

const POU_ORDER = ['whakapapa', 'manaakitanga', 'tikanga', 'kaitiakitanga', 'puukenga', 'haepapa', 'oranga'] as const

// Full Te Waharoa Pou definitions — matches KaimahiApp POU_EXTENDED order
const POU_FULL_META = [
  { id: 'whakapapa',     reo: 'Whakapapa',    en: 'Identity Safety',        full: 'Whakapapa & Identity Safety',         domain: 'Identity, whakapapa, whānau voice, cultural protective factors' },
  { id: 'manaakitanga',  reo: 'Manaakitanga', en: 'Duty of Care',           full: 'Manaakitanga & Duty of Care',         domain: 'Respectful communication, responsiveness to distress, escalation' },
  { id: 'tikanga',       reo: 'Tikanga',       en: 'Ethical Practice',       full: 'Tikanga & Ethical Practice',          domain: 'Consent, confidentiality, ethical decision-making, tikanga' },
  { id: 'kaitiakitanga', reo: 'Kaitiakitanga',en: 'Risk Management',        full: 'Kaitiakitanga & Risk Management',     domain: 'Risk assessment, safety planning, escalations, cultural safety' },
  { id: 'puukenga',      reo: 'Pūkenga',       en: 'Practitioner Capability',full: 'Pūkenga & Practitioner Capability',  domain: 'Training, supervision, reflective practice, scope of practice' },
  { id: 'haepapa',       reo: 'Haepapa',       en: 'Accountability',         full: 'Haepapa & Accountability',            domain: 'Timely notes, reporting obligations, follow-through, transparency' },
  { id: 'oranga',        reo: 'Oranga',        en: 'Protective Factors',     full: 'Oranga & Protective Factors',         domain: 'Whānau strengths, cultural engagement, wellbeing, mana restoration' },
]

// Cell display status — richer than PouStatus alone
type CellStatus = 'up-to-date' | 'needs-followup' | 'action-needed' | 'urgent' | 'not-discussed'

const CELL_STATUS_META: Record<CellStatus, { label: string; color: string; bg: string; border: string }> = {
  'up-to-date':    { label: 'Up to date',        color: 'var(--color-growth)',   bg: 'var(--color-growth-light)',  border: 'var(--color-growth)'          },
  'needs-followup':{ label: 'Needs follow-up',   color: 'var(--color-caution)',  bg: 'var(--color-caution-light)', border: 'var(--color-caution)'         },
  'action-needed': { label: 'Action needed',     color: 'var(--color-concern)',  bg: 'var(--color-concern-light)', border: 'var(--color-concern)'         },
  'urgent':        { label: 'Urgent escalation', color: 'var(--color-concern)',  bg: 'var(--color-concern-light)', border: 'var(--color-concern)'         },
  'not-discussed': { label: 'Not discussed',     color: 'var(--color-ink-muted)', bg: 'var(--color-surface)',      border: 'var(--color-border)'          },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCellStatus(whanau: WhanauRecord, pouId: string): CellStatus {
  const status = getLatestPouStatus(whanau, pouId)
  const latest = getLatestSession(whanau)
  if (status === 'kore') return 'not-discussed'
  if (status === 'tōtika') return 'up-to-date'
  if (status === 'āta') return 'needs-followup'
  if (status === 'mataku') return latest?.flagged ? 'urgent' : 'action-needed'
  return 'not-discussed'
}

function getLastDiscussedDate(whanau: WhanauRecord, pouId: string): string | null {
  const sessions = [...whanau.sessions].reverse()
  for (const session of sessions) {
    const pou = session.pou.find((p) => p.id === pouId)
    if (pou && pou.discussed) return session.date
  }
  return null
}

function worstStatus(whanau: WhanauRecord): CellStatus {
  const statuses = POU_ORDER.map((id) => getCellStatus(whanau, id))
  if (statuses.includes('urgent')) return 'urgent'
  if (statuses.includes('action-needed')) return 'action-needed'
  if (statuses.includes('needs-followup')) return 'needs-followup'
  if (statuses.includes('up-to-date')) return 'up-to-date'
  return 'not-discussed'
}

function kaimahiWorstStatus(k: KaimahiRecord): CellStatus {
  const statuses = k.whanau.map(worstStatus)
  if (statuses.includes('urgent')) return 'urgent'
  if (statuses.includes('action-needed')) return 'action-needed'
  if (statuses.includes('needs-followup')) return 'needs-followup'
  if (statuses.includes('up-to-date')) return 'up-to-date'
  return 'not-discussed'
}

// ─── Nav state ────────────────────────────────────────────────────────────────

interface NavState {
  view: SupervisorView
  sessionId: string | null
}

interface SelectedCell {
  whanauId: string
  pouId: string
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function SupervisorSidebar({
  nav,
  onNav,
  onBack,
  pendingReviews,
}: {
  nav: NavState
  onNav: (patch: Partial<NavState>) => void
  onBack: () => void
  pendingReviews: number
}) {
  const navItems: { view: SupervisorView; reo: string; en: string }[] = [
    { view: 'overview',   reo: 'Tirohanga',  en: 'Overview'     },
    { view: 'pou-matrix', reo: 'Ngā Pou',    en: 'Te Waharoa'   },
  ]

  return (
    <div
      className="flex flex-col h-full flex-shrink-0"
      style={{ width: 228, borderRight: '1px solid var(--color-border-strong)', backgroundColor: 'var(--color-surface)' }}
    >
      {/* Logotype */}
      <div className="px-6 pt-7 pb-6" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <button onClick={onBack} className="block transition-opacity hover:opacity-70">
          <p
            className="text-xs tracking-widest uppercase mb-2"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}
          >
            Te Kaupapa AI
          </p>
          <p
            className="text-2xl font-medium leading-none italic mb-1"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
          >
            Mātāmua
          </p>
          <p
            className="text-xs"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
          >
            Supervisor view
          </p>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-5 space-y-px">
        {navItems.map((item) => {
          const isActive = nav.view === item.view || (item.view === 'pou-matrix' && nav.view === 'pou-drilldown')
          return (
            <button
              key={item.view}
              onClick={() => onNav({ view: item.view, sessionId: null })}
              className="w-full text-left px-6 py-4 transition-all hover:opacity-80 flex items-center justify-between"
              style={{
                backgroundColor: isActive ? 'var(--color-ground)' : 'transparent',
                borderLeft: isActive ? '3px solid var(--color-ridge)' : '3px solid transparent',
              }}
            >
              <div>
                <p className="text-sm font-medium" style={{ color: isActive ? 'var(--color-ink)' : 'var(--color-ink-secondary)' }}>
                  {item.reo}
                </p>
                <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                  {item.en}
                </p>
              </div>
              {item.view === 'overview' && pendingReviews > 0 && (
                <span
                  className="text-xs px-1.5 py-0.5"
                  style={{ fontFamily: 'var(--font-mono)', backgroundColor: 'var(--color-concern)', color: 'white', minWidth: 20, textAlign: 'center' }}
                >
                  {pendingReviews}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Pou legend */}
      <div className="px-6 py-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        <p className="text-xs mb-3" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}>
          POU STATUS
        </p>
        <div className="space-y-2">
          {(Object.entries(CELL_STATUS_META) as [CellStatus, typeof CELL_STATUS_META[CellStatus]][]).map(([s, cfg]) => (
            <div key={s} className="flex items-center gap-2">
              <div style={{ width: 3, height: 12, backgroundColor: cfg.color, flexShrink: 0 }} />
              <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', lineHeight: 1.3 }}>
                {cfg.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Supervisor profile */}
      <div className="px-6 py-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        <p className="text-sm font-medium" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
          Hemi Parata
        </p>
        <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
          Kaiwhakahaere · Programme Supervisor
        </p>
      </div>
    </div>
  )
}

// ─── Overview Screen ──────────────────────────────────────────────────────────

function OverviewScreen({ onNav }: { onNav: (patch: Partial<NavState>) => void }) {
  const allSessions = getAllSessions()
  const pendingReview = allSessions.filter((s) => s.flagged && !s.supervisorReviewed)
  const recentSessions = [...allSessions].sort((a, b) => b.ref.localeCompare(a.ref)).slice(0, 6)

  // Team-level pou health — count statuses per pou across all latest sessions
  const teamPouHealth = POU_FULL_META.map((meta) => {
    const statuses = WHANAU_RECORDS.map((w) => getCellStatus(w, meta.id))
    return {
      ...meta,
      urgent: statuses.filter((s) => s === 'urgent').length,
      actionNeeded: statuses.filter((s) => s === 'action-needed').length,
      needsFollowup: statuses.filter((s) => s === 'needs-followup').length,
      upToDate: statuses.filter((s) => s === 'up-to-date').length,
      notDiscussed: statuses.filter((s) => s === 'not-discussed').length,
    }
  })

  const teamStatus: CellStatus = teamPouHealth.some((p) => p.urgent > 0)
    ? 'urgent'
    : teamPouHealth.some((p) => p.actionNeeded > 0)
    ? 'action-needed'
    : teamPouHealth.some((p) => p.needsFollowup > 0)
    ? 'needs-followup'
    : 'up-to-date'

  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ fontFamily: 'var(--font-body)' }}
    >
      <div className="max-w-3xl px-10 pt-10 pb-16">

        {/* Greeting */}
        <div className="mb-10">
          <p
            className="text-xs tracking-widest uppercase mb-3"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.14em' }}
          >
            Wenerei, 6 Ākuhata 2026
          </p>
          <h1
            className="text-3xl font-medium italic mb-2"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
          >
            Ata mārie, Hemi
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-ink-secondary)' }}>
            {KAIMAHI_RECORDS.length} kaimahi · {WHANAU_RECORDS.length} whānau across the team ·{' '}
            <span style={{ color: pendingReview.length > 0 ? 'var(--color-concern)' : 'var(--color-growth)' }}>
              {pendingReview.length > 0
                ? `${pendingReview.length} session${pendingReview.length !== 1 ? 's' : ''} awaiting your review`
                : 'No reviews outstanding'}
            </span>
          </p>
        </div>

        {/* Paepae */}
        <div style={{ height: 1, backgroundColor: 'var(--color-border-strong)', marginBottom: 40 }} />

        {/* Te Waharoa Pou — team health view */}
        <div className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <SectionLabel>Ngā Pou o Te Waharoa — across the team</SectionLabel>
            <p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
              {WHANAU_RECORDS.length} whānau · most recent session per pou
            </p>
          </div>
          {/* Six pou — two rows of three, status-colored left border */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
            {teamPouHealth.map((meta) => {
              const worst: CellStatus = meta.urgent > 0 ? 'urgent'
                : meta.actionNeeded > 0 ? 'action-needed'
                : meta.needsFollowup > 0 ? 'needs-followup'
                : meta.upToDate > 0 ? 'up-to-date'
                : 'not-discussed'
              const cfg = CELL_STATUS_META[worst]
              // Per-whānau dots for this pou
              const whanauStatuses = WHANAU_RECORDS.map((w) => getCellStatus(w, meta.id))
              return (
                <div
                  key={meta.id}
                  className="flex flex-col px-4 py-4"
                  style={{
                    backgroundColor: cfg.bg,
                    borderLeft: `4px solid ${cfg.color}`,
                  }}
                >
                  {/* Pou identity */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-medium" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
                        {meta.reo}
                      </p>
                      <p className="text-xs mt-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', fontSize: '0.6rem' }}>
                        {meta.en}
                      </p>
                    </div>
                    {/* Worst-status marker */}
                    <div style={{ width: 8, height: 8, backgroundColor: cfg.color, flexShrink: 0, marginTop: 4 }} />
                  </div>
                  {/* Per-whānau status dots — each dot = one whānau's pou status */}
                  <div className="flex gap-1 flex-wrap">
                    {whanauStatuses.map((s, i) => (
                      <div
                        key={i}
                        title={WHANAU_RECORDS[i].code}
                        style={{
                          width: 10,
                          height: 10,
                          backgroundColor: CELL_STATUS_META[s].color,
                          opacity: s === 'not-discussed' ? 0.18 : 0.88,
                        }}
                      />
                    ))}
                  </div>
                  {/* Status summary text */}
                  <p
                    className="text-xs mt-2"
                    style={{ fontFamily: 'var(--font-mono)', color: cfg.color }}
                  >
                    {worst === 'up-to-date' ? 'All stable'
                      : worst === 'not-discussed' ? 'Not yet discussed'
                      : cfg.label}
                    {(meta.urgent + meta.actionNeeded + meta.needsFollowup) > 0 && (
                      <span style={{ color: 'var(--color-ink-muted)' }}>
                        {' '}· {meta.urgent + meta.actionNeeded + meta.needsFollowup}/{WHANAU_RECORDS.length}
                      </span>
                    )}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Pending review */}
        {pendingReview.length > 0 && (
          <div className="mb-10">
            <SectionLabel>Awaiting your review</SectionLabel>
            <div className="mt-3 space-y-px">
              {pendingReview.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onNav({ view: 'session-review', sessionId: s.id })}
                  className="w-full text-left transition-all hover:opacity-85"
                >
                  <div className="flex items-stretch">
                    <div style={{ width: 4, backgroundColor: 'var(--color-concern)' }} />
                    <div
                      className="flex-1 px-4 py-4"
                      style={{ backgroundColor: 'var(--color-concern-light)' }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p
                            className="font-medium"
                            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
                          >
                            {s.ref}
                          </p>
                          <p className="text-xs mt-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                            {s.kaimahiName} · {s.date} · <EngagementLabel type={s.engagementType} />
                          </p>
                        </div>
                        <span
                          className="text-xs px-2 py-0.5 flex-shrink-0"
                          style={{ fontFamily: 'var(--font-mono)', backgroundColor: 'var(--color-concern)', color: 'white' }}
                        >
                          Awaiting review
                        </span>
                      </div>
                      <p
                        className="text-sm italic leading-relaxed"
                        style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
                      >
                        "{s.synthesis.slice(0, 140)}…"
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recent sessions */}
        <div>
          <SectionLabel>Recent sessions — across kaimahi</SectionLabel>
          <div className="mt-3 space-y-px">
            {recentSessions.map((s) => (
              <button
                key={s.id}
                onClick={() => onNav({ view: 'session-review', sessionId: s.id })}
                className="w-full text-left transition-all hover:opacity-85"
              >
                <div className="flex items-stretch">
                  <div
                    style={{
                      width: 4,
                      backgroundColor: s.flagged ? 'var(--color-concern)' : 'var(--color-border)',
                    }}
                  />
                  <div
                    className="flex-1 flex items-center gap-4 px-4 py-3"
                    style={{ backgroundColor: 'var(--color-surface)' }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-medium text-sm" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
                          {s.ref}
                        </p>
                        <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                          {s.kaimahiName}
                        </p>
                        {s.supervisorReviewed && (
                          <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)' }}>
                            ✓ reviewed
                          </span>
                        )}
                      </div>
                      <p className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                        {s.date} · <EngagementLabel type={s.engagementType} />
                        {s.sessionFocus && (
                          <span className="italic" style={{ fontFamily: 'var(--font-display)' }}>
                            {' '}· {s.sessionFocus}
                          </span>
                        )}
                      </p>
                    </div>
                    {/* Compact pou strip */}
                    <div className="flex-shrink-0 flex gap-px" style={{ height: 18 }}>
                      {s.pou.map((p) => {
                        const c = STATUS_CONFIG[p.status]
                        return <div key={p.id} style={{ width: 18, height: 18, backgroundColor: c.light, borderBottom: `2px solid ${c.color}` }} />
                      })}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-4">
            <button
              onClick={() => onNav({ view: 'pou-matrix' })}
              className="text-sm transition-opacity hover:opacity-70"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.04em' }}
            >
              Open team Te Waharoa Pou matrix →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  cell,
  onClose,
  onOpenSession,
}: {
  cell: SelectedCell
  onClose: () => void
  onOpenSession: (sessionId: string) => void
}) {
  const [supervisorNote, setSupervisorNote] = useState('')
  const [notesSaved, setNotesSaved] = useState(false)

  const whanau = WHANAU_RECORDS.find((w) => w.id === cell.whanauId)
  if (!whanau) return null

  const kaimahi = KAIMAHI_RECORDS.find((k) => k.id === whanau.kaimahiId)
  const pouMeta = POU_FULL_META.find((p) => p.id === cell.pouId)!
  const latest = getLatestSession(whanau)
  const latestPou = latest?.pou.find((p) => p.id === cell.pouId)
  const cellStatus = getCellStatus(whanau, cell.pouId)
  const cellCfg = CELL_STATUS_META[cellStatus]
  const lastDate = getLastDiscussedDate(whanau, cell.pouId)

  // Pou history across all sessions
  const pouHistory = [...whanau.sessions]
    .reverse()
    .map((s) => ({ session: s, pou: s.pou.find((p) => p.id === cell.pouId) }))
    .filter((h) => h.pou)

  // Linked actions from latest session
  const linkedActions = latest?.actions.filter((a) => a.pouId === cell.pouId) ?? []

  // Protective vs risk — derive from aiNote keywords (demo simplification)
  const aiNote = latestPou?.aiNote ?? ''

  const handleSaveNote = () => {
    setNotesSaved(true)
    setTimeout(() => setNotesSaved(false), 2500)
  }

  return (
    <div
      className="flex flex-col h-full flex-shrink-0 overflow-y-auto"
      style={{
        width: 400,
        borderLeft: '1px solid var(--color-border-strong)',
        backgroundColor: 'var(--color-ground)',
      }}
    >
      {/* Panel header */}
      <div
        className="flex items-start justify-between px-6 pt-6 pb-5 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex-1 min-w-0 pr-3">
          <div className="flex items-center gap-2 mb-1">
            <div style={{ width: 4, height: 16, backgroundColor: cellCfg.color, flexShrink: 0 }} />
            <p
              className="text-lg font-medium"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
            >
              {pouMeta.reo}
            </p>
          </div>
          <p
            className="text-xs italic mb-2"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
          >
            {pouMeta.full}
          </p>
          <p
            className="text-xs"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
          >
            {whanau.code} · {kaimahi?.name} · {lastDate ?? 'Not yet discussed'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex-shrink-0 transition-opacity hover:opacity-70 text-xs"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
        >
          ✕ Close
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-5 space-y-5">

        {/* Status */}
        <div
          className="px-4 py-4"
          style={{ backgroundColor: cellCfg.bg, borderLeft: `3px solid ${cellCfg.color}` }}
        >
          <div className="flex items-center gap-2 mb-2">
            <p
              className="text-xs font-medium"
              style={{ fontFamily: 'var(--font-mono)', color: cellCfg.color, letterSpacing: '0.08em' }}
            >
              {cellCfg.label.toUpperCase()}
            </p>
            {latestPou && <StatusBadge status={latestPou.status} />}
          </div>
          {aiNote ? (
            <p
              className="text-sm italic leading-relaxed"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
            >
              {aiNote}
            </p>
          ) : (
            <p
              className="text-sm italic"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
            >
              This pou has not yet been discussed in a recorded session.
            </p>
          )}
        </div>

        {/* What was discussed vs not discussed */}
        <div>
          <p
            className="text-xs mb-2"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}
          >
            HE KŌRERO — DISCUSSED IN THIS POU
          </p>
          <div className="space-y-1.5">
            {latestPou?.discussed ? (
              <div className="flex items-start gap-2">
                <div style={{ width: 3, height: 3, backgroundColor: 'var(--color-growth)', flexShrink: 0, marginTop: 6 }} />
                <p className="text-xs italic leading-relaxed" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                  Discussed in {latest?.ref} · {latest?.date}
                </p>
              </div>
            ) : (
              <p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
                Not yet raised in a recorded session.
              </p>
            )}
            {/* Not covered — other sessions */}
            {pouHistory.filter((h) => !h.pou?.discussed).length > 0 && (
              <div className="flex items-start gap-2">
                <div style={{ width: 3, height: 3, backgroundColor: 'var(--color-border-strong)', flexShrink: 0, marginTop: 6 }} />
                <p className="text-xs italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
                  Not covered in {pouHistory.filter((h) => !h.pou?.discussed).length} earlier session{pouHistory.filter((h) => !h.pou?.discussed).length !== 1 ? 's' : ''}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Linked protective factors */}
        {latestPou?.discussed && latestPou.status === 'tōtika' && (
          <div>
            <p
              className="text-xs mb-2"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)', letterSpacing: '0.08em' }}
            >
              PROTECTIVE INDICATORS
            </p>
            <div className="space-y-1.5">
              {['Stable — no immediate concerns identified in this pou', 'Positive indicators present at most recent session'].map((f, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div style={{ width: 3, height: 3, backgroundColor: 'var(--color-growth)', flexShrink: 0, marginTop: 6 }} />
                  <p className="text-xs italic leading-snug" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                    {f}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Linked risk factors */}
        {latestPou && (latestPou.status === 'āta' || latestPou.status === 'mataku') && (
          <div>
            <p
              className="text-xs mb-2"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-caution)', letterSpacing: '0.08em' }}
            >
              RISK FACTORS
            </p>
            <div className="space-y-1.5">
              <div className="flex items-start gap-2">
                <div style={{ width: 3, height: 3, backgroundColor: 'var(--color-caution)', flexShrink: 0, marginTop: 6 }} />
                <p className="text-xs italic leading-snug" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                  {latestPou.status === 'mataku'
                    ? 'Urgent concern identified — requires immediate follow-up'
                    : 'Concern noted — monitoring required'}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <div style={{ width: 3, height: 3, backgroundColor: 'var(--color-caution)', flexShrink: 0, marginTop: 6 }} />
                <p className="text-xs italic leading-snug" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                  See AI note above for detail
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Linked actions */}
        {linkedActions.length > 0 && (
          <div>
            <p
              className="text-xs mb-2"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}
            >
              LINKED ACTIONS
            </p>
            <div className="space-y-1.5">
              {linkedActions.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start gap-2 px-3 py-2.5"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderLeft: `2px solid ${a.completed ? 'var(--color-border)' : 'var(--color-caution)'}`,
                    opacity: a.completed ? 0.6 : 1,
                  }}
                >
                  <ActionBadge type={a.type} />
                  <p
                    className="flex-1 text-xs italic leading-snug"
                    style={{
                      fontFamily: 'var(--font-display)',
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

        {/* Linked referrals */}
        {latest && latest.referralNames.length > 0 && (
          <div>
            <p
              className="text-xs mb-2"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}
            >
              REFERRALS — MOST RECENT SESSION
            </p>
            <div className="space-y-1">
              {latest.referralNames.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2" style={{ backgroundColor: 'var(--color-growth-light)', borderLeft: '2px solid var(--color-growth)' }}>
                  <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)' }}>
                    → {r}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pou history across sessions */}
        <div>
          <p
            className="text-xs mb-2"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}
          >
            RECENT KŌRERO — THIS POU
          </p>
          <div className="space-y-px">
            {pouHistory.slice(0, 4).map(({ session, pou }) => {
              if (!pou) return null
              const c = STATUS_CONFIG[pou.status]
              return (
                <button
                  key={session.id}
                  onClick={() => onOpenSession(session.id)}
                  className="w-full text-left transition-opacity hover:opacity-80"
                >
                  <div className="flex items-start gap-0">
                    <div style={{ width: 3, backgroundColor: pou.discussed ? c.color : 'var(--color-border)', flexShrink: 0, minHeight: 56 }} />
                    <div
                      className="flex-1 px-3 py-2.5"
                      style={{ backgroundColor: 'var(--color-surface)' }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-medium" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-secondary)' }}>
                          {session.ref} · {session.date}
                        </p>
                        <StatusBadge status={pou.status} />
                      </div>
                      <p
                        className="text-xs italic leading-snug"
                        style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
                      >
                        {pou.discussed ? pou.aiNote.slice(0, 80) + '…' : 'Not discussed in this session'}
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
          {latest && (
            <button
              onClick={() => onOpenSession(latest.id)}
              className="mt-2 text-xs transition-opacity hover:opacity-70"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.04em' }}
            >
              Open full session record — {latest.ref} →
            </button>
          )}
        </div>

        {/* Supervisor notes */}
        <div>
          <p
            className="text-xs mb-2"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}
          >
            SUPERVISOR NOTES
          </p>
          {latest?.supervisorNotes && (
            <div
              className="mb-3 px-3 py-3"
              style={{ backgroundColor: 'var(--color-ridge-light)', borderLeft: '3px solid var(--color-ridge)' }}
            >
              <p
                className="text-xs italic leading-relaxed"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
              >
                {latest.supervisorNotes}
              </p>
            </div>
          )}
          <textarea
            value={supervisorNote}
            onChange={(e) => setSupervisorNote(e.target.value)}
            placeholder="Add a note for this pou…"
            rows={3}
            className="w-full px-3 py-2.5 text-sm leading-relaxed resize-none"
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-ink)',
              border: 'none',
              borderLeft: '3px solid var(--color-border)',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSaveNote}
            className="mt-2 text-xs px-3 py-2 transition-all"
            style={{
              fontFamily: 'var(--font-mono)',
              backgroundColor: notesSaved ? 'var(--color-growth-light)' : 'var(--color-surface)',
              color: notesSaved ? 'var(--color-growth)' : 'var(--color-ink-muted)',
              border: `1px solid ${notesSaved ? 'var(--color-growth)' : 'var(--color-border)'}`,
              letterSpacing: '0.04em',
            }}
          >
            {notesSaved ? '✓ Saved' : 'Save note'}
          </button>
        </div>

      </div>
    </div>
  )
}

// ─── Team Matrix Screen ────────────────────────────────────────────────────────

function TeamMatrixScreen({
  onNav,
}: {
  onNav: (patch: Partial<NavState>) => void
}) {
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null)
  const [expandedKaimahiId, setExpandedKaimahiId] = useState<string | null>(null)

  // Column width constants
  const COL_CODE = 148
  const COL_POU = 148
  const COL_PENDING = 116

  const handleCellClick = (whanauId: string, pouId: string) => {
    if (selectedCell?.whanauId === whanauId && selectedCell?.pouId === pouId) {
      setSelectedCell(null)
    } else {
      setSelectedCell({ whanauId, pouId })
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">

      {/* Matrix scroll area */}
      <div className="flex-1 overflow-auto">
        <div style={{ minWidth: COL_CODE + 6 * COL_POU + COL_PENDING + 60, fontFamily: 'var(--font-body)' }}>

          {/* Matrix header */}
          <div
            className="flex-shrink-0 sticky top-0 z-20"
            style={{ backgroundColor: 'var(--color-surface)', borderBottom: '2px solid var(--color-border-strong)' }}
          >
            {/* Top label row */}
            <div className="flex items-center px-6 pt-5 pb-1">
              <div style={{ width: COL_CODE, flexShrink: 0 }}>
                <p
                  className="text-xs"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}
                >
                  KAIMAHI / WHĀNAU
                </p>
              </div>
              {POU_FULL_META.map((meta) => (
                <div
                  key={meta.id}
                  className="flex flex-col items-center text-center"
                  style={{ width: COL_POU, flexShrink: 0 }}
                >
                  <p
                    className="text-sm font-medium mb-0.5"
                    style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
                  >
                    {meta.reo}
                  </p>
                  <p
                    className="text-xs leading-tight px-1"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', fontSize: '0.6rem' }}
                  >
                    {meta.full}
                  </p>
                </div>
              ))}
              <div style={{ width: COL_PENDING, flexShrink: 0 }} />
            </div>
            {/* Paepae — structural threshold line */}
            <div className="flex items-end">
              <div style={{ width: COL_CODE + 24, flexShrink: 0 }} />
              {POU_FULL_META.map((meta) => {
                const allStatuses = WHANAU_RECORDS.map((w) => getCellStatus(w, meta.id))
                const worst: CellStatus = allStatuses.includes('urgent') ? 'urgent'
                  : allStatuses.includes('action-needed') ? 'action-needed'
                  : allStatuses.includes('needs-followup') ? 'needs-followup'
                  : 'up-to-date'
                return (
                  <div
                    key={meta.id}
                    style={{ width: COL_POU, flexShrink: 0, height: 4, backgroundColor: CELL_STATUS_META[worst].color, opacity: 0.5 }}
                  />
                )
              })}
            </div>
          </div>

          {/* Kaimahi sections */}
          <div className="px-6">
            {KAIMAHI_RECORDS.map((kaimahi) => {
              const kWorst = kaimahiWorstStatus(kaimahi)
              const kCfg = CELL_STATUS_META[kWorst]
              const isExpanded = expandedKaimahiId !== kaimahi.id  // default open
              const pendingReviews = kaimahi.whanau.some((w) =>
                getLatestSession(w)?.flagged && !getLatestSession(w)?.supervisorReviewed
              )

              return (
                <div key={kaimahi.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {/* Kaimahi section header */}
                  <button
                    onClick={() => setExpandedKaimahiId(expandedKaimahiId === kaimahi.id ? null : kaimahi.id)}
                    className="w-full flex items-center transition-opacity hover:opacity-80"
                    style={{ paddingTop: 20, paddingBottom: 12 }}
                  >
                    <div
                      className="flex items-center gap-3"
                      style={{ width: COL_CODE, flexShrink: 0 }}
                    >
                      <div style={{ width: 4, height: 32, backgroundColor: kCfg.color, flexShrink: 0 }} />
                      <div className="text-left">
                        <p
                          className="text-sm font-medium italic"
                          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
                        >
                          {kaimahi.name}
                        </p>
                        <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                          {kaimahi.role}
                        </p>
                        <p className="text-xs mt-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                          {kaimahi.whanau.length} whānau
                        </p>
                      </div>
                    </div>
                    {/* Kaimahi-level pou summary — dots per whānau */}
                    {POU_FULL_META.map((meta) => {
                      const statuses = kaimahi.whanau.map((w) => getCellStatus(w, meta.id))
                      const worst: CellStatus = statuses.includes('urgent') ? 'urgent'
                        : statuses.includes('action-needed') ? 'action-needed'
                        : statuses.includes('needs-followup') ? 'needs-followup'
                        : statuses.includes('up-to-date') ? 'up-to-date'
                        : 'not-discussed'
                      const cfg = CELL_STATUS_META[worst]
                      return (
                        <div
                          key={meta.id}
                          className="flex items-center justify-center gap-1"
                          style={{ width: COL_POU, flexShrink: 0 }}
                        >
                          {statuses.map((s, si) => (
                            <div
                              key={si}
                              style={{
                                width: 10,
                                height: 10,
                                backgroundColor: CELL_STATUS_META[s].color,
                                opacity: s === 'not-discussed' ? 0.2 : 0.85,
                              }}
                            />
                          ))}
                        </div>
                      )
                    })}
                    <div
                      className="flex items-center gap-2"
                      style={{ width: COL_PENDING, flexShrink: 0 }}
                    >
                      {pendingReviews && (
                        <span
                          className="text-xs px-1.5 py-0.5"
                          style={{ fontFamily: 'var(--font-mono)', backgroundColor: 'var(--color-concern)', color: 'white' }}
                        >
                          Review needed
                        </span>
                      )}
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--color-ink-muted)', marginLeft: 'auto' }}>
                        {expandedKaimahiId === kaimahi.id ? '▲' : '▽'}
                      </span>
                    </div>
                  </button>

                  {/* Whānau rows — expanded */}
                  {expandedKaimahiId !== kaimahi.id && (
                    <div className="pb-3 space-y-px">
                      {kaimahi.whanau.map((whanau, rowIdx) => {
                        const latest = getLatestSession(whanau)
                        const openActions = latest?.actions.filter((a) => !a.completed).length ?? 0
                        const needsReview = latest?.flagged && !latest?.supervisorReviewed
                        const wWorst = worstStatus(whanau)

                        return (
                          <div
                            key={whanau.id}
                            className="flex items-stretch"
                            style={{ backgroundColor: rowIdx % 2 === 0 ? 'var(--color-surface)' : 'var(--color-ground)' }}
                          >
                            {/* Whānau code */}
                            <div
                              className="flex items-center gap-2 py-3"
                              style={{ width: COL_CODE, flexShrink: 0, paddingLeft: 28 }}
                            >
                              <div style={{ width: 3, height: 28, backgroundColor: CELL_STATUS_META[wWorst].color, flexShrink: 0 }} />
                              <div>
                                <p className="text-sm font-medium" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
                                  {whanau.code}
                                </p>
                                {latest && (
                                  <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                                    {latest.date}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Pou cells */}
                            {POU_FULL_META.map((meta) => {
                              const status = getCellStatus(whanau, meta.id)
                              const cfg = CELL_STATUS_META[status]
                              const lastDate = getLastDiscussedDate(whanau, meta.id)
                              const isSelected = selectedCell?.whanauId === whanau.id && selectedCell?.pouId === meta.id

                              return (
                                <button
                                  key={meta.id}
                                  onClick={() => handleCellClick(whanau.id, meta.id)}
                                  className="flex flex-col items-start justify-center transition-all"
                                  style={{
                                    width: COL_POU,
                                    flexShrink: 0,
                                    padding: '8px 12px',
                                    backgroundColor: isSelected ? cfg.bg : status === 'not-discussed' ? 'transparent' : cfg.bg,
                                    borderLeft: `3px solid ${isSelected ? cfg.color : status === 'not-discussed' ? 'var(--color-border)' : cfg.color}`,
                                    opacity: status === 'not-discussed' ? 0.4 : 1,
                                    outline: isSelected ? `2px solid ${cfg.color}` : 'none',
                                    outlineOffset: -2,
                                  }}
                                >
                                  <p
                                    className="text-xs font-medium leading-tight"
                                    style={{ fontFamily: 'var(--font-mono)', color: cfg.color }}
                                  >
                                    {cfg.label}
                                  </p>
                                  {lastDate && (
                                    <p
                                      className="text-xs mt-1 leading-tight"
                                      style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', fontSize: '0.6rem' }}
                                    >
                                      {lastDate}
                                    </p>
                                  )}
                                </button>
                              )
                            })}

                            {/* Pending indicators */}
                            <div
                              className="flex items-center gap-1.5 px-3 py-3"
                              style={{ width: COL_PENDING, flexShrink: 0 }}
                            >
                              {needsReview && (
                                <span
                                  className="text-xs px-1.5 py-0.5"
                                  style={{ fontFamily: 'var(--font-mono)', backgroundColor: 'var(--color-concern)', color: 'white' }}
                                >
                                  Review
                                </span>
                              )}
                              {openActions > 0 && (
                                <span
                                  className="text-xs px-1.5 py-0.5"
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    backgroundColor: 'var(--color-caution-light)',
                                    color: 'var(--color-caution)',
                                    border: '1px solid var(--color-caution)',
                                  }}
                                >
                                  {openActions} open
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div className="px-6 py-6 flex items-center gap-6 flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
            <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}>
              STATUS
            </p>
            {(Object.entries(CELL_STATUS_META) as [CellStatus, typeof CELL_STATUS_META[CellStatus]][]).map(([s, cfg]) => (
              <div key={s} className="flex items-center gap-2">
                <div style={{ width: 3, height: 14, backgroundColor: cfg.color }} />
                <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                  {cfg.label}
                </span>
              </div>
            ))}
            <p className="text-xs ml-auto" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
              Click any pou cell to open detail panel
            </p>
          </div>
        </div>
      </div>

      {/* Detail panel */}
      {selectedCell && (
        <DetailPanel
          cell={selectedCell}
          onClose={() => setSelectedCell(null)}
          onOpenSession={(sessionId) => {
            setSelectedCell(null)
            onNav({ view: 'session-review', sessionId })
          }}
        />
      )}
    </div>
  )
}

// ─── Session Review Screen ────────────────────────────────────────────────────

function SessionReviewScreen({
  nav,
  onNav,
}: {
  nav: NavState
  onNav: (patch: Partial<NavState>) => void
}) {
  const [supervisorNote, setSupervisorNote] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const allSessions = getAllSessions()
  const session = allSessions.find((s) => s.id === nav.sessionId) ?? allSessions[0]

  const discussed = session.pou.filter((p) => p.discussed)
  const notDiscussed = session.pou.filter((p) => !p.discussed)
  const concernedPou = session.pou.filter((p) => p.status === 'mataku' || p.status === 'āta')

  return (
    <div className="flex-1 overflow-y-auto" style={{ fontFamily: 'var(--font-body)' }}>
      <div className="max-w-3xl px-10 pt-8 pb-16">

        {/* Breadcrumb */}
        <button
          onClick={() => onNav({ view: 'overview', sessionId: null })}
          className="text-xs mb-6 transition-opacity hover:opacity-70 flex items-center gap-1"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}
        >
          ← Overview
        </button>

        {/* Session identity */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2
                  className="text-3xl font-medium"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
                >
                  {session.ref}
                </h2>
                {session.flagged && !session.supervisorReviewed && (
                  <span
                    className="text-xs px-2 py-0.5"
                    style={{ fontFamily: 'var(--font-mono)', backgroundColor: 'var(--color-concern)', color: 'white' }}
                  >
                    Awaiting review
                  </span>
                )}
                {(session.supervisorReviewed || acknowledged) && (
                  <span
                    className="text-xs px-2 py-0.5"
                    style={{ fontFamily: 'var(--font-mono)', backgroundColor: 'var(--color-growth-light)', color: 'var(--color-growth)' }}
                  >
                    ✓ Reviewed
                  </span>
                )}
              </div>
              <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
                {session.kaimahiName} · <EngagementLabel type={session.engagementType} /> · {session.date}
              </p>
              {session.sessionFocus && (
                <p
                  className="text-sm italic mt-1"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
                >
                  {session.sessionFocus}
                </p>
              )}
            </div>
          </div>

          {/* Pou strip — visual summary */}
          <div className="flex gap-px mt-4" style={{ height: 8 }}>
            {session.pou.map((p) => {
              const c = STATUS_CONFIG[p.status]
              return <div key={p.id} style={{ flex: 1, backgroundColor: c.color, opacity: p.discussed ? 1 : 0.2 }} />
            })}
          </div>
          <div className="flex mt-1.5">
            {session.pou.map((p) => {
              const c = STATUS_CONFIG[p.status]
              return (
                <div key={p.id} style={{ flex: 1, textAlign: 'center' }}>
                  <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: c.color, fontSize: '0.6rem' }}>
                    {p.reo.slice(0, 3)}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ height: 1, backgroundColor: 'var(--color-border-strong)', marginBottom: 32 }} />

        {/* Synthesis */}
        <div
          className="px-5 py-5 mb-8"
          style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-ridge)' }}
        >
          <p className="text-xs mb-3" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.08em' }}>
            HE WHAKAARO — AI SYNTHESIS
          </p>
          <p
            className="text-base italic leading-relaxed"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
          >
            "{session.synthesis}"
          </p>
        </div>

        {/* Concerned pou */}
        {concernedPou.length > 0 && (
          <div className="mb-8">
            <SectionLabel>Pou requiring attention</SectionLabel>
            <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {concernedPou.map((p) => {
                const c = STATUS_CONFIG[p.status]
                return (
                  <div
                    key={p.id}
                    className="px-4 py-4"
                    style={{ backgroundColor: c.light, borderLeft: `3px solid ${c.color}` }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <p className="font-medium text-sm" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
                        {p.reo}
                      </p>
                      <StatusBadge status={p.status} />
                    </div>
                    <p className="text-xs italic leading-relaxed" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                      {p.aiNote}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Discussed pou */}
        <div className="mb-8">
          <SectionLabel>He kōrero — Discussed ({discussed.length} pou)</SectionLabel>
          <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            {discussed.map((p) => {
              const c = STATUS_CONFIG[p.status]
              return (
                <div
                  key={p.id}
                  className="px-3 py-3"
                  style={{ backgroundColor: c.light, borderLeft: `3px solid ${c.color}` }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
                      {p.reo}
                    </p>
                    <StatusBadge status={p.status} />
                  </div>
                  <p className="text-xs italic leading-snug" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                    {p.aiNote.slice(0, 80)}…
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Not discussed */}
        {notDiscussed.length > 0 && (
          <div className="mb-8">
            <SectionLabel>Kāore i kōrerohia — Not discussed this session ({notDiscussed.length} pou)</SectionLabel>
            <div className="mt-3 flex gap-2 flex-wrap">
              {notDiscussed.map((p) => (
                <div
                  key={p.id}
                  className="px-3 py-2"
                  style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border-strong)' }}
                >
                  <p className="text-sm" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
                    {p.reo}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {session.actions.length > 0 && (
          <div className="mb-8">
            <SectionLabel>Ngā Mahi — Actions ({session.actions.length})</SectionLabel>
            <div className="mt-3 space-y-px">
              {session.actions.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start gap-3 px-4 py-3"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderLeft: `3px solid ${a.completed ? 'var(--color-border)' : 'var(--color-caution)'}`,
                    opacity: a.completed ? 0.6 : 1,
                  }}
                >
                  <ActionBadge type={a.type} />
                  <p className="flex-1 text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>
                    {a.description}
                  </p>
                  {a.completed && (
                    <span className="text-xs flex-shrink-0" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-growth)' }}>
                      ✓ done
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Referrals */}
        {session.referralNames.length > 0 && (
          <div className="mb-8">
            <SectionLabel>Referrals ({session.referralNames.length})</SectionLabel>
            <div className="mt-3 space-y-1">
              {session.referralNames.map((r) => (
                <div
                  key={r}
                  className="px-3 py-2.5"
                  style={{ backgroundColor: 'var(--color-growth-light)', borderLeft: '3px solid var(--color-growth)' }}
                >
                  <p className="text-sm" style={{ color: 'var(--color-ink)' }}>→ {r}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Existing supervisor notes */}
        {session.supervisorNotes && (
          <div
            className="px-5 py-4 mb-8"
            style={{ backgroundColor: 'var(--color-ridge-light)', borderLeft: '3px solid var(--color-ridge)' }}
          >
            <p className="text-xs mb-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.08em' }}>
              SUPERVISOR NOTES — RECORDED
            </p>
            <p
              className="text-sm italic leading-relaxed"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}
            >
              {session.supervisorNotes}
            </p>
          </div>
        )}

        {/* Add supervisor note */}
        <div className="mb-6">
          <SectionLabel>Add supervisor notes</SectionLabel>
          <textarea
            value={supervisorNote}
            onChange={(e) => setSupervisorNote(e.target.value)}
            placeholder="Your supervision notes for this session…"
            rows={4}
            className="mt-2 w-full py-3 px-4 text-sm leading-relaxed resize-none"
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-ink)',
              border: 'none',
              borderLeft: '3px solid var(--color-border)',
              outline: 'none',
            }}
          />
        </div>

        {/* Supervisor actions */}
        <div className="flex gap-3">
          <button
            onClick={() => setAcknowledged(true)}
            className="flex-1 py-4 text-sm font-medium tracking-wide transition-opacity hover:opacity-90"
            style={{
              backgroundColor: acknowledged ? 'var(--color-growth)' : 'var(--color-ridge)',
              color: 'white',
              letterSpacing: '0.06em',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {acknowledged ? '✓ Review acknowledged' : 'Whakaae — Acknowledge review'}
          </button>
          {session.flagged && !acknowledged && (
            <button
              className="py-4 px-6 text-sm font-medium tracking-wide transition-opacity hover:opacity-80"
              style={{
                backgroundColor: 'transparent',
                color: 'var(--color-concern)',
                border: '1.5px solid var(--color-concern)',
                letterSpacing: '0.06em',
                fontFamily: 'var(--font-mono)',
              }}
            >
              Tūāhu — Escalate
            </button>
          )}
        </div>

      </div>
    </div>
  )
}

// ─── Main content routing ─────────────────────────────────────────────────────

function MainContent({
  nav,
  onNav,
}: {
  nav: NavState
  onNav: (patch: Partial<NavState>) => void
}) {
  return (
    <div className="flex flex-1 overflow-hidden">
      {nav.view === 'overview'      && <OverviewScreen onNav={onNav} />}
      {nav.view === 'pou-matrix'    && <TeamMatrixScreen onNav={onNav} />}
      {nav.view === 'session-review' && <SessionReviewScreen nav={nav} onNav={onNav} />}
    </div>
  )
}

// ─── Supervisor App root ──────────────────────────────────────────────────────

export default function SupervisorApp({ onBack }: { onBack: () => void }) {
  const [nav, setNav] = useState<NavState>({ view: 'pou-matrix', sessionId: null })

  const updateNav = (patch: Partial<NavState>) => setNav((prev) => ({ ...prev, ...patch }))

  const pendingReviews = getAllSessions().filter((s) => s.flagged && !s.supervisorReviewed).length

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--color-ground)' }}
    >
      {/* Structural ridge — top of whare */}
      <div style={{ height: 4, display: 'flex' }}>
        {POU_FULL_META.map((meta, i) => {
          const allStatuses = WHANAU_RECORDS.map((w) => getCellStatus(w, meta.id))
          const worst: CellStatus = allStatuses.includes('urgent') ? 'urgent'
            : allStatuses.includes('action-needed') ? 'action-needed'
            : allStatuses.includes('needs-followup') ? 'needs-followup'
            : 'up-to-date'
          return (
            <div key={meta.id} style={{ flex: 1, backgroundColor: CELL_STATUS_META[worst].color }} />
          )
        })}
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 4px)' }}>
        <SupervisorSidebar
          nav={nav}
          onNav={updateNav}
          onBack={onBack}
          pendingReviews={pendingReviews}
        />
        <MainContent nav={nav} onNav={updateNav} />
      </div>
    </div>
  )
}
