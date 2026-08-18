import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const userStatus = pgEnum('user_status', ['active', 'inactive'])
export const applicationRole = pgEnum('application_role', ['KAIMAHI', 'SUPERVISOR', 'SPECIFICATION_EDITOR'])
export const applicationSessionMode = pgEnum('application_session_mode', ['standard', 'trusted_device'])
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
export const workflowCarryForwardSource = pgEnum('workflow_carry_forward_source', ['review_criterion', 'areas_for_attention', 'safety_observation'])
export const workflowReferralStatus = pgEnum('workflow_referral_status', ['draft', 'prepared', 'declined', 'withdrawn'])
export const workflowSynthesisStatus = pgEnum('workflow_synthesis_status', ['generating', 'generated', 'failed'])
export const workflowSynthesisRevisionSource = pgEnum('workflow_synthesis_revision_source', ['generated', 'edited'])
export const workflowSafetyAssessmentContext = pgEnum('workflow_safety_assessment_context', ['setup', 'pou'])
export const workflowSafetyBroadClass = pgEnum('workflow_safety_broad_class', ['whanau_safety', 'practice_quality', 'practitioner_wellbeing'])
export const workflowSafetyConcernLevel = pgEnum('workflow_safety_concern_level', ['unsure', 'low', 'watch', 'action', 'urgent'])
export const workflowSafetyObservationStatus = pgEnum('workflow_safety_observation_status', ['active', 'retracted'])
export const workflowSafetyRevisionOperation = pgEnum('workflow_safety_revision_operation', ['confirmed', 'corrected', 'retracted'])
export const workflowSafetyConsequenceType = pgEnum('workflow_safety_consequence_type', ['supervisor_review_required', 'supervisor_notification_required'])
export const workflowSafetyConsequenceState = pgEnum('workflow_safety_consequence_state', ['required', 'ceased'])
export const workflowSafetyConsequenceCessationReason = pgEnum('workflow_safety_consequence_cessation_reason', ['observation_corrected', 'observation_retracted'])
export const workflowConversationStatus = pgEnum('workflow_conversation_status', ['preparing', 'authorized', 'active', 'ended', 'failed'])
export const safetySpecificationApprovalStatus = pgEnum('safety_specification_approval_status', ['draft_derived', 'approved_for_pilot'])
export const safetyEvidenceScope = pgEnum('safety_evidence_scope', ['current_conversation', 'application_state', 'longitudinal'])
export const providerAssessmentOutcome = pgEnum('provider_assessment_outcome', ['no_candidate_concern', 'possible_concern', 'insufficient_information', 'not_applicable'])
export const providerAssessmentRunStatus = pgEnum('provider_assessment_run_status', ['pending', 'received', 'superseded'])
export const providerAssessmentReviewStatus = pgEnum('provider_assessment_review_status', ['confirmed', 'dismissed', 'insufficient_information_acknowledged'])
export const providerAssessmentDeliveryStatus = pgEnum('provider_assessment_delivery_status', ['reserved', 'completed'])
export const conversationTranscriptSpeaker = pgEnum('conversation_transcript_speaker', ['kaimahi', 'assistant', 'unknown'])
export const conversationReviewDraftStatus = pgEnum('conversation_review_draft_status', ['generated', 'failed'])
export const conversationReviewDraftRevisionSource = pgEnum('conversation_review_draft_revision_source', ['generated', 'edited'])
export const organisationPouSpecificationApprovalStatus = pgEnum('organisation_pou_specification_approval_status', ['draft_derived', 'approved_for_pilot'])
export const pouEvidenceScope = pgEnum('pou_evidence_scope', ['current_conversation', 'application_state', 'longitudinal'])
export const pouReviewCriterionStatus = pgEnum('pou_review_criterion_status', ['evidenced', 'partially_evidenced', 'not_explored', 'insufficient_information', 'not_applicable'])
export const workflowInteractionType = pgEnum('workflow_interaction_type', [
  'workflow_created',
  'setup_confirmed',
  'pou_review_confirmed',
  'workflow_synthesis_confirmed',
  'pou_summary_confirmed',
  'action_plan_confirmed',
  'referral_plan_confirmed',
  'structured_review_confirmed',
  'workflow_completed',
  'safety_observation_confirmed',
  'safety_observation_corrected',
  'safety_observation_retracted',
  'supervisor_review_requested',
  'carry_forward_marked',
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
    mode: applicationSessionMode('mode').default('standard').notNull(),
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
    uniqueIndex('workflow_conversation_id_scope_uq').on(table.id, table.organisationId, table.workflowSessionId, table.pouId),
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

/**
 * Phase 5B provider assessments are deliberately noncanonical. These records
 * pin approved SME policy/projection provenance and structured results only;
 * they do not retain transcript, captions, audio, raw payloads, or effects.
 */
export const safetySpecificationVersions = pgTable(
  'safety_specification_version',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    specificationCode: text('specification_code').notNull(),
    specificationVersion: text('specification_version').notNull(),
    pouId: workflowPouId('pou_id').notNull(),
    approvalStatus: safetySpecificationApprovalStatus('approval_status').notNull(),
    contentHash: text('content_hash').notNull(),
    ruleManifestHash: text('rule_manifest_hash').notNull(),
    specification: jsonb('specification').notNull(),
    sourceDocumentCode: text('source_document_code').notNull(),
    sourceDocumentStatus: text('source_document_status').notNull(),
    sourceReference: text('source_reference').notNull(),
    sourceDocumentHash: text('source_document_hash').notNull(),
    derivedAt: timestamp('derived_at', { withTimezone: true }).notNull(),
    approvedForPilotBy: uuid('approved_for_pilot_by'),
    approvedForPilotAt: timestamp('approved_for_pilot_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.approvedForPilotBy, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'safety_specification_approval_actor_organisation_fk' }),
    uniqueIndex('safety_specification_organisation_code_version_uq').on(table.organisationId, table.specificationCode, table.specificationVersion),
    uniqueIndex('safety_specification_id_organisation_pou_uq').on(table.id, table.organisationId, table.pouId),
    check('safety_specification_hash_format', sql`length(${table.contentHash}) = 64 and length(${table.ruleManifestHash}) = 64 and length(${table.sourceDocumentHash}) = 64`),
    check('safety_specification_approval_fields', sql`(${table.approvalStatus} = 'draft_derived' and ${table.approvedForPilotBy} is null and ${table.approvedForPilotAt} is null) or (${table.approvalStatus} = 'approved_for_pilot' and ${table.approvedForPilotBy} is not null and ${table.approvedForPilotAt} is not null)`),
  ],
)

export const providerAssessmentProjections = pgTable(
  'provider_assessment_projection',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    pouId: workflowPouId('pou_id').notNull(),
    specificationId: uuid('specification_id').notNull(),
    projectionCode: text('projection_code').notNull(),
    projectionVersion: text('projection_version').notNull(),
    projectionHash: text('projection_hash').notNull(),
    provider: text('provider').notNull(),
    providerAgentReference: text('provider_agent_reference').notNull(),
    providerBranchReference: text('provider_branch_reference'),
    providerEnvironment: text('provider_environment').notNull(),
    projection: jsonb('projection').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.specificationId, table.organisationId, table.pouId], foreignColumns: [safetySpecificationVersions.id, safetySpecificationVersions.organisationId, safetySpecificationVersions.pouId], name: 'provider_projection_specification_organisation_pou_fk' }),
    uniqueIndex('provider_projection_organisation_code_version_uq').on(table.organisationId, table.projectionCode, table.projectionVersion),
    uniqueIndex('provider_projection_id_organisation_pou_uq').on(table.id, table.organisationId, table.pouId),
    index('provider_projection_provider_agent_idx').on(table.provider, table.providerAgentReference, table.providerEnvironment),
    check('provider_projection_hash_format', sql`length(${table.projectionHash}) = 64`),
  ],
)

