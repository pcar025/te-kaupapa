import { and, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'

import * as schema from '../db/schema.js'

type Database = NodePgDatabase<typeof schema>

export type Phq9EscalationStatus = 'recipient_unresolved' | 'queued' | 'sending' | 'provider_accepted' | 'failed' | 'retry_pending'

export interface Phq9EscalationWriter {
  createRequiredInTransaction(executor: Database, input: {
    organisationId: string; workflowSessionId: string; confirmationInteractionId: string
    ruleCode: string; ruleVersion: number; kaimahiUserId: string; createdAt: Date
  }): Promise<void>
}

/** PostgreSQL is the authoritative requirement and outbox. It never selects an arbitrary supervisor. */
export class PostgresPhq9SupervisorEscalationRepository implements Phq9EscalationWriter {
  constructor(private readonly db: Database, private readonly now: () => Date = () => new Date()) {}

  async createRequiredInTransaction(executor: Database, input: {
    organisationId: string; workflowSessionId: string; confirmationInteractionId: string
    ruleCode: string; ruleVersion: number; kaimahiUserId: string; createdAt: Date
  }): Promise<void> {
    const recipients = await executor.select({ id: schema.appUsers.id, email: schema.appUsers.email })
      .from(schema.supervision)
      .innerJoin(schema.appUsers, and(eq(schema.supervision.supervisorUserId, schema.appUsers.id), eq(schema.supervision.organisationId, schema.appUsers.organisationId)))
      .innerJoin(schema.roleAssignments, and(eq(schema.roleAssignments.userId, schema.appUsers.id), eq(schema.roleAssignments.role, 'SUPERVISOR')))
      .where(and(eq(schema.supervision.organisationId, input.organisationId), eq(schema.supervision.kaimahiUserId, input.kaimahiUserId), eq(schema.appUsers.status, 'active')))
    // First apply the exact-one policy; a malformed address must never turn two
    // authorised relationships into an arbitrary valid-looking recipient.
    const candidate = recipients.length === 1 ? recipients[0] : undefined
    const recipient = candidate && z.string().email().safeParse(candidate.email).success ? candidate : undefined
    await executor.insert(schema.workflowPhq9SupervisorEscalations).values({
      organisationId: input.organisationId, workflowSessionId: input.workflowSessionId, phq9ConfirmationInteractionId: input.confirmationInteractionId,
      ruleCode: input.ruleCode, ruleVersion: input.ruleVersion, kaimahiUserId: input.kaimahiUserId,
      supervisorUserId: recipient?.id, recipientEmail: recipient?.email,
      status: recipient ? 'queued' : 'recipient_unresolved', createdAt: input.createdAt, updatedAt: input.createdAt,
    }).onConflictDoNothing({ target: schema.workflowPhq9SupervisorEscalations.workflowSessionId })
  }

  async findForWorkflow(organisationId: string, workflowSessionId: string) {
    return (await this.db.select().from(schema.workflowPhq9SupervisorEscalations).where(and(eq(schema.workflowPhq9SupervisorEscalations.organisationId, organisationId), eq(schema.workflowPhq9SupervisorEscalations.workflowSessionId, workflowSessionId))).limit(1))[0] ?? null
  }

  async findAssignedToSupervisor(organisationId: string, supervisorUserId: string) {
    const kaimahi = alias(schema.appUsers, 'phq9_escalation_kaimahi')
    return this.db.select({
      id: schema.workflowPhq9SupervisorEscalations.id,
      workflowReference: schema.workflowSessions.reference,
      kaimahiDisplayName: kaimahi.displayName,
      createdAt: schema.workflowPhq9SupervisorEscalations.createdAt,
      status: schema.workflowPhq9SupervisorEscalations.status,
    })
      .from(schema.workflowPhq9SupervisorEscalations)
      .innerJoin(schema.workflowSessions, and(eq(schema.workflowPhq9SupervisorEscalations.workflowSessionId, schema.workflowSessions.id), eq(schema.workflowPhq9SupervisorEscalations.organisationId, schema.workflowSessions.organisationId)))
      .innerJoin(kaimahi, and(eq(schema.workflowPhq9SupervisorEscalations.kaimahiUserId, kaimahi.id), eq(schema.workflowPhq9SupervisorEscalations.organisationId, kaimahi.organisationId)))
      .innerJoin(schema.supervision, and(eq(schema.supervision.organisationId, schema.workflowPhq9SupervisorEscalations.organisationId), eq(schema.supervision.kaimahiUserId, schema.workflowPhq9SupervisorEscalations.kaimahiUserId), eq(schema.supervision.supervisorUserId, supervisorUserId)))
      .innerJoin(schema.appUsers, and(eq(schema.appUsers.id, schema.supervision.supervisorUserId), eq(schema.appUsers.organisationId, schema.supervision.organisationId)))
      .innerJoin(schema.roleAssignments, and(eq(schema.roleAssignments.userId, schema.appUsers.id), eq(schema.roleAssignments.role, 'SUPERVISOR')))
      .where(and(eq(schema.workflowPhq9SupervisorEscalations.organisationId, organisationId), eq(schema.workflowPhq9SupervisorEscalations.supervisorUserId, supervisorUserId), eq(schema.appUsers.status, 'active'), sql`(select count(*) from supervision relation join app_user supervisor on supervisor.id = relation.supervisor_user_id and supervisor.organisation_id = relation.organisation_id join role_assignment role on role.user_id = supervisor.id and role.role = 'SUPERVISOR' where relation.organisation_id = ${schema.workflowPhq9SupervisorEscalations.organisationId} and relation.kaimahi_user_id = ${schema.workflowPhq9SupervisorEscalations.kaimahiUserId} and supervisor.status = 'active') = 1`))
  }

  /** A read is permitted only while the original exact-one assignment remains valid. */
  async findAssignedDetailToSupervisor(organisationId: string, supervisorUserId: string, escalationId: string) {
    const kaimahi = alias(schema.appUsers, 'phq9_escalation_detail_kaimahi')
    const [detail] = await this.db.select({
      id: schema.workflowPhq9SupervisorEscalations.id,
      workflowReference: schema.workflowSessions.reference,
      kaimahiDisplayName: kaimahi.displayName,
      createdAt: schema.workflowPhq9SupervisorEscalations.createdAt,
      status: schema.workflowPhq9SupervisorEscalations.status,
      confirmedTotalScore: schema.workflowKaitiakitangaPhq9Confirmations.confirmedTotalScore,
      ruleCode: schema.workflowKaitiakitangaPhq9Confirmations.escalationRuleCode,
      ruleVersion: schema.workflowKaitiakitangaPhq9Confirmations.escalationRuleVersion,
      /** Canonical Kaitiakitanga review text, never a newly generated Supervisor summary. */
      contextSummary: schema.workflowPouReviews.overallSummary,
    })
      .from(schema.workflowPhq9SupervisorEscalations)
      .innerJoin(schema.workflowSessions, and(eq(schema.workflowPhq9SupervisorEscalations.workflowSessionId, schema.workflowSessions.id), eq(schema.workflowPhq9SupervisorEscalations.organisationId, schema.workflowSessions.organisationId)))
      .innerJoin(schema.workflowKaitiakitangaPhq9Confirmations, and(eq(schema.workflowPhq9SupervisorEscalations.workflowSessionId, schema.workflowKaitiakitangaPhq9Confirmations.workflowSessionId), eq(schema.workflowPhq9SupervisorEscalations.organisationId, schema.workflowKaitiakitangaPhq9Confirmations.organisationId), eq(schema.workflowPhq9SupervisorEscalations.phq9ConfirmationInteractionId, schema.workflowKaitiakitangaPhq9Confirmations.interactionId)))
      .leftJoin(schema.workflowPouReviews, and(eq(schema.workflowPouReviews.workflowSessionId, schema.workflowPhq9SupervisorEscalations.workflowSessionId), eq(schema.workflowPouReviews.organisationId, schema.workflowPhq9SupervisorEscalations.organisationId), eq(schema.workflowPouReviews.pouId, 'kaitiakitanga')))
      .innerJoin(kaimahi, and(eq(schema.workflowPhq9SupervisorEscalations.kaimahiUserId, kaimahi.id), eq(schema.workflowPhq9SupervisorEscalations.organisationId, kaimahi.organisationId)))
      .innerJoin(schema.supervision, and(eq(schema.supervision.organisationId, schema.workflowPhq9SupervisorEscalations.organisationId), eq(schema.supervision.kaimahiUserId, schema.workflowPhq9SupervisorEscalations.kaimahiUserId), eq(schema.supervision.supervisorUserId, supervisorUserId)))
      .innerJoin(schema.appUsers, and(eq(schema.appUsers.id, schema.supervision.supervisorUserId), eq(schema.appUsers.organisationId, schema.supervision.organisationId)))
      .innerJoin(schema.roleAssignments, and(eq(schema.roleAssignments.userId, schema.appUsers.id), eq(schema.roleAssignments.role, 'SUPERVISOR')))
      .where(and(eq(schema.workflowPhq9SupervisorEscalations.id, escalationId), eq(schema.workflowPhq9SupervisorEscalations.organisationId, organisationId), eq(schema.workflowPhq9SupervisorEscalations.supervisorUserId, supervisorUserId), eq(schema.appUsers.status, 'active'), sql`(select count(*) from supervision relation join app_user supervisor on supervisor.id = relation.supervisor_user_id and supervisor.organisation_id = relation.organisation_id join role_assignment role on role.user_id = supervisor.id and role.role = 'SUPERVISOR' where relation.organisation_id = ${schema.workflowPhq9SupervisorEscalations.organisationId} and relation.kaimahi_user_id = ${schema.workflowPhq9SupervisorEscalations.kaimahiUserId} and supervisor.status = 'active') = 1`))
      .limit(1)
    return detail ?? null
  }

  /** Revocation, deactivation, ambiguity, or an address change after enqueue fails closed before I/O. */
  private async markInvalidRecipientsUnresolved(executor: Database): Promise<void> {
    const now = this.now()
    await executor.execute(sql`
      update workflow_phq9_supervisor_escalation escalation
      set status = 'recipient_unresolved', supervisor_user_id = null, recipient_email = null,
          failure_category = null, updated_at = ${now}
      where escalation.status in ('queued', 'retry_pending')
        and (
          (select count(*)
             from supervision relation
             join app_user supervisor on supervisor.id = relation.supervisor_user_id and supervisor.organisation_id = relation.organisation_id
             join role_assignment role on role.user_id = supervisor.id and role.role = 'SUPERVISOR'
            where relation.organisation_id = escalation.organisation_id
              and relation.kaimahi_user_id = escalation.kaimahi_user_id
              and supervisor.status = 'active') <> 1
          or not exists (
            select 1
              from supervision relation
              join app_user supervisor on supervisor.id = relation.supervisor_user_id and supervisor.organisation_id = relation.organisation_id
              join role_assignment role on role.user_id = supervisor.id and role.role = 'SUPERVISOR'
             where relation.organisation_id = escalation.organisation_id
               and relation.kaimahi_user_id = escalation.kaimahi_user_id
               and relation.supervisor_user_id = escalation.supervisor_user_id
               and supervisor.status = 'active'
               and supervisor.email = escalation.recipient_email
          )
        )
    `)
  }

  /** An interrupted external request is never resent automatically because SES has no client idempotency key. */
  async recoverStaleSending(): Promise<void> {
    const now = this.now()
    const staleBefore = new Date(now.getTime() - 5 * 60_000)
    await this.db.update(schema.workflowPhq9SupervisorEscalations)
      .set({ status: 'failed', failureCategory: 'ambiguous', updatedAt: now })
      .where(and(eq(schema.workflowPhq9SupervisorEscalations.status, 'sending'), sql`${schema.workflowPhq9SupervisorEscalations.lastAttemptAt} <= ${staleBefore}`))
  }

  /** The authorization snapshot is rechecked immediately before the provider call. */
  async revalidateClaimedRecipient(id: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const valid = await tx.execute(sql`
        select 1 from workflow_phq9_supervisor_escalation escalation
        where escalation.id = ${id}
          and escalation.status = 'sending'
          and (select count(*)
                 from supervision relation
                 join app_user supervisor on supervisor.id = relation.supervisor_user_id and supervisor.organisation_id = relation.organisation_id
                 join role_assignment role on role.user_id = supervisor.id and role.role = 'SUPERVISOR'
                where relation.organisation_id = escalation.organisation_id
                  and relation.kaimahi_user_id = escalation.kaimahi_user_id
                  and supervisor.status = 'active') = 1
          and exists (
            select 1 from supervision relation
            join app_user supervisor on supervisor.id = relation.supervisor_user_id and supervisor.organisation_id = relation.organisation_id
            join role_assignment role on role.user_id = supervisor.id and role.role = 'SUPERVISOR'
            where relation.organisation_id = escalation.organisation_id
              and relation.kaimahi_user_id = escalation.kaimahi_user_id
              and relation.supervisor_user_id = escalation.supervisor_user_id
              and supervisor.status = 'active'
              and supervisor.email = escalation.recipient_email
          )
        for update
      `)
      if (valid.rows.length === 1) return true
      await tx.update(schema.workflowPhq9SupervisorEscalations)
        .set({ status: 'recipient_unresolved', supervisorUserId: null, recipientEmail: null, failureCategory: null, updatedAt: this.now() })
        .where(and(eq(schema.workflowPhq9SupervisorEscalations.id, id), eq(schema.workflowPhq9SupervisorEscalations.status, 'sending')))
      return false
    })
  }

  /** Claims one queued item before external I/O. A crashed/ambiguous sending attempt is deliberately not retried automatically. */
  async claimNext(): Promise<typeof schema.workflowPhq9SupervisorEscalations.$inferSelect | null> {
    return this.db.transaction(async (tx) => {
      await this.markInvalidRecipientsUnresolved(tx)
      const locked = await tx.execute(sql`select id from workflow_phq9_supervisor_escalation where status in ('queued', 'retry_pending') and attempt_count < 3 order by created_at for update skip locked limit 1`)
      const id = locked.rows[0]?.id
      if (typeof id !== 'string') return null
      const [claimed] = await tx.update(schema.workflowPhq9SupervisorEscalations).set({ status: 'sending', attemptCount: sql`${schema.workflowPhq9SupervisorEscalations.attemptCount} + 1`, lastAttemptAt: this.now(), updatedAt: this.now(), failureCategory: null }).where(eq(schema.workflowPhq9SupervisorEscalations.id, id)).returning()
      return claimed ?? null
    })
  }

  async providerAccepted(id: string, messageId: string) {
    const now = this.now()
    await this.db.update(schema.workflowPhq9SupervisorEscalations).set({ status: 'provider_accepted', providerMessageId: messageId, providerAcceptedAt: now, updatedAt: now, failureCategory: null }).where(and(eq(schema.workflowPhq9SupervisorEscalations.id, id), eq(schema.workflowPhq9SupervisorEscalations.status, 'sending')))
  }

  async failed(id: string, failureCategory: 'configuration' | 'permanent' | 'ambiguous' | 'transient') {
    const now = this.now()
    const [current] = await this.db.select({ attemptCount: schema.workflowPhq9SupervisorEscalations.attemptCount }).from(schema.workflowPhq9SupervisorEscalations).where(eq(schema.workflowPhq9SupervisorEscalations.id, id)).limit(1)
    const retry = failureCategory === 'transient' && (current?.attemptCount ?? 3) < 3
    await this.db.update(schema.workflowPhq9SupervisorEscalations).set({ status: retry ? 'retry_pending' : 'failed', failureCategory, updatedAt: now }).where(and(eq(schema.workflowPhq9SupervisorEscalations.id, id), eq(schema.workflowPhq9SupervisorEscalations.status, 'sending')))
  }
}
