import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
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
export const workflowStage = pgEnum('workflow_stage', [
  'setup',
  'pou-overview',
  'pou-convo',
  'pou-summary',
  'action-planning',
  'referral-planning',
  'structured-review',
  'record-review',
  'complete',
])
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
export const workflowActionType = pgEnum('workflow_action_type', ['follow-up', 'support', 'other'])
export const workflowActionStatus = pgEnum('workflow_action_status', ['open', 'completed', 'withdrawn'])
export const workflowReferralStatus = pgEnum('workflow_referral_status', ['draft', 'prepared', 'declined', 'withdrawn'])
export const workflowSafetyAssessmentContext = pgEnum('workflow_safety_assessment_context', ['setup', 'pou'])
export const workflowSafetyBroadClass = pgEnum('workflow_safety_broad_class', ['whanau_safety', 'practice_quality', 'practitioner_wellbeing'])
export const workflowSafetyConcernLevel = pgEnum('workflow_safety_concern_level', ['unsure', 'low', 'watch', 'action', 'urgent'])
export const workflowSafetyObservationStatus = pgEnum('workflow_safety_observation_status', ['active', 'retracted'])
export const workflowSafetyRevisionOperation = pgEnum('workflow_safety_revision_operation', ['confirmed', 'corrected', 'retracted'])
export const workflowSafetyConsequenceType = pgEnum('workflow_safety_consequence_type', ['supervisor_review_required', 'supervisor_notification_required'])
export const workflowSafetyConsequenceState = pgEnum('workflow_safety_consequence_state', ['required', 'ceased'])
export const workflowSafetyConsequenceCessationReason = pgEnum('workflow_safety_consequence_cessation_reason', ['observation_corrected', 'observation_retracted'])
export const workflowConversationStatus = pgEnum('workflow_conversation_status', ['preparing', 'authorized', 'active', 'ended', 'failed'])
export const workflowInteractionType = pgEnum('workflow_interaction_type', [
  'workflow_created',
  'setup_confirmed',
  'pou_review_confirmed',
  'pou_summary_confirmed',
  'action_plan_confirmed',
  'referral_plan_confirmed',
  'structured_review_confirmed',
  'workflow_completed',
  'safety_observation_confirmed',
  'safety_observation_corrected',
  'safety_observation_retracted',
  'supervisor_review_requested',
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
    completedByUserId: uuid('completed_by_user_id'),
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
    foreignKey({
      columns: [table.completedByUserId, table.organisationId],
      foreignColumns: [appUsers.id, appUsers.organisationId],
      name: 'workflow_session_completed_by_organisation_fk',
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
    uniqueIndex('workflow_pou_checkpoint_session_organisation_pou_uq').on(table.workflowSessionId, table.organisationId, table.pouId),
    check('workflow_pou_checkpoint_ordinal_range', sql`${table.ordinal} between 1 and 7`),
  ],
)

/**
 * Media-session provenance only. Phase 5A intentionally stores neither
 * transcript/audio content nor temporary provider authorization material.
 */
export const workflowConversations = pgTable(
  'workflow_conversation',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    pouId: workflowPouId('pou_id').notNull(),
    startedByUserId: uuid('started_by_user_id').notNull(),
    provider: text('provider').notNull(),
    providerConversationId: text('provider_conversation_id'),
    providerAgentReference: text('provider_agent_reference').notNull(),
    providerBranchReference: text('provider_branch_reference'),
    providerEnvironment: text('provider_environment').notNull(),
    conversationSpecificationCode: text('conversation_specification_code').notNull(),
    conversationSpecificationVersion: integer('conversation_specification_version').notNull(),
    status: workflowConversationStatus('status').default('preparing').notNull(),
    startIdempotencyKey: uuid('start_idempotency_key').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    terminationReason: text('termination_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workflowSessionId, table.organisationId],
      foreignColumns: [workflowSessions.id, workflowSessions.organisationId],
      name: 'workflow_conversation_session_organisation_fk',
    }),
    foreignKey({
      columns: [table.workflowSessionId, table.organisationId, table.pouId],
      foreignColumns: [workflowPouCheckpoints.workflowSessionId, workflowPouCheckpoints.organisationId, workflowPouCheckpoints.pouId],
      name: 'workflow_conversation_checkpoint_organisation_fk',
    }),
    foreignKey({
      columns: [table.startedByUserId, table.organisationId],
      foreignColumns: [appUsers.id, appUsers.organisationId],
      name: 'workflow_conversation_actor_organisation_fk',
    }),
    uniqueIndex('workflow_conversation_provider_reference_uq')
      .on(table.provider, table.providerConversationId)
      .where(sql`${table.providerConversationId} is not null`),
    uniqueIndex('workflow_conversation_actor_start_idempotency_uq').on(table.startedByUserId, table.startIdempotencyKey),
    uniqueIndex('workflow_conversation_one_open_per_pou_uq')
      .on(table.workflowSessionId, table.pouId)
      .where(sql`${table.status} in ('preparing', 'authorized', 'active')`),
    index('workflow_conversation_workflow_created_idx').on(table.workflowSessionId, table.createdAt),
    check('workflow_conversation_provider_length', sql`length(${table.provider}) between 1 and 80`),
    check('workflow_conversation_provider_reference_length', sql`${table.providerConversationId} is null or length(${table.providerConversationId}) between 1 and 255`),
    check('workflow_conversation_agent_reference_length', sql`length(${table.providerAgentReference}) between 1 and 255`),
    check('workflow_conversation_branch_reference_length', sql`${table.providerBranchReference} is null or length(${table.providerBranchReference}) between 1 and 255`),
    check('workflow_conversation_environment_length', sql`length(${table.providerEnvironment}) between 1 and 80`),
    check('workflow_conversation_specification_code_length', sql`length(${table.conversationSpecificationCode}) between 1 and 120`),
    check('workflow_conversation_specification_version_positive', sql`${table.conversationSpecificationVersion} > 0`),
    check('workflow_conversation_termination_reason_length', sql`${table.terminationReason} is null or length(${table.terminationReason}) between 1 and 80`),
    check('workflow_conversation_connection_requires_authorization', sql`${table.connectedAt} is null or ${table.authorizedAt} is not null`),
    check('workflow_conversation_terminal_timestamp', sql`(${table.endedAt} is null) = (${table.status} in ('preparing', 'authorized', 'active'))`),
    check('workflow_conversation_lifecycle_consistency', sql`
      (${table.status} = 'preparing'
        and ${table.providerConversationId} is null
        and ${table.authorizedAt} is null
        and ${table.connectedAt} is null
        and ${table.endedAt} is null
        and ${table.terminationReason} is null)
      or (${table.status} = 'authorized'
        and ${table.providerConversationId} is not null
        and ${table.authorizedAt} is not null
        and ${table.connectedAt} is null
        and ${table.endedAt} is null
        and ${table.terminationReason} is null)
      or (${table.status} = 'active'
        and ${table.providerConversationId} is not null
        and ${table.authorizedAt} is not null
        and ${table.connectedAt} is not null
        and ${table.endedAt} is null
        and ${table.terminationReason} is null)
      or (${table.status} = 'ended'
        and ${table.providerConversationId} is not null
        and ${table.authorizedAt} is not null
        and ${table.endedAt} is not null
        and ${table.terminationReason} is not null)
      or (${table.status} = 'failed'
        and ${table.endedAt} is not null
        and ${table.terminationReason} is not null
        and (
          (${table.providerConversationId} is null and ${table.authorizedAt} is null and ${table.connectedAt} is null)
          or (${table.providerConversationId} is not null and ${table.authorizedAt} is not null)
        ))
    `),
  ],
)

