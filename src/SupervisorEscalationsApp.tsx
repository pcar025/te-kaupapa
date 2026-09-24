import { useEffect, useState } from 'react'

import type { AuthProfile } from './auth'

type DeliveryStatus = 'recipient_unresolved' | 'queued' | 'sending' | 'provider_accepted' | 'failed' | 'retry_pending'

interface EscalationListItem {
  id: string
  workflowReference: string
  kaimahiDisplayName: string
  createdAt: string
  status: DeliveryStatus
}

interface EscalationDetail extends EscalationListItem {
  confirmedTotalScore: number
  ruleCode: string
  ruleVersion: number
  contextSummary: string | null
}

function deliveryLabel(status: DeliveryStatus) {
  if (status === 'provider_accepted') return 'Sent to email service'
  if (status === 'failed') return 'Automatic notification failed'
  return 'Notification pending'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-NZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('read_unavailable')
  return response.json() as Promise<T>
}

/** This is intentionally separate from the static Supervisor prototype screens. */
export default function SupervisorEscalationsApp({ onBack, profile }: { onBack: () => void; profile: AuthProfile }) {
  const [escalations, setEscalations] = useState<EscalationListItem[] | null>(null)
  const [detail, setDetail] = useState<EscalationDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void readJson<{ escalations: EscalationListItem[] }>('/api/phq9-escalations/assigned')
      .then((payload) => { if (active) setEscalations(payload.escalations) })
      .catch(() => { if (active) setError('Your assigned escalations are unavailable right now.') })
    return () => { active = false }
  }, [])

  async function openDetail(id: string) {
    setError(null)
    try {
      const payload = await readJson<{ escalation: EscalationDetail }>(`/api/phq9-escalations/assigned/${id}`)
      setDetail(payload.escalation)
    } catch {
      setDetail(null)
      setError('This escalation is no longer available.')
    }
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--color-ground)', fontFamily: 'var(--font-body)' }}>
      <div style={{ height: 4, backgroundColor: 'var(--color-ridge)' }} />
      <div className="max-w-3xl mx-auto px-6 py-8 sm:px-10">
        <button onClick={onBack} className="text-xs mb-10 transition-opacity hover:opacity-70" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>
          ← Back to Te Kaupapa
        </button>
        <p className="text-xs tracking-widest uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.14em' }}>
          Mātāmua · Supervisor view
        </p>
        <h1 className="text-3xl font-medium italic mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
          Assigned escalations
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--color-ink-secondary)' }}>
          {profile.displayName} · {profile.organisation.name}
        </p>

        {error && <p role="status" className="mb-5 px-4 py-3 text-sm" style={{ backgroundColor: 'var(--color-caution-light)', borderLeft: '3px solid var(--color-caution)', color: 'var(--color-ink-secondary)' }}>{error}</p>}
        {escalations === null && !error && <p role="status" className="text-sm" style={{ color: 'var(--color-ink-secondary)' }}>Loading assigned escalations…</p>}
        {escalations?.length === 0 && <p className="text-sm" style={{ color: 'var(--color-ink-secondary)' }}>No assigned PHQ-9 escalations require your review.</p>}
        {escalations && escalations.length > 0 && (
          <div className="space-y-2">
            {escalations.map((escalation) => (
              <button key={escalation.id} onClick={() => void openDetail(escalation.id)} className="w-full text-left px-5 py-4 transition-opacity hover:opacity-80" style={{ backgroundColor: 'var(--color-surface)', borderLeft: '3px solid var(--color-concern)' }}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>Supervisor review required</p>
                    <p className="text-xs mt-1" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>Kaitiakitanga / PHQ-9 · {escalation.workflowReference}</p>
                    <p className="text-xs mt-2" style={{ color: 'var(--color-ink-secondary)' }}>{escalation.kaimahiDisplayName} · {formatDate(escalation.createdAt)}</p>
                  </div>
                  <p className="text-xs text-right" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>{deliveryLabel(escalation.status)}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {detail && (
          <section aria-label="PHQ-9 escalation detail" className="mt-8 px-5 py-5" style={{ backgroundColor: 'var(--color-surface)', borderTop: '2px solid var(--color-ridge)' }}>
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="text-xs tracking-widest uppercase mb-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.12em' }}>Escalation detail</p>
                <h2 className="text-xl font-medium italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>Supervisor review required</h2>
              </div>
              <button onClick={() => setDetail(null)} className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>Close</button>
            </div>
            <dl className="space-y-3 text-sm" style={{ color: 'var(--color-ink-secondary)' }}>
              <div><dt className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>SOURCE</dt><dd>Kaitiakitanga / PHQ-9</dd></div>
              <div><dt className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>WORKFLOW</dt><dd>{detail.workflowReference}</dd></div>
              <div><dt className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>KAIMAHI</dt><dd>{detail.kaimahiDisplayName}</dd></div>
              <div><dt className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>CREATED</dt><dd>{formatDate(detail.createdAt)}</dd></div>
              <div><dt className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>CONFIRMED PHQ-9 TOTAL SCORE</dt><dd className="font-medium" style={{ color: 'var(--color-ink)' }}>{detail.confirmedTotalScore}</dd></div>
              <div><dt className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>DETERMINISTIC RULE</dt><dd>Confirmed PHQ-9 total score ≥12 requires supervisor escalation (version {detail.ruleVersion}).</dd></div>
              <div><dt className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)' }}>NOTIFICATION</dt><dd>{deliveryLabel(detail.status)}</dd></div>
            </dl>
            {detail.contextSummary && (
              <section className="mt-6 pt-5" style={{ borderTop: '1px solid var(--color-border)' }}>
                <p className="text-xs mb-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}>KAITIAKITANGA CONTEXT SUMMARY</p>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-ink-secondary)' }}>{detail.contextSummary}</p>
              </section>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