export const safetySpecificationActivations = pgTable(
  'safety_specification_activation',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    pouId: workflowPouId('pou_id').notNull(),
    specificationId: uuid('specification_id').notNull(),
    projectionId: uuid('projection_id').notNull(),
    activatedByUserId: uuid('activated_by_user_id').notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }).defaultNow().notNull(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({ columns: [table.specificationId, table.organisationId, table.pouId], foreignColumns: [safetySpecificationVersions.id, safetySpecificationVersions.organisationId, safetySpecificationVersions.pouId], name: 'safety_activation_specification_organisation_pou_fk' }),
    foreignKey({ columns: [table.projectionId, table.organisationId, table.pouId], foreignColumns: [providerAssessmentProjections.id, providerAssessmentProjections.organisationId, providerAssessmentProjections.pouId], name: 'safety_activation_projection_organisation_pou_fk' }),
    foreignKey({ columns: [table.activatedByUserId, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'safety_activation_actor_organisation_fk' }),
    uniqueIndex('safety_activation_one_active_per_organisation_pou_uq').on(table.organisationId, table.pouId).where(sql`${table.deactivatedAt} is null`),
  ],
)

/**
 * Organisation-owned SME policy. This deliberately contains provider-neutral
 * Pou meaning; concrete conversation, narrative-review, and safety artefacts
 * are separate deterministic projections of the same approved version.
 */
export const organisationPouSpecificationVersions = pgTable(
  'organisation_pou_specification_version',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    specificationCode: text('specification_code').notNull(),
    specificationVersion: text('specification_version').notNull(),
    pouId: workflowPouId('pou_id').notNull(),
    approvalStatus: organisationPouSpecificationApprovalStatus('approval_status').notNull(),
    contentHash: text('content_hash').notNull(),
    specification: jsonb('specification').notNull(),
    sourceDocumentCode: text('source_document_code').notNull(),
    sourceDocumentStatus: text('source_document_status').notNull(),
    sourceReference: text('source_reference').notNull(),
    sourceDocumentHash: text('source_document_hash').notNull(),
    derivedAt: timestamp('derived_at', { withTimezone: true }).notNull(),
    approvedForPilotBy: uuid('approved_for_pilot_by'),
    approvedForPilotAt: timestamp('approved_for_pilot_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.approvedForPilotBy, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'organisation_pou_specification_approval_actor_organisation_fk' }),
    uniqueIndex('organisation_pou_specification_organisation_code_version_uq').on(table.organisationId, table.specificationCode, table.specificationVersion),
    uniqueIndex('organisation_pou_specification_id_organisation_pou_uq').on(table.id, table.organisationId, table.pouId),
    check('organisation_pou_specification_hash_format', sql`length(${table.contentHash}) = 64 and length(${table.sourceDocumentHash}) = 64`),
    check('organisation_pou_specification_approval_fields', sql`(${table.approvalStatus} = 'draft_derived' and ${table.approvedForPilotBy} is null and ${table.approvedForPilotAt} is null) or (${table.approvalStatus} = 'approved_for_pilot' and ${table.approvedForPilotBy} is not null and ${table.approvedForPilotAt} is not null)`),
  ],
)

/**
 * Mutable SME working copy. It is deliberately separate from immutable
 * organisation_pou_specification_version records and cannot drive runtime.
 */
