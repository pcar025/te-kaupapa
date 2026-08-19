import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import EntryScreen from './EntryScreen'

describe('trusted-device sign-in choice', () => {
  it('is opt-in and sends the selected value only when sign-in is chosen', async () => {
    const onSignIn = vi.fn()
    const user = userEvent.setup()
    render(<EntryScreen onKaimahi={() => undefined} onSupervisor={() => undefined} onSignIn={onSignIn} />)

    const choice = screen.getByRole('checkbox', { name: /Keep me signed in on this device for 30 days/i })
    expect((choice as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText(/private or individually assigned device/i)).toBeTruthy()
    await user.click(choice)
    await user.click(screen.getByRole('button', { name: 'Waitohu mai — Sign in' }))
    expect(onSignIn).toHaveBeenCalledWith(true)
  })
})
