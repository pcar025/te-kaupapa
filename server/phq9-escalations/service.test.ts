import { describe, expect, it, vi } from 'vitest'

import { Phq9EscalationDeliveryService } from './service.js'
import { phq9EscalationEmail, SesPhq9EscalationEmailSender } from './ses.js'

const queuedItem = {
  id: '11111111-1111-4111-8111-111111111111',
  recipientEmail: 'supervisor@example.invalid',
}

describe('PHQ-9 supervisor escalation delivery', () => {
  it('uses a minimal SES message and records provider acceptance, not human acknowledgement', async () => {
    const repository = {
      recoverStaleSending: vi.fn(async () => undefined),
      revalidateClaimedRecipient: vi.fn(async () => true),
      claimNext: vi.fn(async () => queuedItem),
      providerAccepted: vi.fn(async () => undefined),
      failed: vi.fn(async () => undefined),
    }
    const sender = { send: vi.fn(async () => ({ messageId: 'ses-message-id' })) }
    await new Phq9EscalationDeliveryService(repository as never, sender).processOne()
    expect(sender.send).toHaveBeenCalledWith({ to: 'supervisor@example.invalid' })
    expect(repository.providerAccepted).toHaveBeenCalledWith(queuedItem.id, 'ses-message-id')
    expect(repository.failed).not.toHaveBeenCalled()
    expect(phq9EscalationEmail()).toEqual({
      subject: 'Te Kaupapa review required',
      body: 'A Te Kaupapa escalation requires your review. Please sign in to Te Kaupapa to review the relevant record.',
    })
    expect(JSON.stringify(phq9EscalationEmail())).not.toMatch(/transcript|narrative|PHQ-9 score/i)
  })

  it('keeps the durable requirement and records a bounded failure when configuration or provider delivery is unavailable', async () => {
    const repository = {
      recoverStaleSending: vi.fn(async () => undefined),
      revalidateClaimedRecipient: vi.fn(async () => true),
      claimNext: vi.fn(async () => queuedItem),
      providerAccepted: vi.fn(async () => undefined),
      failed: vi.fn(async () => undefined),
    }
    await new Phq9EscalationDeliveryService(repository as never, undefined).processOne()
    expect(repository.failed).toHaveBeenCalledWith(queuedItem.id, 'configuration')

    const transientRepository = { ...repository, claimNext: vi.fn(async () => queuedItem), failed: vi.fn(async () => undefined) }
    await new Phq9EscalationDeliveryService(transientRepository as never, { send: vi.fn(async () => { throw { name: 'TooManyRequestsException' } }) }).processOne()
    expect(transientRepository.failed).toHaveBeenCalledWith(queuedItem.id, 'transient')

    const ambiguousRepository = { ...repository, claimNext: vi.fn(async () => queuedItem), failed: vi.fn(async () => undefined) }
    await new Phq9EscalationDeliveryService(ambiguousRepository as never, { send: vi.fn(async () => { throw new Error('network interrupted') }) }).processOne()
    expect(ambiguousRepository.failed).toHaveBeenCalledWith(queuedItem.id, 'ambiguous')
  })

  it('maps the configured sender and recipient into the SES v2 simple-email request', async () => {
    let sentCommand: { input: unknown } | undefined
    const sender = new SesPhq9EscalationEmailSender('ap-southeast-2', 'configured@example.invalid', { send: async (command: { input: unknown }) => {
      sentCommand = command
      return { MessageId: 'ses-message-id' }
    } } as never)
    await expect(sender.send({ to: 'supervisor@example.invalid' })).resolves.toEqual({ messageId: 'ses-message-id' })
    expect(sentCommand!.input).toMatchObject({
      FromEmailAddress: 'configured@example.invalid',
      Destination: { ToAddresses: ['supervisor@example.invalid'] },
      Content: { Simple: { Subject: { Data: 'Te Kaupapa review required' } } },
    })
  })
})