export const organisationPouSpecificationDrafts = pgTable(
  'organisation_pou_specification_draft',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    pouId: workflowPouId('pou_id').notNull(),
    baseSpecificationId: uuid('base_specification_id').notNull(),
    draftVersion: text('draft_version').notNull(),
    revision: integer('revision').notNull().default(1),
    specification: jsonb('specification').notNull(),
    proposedSafetyRuleNotes: jsonb('proposed_safety_rule_notes').notNull().default(sql`'[]'::jsonb`),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedByUserId: uuid('updated_by_user_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    approvedByUserId: uuid('approved_by_user_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    activatedByUserId: uuid('activated_by_user_id'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({ columns: [table.baseSpecificationId, table.organisationId, table.pouId], foreignColumns: [organisationPouSpecificationVersions.id, organisationPouSpecificationVersions.organisationId, organisationPouSpecificationVersions.pouId], name: 'organisation_pou_specification_draft_base_scope_fk' }),
    foreignKey({ columns: [table.createdByUserId, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'organisation_pou_specification_draft_created_by_scope_fk' }),
    foreignKey({ columns: [table.updatedByUserId, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'organisation_pou_specification_draft_updated_by_scope_fk' }),
    foreignKey({ columns: [table.approvedByUserId, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'organisation_pou_specification_draft_approved_by_scope_fk' }),
    foreignKey({ columns: [table.activatedByUserId, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'organisation_pou_specification_draft_activated_by_scope_fk' }),
    uniqueIndex('organisation_pou_specification_draft_one_open_uq').on(table.organisationId, table.pouId).where(sql`${table.activatedAt} is null`),
    check('organisation_pou_specification_draft_positive_revision', sql`${table.revision} > 0`),
    check('organisation_pou_specification_draft_version', sql`${table.draftVersion} ~ '^[0-9]+\\.[0-9]+(\\.[0-9]+)?$'`),
    check('organisation_pou_specification_draft_approval_lifecycle', sql`(${table.approvedByUserId} is null and ${table.approvedAt} is null and ${table.activatedByUserId} is null and ${table.activatedAt} is null) or (${table.approvedByUserId} is not null and ${table.approvedAt} is not null and ((${table.activatedByUserId} is null and ${table.activatedAt} is null) or (${table.activatedByUserId} is not null and ${table.activatedAt} is not null)))`),
  ],
)

export const organisationPouSpecificationActivations = pgTable(
  'organisation_pou_specification_activation',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    pouId: workflowPouId('pou_id').notNull(),
    specificationId: uuid('specification_id').notNull(),
    conversationGuidanceProjectionId: uuid('conversation_guidance_projection_id').notNull(),
    pouReviewProjectionId: uuid('pou_review_projection_id').notNull(),
    safetyLinkId: uuid('safety_link_id').notNull(),
    activatedByUserId: uuid('activated_by_user_id').notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }).defaultNow().notNull(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({ columns: [table.specificationId, table.organisationId, table.pouId], foreignColumns: [organisationPouSpecificationVersions.id, organisationPouSpecificationVersions.organisationId, organisationPouSpecificationVersions.pouId], name: 'organisation_pou_specification_activation_specification_scope_fk' }),
    foreignKey({ columns: [table.conversationGuidanceProjectionId, table.organisationId, table.pouId], foreignColumns: [conversationGuidanceProjections.id, conversationGuidanceProjections.organisationId, conversationGuidanceProjections.pouId], name: 'organisation_pou_specification_activation_guidance_scope_fk' }),
    foreignKey({ columns: [table.pouReviewProjectionId, table.organisationId, table.pouId], foreignColumns: [pouReviewProjections.id, pouReviewProjections.organisationId, pouReviewProjections.pouId], name: 'organisation_pou_specification_activation_review_scope_fk' }),
    foreignKey({ columns: [table.safetyLinkId, table.organisationId, table.pouId], foreignColumns: [organisationPouSafetySpecificationLinks.id, organisationPouSafetySpecificationLinks.organisationId, organisationPouSafetySpecificationLinks.pouId], name: 'organisation_pou_specification_activation_safety_link_scope_fk' }),
    foreignKey({ columns: [table.activatedByUserId, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'organisation_pou_specification_activation_actor_organisation_fk' }),
    uniqueIndex('organisation_pou_specification_one_active_uq').on(table.organisationId, table.pouId).where(sql`${table.deactivatedAt} is null`),
  ],
)

export const conversationGuidanceProjections = pgTable(
  'conversation_guidance_projection',
  {
    id: uuid('id').defaultRandom().primaryKey(), organisationId: uuid('organisation_id').notNull(), pouId: workflowPouId('pou_id').notNull(), specificationId: uuid('specification_id').notNull(),
    projectionCode: text('projection_code').notNull(), projectionVersion: text('projection_version').notNull(), projectionHash: text('projection_hash').notNull(), projection: jsonb('projection').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.specificationId, table.organisationId, table.pouId], foreignColumns: [organisationPouSpecificationVersions.id, organisationPouSpecificationVersions.organisationId, organisationPouSpecificationVersions.pouId], name: 'conversation_guidance_projection_specification_scope_fk' }),
    uniqueIndex('conversation_guidance_projection_organisation_code_version_uq').on(table.organisationId, table.projectionCode, table.projectionVersion),
    uniqueIndex('conversation_guidance_projection_id_organisation_pou_uq').on(table.id, table.organisationId, table.pouId),
    check('conversation_guidance_projection_hash_format', sql`length(${table.projectionHash}) = 64`),
  ],
)

export const pouReviewProjections = pgTable(
  'pou_review_projection',
  {
    id: uuid('id').defaultRandom().primaryKey(), organisationId: uuid('organisation_id').notNull(), pouId: workflowPouId('pou_id').notNull(), specificationId: uuid('specification_id').notNull(),
    projectionCode: text('projection_code').notNull(), projectionVersion: text('projection_version').notNull(), projectionHash: text('projection_hash').notNull(), projection: jsonb('projection').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.specificationId, table.organisationId, table.pouId], foreignColumns: [organisationPouSpecificationVersions.id, organisationPouSpecificationVersions.organisationId, organisationPouSpecificationVersions.pouId], name: 'pou_review_projection_specification_scope_fk' }),
    uniqueIndex('pou_review_projection_organisation_code_version_uq').on(table.organisationId, table.projectionCode, table.projectionVersion),
    uniqueIndex('pou_review_projection_id_organisation_pou_uq').on(table.id, table.organisationId, table.pouId),
    check('pou_review_projection_hash_format', sql`length(${table.projectionHash}) = 64`),
  ],
)