export const workflowActions = pgTable(
  'workflow_action',
  {
    id: uuid('id').primaryKey(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    pouId: workflowPouId('pou_id'),
    title: text('title').notNull(),
    type: workflowActionType('type').notNull(),
    dueDate: date('due_date'),
    status: workflowActionStatus('status').default('open').notNull(),
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    ownerUserId: uuid('owner_user_id').notNull(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workflowSessionId, table.organisationId],
      foreignColumns: [workflowSessions.id, workflowSessions.organisationId],
      name: 'workflow_action_session_organisation_fk',
    }),
    foreignKey({
      columns: [table.workflowSessionId, table.organisationId, table.pouId],
      foreignColumns: [workflowPouCheckpoints.workflowSessionId, workflowPouCheckpoints.organisationId, workflowPouCheckpoints.pouId],
      name: 'workflow_action_checkpoint_organisation_fk',
    }),
    foreignKey({
      columns: [table.createdByUserId, table.organisationId],
      foreignColumns: [appUsers.id, appUsers.organisationId],
      name: 'workflow_action_created_by_organisation_fk',
    }),
    foreignKey({
      columns: [table.ownerUserId, table.organisationId],
      foreignColumns: [appUsers.id, appUsers.organisationId],
      name: 'workflow_action_owner_organisation_fk',
    }),
    index('workflow_action_workflow_status_idx').on(table.workflowSessionId, table.status),
    check('workflow_action_title_length', sql`length(${table.title}) between 1 and 300`),
    check('workflow_action_notes_length', sql`${table.notes} is null or length(${table.notes}) <= 4000`),
    check('workflow_action_owner_is_creator', sql`${table.ownerUserId} = ${table.createdByUserId}`),
    check('workflow_action_withdrawn_state', sql`(${table.status} = 'withdrawn') = (${table.withdrawnAt} is not null)`),
  ],
)

