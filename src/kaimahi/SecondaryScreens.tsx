import { useState } from 'react'

import { REFERRAL_CATEGORIES, REFERRAL_SERVICES, WHANAU_RECORDS } from '../data'
import { ActionBadge, EngagementLabel, PouStrip, SectionLabel } from '../shared'
import type { AuthProfile } from '../auth'

// ─────────────────────────────────────────────────────────────────────────────
// REFERRALS BROWSE (standalone — not within session)
// ─────────────────────────────────────────────────────────────────────────────

export function ReferralsBrowseScreen() {
  const [activeCat, setActiveCat] = useState('kainga')
  const services = REFERRAL_SERVICES.filter((s) => s.categoryId === activeCat)

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: 'var(--font-body)' }}>
      <div className="px-5 pt-7 pb-4 flex-shrink-0">
        <h2
          className="text-xl font-medium mb-1"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
        >
          Ngā Ara Tautoko
        </h2>
        <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          Referral services — browse and find support pathways
        </p>
      </div>

      {/* Category rail */}
      <div
        className="flex-shrink-0 overflow-x-auto"
        style={{
          borderTop: '1px solid var(--color-border)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div className="flex px-5 py-0" style={{ minWidth: 'max-content' }}>
          {REFERRAL_CATEGORIES.map((cat) => {
            const isActive = activeCat === cat.id
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCat(cat.id)}
                className="flex flex-col items-start py-3 pr-6 min-h-[48px] transition-all"
                style={{
                  borderBottom: isActive ? '2px solid var(--color-ridge)' : '2px solid transparent',
                }}
              >
                <span
                  className="text-sm font-medium"
                  style={{ color: isActive ? 'var(--color-ridge)' : 'var(--color-ink-secondary)' }}
                >
                  {cat.reo}
                </span>
                <span
                  className="text-xs"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                >
                  {cat.en}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Services */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
        {services.map((s) => (
          <div
            key={s.id}
            className="py-4 px-3"
            style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}
          >
            <p
              className="font-medium text-sm mb-1"
              style={{ color: 'var(--color-ink)' }}
            >
              {s.name}
            </p>
            <p
              className="text-xs leading-relaxed mb-2.5"
              style={{ color: 'var(--color-ink-secondary)' }}
            >
              {s.description}
            </p>
            <div className="flex items-center justify-between">
              <a
                href={`tel:${s.phone.replace(/\s/g, '')}`}
                className="text-sm font-medium transition-opacity active:opacity-70"
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}
              >
                {s.phone}
              </a>
              <span
                className="text-xs"
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
              >
                {s.area}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHESIS ARCHIVE (standalone — browse past syntheses)
// ─────────────────────────────────────────────────────────────────────────────

export function SynthesisArchiveScreen() {
  const allSessions = WHANAU_RECORDS
    .filter((w) => w.kaimahiId === 'k1')
    .flatMap((w) => w.sessions.map((s) => ({ ...s, whanauCode: w.code })))
    .sort((a, b) => b.ref.localeCompare(a.ref))

  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: 'var(--font-body)' }}>
      <div className="px-5 pt-7 pb-4 flex-shrink-0">
        <h2
          className="text-xl font-medium mb-1"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
        >
          Ngā Whakaaro
        </h2>
        <p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
          What was gathered — past session syntheses
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2">
        {allSessions.map((s) => {
          const isExpanded = expanded === s.id
          return (
            <button
              key={s.id}
              onClick={() => setExpanded(isExpanded ? null : s.id)}
              className="w-full text-left transition-all"
            >
              <div
                className="py-4 px-3"
                style={{
                  backgroundColor: isExpanded ? 'var(--color-ridge-light)' : 'var(--color-surface)',
                  borderLeft: isExpanded ? '3px solid var(--color-ridge)' : '3px solid var(--color-border)',
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-medium text-sm"
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
                  </div>
                  <span
                    className="text-xs"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
                  >
                    {s.date}
                  </span>
                </div>
                <p
                  className="text-sm italic leading-relaxed"
                  style={{
                    fontFamily: 'var(--font-display)',
                    color: 'var(--color-ink-secondary)',
                  }}
                >
                  {isExpanded ? `"${s.synthesis}"` : `"${s.synthesis.slice(0, 100)}…"`}
                </p>
                {isExpanded && (
                  <div className="mt-3">
                    <PouStrip pou={s.pou} />
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RECORD ARCHIVE (standalone — past session records)
// ─────────────────────────────────────────────────────────────────────────────

export function RecordArchiveScreen() {
  const allSessions = WHANAU_RECORDS
    .filter((w) => w.kaimahiId === 'k1')
    .flatMap((w) => w.sessions.map((s) => ({ ...s, whanauCode: w.code })))
    .sort((a, b) => b.ref.localeCompare(a.ref))

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: 'var(--font-body)' }}>
      <div className="px-5 pt-7 pb-4 flex-shrink-0">
        <h2
          className="text-xl font-medium mb-1"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
        >
          Ngā Tohu
        </h2>
        <p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
          Ngā tohu i mau — what has been carried and recorded
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-1.5">
        {allSessions.map((s) => (
          <div
            key={s.id}
            className="py-3.5 px-3 flex items-start gap-3"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderLeft: s.flagged
                ? '3px solid var(--color-concern)'
                : '3px solid var(--color-border)',
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="font-medium text-sm"
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
                  <div className="w-1.5 h-1.5" style={{ backgroundColor: 'var(--color-concern)' }} />
                )}
              </div>
              <p className="text-xs mb-2" style={{ color: 'var(--color-ink-muted)' }}>
                {s.date} · <EngagementLabel type={s.engagementType} />
              </p>
              {s.actions.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {s.actions.map((a) => (
                    <ActionBadge key={a.id} type={a.type} />
                  ))}
                </div>
              )}
            </div>
            <div className="flex-shrink-0 mt-0.5">
              <PouStrip pou={s.pou} compact />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsScreen({ profile }: { profile: AuthProfile }) {
  const [reo, setReo] = useState(false)
  const [notifications, setNotifications] = useState(true)

  const SettingRow = ({
    label,
    value,
    mono,
    onToggle,
    toggled,
  }: {
    label: string
    value?: string
    mono?: boolean
    onToggle?: () => void
    toggled?: boolean
  }) => (
    <div
      className="flex items-center justify-between px-4 py-4 min-h-[56px]"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderLeft: '3px solid var(--color-border)',
      }}
    >
      <span className="text-sm" style={{ color: 'var(--color-ink-secondary)' }}>
        {label}
      </span>
      {onToggle ? (
        <button
          onClick={onToggle}
          className="flex-shrink-0 relative transition-colors"
          style={{
            width: 40,
            height: 22,
            backgroundColor: toggled ? 'var(--color-ridge)' : 'var(--color-border-strong)',
          }}
        >
          <div
            className="absolute top-0.5 transition-all"
            style={{
              width: 18,
              height: 18,
              backgroundColor: 'white',
              left: toggled ? 20 : 2,
            }}
          />
        </button>
      ) : (
        <span
          className="text-sm"
          style={{
            fontFamily: mono ? 'var(--font-mono)' : undefined,
            color: 'var(--color-ink)',
          }}
        >
          {value}
        </span>
      )}
    </div>
  )

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: 'var(--font-body)' }}>
      <div className="px-5 pt-7 pb-5 flex-shrink-0">
        <h2
          className="text-xl font-medium mb-1"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
        >
          Tautuhinga
        </h2>
        <p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>
          Your profile and preferences
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        <div className="mb-5">
          <SectionLabel>Kaimahi profile</SectionLabel>
          <div className="mt-2 space-y-px">
            <SettingRow label="Name" value={profile.displayName} />
            <SettingRow label="Role" value="Kaimahi" />
            <SettingRow label="Organisation" value={profile.organisation.name} />
            <SettingRow label="Supervisor" value="Not available" />
          </div>
        </div>

        <div className="mb-5">
          <SectionLabel>Preferences</SectionLabel>
          <div className="mt-2 space-y-px">
            <SettingRow
              label="Te reo Māori interface"
              onToggle={() => setReo(!reo)}
              toggled={reo}
            />
            <SettingRow
              label="Supervisor notifications"
              onToggle={() => setNotifications(!notifications)}
              toggled={notifications}
            />
          </div>
        </div>

        <div className="mb-5">
          <SectionLabel>Session defaults</SectionLabel>
          <div className="mt-2 space-y-px">
            <SettingRow label="Default engagement" value="Home visit" />
            <SettingRow label="Session ref prefix" value="W-" mono />
          </div>
        </div>

        <div className="mt-8 space-y-4">
          <div style={{ height: 1, backgroundColor: 'var(--color-border)' }} />
          <p
            className="text-xs italic text-center"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
          >
            "He whakaaro pai, he oranga tangata"
          </p>
          <button
            className="w-full py-3.5 text-sm transition-opacity hover:opacity-80 active:opacity-60 min-h-[48px]"
            style={{
              border: '1px solid var(--color-border-strong)',
              color: 'var(--color-ink-muted)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.05em',
            }}
          >
            Takahi — Step out
          </button>
        </div>
      </div>
    </div>
  )
}