/** Links the existing immutable Phase 5B policy to the same organisation Pou version. */
export const organisationPouSafetySpecificationLinks = pgTable(
  'organisation_pou_safety_specification_link',
  {
    id: uuid('id').defaultRandom().primaryKey(), organisationId: uuid('organisation_id').notNull(), pouId: workflowPouId('pou_id').notNull(),
    organisationPouSpecificationId: uuid('organisation_pou_specification_id').notNull(), safetySpecificationId: uuid('safety_specification_id').notNull(), safetyProjectionId: uuid('safety_projection_id').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.organisationPouSpecificationId, table.organisationId, table.pouId], foreignColumns: [organisationPouSpecificationVersions.id, organisationPouSpecificationVersions.organisationId, organisationPouSpecificationVersions.pouId], name: 'organisation_pou_safety_link_pou_specification_scope_fk' }),
    foreignKey({ columns: [table.safetySpecificationId, table.organisationId, table.pouId], foreignColumns: [safetySpecificationVersions.id, safetySpecificationVersions.organisationId, safetySpecificationVersions.pouId], name: 'organisation_pou_safety_link_safety_specification_scope_fk' }),
    foreignKey({ columns: [table.safetyProjectionId, table.organisationId, table.pouId], foreignColumns: [providerAssessmentProjections.id, providerAssessmentProjections.organisationId, providerAssessmentProjections.pouId], name: 'organisation_pou_safety_link_safety_projection_scope_fk' }),
    uniqueIndex('organisation_pou_safety_link_specification_uq').on(table.organisationPouSpecificationId),
    uniqueIndex('organisation_pou_safety_link_id_organisation_pou_uq').on(table.id, table.organisationId, table.pouId),
  ],
)

/** Immutable specification/guidance pin for every post-activation conversation. */
export const workflowConversationPouSpecificationPins = pgTable(
  'workflow_conversation_pou_specification_pin',
  {
    workflowConversationId: uuid('workflow_conversation_id').primaryKey(), organisationId: uuid('organisation_id').notNull(), workflowSessionId: uuid('workflow_session_id').notNull(), pouId: workflowPouId('pou_id').notNull(),
    specificationId: uuid('specification_id').notNull(), specificationHash: text('specification_hash').notNull(),
    conversationGuidanceProjectionId: uuid('conversation_guidance_projection_id').notNull(), conversationGuidanceProjectionHash: text('conversation_guidance_projection_hash').notNull(),
    pouReviewProjectionId: uuid('pou_review_projection_id').notNull(), pouReviewProjectionHash: text('pou_review_projection_hash').notNull(),
    specificationSnapshot: jsonb('specification_snapshot').notNull(), conversationGuidanceProjectionSnapshot: jsonb('conversation_guidance_projection_snapshot').notNull(), pouReviewProjectionSnapshot: jsonb('pou_review_projection_snapshot').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.workflowConversationId, table.organisationId, table.workflowSessionId, table.pouId], foreignColumns: [workflowConversations.id, workflowConversations.organisationId, workflowConversations.workflowSessionId, workflowConversations.pouId], name: 'conversation_pou_specification_pin_conversation_scope_fk' }),
    foreignKey({ columns: [table.specificationId, table.organisationId, table.pouId], foreignColumns: [organisationPouSpecificationVersions.id, organisationPouSpecificationVersions.organisationId, organisationPouSpecificationVersions.pouId], name: 'conversation_pou_specification_pin_specification_scope_fk' }),
    foreignKey({ columns: [table.conversationGuidanceProjectionId, table.organisationId, table.pouId], foreignColumns: [conversationGuidanceProjections.id, conversationGuidanceProjections.organisationId, conversationGuidanceProjections.pouId], name: 'conversation_pou_specification_pin_guidance_scope_fk' }),
    foreignKey({ columns: [table.pouReviewProjectionId, table.organisationId, table.pouId], foreignColumns: [pouReviewProjections.id, pouReviewProjections.organisationId, pouReviewProjections.pouId], name: 'conversation_pou_specification_pin_review_scope_fk' }),
    check('conversation_pou_specification_pin_hash_format', sql`length(${table.specificationHash}) = 64 and length(${table.conversationGuidanceProjectionHash}) = 64 and length(${table.pouReviewProjectionHash}) = 64`),
  ],
)

export const conversationSafetyAssessmentRuns = pgTable(
  'conversation_safety_assessment_run',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workflowConversationId: uuid('workflow_conversation_id').notNull().references(() => workflowConversations.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id').notNull(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    pouId: workflowPouId('pou_id').notNull(),
    specificationId: uuid('specification_id').notNull(),
    specificationCode: text('specification_code').notNull(),
    specificationVersion: text('specification_version').notNull(),
    specificationHash: text('specification_hash').notNull(),
    ruleManifestHash: text('rule_manifest_hash').notNull(),
    projectionId: uuid('projection_id').notNull(),
    projectionCode: text('projection_code').notNull(),
    projectionVersion: text('projection_version').notNull(),
    projectionHash: text('projection_hash').notNull(),
    provider: text('provider').notNull(),
    providerAgentReference: text('provider_agent_reference').notNull(),
    providerBranchReference: text('provider_branch_reference'),
    providerEnvironment: text('provider_environment').notNull(),
    /** The transcript interpreter is distinct from the conversation provider. */
    assessmentProvider: text('assessment_provider'),
    assessmentProviderModel: text('assessment_provider_model'),
    assessmentProviderConfigHash: text('assessment_provider_config_hash'),
    assessmentSchemaVersion: text('assessment_schema_version'),
    transcriptReceivedAt: timestamp('transcript_received_at', { withTimezone: true }),
    assessmentStartedAt: timestamp('assessment_started_at', { withTimezone: true }),
    assessmentCompletedAt: timestamp('assessment_completed_at', { withTimezone: true }),
    reviewAvailableAt: timestamp('review_available_at', { withTimezone: true }),
    /** Complete immutable policy artifacts pinned when the conversation starts. */
    specificationSnapshot: jsonb('specification_snapshot').notNull(),
    projectionSnapshot: jsonb('projection_snapshot').notNull(),
    status: providerAssessmentRunStatus('status').default('pending').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.workflowSessionId, table.organisationId], foreignColumns: [workflowSessions.id, workflowSessions.organisationId], name: 'assessment_run_session_organisation_fk' }),
    foreignKey({ columns: [table.workflowSessionId, table.organisationId, table.pouId], foreignColumns: [workflowPouCheckpoints.workflowSessionId, workflowPouCheckpoints.organisationId, workflowPouCheckpoints.pouId], name: 'assessment_run_checkpoint_organisation_fk' }),
    foreignKey({ columns: [table.specificationId, table.organisationId, table.pouId], foreignColumns: [safetySpecificationVersions.id, safetySpecificationVersions.organisationId, safetySpecificationVersions.pouId], name: 'assessment_run_specification_organisation_pou_fk' }),
    foreignKey({ columns: [table.projectionId, table.organisationId, table.pouId], foreignColumns: [providerAssessmentProjections.id, providerAssessmentProjections.organisationId, providerAssessmentProjections.pouId], name: 'assessment_run_projection_organisation_pou_fk' }),
    uniqueIndex('assessment_run_one_per_conversation_uq').on(table.workflowConversationId),
    uniqueIndex('assessment_run_id_organisation_workflow_uq').on(table.id, table.organisationId, table.workflowSessionId),
    index('assessment_run_workflow_pou_status_idx').on(table.workflowSessionId, table.pouId, table.status),
    check('assessment_run_hash_format', sql`length(${table.specificationHash}) = 64 and length(${table.ruleManifestHash}) = 64 and length(${table.projectionHash}) = 64`),
    check('assessment_run_status_timestamps', sql`(${table.status} = 'pending' and ${table.receivedAt} is null and ${table.supersededAt} is null) or (${table.status} = 'received' and ${table.receivedAt} is not null and ${table.supersededAt} is null) or (${table.status} = 'superseded' and ${table.supersededAt} is not null)`),
  ],
)