export const workflowReferrals = pgTable(
  'workflow_referral',
  {
    id: uuid('id').primaryKey(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    pouId: workflowPouId('pou_id'),
    destinationCode: text('destination_code'),
    destinationName: text('destination_name').notNull(),
    reason: text('reason').notNull(),
    handoverNote: text('handover_note'),
    notes: text('notes'),
    status: workflowReferralStatus('status').default('draft').notNull(),
    createdByUserId: uuid('created_by_user_id').notNull(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workflowSessionId, table.organisationId],
      foreignColumns: [workflowSessions.id, workflowSessions.organisationId],
      name: 'workflow_referral_session_organisation_fk',
    }),
    foreignKey({
      columns: [table.workflowSessionId, table.organisationId, table.pouId],
      foreignColumns: [workflowPouCheckpoints.workflowSessionId, workflowPouCheckpoints.organisationId, workflowPouCheckpoints.pouId],
      name: 'workflow_referral_checkpoint_organisation_fk',
    }),
    foreignKey({
      columns: [table.createdByUserId, table.organisationId],
      foreignColumns: [appUsers.id, appUsers.organisationId],
      name: 'workflow_referral_created_by_organisation_fk',
    }),
    index('workflow_referral_workflow_status_idx').on(table.workflowSessionId, table.status),
    check('workflow_referral_destination_code_length', sql`${table.destinationCode} is null or length(${table.destinationCode}) between 1 and 100`),
    check('workflow_referral_destination_name_length', sql`length(${table.destinationName}) between 1 and 300`),
    check('workflow_referral_reason_length', sql`length(${table.reason}) between 1 and 4000`),
    check('workflow_referral_handover_note_length', sql`${table.handoverNote} is null or length(${table.handoverNote}) <= 4000`),
    check('workflow_referral_notes_length', sql`${table.notes} is null or length(${table.notes}) <= 4000`),
    check('workflow_referral_withdrawn_state', sql`(${table.status} = 'withdrawn') = (${table.withdrawnAt} is not null)`),
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
    uniqueIndex('workflow_interaction_id_organisation_session_uq').on(table.id, table.organisationId, table.workflowSessionId),
    index('workflow_interaction_session_created_idx').on(table.workflowSessionId, table.createdAt),
    check('workflow_interaction_resulting_version_positive', sql`${table.resultingVersion} > 0`),
  ],
)

