import { Component, type ErrorInfo, type ReactNode } from 'react'

export function VoiceChunkLoading({ onProceedToReview }: { onProceedToReview: () => void }) {
  return (
    <div className="flex flex-col" style={{ minHeight: '82vh', fontFamily: 'var(--font-body)' }} aria-live="polite">
      <div className="py-16 px-8 text-center">
        <p className="text-sm italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-muted)' }}>Loading voice reflection…</p>
      </div>
      <div className="px-5 py-5">
        <button type="button" onClick={onProceedToReview} className="w-full py-3 text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border-strong)' }}>Continue to manual review</button>
      </div>
    </div>
  )
}

export class VoiceChunkBoundary extends Component<{ children: ReactNode; onProceedToReview: () => void; pouNumber?: number; pouName?: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: true } {
    return { failed: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // The failure is deliberately contained here. It must not include provider
    // authorization, microphone access, or conversation content.
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex flex-col" style={{ minHeight: '82vh', fontFamily: 'var(--font-body)' }} role="alert">
        <div className="px-6 pt-9 pb-7">
          <p className="text-xs tracking-widest uppercase mb-5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)', letterSpacing: '0.14em' }}>Pou {this.props.pouNumber ?? 1} o 7 — Kōrero</p>
          <h2 className="mb-3 leading-snug" style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--color-ink)' }}>{this.props.pouName ?? 'Whakapapa'}</h2>
          <p className="text-sm italic leading-relaxed" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink-secondary)' }}>Voice reflection could not be loaded. No conversation was started.</p>
        </div>
        <div className="mx-6" style={{ height: 1, backgroundColor: 'var(--color-border)' }} />
        <div className="px-5 py-5">
          <button type="button" onClick={this.props.onProceedToReview} className="w-full py-3 text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border-strong)' }}>Continue to manual review</button>
        </div>
      </div>
    )
  }
}