/**
 * Noncanonical supporting source material.  These rows are deliberately not
 * joined into ordinary workflow or dashboard serializers.  A later transcript
 * access policy/service may move text to encrypted object storage without
 * changing the conversation, assessment, or canonical-safety contracts.
 */
export const conversationTranscripts = pgTable(
  'conversation_transcript',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    pouId: workflowPouId('pou_id').notNull(),
    workflowConversationId: uuid('workflow_conversation_id').notNull(),
    provider: text('provider').notNull(),
    providerConversationId: text('provider_conversation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.workflowConversationId, table.organisationId, table.workflowSessionId, table.pouId], foreignColumns: [workflowConversations.id, workflowConversations.organisationId, workflowConversations.workflowSessionId, workflowConversations.pouId], name: 'transcript_conversation_scope_fk' }),
    foreignKey({ columns: [table.workflowSessionId, table.organisationId, table.pouId], foreignColumns: [workflowPouCheckpoints.workflowSessionId, workflowPouCheckpoints.organisationId, workflowPouCheckpoints.pouId], name: 'transcript_checkpoint_organisation_fk' }),
    uniqueIndex('transcript_one_per_workflow_conversation_uq').on(table.workflowConversationId),
    uniqueIndex('transcript_id_organisation_workflow_uq').on(table.id, table.organisationId, table.workflowSessionId),
  ],
)

export const conversationTranscriptTurns = pgTable(
  'conversation_transcript_turn',
  {
    id: uuid('id').primaryKey(),
    transcriptId: uuid('transcript_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    speaker: conversationTranscriptSpeaker('speaker').notNull(),
    text: text('text').notNull(),
    providerSequence: integer('provider_sequence'),
    providerTimestamp: timestamp('provider_timestamp', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.transcriptId], foreignColumns: [conversationTranscripts.id], name: 'transcript_turn_transcript_fk' }),
    uniqueIndex('transcript_turn_transcript_ordinal_uq').on(table.transcriptId, table.ordinal),
    check('transcript_turn_ordinal_positive', sql`${table.ordinal} > 0`),
    check('transcript_turn_text_nonempty', sql`length(${table.text}) between 1 and 120000`),
  ],
)

/**
 * A generated Whakapapa narrative remains noncanonical. Generated material,
 * human edits, and the later canonical Pou review are deliberately separate.
 */
