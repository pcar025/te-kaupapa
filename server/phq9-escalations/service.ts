import type { Phq9EscalationEmailSender } from './ses.js'
import { PostgresPhq9SupervisorEscalationRepository } from './repository.js'

function failureCategory(error: unknown): 'configuration' | 'permanent' | 'ambiguous' | 'transient' {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
  if (['AccessDeniedException', 'BadRequestException', 'MessageRejected', 'NotFoundException'].includes(name)) return 'permanent'
  if (['TooManyRequestsException', 'ServiceUnavailableException'].includes(name)) return 'transient'
  return 'ambiguous'
}

/** Processes at most one durable item. Startup and the bounded timer invoke it; browser state is never required. */
export class Phq9EscalationDeliveryService {
  constructor(private readonly repository: PostgresPhq9SupervisorEscalationRepository, private readonly sender: Phq9EscalationEmailSender | undefined) {}
  async processOne(): Promise<void> {
    await this.repository.recoverStaleSending()
    const item = await this.repository.claimNext()
    if (!item) return
    if (!this.sender || !item.recipientEmail) {
      await this.repository.failed(item.id, 'configuration')
      return
    }
    if (!await this.repository.revalidateClaimedRecipient(item.id)) return
    try {
      const result = await this.sender.send({ to: item.recipientEmail })
      await this.repository.providerAccepted(item.id, result.messageId)
    } catch (error) {
      await this.repository.failed(item.id, failureCategory(error))
    }
  }
}
