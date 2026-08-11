import { lazy, Suspense } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VoiceChunkBoundary, VoiceChunkLoading } from './VoiceChunkBoundary'

describe('VoiceChunkBoundary', () => {
  afterEach(() => cleanup())

  it('shows a truthful loading state without voice side effects while the lazy module is pending', () => {
    const onProceedToReview = vi.fn()
    const PendingVoice = lazy(() => new Promise<{ default: () => null }>(() => undefined))
    render(<VoiceChunkBoundary onProceedToReview={onProceedToReview}><Suspense fallback={<VoiceChunkLoading onProceedToReview={onProceedToReview} />}><PendingVoice /></Suspense></VoiceChunkBoundary>)
    expect(screen.getByText('Loading voice reflection…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /continue to manual review/i }))
    expect(onProceedToReview).toHaveBeenCalledTimes(1)
  })

  it('contains a rejected lazy module and keeps manual review available', async () => {
    const onProceedToReview = vi.fn()
    const FailingVoice = lazy(() => Promise.reject(new Error('voice chunk unavailable')))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<VoiceChunkBoundary onProceedToReview={onProceedToReview}><Suspense fallback={<VoiceChunkLoading onProceedToReview={onProceedToReview} />}><FailingVoice /></Suspense></VoiceChunkBoundary>)
    expect((await screen.findByRole('alert')).textContent).toContain('Voice reflection could not be loaded')
    fireEvent.click(screen.getByRole('button', { name: /continue to manual review/i }))
    expect(onProceedToReview).toHaveBeenCalledTimes(1)
  })
})