export const conversationReviewDrafts = pgTable(
  'conversation_review_draft',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assessmentRunId: uuid('assessment_run_id').notNull(),
    workflowConversationId: uuid('workflow_conversation_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    pouId: workflowPouId('pou_id').notNull(),
    status: conversationReviewDraftStatus('status').notNull(),
    provider: text('provider'),
    providerModel: text('provider_model'),
    providerConfigHash: text('provider_config_hash'),
    schemaVersion: text('schema_version'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureCategory: text('failure_category'),
    specificationHash: text('specification_hash').notNull(),
    projectionHash: text('projection_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.assessmentRunId, table.organisationId, table.workflowSessionId], foreignColumns: [conversationSafetyAssessmentRuns.id, conversationSafetyAssessmentRuns.organisationId, conversationSafetyAssessmentRuns.workflowSessionId], name: 'review_draft_run_organisation_session_fk' }),
    foreignKey({ columns: [table.workflowConversationId, table.organisationId, table.workflowSessionId, table.pouId], foreignColumns: [workflowConversations.id, workflowConversations.organisationId, workflowConversations.workflowSessionId, workflowConversations.pouId], name: 'review_draft_conversation_scope_fk' }),
    foreignKey({ columns: [table.workflowSessionId, table.organisationId, table.pouId], foreignColumns: [workflowPouCheckpoints.workflowSessionId, workflowPouCheckpoints.organisationId, workflowPouCheckpoints.pouId], name: 'review_draft_checkpoint_organisation_fk' }),
    uniqueIndex('review_draft_one_per_assessment_run_uq').on(table.assessmentRunId),
    uniqueIndex('review_draft_id_organisation_workflow_uq').on(table.id, table.organisationId, table.workflowSessionId),
    check('review_draft_hash_format', sql`length(${table.specificationHash}) = 64 and length(${table.projectionHash}) = 64 and (${table.providerConfigHash} is null or length(${table.providerConfigHash}) = 64)`),
    check('review_draft_status_lifecycle', sql`(${table.status} = 'generated' and ${table.generatedAt} is not null and ${table.failedAt} is null and ${table.provider} is not null and ${table.providerModel} is not null and ${table.providerConfigHash} is not null and ${table.schemaVersion} is not null and ${table.failureCategory} is null) or (${table.status} = 'failed' and ${table.generatedAt} is null and ${table.failedAt} is not null and ${table.provider} is null and ${table.providerModel} is null and ${table.providerConfigHash} is null and ${table.schemaVersion} is null and ${table.failureCategory} is not null)`),
  ],
)

export const conversationReviewDraftRevisions = pgTable(
  'conversation_review_draft_revision',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reviewDraftId: uuid('review_draft_id').notNull(),
    revision: integer('revision').notNull(),
    source: conversationReviewDraftRevisionSource('source').notNull(),
    overallSummary: text('overall_summary'),
    strengthsSummary: text('strengths_summary'),
    areasForAttentionSummary: text('areas_for_attention_summary'),
    evidenceTurnIds: jsonb('evidence_turn_ids').notNull(),
    createdByUserId: uuid('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.reviewDraftId], foreignColumns: [conversationReviewDrafts.id], name: 'review_draft_revision_draft_fk' }),
    uniqueIndex('review_draft_revision_draft_revision_uq').on(table.reviewDraftId, table.revision),
    uniqueIndex('review_draft_revision_id_draft_uq').on(table.id, table.reviewDraftId),
    check('review_draft_revision_positive', sql`${table.revision} > 0`),
    check('review_draft_revision_content_bound', sql`coalesce(length(${table.overallSummary}), 0) + coalesce(length(${table.strengthsSummary}), 0) + coalesce(length(${table.areasForAttentionSummary}), 0) > 0 and (${table.overallSummary} is null or length(${table.overallSummary}) <= 1200) and (${table.strengthsSummary} is null or length(${table.strengthsSummary}) <= 900) and (${table.areasForAttentionSummary} is null or length(${table.areasForAttentionSummary}) <= 900)`),
    check('review_draft_revision_source_actor', sql`(${table.source} = 'generated' and ${table.revision} = 1 and ${table.createdByUserId} is null) or (${table.source} = 'edited' and ${table.revision} > 1 and ${table.createdByUserId} is not null)`),
  ],
)

/**
 * Bounded evidence status only. No transcript text, rationale, provider raw
 * output, or safety decision is stored here. A new narrative revision carries
 * a copied set so future human criterion corrections can also be append-only.
 */
export const conversationReviewDraftCriterionAssessments = pgTable(
  'conversation_review_draft_criterion_assessment',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reviewDraftRevisionId: uuid('review_draft_revision_id').notNull(),
    criterionCode: text('criterion_code').notNull(),
    status: pouReviewCriterionStatus('status').notNull(),
    evidenceTurnIds: jsonb('evidence_turn_ids').notNull(),
    missingInformationCodes: jsonb('missing_information_codes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.reviewDraftRevisionId], foreignColumns: [conversationReviewDraftRevisions.id], name: 'review_draft_criterion_revision_fk' }),
    uniqueIndex('review_draft_criterion_revision_code_uq').on(table.reviewDraftRevisionId, table.criterionCode),
    check('review_draft_criterion_code_length', sql`length(${table.criterionCode}) between 2 and 120`),
  ],
)

export const conversationReviewDraftViews = pgTable(
  'conversation_review_draft_view',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reviewDraftId: uuid('review_draft_id').notNull(),
    viewedByUserId: uuid('viewed_by_user_id').notNull(),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.reviewDraftId], foreignColumns: [conversationReviewDrafts.id], name: 'review_draft_view_draft_fk' }),
    foreignKey({ columns: [table.viewedByUserId], foreignColumns: [appUsers.id], name: 'review_draft_view_user_fk' }),
    uniqueIndex('review_draft_view_draft_user_uq').on(table.reviewDraftId, table.viewedByUserId),
  ],
)

/** The only canonical narrative review record; inserted by explicit Pou confirmation. */
export const workflowPouReviews = pgTable(
  'workflow_pou_review',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    pouId: workflowPouId('pou_id').notNull(),
    reviewDraftRevisionId: uuid('review_draft_revision_id').notNull(),
    overallSummary: text('overall_summary'),
    strengthsSummary: text('strengths_summary'),
    areasForAttentionSummary: text('areas_for_attention_summary'),
    confirmedByUserId: uuid('confirmed_by_user_id').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.workflowSessionId, table.organisationId, table.pouId], foreignColumns: [workflowPouCheckpoints.workflowSessionId, workflowPouCheckpoints.organisationId, workflowPouCheckpoints.pouId], name: 'workflow_pou_review_checkpoint_organisation_fk' }),
    foreignKey({ columns: [table.reviewDraftRevisionId], foreignColumns: [conversationReviewDraftRevisions.id], name: 'workflow_pou_review_revision_fk' }),
    foreignKey({ columns: [table.confirmedByUserId, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'workflow_pou_review_confirming_user_organisation_fk' }),
    uniqueIndex('workflow_pou_review_session_pou_uq').on(table.workflowSessionId, table.pouId),
    check('workflow_pou_review_content_bound', sql`coalesce(length(${table.overallSummary}), 0) + coalesce(length(${table.strengthsSummary}), 0) + coalesce(length(${table.areasForAttentionSummary}), 0) > 0 and (${table.overallSummary} is null or length(${table.overallSummary}) <= 1200) and (${table.strengthsSummary} is null or length(${table.strengthsSummary}) <= 900) and (${table.areasForAttentionSummary} is null or length(${table.areasForAttentionSummary}) <= 900)`),
  ],
)

/**
 * Noncanonical cross-Pou synthesis lifecycle. Its revisions are immutable;
 * only an explicit Kaimahi confirmation can make one revision authoritative.
 */
export const workflowSyntheses = pgTable(
  'workflow_synthesis',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    status: workflowSynthesisStatus('status').default('generating').notNull(),
    sourceHash: text('source_hash').notNull(),
    provider: text('provider'),
    providerModel: text('provider_model'),
    providerConfigHash: text('provider_config_hash'),
    schemaVersion: text('schema_version'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureCategory: text('failure_category'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.workflowSessionId, table.organisationId], foreignColumns: [workflowSessions.id, workflowSessions.organisationId], name: 'workflow_synthesis_session_organisation_fk' }),
    uniqueIndex('workflow_synthesis_session_uq').on(table.workflowSessionId),
    check('workflow_synthesis_hash_format', sql`length(${table.sourceHash}) = 64`),
    check('workflow_synthesis_generated_state', sql`(${table.status} = 'generated') = (${table.generatedAt} is not null)`),
    check('workflow_synthesis_failed_state', sql`(${table.status} = 'failed') = (${table.failedAt} is not null and ${table.failureCategory} is not null)`),
  ],
)