export const workflowSafetyObservations = pgTable(
  'workflow_safety_observation',
  {
    id: uuid('id').primaryKey(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    assessmentContext: workflowSafetyAssessmentContext('assessment_context').notNull(),
    pouId: workflowPouId('pou_id'),
    broadClass: workflowSafetyBroadClass('broad_class').notNull(),
    concernLevel: workflowSafetyConcernLevel('concern_level').notNull(),
    contextNote: text('context_note'),
    status: workflowSafetyObservationStatus('status').default('active').notNull(),
    currentRevision: integer('current_revision').default(1).notNull(),
    confirmedByUserId: uuid('confirmed_by_user_id').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    retractedAt: timestamp('retracted_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({ columns: [table.workflowSessionId, table.organisationId], foreignColumns: [workflowSessions.id, workflowSessions.organisationId], name: 'workflow_safety_observation_session_organisation_fk' }),
    foreignKey({ columns: [table.workflowSessionId, table.organisationId, table.pouId], foreignColumns: [workflowPouCheckpoints.workflowSessionId, workflowPouCheckpoints.organisationId, workflowPouCheckpoints.pouId], name: 'workflow_safety_observation_checkpoint_organisation_fk' }),
    foreignKey({ columns: [table.confirmedByUserId, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'workflow_safety_observation_confirmed_by_organisation_fk' }),
    uniqueIndex('workflow_safety_observation_id_organisation_uq').on(table.id, table.organisationId),
    uniqueIndex('workflow_safety_observation_id_organisation_session_uq').on(table.id, table.organisationId, table.workflowSessionId),
    index('workflow_safety_observation_workflow_active_idx').on(table.workflowSessionId, table.status),
    check('workflow_safety_observation_context_pou', sql`(${table.assessmentContext} = 'setup' and ${table.pouId} is null) or (${table.assessmentContext} = 'pou' and ${table.pouId} is not null)`),
    check('workflow_safety_observation_context_concern', sql`(${table.assessmentContext} = 'setup' and ${table.concernLevel} in ('unsure', 'urgent')) or (${table.assessmentContext} = 'pou' and ${table.concernLevel} in ('low', 'watch', 'action', 'urgent'))`),
    check('workflow_safety_observation_revision_positive', sql`${table.currentRevision} > 0`),
    check('workflow_safety_observation_context_note_length', sql`${table.contextNote} is null or length(${table.contextNote}) <= 4000`),
    check('workflow_safety_observation_retracted_state', sql`(${table.status} = 'retracted') = (${table.retractedAt} is not null)`),
  ],
)

export const workflowSafetyObservationRevisions = pgTable(
  'workflow_safety_observation_revision',
  {
    observationId: uuid('observation_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    revision: integer('revision').notNull(),
    assessmentContext: workflowSafetyAssessmentContext('assessment_context').notNull(),
    pouId: workflowPouId('pou_id'),
    broadClass: workflowSafetyBroadClass('broad_class').notNull(),
    concernLevel: workflowSafetyConcernLevel('concern_level').notNull(),
    contextNote: text('context_note'),
    resultingStatus: workflowSafetyObservationStatus('resulting_status').notNull(),
    operation: workflowSafetyRevisionOperation('operation').notNull(),
    changeReason: text('change_reason'),
    actorUserId: uuid('actor_user_id').notNull(),
    interactionId: uuid('interaction_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.observationId, table.revision], name: 'workflow_safety_observation_revision_pk' }),
    foreignKey({ columns: [table.observationId, table.organisationId, table.workflowSessionId], foreignColumns: [workflowSafetyObservations.id, workflowSafetyObservations.organisationId, workflowSafetyObservations.workflowSessionId], name: 'workflow_safety_observation_revision_observation_organisation_session_fk' }),
    foreignKey({ columns: [table.actorUserId, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'workflow_safety_observation_revision_actor_organisation_fk' }),
    foreignKey({ columns: [table.interactionId, table.organisationId, table.workflowSessionId], foreignColumns: [workflowInteractions.id, workflowInteractions.organisationId, workflowInteractions.workflowSessionId], name: 'workflow_safety_observation_revision_interaction_organisation_session_fk' }),
    uniqueIndex('workflow_safety_observation_revision_organisation_uq').on(table.observationId, table.organisationId, table.revision),
    check('workflow_safety_observation_revision_positive', sql`${table.revision} > 0`),
    check('workflow_safety_observation_revision_context_pou', sql`(${table.assessmentContext} = 'setup' and ${table.pouId} is null) or (${table.assessmentContext} = 'pou' and ${table.pouId} is not null)`),
    check('workflow_safety_observation_revision_context_concern', sql`(${table.assessmentContext} = 'setup' and ${table.concernLevel} in ('unsure', 'urgent')) or (${table.assessmentContext} = 'pou' and ${table.concernLevel} in ('low', 'watch', 'action', 'urgent'))`),
    check('workflow_safety_observation_revision_context_note_length', sql`${table.contextNote} is null or length(${table.contextNote}) <= 4000`),
    check('workflow_safety_observation_revision_reason', sql`(${table.operation} = 'confirmed' and ${table.changeReason} is null) or (${table.operation} in ('corrected', 'retracted') and length(${table.changeReason}) between 1 and 4000)`),
  ],
)

export const workflowSafetyRuleEvaluations = pgTable(
  'workflow_safety_rule_evaluation',
  {
    id: uuid('id').primaryKey(),
    observationId: uuid('observation_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    observationRevision: integer('observation_revision').notNull(),
    ruleCode: text('rule_code').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    decisionCode: text('decision_code').notNull(),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.observationId, table.organisationId, table.observationRevision], foreignColumns: [workflowSafetyObservationRevisions.observationId, workflowSafetyObservationRevisions.organisationId, workflowSafetyObservationRevisions.revision], name: 'workflow_safety_rule_evaluation_revision_organisation_fk' }),
    uniqueIndex('workflow_safety_rule_evaluation_observation_rule_uq').on(table.observationId, table.observationRevision, table.ruleCode, table.ruleVersion),
    uniqueIndex('workflow_safety_rule_evaluation_id_observation_organisation_uq').on(table.id, table.observationId, table.organisationId),
    check('workflow_safety_rule_evaluation_rule_code_length', sql`length(${table.ruleCode}) between 1 and 200`),
    check('workflow_safety_rule_evaluation_rule_version_positive', sql`${table.ruleVersion} > 0`),
    check('workflow_safety_rule_evaluation_decision_code_length', sql`length(${table.decisionCode}) between 1 and 200`),
  ],
)

export const workflowSafetyConsequences = pgTable(
  'workflow_safety_consequence',
  {
    id: uuid('id').primaryKey(),
    observationId: uuid('observation_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    type: workflowSafetyConsequenceType('type').notNull(),
    state: workflowSafetyConsequenceState('state').default('required').notNull(),
    createdByEvaluationId: uuid('created_by_evaluation_id').notNull(),
    requiredAt: timestamp('required_at', { withTimezone: true }).defaultNow().notNull(),
    ceasedByEvaluationId: uuid('ceased_by_evaluation_id'),
    cessationReason: workflowSafetyConsequenceCessationReason('cessation_reason'),
    ceasedAt: timestamp('ceased_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({ columns: [table.observationId, table.organisationId], foreignColumns: [workflowSafetyObservations.id, workflowSafetyObservations.organisationId], name: 'workflow_safety_consequence_observation_organisation_fk' }),
    foreignKey({ columns: [table.createdByEvaluationId, table.observationId, table.organisationId], foreignColumns: [workflowSafetyRuleEvaluations.id, workflowSafetyRuleEvaluations.observationId, workflowSafetyRuleEvaluations.organisationId], name: 'workflow_safety_consequence_created_evaluation_observation_organisation_fk' }),
    foreignKey({ columns: [table.ceasedByEvaluationId, table.observationId, table.organisationId], foreignColumns: [workflowSafetyRuleEvaluations.id, workflowSafetyRuleEvaluations.observationId, workflowSafetyRuleEvaluations.organisationId], name: 'workflow_safety_consequence_ceased_evaluation_observation_organisation_fk' }),
    uniqueIndex('workflow_safety_consequence_active_observation_type_uq').on(table.observationId, table.type).where(sql`${table.state} = 'required'`),
    index('workflow_safety_consequence_observation_state_idx').on(table.observationId, table.state),
    check('workflow_safety_consequence_state_fields', sql`(${table.state} = 'required' and ${table.ceasedByEvaluationId} is null and ${table.cessationReason} is null and ${table.ceasedAt} is null) or (${table.state} = 'ceased' and ${table.ceasedByEvaluationId} is not null and ${table.cessationReason} is not null and ${table.ceasedAt} is not null)`),
  ],
)

export const workflowSupervisorReviewRequests = pgTable(
  'workflow_supervisor_review_request',
  {
    id: uuid('id').primaryKey(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    pouId: workflowPouId('pou_id'),
    requestNote: text('request_note'),
    requestedByUserId: uuid('requested_by_user_id').notNull(),
    interactionId: uuid('interaction_id').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.workflowSessionId, table.organisationId], foreignColumns: [workflowSessions.id, workflowSessions.organisationId], name: 'workflow_supervisor_review_request_session_organisation_fk' }),
    foreignKey({ columns: [table.workflowSessionId, table.organisationId, table.pouId], foreignColumns: [workflowPouCheckpoints.workflowSessionId, workflowPouCheckpoints.organisationId, workflowPouCheckpoints.pouId], name: 'workflow_supervisor_review_request_checkpoint_organisation_fk' }),
    foreignKey({ columns: [table.requestedByUserId, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'workflow_supervisor_review_request_requester_organisation_fk' }),
    foreignKey({ columns: [table.interactionId, table.organisationId, table.workflowSessionId], foreignColumns: [workflowInteractions.id, workflowInteractions.organisationId, workflowInteractions.workflowSessionId], name: 'workflow_supervisor_review_request_interaction_organisation_session_fk' }),
    index('workflow_supervisor_review_request_workflow_requested_idx').on(table.workflowSessionId, table.requestedAt),
    check('workflow_supervisor_review_request_note_length', sql`${table.requestNote} is null or length(${table.requestNote}) <= 4000`),
  ],
)
