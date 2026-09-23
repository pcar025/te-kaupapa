import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

export interface Phq9EscalationEmailSender { send(input: { to: string }): Promise<{ messageId: string }> }

export function phq9EscalationEmail(): { subject: string; body: string } {
  return { subject: 'Te Kaupapa review required', body: 'A Te Kaupapa escalation requires your review. Please sign in to Te Kaupapa to review the relevant record.' }
}

export class SesPhq9EscalationEmailSender implements Phq9EscalationEmailSender {
  private readonly client: SESv2Client
  constructor(region: 'ap-southeast-2', private readonly from: string, client?: SESv2Client) { this.client = client ?? new SESv2Client({ region }) }
  async send(input: { to: string }): Promise<{ messageId: string }> {
    const email = phq9EscalationEmail()
    const result = await this.client.send(new SendEmailCommand({ FromEmailAddress: this.from, Destination: { ToAddresses: [input.to] }, Content: { Simple: { Subject: { Data: email.subject, Charset: 'UTF-8' }, Body: { Text: { Data: email.body, Charset: 'UTF-8' } } } } }))
    if (!result.MessageId) throw new Error('SES accepted the request without a message identifier.')
    return { messageId: result.MessageId }
  }
}