export const workflowSynthesisRevisions = pgTable(
  'workflow_synthesis_revision',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    synthesisId: uuid('synthesis_id').notNull(),
    revision: integer('revision').notNull(),
    source: workflowSynthesisRevisionSource('source').notNull(),
    overallSummary: text('overall_summary').notNull(),
    keyThemes: text('key_themes'),
    strengthsSummary: text('strengths_summary'),
    areasForAttentionSummary: text('areas_for_attention_summary'),
    informationStillToExploreSummary: text('information_still_to_explore_summary'),
    confirmedSafetyConcernsSummary: text('confirmed_safety_concerns_summary'),
    editedByUserId: uuid('edited_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.synthesisId], foreignColumns: [workflowSyntheses.id], name: 'workflow_synthesis_revision_synthesis_fk' }),
    foreignKey({ columns: [table.editedByUserId], foreignColumns: [appUsers.id], name: 'workflow_synthesis_revision_editor_fk' }),
    uniqueIndex('workflow_synthesis_revision_synthesis_revision_uq').on(table.synthesisId, table.revision),
    check('workflow_synthesis_revision_positive', sql`${table.revision} > 0`),
    check('workflow_synthesis_revision_source_actor', sql`(${table.source} = 'generated' and ${table.editedByUserId} is null) or (${table.source} = 'edited' and ${table.editedByUserId} is not null)`),
    check('workflow_synthesis_revision_bounds', sql`length(${table.overallSummary}) between 1 and 1800 and (${table.keyThemes} is null or length(${table.keyThemes}) <= 1200) and (${table.strengthsSummary} is null or length(${table.strengthsSummary}) <= 1200) and (${table.areasForAttentionSummary} is null or length(${table.areasForAttentionSummary}) <= 1200) and (${table.informationStillToExploreSummary} is null or length(${table.informationStillToExploreSummary}) <= 1200) and (${table.confirmedSafetyConcernsSummary} is null or length(${table.confirmedSafetyConcernsSummary}) <= 1200)`),
  ],
)

/** The immutable, explicit human authority for the synthesis used in the final record. */
export const workflowConfirmedSyntheses = pgTable(
  'workflow_confirmed_synthesis',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    synthesisRevisionId: uuid('synthesis_revision_id').notNull(),
    confirmedByUserId: uuid('confirmed_by_user_id').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.workflowSessionId, table.organisationId], foreignColumns: [workflowSessions.id, workflowSessions.organisationId], name: 'workflow_confirmed_synthesis_session_organisation_fk' }),
    foreignKey({ columns: [table.synthesisRevisionId], foreignColumns: [workflowSynthesisRevisions.id], name: 'workflow_confirmed_synthesis_revision_fk' }),
    foreignKey({ columns: [table.confirmedByUserId, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'workflow_confirmed_synthesis_actor_organisation_fk' }),
    uniqueIndex('workflow_confirmed_synthesis_session_uq').on(table.workflowSessionId),
  ],
)

/**
 * One point-in-time, immutable professional record per completed workflow.
 * Variable action/referral/safety snapshots are validated by the application
 * before insertion and are never regenerated for export.
 */
export const workflowFinalRecords = pgTable(
  'workflow_final_record',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    confirmedSynthesisId: uuid('confirmed_synthesis_id').notNull(),
    workflowReference: text('workflow_reference').notNull(),
    organisationName: text('organisation_name').notNull(),
    kaimahiDisplayName: text('kaimahi_display_name').notNull(),
    overallSummary: text('overall_summary').notNull(),
    keyThemes: text('key_themes'),
    strengthsSummary: text('strengths_summary'),
    areasForAttentionSummary: text('areas_for_attention_summary'),
    informationStillToExploreSummary: text('information_still_to_explore_summary'),
    confirmedSafetyConcernsSummary: text('confirmed_safety_concerns_summary'),
    actions: jsonb('actions').notNull(),
    referrals: jsonb('referrals').notNull(),
    safetyObservations: jsonb('safety_observations').notNull(),
    contentHash: text('content_hash').notNull(),
    finalizedByUserId: uuid('finalized_by_user_id').notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.workflowSessionId, table.organisationId], foreignColumns: [workflowSessions.id, workflowSessions.organisationId], name: 'workflow_final_record_session_organisation_fk' }),
    foreignKey({ columns: [table.confirmedSynthesisId], foreignColumns: [workflowConfirmedSyntheses.id], name: 'workflow_final_record_confirmed_synthesis_fk' }),
    foreignKey({ columns: [table.finalizedByUserId, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'workflow_final_record_actor_organisation_fk' }),
    uniqueIndex('workflow_final_record_session_uq').on(table.workflowSessionId),
    check('workflow_final_record_hash_format', sql`length(${table.contentHash}) = 64`),
    check('workflow_final_record_summary_bound', sql`length(${table.overallSummary}) between 1 and 1800`),
  ],
)

export const providerAssessmentDeliveries = pgTable(
  'provider_assessment_delivery',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: text('provider').notNull(),
    providerDeliveryId: text('provider_delivery_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    assessmentRunId: uuid('assessment_run_id').notNull(),
    status: providerAssessmentDeliveryStatus('status').default('reserved').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.assessmentRunId], foreignColumns: [conversationSafetyAssessmentRuns.id], name: 'provider_delivery_assessment_run_fk' }),
    uniqueIndex('provider_assessment_delivery_identity_uq').on(table.provider, table.providerDeliveryId),
    check('provider_delivery_hash_format', sql`length(${table.payloadHash}) = 64`),
  ],
)

