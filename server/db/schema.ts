import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const userStatus = pgEnum('user_status', ['active', 'inactive'])
export const applicationRole = pgEnum('application_role', ['KAIMAHI', 'SUPERVISOR'])

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
  (table) => [uniqueIndex('app_user_organisation_email_uq').on(table.organisationId, table.email)],
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
