import type { ReactNode } from 'react'

export type SessionStageKey =
  | 'setup'
  | 'pou-overview'
  | 'pou-convo'
  | 'pou-processing'
  | 'pou-review'
  | 'pou-summary'
  | 'synthesising'
  | 'risks'
  | 'referrals'
  | 'synthesis'
  | 'record'
  | 'complete'

// Linear order for non-pou stages (pou stages handled by pouIdx counter in SessionShell)
export const SESSION_STAGE_LABELS: Partial<Record<SessionStageKey, { reo: string; en: string }>> = {
  setup:        { reo: 'Tomokia',    en: 'Enter'         },
  'pou-overview':{ reo: 'Ngā Pou',  en: 'Te Waharoa'    },
  'pou-processing': { reo: 'Whakarite', en: 'Preparing review' },
  'pou-summary': { reo: 'Whakarāpopoto', en: 'Summary'  },
  risks:        { reo: 'Āwangawanga', en: 'Concerns & Actions' },
  referrals:    { reo: 'Ara',       en: 'Referrals'      },
  synthesis:    { reo: 'Whakaaro',  en: 'Structured review' },
  record:       { reo: 'Tohu',      en: 'Record'         },
}

// ─────────────────────────────────────────────────────────────────────────────
// SHELL — WhareShell wraps the whole app
// The 6 pou live as faint structural background lines throughout
// ─────────────────────────────────────────────────────────────────────────────

export function WhareShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative flex flex-col"
      style={{ minHeight: '100vh', backgroundColor: 'var(--color-ground)' }}
    >
      {children}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// SESSION PROGRESS HEADER
// ─────────────────────────────────────────────────────────────────────────────

export function SessionHeader({
  stage,
  sessionRef,
  whanauCode,
  onBack,
  pouIdx,
  pouReo,
}: {
  stage: SessionStageKey
  sessionRef: string
  whanauCode: string
  onBack: () => void
  pouIdx?: number
  pouReo?: string
}) {
  const meta = SESSION_STAGE_LABELS[stage]

  // Centre label: pou stages show "Pou N/6", others show stage reo
  const centreLabel = (() => {
    if (stage === 'pou-convo' && pouIdx !== undefined)
      return { main: pouReo ?? 'Kōrero', sub: `Pou ${pouIdx + 1} o 7` }
    if (stage === 'pou-processing' && pouIdx !== undefined)
      return { main: 'Whakarite', sub: `Pou ${pouIdx + 1} o 7` }
    if (stage === 'pou-review' && pouIdx !== undefined)
      return { main: 'Arotake', sub: `Pou ${pouIdx + 1} o 7` }
    if (meta) return { main: meta.reo, sub: meta.en }
    return null
  })()

  // Macro progress rail: 5 phases (Setup, Pou Journey, Summary, Docs, Record)
  // During pou-convo / pou-review, show mini pou dots instead
  const showPouDots = stage === 'pou-convo' || stage === 'pou-processing' || stage === 'pou-review'
  const macroPhases: SessionStageKey[] = ['setup', 'pou-overview', 'pou-summary', 'risks', 'record']
  const macroIdx = macroPhases.indexOf(stage)

  return (
    <div
      className="flex-shrink-0"
      style={{ backgroundColor: 'var(--color-ground)', borderBottom: '1px solid var(--color-border)' }}
    >
      {/* Ridge */}
      <div className="h-1 w-full" style={{ backgroundColor: 'var(--color-ridge)' }} />

      {/* Meta row */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <button
          onClick={onBack}
          className="text-xs active:opacity-50 transition-opacity min-h-[32px]"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', paddingRight: 12 }}
        >
          ← Hoki
        </button>

        <div className="text-center">
          {centreLabel && (
            <div>
              <p className="text-xs tracking-wide leading-tight" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.1em' }}>
                {centreLabel.main}
              </p>
              {centreLabel.sub && centreLabel.sub !== centreLabel.main && (
                <p className="text-xs leading-tight" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', fontSize: '0.62rem' }}>
                  {centreLabel.sub}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="text-right">
          <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>
            {sessionRef}
          </span>
          {whanauCode && (
            <span className="ml-1.5 text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>
              {whanauCode}
            </span>
          )}
        </div>
      </div>

      {/* Progress indicator */}
      {stage !== 'complete' && stage !== 'synthesising' && (
        <div className="px-4 pb-2">
          {showPouDots && pouIdx !== undefined ? (
            // Six pou dots — shows journey through all pou
            <div className="flex gap-0.5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="flex-1 transition-all"
                  style={{
                    height: i === pouIdx ? 4 : 2,
                    backgroundColor:
                      i < pouIdx
                        ? 'var(--color-growth)'
                        : i === pouIdx
                          ? 'var(--color-ridge)'
                          : 'var(--color-border-strong)',
                  }}
                />
              ))}
            </div>
          ) : (
            // Macro phase rail
            <div className="flex gap-0.5">
              {macroPhases.map((s, i) => (
                <div
                  key={s}
                  className="flex-1 transition-all"
                  style={{
                    height: i === macroIdx ? 3 : 2,
                    backgroundColor:
                      macroIdx === -1 ? 'var(--color-border-strong)'
                      : i < macroIdx ? 'var(--color-growth)'
                      : i === macroIdx ? 'var(--color-ridge)'
                      : 'var(--color-border-strong)',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