export const conversationProviderRuleAssessments = pgTable(
  'conversation_provider_rule_assessment',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assessmentRunId: uuid('assessment_run_id').notNull(),
    ruleCode: text('rule_code').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    evidenceScope: safetyEvidenceScope('evidence_scope').notNull(),
    outcome: providerAssessmentOutcome('outcome').notNull(),
    candidateConcernLevel: workflowSafetyConcernLevel('candidate_concern_level'),
    matchedProtectiveIndicatorCodes: jsonb('matched_protective_indicator_codes').notNull(),
    matchedConcernIndicatorCodes: jsonb('matched_concern_indicator_codes').notNull(),
    missingInformationCodes: jsonb('missing_information_codes').notNull(),
    uncertaintyReasonCodes: jsonb('uncertainty_reason_codes').notNull(),
    applicabilityReasonCode: text('applicability_reason_code'),
    evidenceTurnIds: jsonb('evidence_turn_ids').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.assessmentRunId], foreignColumns: [conversationSafetyAssessmentRuns.id], name: 'provider_rule_assessment_run_fk' }),
    uniqueIndex('provider_rule_assessment_run_rule_version_uq').on(table.assessmentRunId, table.ruleCode, table.ruleVersion),
    uniqueIndex('provider_rule_assessment_id_run_uq').on(table.id, table.assessmentRunId),
    check('provider_rule_assessment_current_conversation_only', sql`${table.evidenceScope} = 'current_conversation'`),
    // v0.1 leaves all concern-level selection to an explicit human action.
    check('provider_rule_assessment_level_outcome', sql`${table.candidateConcernLevel} is null`),
    check('provider_rule_assessment_code_length', sql`length(${table.ruleCode}) between 2 and 120`),
  ],
)

export const providerAssessmentReviews = pgTable(
  'provider_assessment_review',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerRuleAssessmentId: uuid('provider_rule_assessment_id').notNull(),
    assessmentRunId: uuid('assessment_run_id').notNull(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    reviewedByUserId: uuid('reviewed_by_user_id').notNull(),
    status: providerAssessmentReviewStatus('status').notNull(),
    classificationSource: text('classification_source'),
    canonicalObservationId: uuid('canonical_observation_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.providerRuleAssessmentId, table.assessmentRunId], foreignColumns: [conversationProviderRuleAssessments.id, conversationProviderRuleAssessments.assessmentRunId], name: 'provider_assessment_review_assessment_run_fk' }),
    foreignKey({ columns: [table.assessmentRunId, table.organisationId, table.workflowSessionId], foreignColumns: [conversationSafetyAssessmentRuns.id, conversationSafetyAssessmentRuns.organisationId, conversationSafetyAssessmentRuns.workflowSessionId], name: 'provider_assessment_review_run_organisation_session_fk' }),
    foreignKey({ columns: [table.workflowSessionId, table.organisationId], foreignColumns: [workflowSessions.id, workflowSessions.organisationId], name: 'provider_assessment_review_session_organisation_fk' }),
    foreignKey({ columns: [table.reviewedByUserId, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'provider_assessment_review_actor_organisation_fk' }),
    foreignKey({ columns: [table.canonicalObservationId, table.organisationId, table.workflowSessionId], foreignColumns: [workflowSafetyObservations.id, workflowSafetyObservations.organisationId, workflowSafetyObservations.workflowSessionId], name: 'provider_assessment_review_observation_organisation_session_fk' }),
    uniqueIndex('provider_assessment_review_one_final_uq').on(table.providerRuleAssessmentId),
    uniqueIndex('provider_assessment_review_observation_uq').on(table.canonicalObservationId).where(sql`${table.canonicalObservationId} is not null`),
    check('provider_assessment_review_linking', sql`(${table.status} = 'confirmed' and ${table.canonicalObservationId} is not null and ${table.classificationSource} = 'human_selected') or (${table.status} in ('dismissed', 'insufficient_information_acknowledged') and ${table.canonicalObservationId} is null and ${table.classificationSource} is null)`),
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

/**
 * Human-owned, pre-action follow-up markers. These preserve a bounded link to
 * review or confirmed-safety context without claiming that an action, referral
 * or escalation has been created.
 */
export const workflowCarryForwards = pgTable(
  'workflow_carry_forward',
  {
    id: uuid('id').primaryKey(),
    workflowSessionId: uuid('workflow_session_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    pouId: workflowPouId('pou_id').notNull(),
    source: workflowCarryForwardSource('source').notNull(),
    reviewDraftRevisionId: uuid('review_draft_revision_id'),
    criterionCode: text('criterion_code'),
    safetyObservationId: uuid('safety_observation_id'),
    note: text('note'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.workflowSessionId, table.organisationId, table.pouId], foreignColumns: [workflowPouCheckpoints.workflowSessionId, workflowPouCheckpoints.organisationId, workflowPouCheckpoints.pouId], name: 'carry_forward_checkpoint_organisation_fk' }),
    foreignKey({ columns: [table.reviewDraftRevisionId], foreignColumns: [conversationReviewDraftRevisions.id], name: 'carry_forward_review_revision_fk' }),
    foreignKey({ columns: [table.safetyObservationId], foreignColumns: [workflowSafetyObservations.id], name: 'carry_forward_safety_observation_fk' }),
    foreignKey({ columns: [table.createdByUserId, table.organisationId], foreignColumns: [appUsers.id, appUsers.organisationId], name: 'carry_forward_created_by_organisation_fk' }),
    index('carry_forward_workflow_created_idx').on(table.workflowSessionId, table.createdAt),
    check('carry_forward_note_length', sql`${table.note} is null or length(${table.note}) between 1 and 1000`),
    check('carry_forward_source_shape', sql`(${table.source} = 'review_criterion' and ${table.reviewDraftRevisionId} is not null and ${table.criterionCode} is not null and ${table.safetyObservationId} is null) or (${table.source} = 'areas_for_attention' and ${table.reviewDraftRevisionId} is not null and ${table.criterionCode} is null and ${table.safetyObservationId} is null) or (${table.source} = 'safety_observation' and ${table.reviewDraftRevisionId} is null and ${table.criterionCode} is null and ${table.safetyObservationId} is not null)`),
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
