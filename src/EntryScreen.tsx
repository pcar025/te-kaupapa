import { useState } from 'react'

import { TE_WAHAROA_POU } from './pou'
import type { AuthProfile } from './auth'

// Six Safety Pou — structural entry marks
const ENTRY_POU = TE_WAHAROA_POU.map((pou) => pou.reo)

export default function EntryScreen({
  onKaimahi,
  onSupervisor,
  onSpecificationEditor,
  profile,
  authMessage,
  onSignIn,
  onSignOut,
}: {
  onKaimahi: () => void
  onSupervisor: () => void
  onSpecificationEditor?: () => void
  profile?: AuthProfile
  authMessage?: string
  onSignIn?: (trustedDevice: boolean) => void
  onSignOut?: () => void
}) {
  const canUseKaimahi = profile?.roles.includes('KAIMAHI') ?? false
  const canUseSupervisor = profile?.roles.includes('SUPERVISOR') ?? false
  const canUseSpecificationEditor = profile?.roles.includes('SPECIFICATION_EDITOR') ?? false
  const [trustedDevice, setTrustedDevice] = useState(false)
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--color-ground)', fontFamily: 'var(--font-body)' }}
    >
      {/* Six Safety Pou — structural ridge at the top of the Whare */}
      <div className="flex w-full">
        {ENTRY_POU.map((_, i) => (
          <div
            key={i}
            className="flex-1"
            style={{
              height: 4,
              backgroundColor: 'var(--color-ridge)',
              opacity: 0.12 + i * 0.12,
            }}
          />
        ))}
      </div>

      {/* Centred content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div className="w-full max-w-xs">

          {/* Logotype — name over mark */}
          <div className="mb-10">
            <p
              className="text-xs tracking-widest uppercase mb-5"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.18em' }}
            >
              Te Kaupapa AI
            </p>
            <h1
              className="leading-none mb-3"
              style={{
                fontFamily: 'var(--font-display)',
                fontStyle: 'italic',
                fontWeight: 500,
                fontSize: '2.5rem',
                color: 'var(--color-ink)',
                letterSpacing: '-0.01em',
              }}
            >
              Nau mai,
              <br />
              haere mai
            </h1>
            <p
              className="text-sm leading-relaxed"
              style={{ color: 'var(--color-ink-secondary)' }}
            >
              Reflective practice as a form of protection — grounded in
              the seven Pou of Te Waharoa Model of Care.
            </p>
          </div>

          {/* Six pou — structural rhythm */}
          <div className="flex gap-px mb-10">
            {ENTRY_POU.map((reo, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                <div
                  style={{
                    width: 2,
                    height: 28,
                    backgroundColor: 'var(--color-ridge)',
                    opacity: 0.18 + i * 0.1,
                  }}
                />
                <p
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.5rem',
                    color: 'var(--color-ink-muted)',
                    letterSpacing: '0.04em',
                    textAlign: 'center',
                  }}
                >
                  {reo}
                </p>
              </div>
            ))}
          </div>

          {/* Paepae — the threshold before entry */}
          <div className="relative flex items-center mb-8">
            <div className="flex-1" style={{ height: 1, backgroundColor: 'var(--color-border-strong)' }} />
            <div
              className="flex-shrink-0 px-3 py-1"
              style={{ backgroundColor: 'var(--color-surface-deep)' }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.6rem',
                  letterSpacing: '0.2em',
                  color: 'var(--color-ink-muted)',
                }}
              >
                PAEPAE
              </span>
            </div>
            <div className="flex-1" style={{ height: 1, backgroundColor: 'var(--color-border-strong)' }} />
          </div>

          {/* Entry actions */}
          <div className="space-y-3">
            {profile ? (
              <>
                <div className="flex items-center justify-between gap-3 pb-1">
                  <p className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
                    {profile.displayName} · {profile.organisation.name}
                  </p>
                  <button
                    onClick={onSignOut}
                    className="text-xs underline underline-offset-4"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-secondary)' }}
                  >
                    Sign out
                  </button>
                </div>
                {canUseKaimahi && (
                  <button
                    onClick={onKaimahi}
                    className="w-full py-4 text-sm font-medium transition-opacity hover:opacity-90 active:opacity-75"
                    style={{
                      backgroundColor: 'var(--color-ridge)',
                      color: 'white',
                      letterSpacing: '0.06em',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    Kaimahi — Tīmata Kōrero
                  </button>
                )}
                {canUseSupervisor && (
                  <button
                    onClick={onSupervisor}
                    className="w-full py-4 text-sm font-medium transition-opacity hover:opacity-80"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--color-ink-secondary)',
                      border: '1px solid var(--color-border-strong)',
                      letterSpacing: '0.06em',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    Mātāmua — Supervisor View
                  </button>
                )}
                {canUseSpecificationEditor && (
                  <button
                    onClick={onSpecificationEditor}
                    className="w-full py-3 text-sm transition-opacity hover:opacity-80"
                    style={{ backgroundColor: 'transparent', color: 'var(--color-ink-secondary)', border: '1px solid var(--color-border-strong)', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}
                  >
                    Pou specification workshop
                  </button>
                )}
                {!canUseKaimahi && !canUseSupervisor && !canUseSpecificationEditor && (
                  <p role="status" className="text-sm leading-relaxed" style={{ color: 'var(--color-ink-secondary)' }}>
                    Your account does not have a Te Kaupapa role assigned.
                  </p>
                )}
              </>
            ) : (
              <>
                <p role="status" className="text-sm leading-relaxed" style={{ color: 'var(--color-ink-secondary)' }}>
                  {authMessage ?? 'Please sign in to continue.'}
                </p>
                <label className="flex items-start gap-3 text-sm leading-relaxed" style={{ color: 'var(--color-ink-secondary)' }}>
                  <input
                    type="checkbox"
                    checked={trustedDevice}
                    onChange={(event) => setTrustedDevice(event.target.checked)}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block font-medium" style={{ color: 'var(--color-ink)' }}>Keep me signed in on this device for 30 days</span>
                    <span className="block mt-1 text-xs">Use this only on a private or individually assigned device protected by a screen lock or device sign-in. Do not use this on a shared or public device.</span>
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => onSignIn?.(trustedDevice)}
                  className="w-full py-4 text-sm font-medium transition-opacity hover:opacity-90 active:opacity-75"
                  style={{
                    backgroundColor: 'var(--color-ridge)',
                    color: 'white',
                    letterSpacing: '0.06em',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  Waitohu mai — Sign in
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Whakataukī — the closing of the entrance */}
      <div className="text-center pb-10 px-8">
        <p
          className="text-xs italic mb-1"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}
        >
          "He whakaaro pai, he oranga tangata"
        </p>
        <p
          className="text-xs"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}
        >
          Good thinking brings wellness to people
        </p>
      </div>
    </div>
  )
}
