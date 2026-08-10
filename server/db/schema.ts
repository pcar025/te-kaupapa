import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const userStatus = pgEnum('user_status', ['active', 'inactive'])
export const applicationRole = pgEnum('application_role', ['KAIMAHI', 'SUPERVISOR'])
export const workflowStatus = pgEnum('workflow_status', ['draft', 'in_progress', 'completed', 'abandoned'])
export const workflowStage = pgEnum('workflow_stage', ['setup', 'pou-overview', 'pou-convo', 'pou-summary'])
export const workflowPouId = pgEnum('workflow_pou_id', [
  'whakapapa',
  'manaakitanga',
  'tikanga',
  'kaitiakitanga',
  'puukenga',
  'haepapa',
  'oranga',
])
export const workflowEngagementType = pgEnum('workflow_engagement_type', ['home-visit', 'phone', 'office', 'hui', 'outreach'])
export const workflowImmediateConcern = pgEnum('workflow_immediate_concern', ['none', 'unsure', 'urgent'])
export const workflowPouConcern = pgEnum('workflow_pou_concern', ['low', 'watch', 'action', 'urgent'])
export const workflowPouProgress = pgEnum('workflow_pou_progress', ['not_started', 'confirmed'])
export const workflowInteractionType = pgEnum('workflow_interaction_type', [
  'workflow_created',
  'setup_confirmed',
  'pou_review_confirmed',
])

export const organisations = pgTable('organisation', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const appUsers = pgTable(
  'app_user',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    displayName: text('display_name').notNull(),
    email: text('email').notNull(),
    status: userStatus('status').default('active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('app_user_organisation_email_uq').on(table.organisationId, table.email),
    uniqueIndex('app_user_id_organisation_uq').on(table.id, table.organisationId),
  ],
)

export const externalIdentities = pgTable(
  'external_identity',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('external_identity_provider_subject_uq').on(table.provider, table.providerSubject)],
)

export const roleAssignments = pgTable(
  'role_assignment',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
    role: applicationRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('role_assignment_user_role_uq').on(table.userId, table.role)],
)

export const supervision = pgTable(
  'supervision',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    supervisorUserId: uuid('supervisor_user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
    kaimahiUserId: uuid('kaimahi_user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('supervision_relation_uq').on(table.organisationId, table.supervisorUserId, table.kaimahiUserId)],
)

export const applicationSessions = pgTable(
  'application_session',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
)

export const workflowSessions = pgTable(
  'workflow_session',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    kaimahiUserId: uuid('kaimahi_user_id').notNull(),
    reference: text('reference').notNull(),
    whanauReference: text('whanau_reference'),
    engagementType: workflowEngagementType('engagement_type'),
    sessionFocus: text('session_focus'),
    additionalNotes: text('additional_notes'),
    immediateConcern: workflowImmediateConcern('immediate_concern'),
    status: workflowStatus('status').default('draft').notNull(),
    currentStage: workflowStage('current_stage').default('setup').notNull(),
    currentPouId: workflowPouId('current_pou_id'),
    version: integer('version').default(1).notNull(),
    setupConfirmedAt: timestamp('setup_confirmed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    abandonedAt: timestamp('abandoned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.kaimahiUserId, table.organisationId],
      foreignColumns: [appUsers.id, appUsers.organisationId],
      name: 'workflow_session_kaimahi_organisation_fk',
    }),
    uniqueIndex('workflow_session_organisation_reference_uq').on(table.organisationId, table.reference),
    uniqueIndex('workflow_session_id_organisation_uq').on(table.id, table.organisationId),
    uniqueIndex('workflow_session_one_resumable_per_kaimahi_uq')
      .on(table.kaimahiUserId)
      .where(sql`${table.status} in ('draft', 'in_progress')`),
    index('workflow_session_kaimahi_status_updated_idx').on(table.kaimahiUserId, table.status, table.updatedAt),
    index('workflow_session_organisation_whanau_updated_idx').on(table.organisationId, table.whanauReference, table.updatedAt),
    check('workflow_session_version_positive', sql`${table.version} > 0`),
    check('workflow_session_whanau_reference_length', sql`${table.whanauReference} is null or length(${table.whanauReference}) <= 64`),
  ],
)

export const workflowPouCheckpoints = pgTable(
  'workflow_pou_checkpoint',
  {
    workflowSessionId: uuid('workflow_session_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    pouId: workflowPouId('pou_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    progress: workflowPouProgress('progress').default('not_started').notNull(),
    userSelectedConcern: workflowPouConcern('user_selected_concern'),
    note: text('note'),
    referralSuggested: boolean('referral_suggested').default(false).notNull(),
    supervisorReviewSuggested: boolean('supervisor_review_suggested').default(false).notNull(),
    confirmedByUserId: uuid('confirmed_by_user_id'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workflowSessionId, table.pouId], name: 'workflow_pou_checkpoint_pk' }),
    foreignKey({
      columns: [table.workflowSessionId, table.organisationId],
      foreignColumns: [workflowSessions.id, workflowSessions.organisationId],
      name: 'workflow_pou_checkpoint_session_organisation_fk',
    }),
    foreignKey({
      columns: [table.confirmedByUserId, table.organisationId],
      foreignColumns: [appUsers.id, appUsers.organisationId],
      name: 'workflow_pou_checkpoint_confirming_user_organisation_fk',
    }),
    uniqueIndex('workflow_pou_checkpoint_session_ordinal_uq').on(table.workflowSessionId, table.ordinal),
    check('workflow_pou_checkpoint_ordinal_range', sql`${table.ordinal} between 1 and 7`),
  ],
)

export const workflowInteractions = pgTable(
  'workflow_interaction',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    actorUserId: uuid('actor_user_id').notNull(),
    type: workflowInteractionType('type').notNull(),
    pouId: workflowPouId('pou_id'),
    idempotencyKey: uuid('idempotency_key').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    expectedVersion: integer('expected_version'),
    resultingVersion: integer('resulting_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workflowSessionId, table.organisationId],
      foreignColumns: [workflowSessions.id, workflowSessions.organisationId],
      name: 'workflow_interaction_session_organisation_fk',
    }),
    foreignKey({
      columns: [table.actorUserId, table.organisationId],
      foreignColumns: [appUsers.id, appUsers.organisationId],
      name: 'workflow_interaction_actor_organisation_fk',
    }),
    uniqueIndex('workflow_interaction_actor_idempotency_uq').on(table.actorUserId, table.idempotencyKey),
    index('workflow_interaction_session_created_idx').on(table.workflowSessionId, table.createdAt),
    check('workflow_interaction_resulting_version_positive', sql`${table.resultingVersion} > 0`),
  ],
)
