CREATE TYPE "public"."provider_assessment_outcome" AS ENUM('no_candidate_concern', 'possible_concern', 'insufficient_information', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."provider_assessment_review_status" AS ENUM('confirmed', 'dismissed', 'insufficient_information_acknowledged');--> statement-breakpoint
CREATE TYPE "public"."provider_assessment_run_status" AS ENUM('pending', 'received', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."safety_evidence_scope" AS ENUM('current_conversation', 'application_state', 'longitudinal');--> statement-breakpoint
CREATE TYPE "public"."safety_specification_approval_status" AS ENUM('draft_derived', 'approved_for_pilot');--> statement-breakpoint
CREATE TABLE "conversation_provider_rule_assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_run_id" uuid NOT NULL,
	"rule_code" text NOT NULL,
	"rule_version" integer NOT NULL,
	"evidence_scope" "safety_evidence_scope" NOT NULL,
	"outcome" "provider_assessment_outcome" NOT NULL,
	"candidate_concern_level" "workflow_safety_concern_level",
	"matched_protective_indicator_codes" jsonb NOT NULL,
	"matched_concern_indicator_codes" jsonb NOT NULL,
	"missing_information_codes" jsonb NOT NULL,
	"uncertainty_reason_codes" jsonb NOT NULL,
	"applicability_reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_rule_assessment_current_conversation_only" CHECK ("conversation_provider_rule_assessment"."evidence_scope" = 'current_conversation'),
	CONSTRAINT "provider_rule_assessment_level_outcome" CHECK ("conversation_provider_rule_assessment"."outcome" = 'possible_concern' or "conversation_provider_rule_assessment"."candidate_concern_level" is null),
	CONSTRAINT "provider_rule_assessment_code_length" CHECK (length("conversation_provider_rule_assessment"."rule_code") between 2 and 120)
);
--> statement-breakpoint
CREATE TABLE "conversation_safety_assessment_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_conversation_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"specification_id" uuid NOT NULL,
	"specification_code" text NOT NULL,
	"specification_version" text NOT NULL,
	"specification_hash" text NOT NULL,
	"rule_manifest_hash" text NOT NULL,
	"projection_id" uuid NOT NULL,
	"projection_code" text NOT NULL,
	"projection_version" text NOT NULL,
	"projection_hash" text NOT NULL,
	"provider" text NOT NULL,
	"provider_agent_reference" text NOT NULL,
	"provider_branch_reference" text,
	"provider_environment" text NOT NULL,
	"status" "provider_assessment_run_status" DEFAULT 'pending' NOT NULL,
	"specification_snapshot" jsonb NOT NULL,
	"projection_snapshot" jsonb NOT NULL,
	"received_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_run_whakapapa_only" CHECK ("conversation_safety_assessment_run"."pou_id" = 'whakapapa'),
	CONSTRAINT "assessment_run_hash_format" CHECK (length("conversation_safety_assessment_run"."specification_hash") = 64 and length("conversation_safety_assessment_run"."rule_manifest_hash") = 64 and length("conversation_safety_assessment_run"."projection_hash") = 64),
	CONSTRAINT "assessment_run_status_timestamps" CHECK (("conversation_safety_assessment_run"."status" = 'pending' and "conversation_safety_assessment_run"."received_at" is null and "conversation_safety_assessment_run"."superseded_at" is null) or ("conversation_safety_assessment_run"."status" = 'received' and "conversation_safety_assessment_run"."received_at" is not null and "conversation_safety_assessment_run"."superseded_at" is null) or ("conversation_safety_assessment_run"."status" = 'superseded' and "conversation_safety_assessment_run"."superseded_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "provider_assessment_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_delivery_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"assessment_run_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_delivery_hash_format" CHECK (length("provider_assessment_delivery"."payload_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "provider_assessment_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"specification_id" uuid NOT NULL,
	"projection_code" text NOT NULL,
	"projection_version" text NOT NULL,
	"projection_hash" text NOT NULL,
	"provider" text NOT NULL,
	"provider_agent_reference" text NOT NULL,
	"provider_branch_reference" text,
	"provider_environment" text NOT NULL,
	"projection" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_projection_whakapapa_only" CHECK ("provider_assessment_projection"."pou_id" = 'whakapapa'),
	CONSTRAINT "provider_projection_hash_format" CHECK (length("provider_assessment_projection"."projection_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "provider_assessment_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_rule_assessment_id" uuid NOT NULL,
	"assessment_run_id" uuid NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"reviewed_by_user_id" uuid NOT NULL,
	"status" "provider_assessment_review_status" NOT NULL,
	"classification_source" text,
	"canonical_observation_id" uuid,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_assessment_review_linking" CHECK (("provider_assessment_review"."status" = 'confirmed' and "provider_assessment_review"."canonical_observation_id" is not null and "provider_assessment_review"."classification_source" = 'human_selected') or ("provider_assessment_review"."status" in ('dismissed', 'insufficient_information_acknowledged') and "provider_assessment_review"."canonical_observation_id" is null and "provider_assessment_review"."classification_source" is null))
);
--> statement-breakpoint
CREATE TABLE "safety_specification_activation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"specification_id" uuid NOT NULL,
	"projection_id" uuid NOT NULL,
	"activated_by_user_id" uuid NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "safety_activation_whakapapa_only" CHECK ("safety_specification_activation"."pou_id" = 'whakapapa')
);
--> statement-breakpoint
CREATE TABLE "safety_specification_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"specification_code" text NOT NULL,
	"specification_version" text NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"approval_status" "safety_specification_approval_status" NOT NULL,
	"content_hash" text NOT NULL,
	"rule_manifest_hash" text NOT NULL,
	"specification" jsonb NOT NULL,
	"source_document_code" text NOT NULL,
	"source_document_status" text NOT NULL,
	"source_reference" text NOT NULL,
	"source_document_hash" text NOT NULL,
	"derived_at" timestamp with time zone NOT NULL,
	"approved_for_pilot_by" uuid,
	"approved_for_pilot_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "safety_specification_whakapapa_only" CHECK ("safety_specification_version"."pou_id" = 'whakapapa'),
	CONSTRAINT "safety_specification_hash_format" CHECK (length("safety_specification_version"."content_hash") = 64 and length("safety_specification_version"."rule_manifest_hash") = 64 and length("safety_specification_version"."source_document_hash") = 64),
	CONSTRAINT "safety_specification_approval_fields" CHECK (("safety_specification_version"."approval_status" = 'draft_derived' and "safety_specification_version"."approved_for_pilot_by" is null and "safety_specification_version"."approved_for_pilot_at" is null) or ("safety_specification_version"."approval_status" = 'approved_for_pilot' and "safety_specification_version"."approved_for_pilot_by" is not null and "safety_specification_version"."approved_for_pilot_at" is not null))
);
--> statement-breakpoint
-- These composite referenced keys must exist before their dependent foreign
-- keys. This is an ordering correction only; the index definitions are the
-- generated schema definitions below.
CREATE UNIQUE INDEX "provider_projection_id_organisation_pou_uq" ON "provider_assessment_projection" USING btree ("id","organisation_id","pou_id");--> statement-breakpoint
CREATE UNIQUE INDEX "safety_specification_id_organisation_pou_uq" ON "safety_specification_version" USING btree ("id","organisation_id","pou_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_rule_assessment_id_run_uq" ON "conversation_provider_rule_assessment" USING btree ("id","assessment_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_run_id_organisation_workflow_uq" ON "conversation_safety_assessment_run" USING btree ("id","organisation_id","workflow_session_id");--> statement-breakpoint
ALTER TABLE "conversation_provider_rule_assessment" ADD CONSTRAINT "provider_rule_assessment_run_fk" FOREIGN KEY ("assessment_run_id") REFERENCES "public"."conversation_safety_assessment_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_safety_assessment_run" ADD CONSTRAINT "conversation_safety_assessment_run_workflow_conversation_id_workflow_conversation_id_fk" FOREIGN KEY ("workflow_conversation_id") REFERENCES "public"."workflow_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_safety_assessment_run" ADD CONSTRAINT "assessment_run_session_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_safety_assessment_run" ADD CONSTRAINT "assessment_run_checkpoint_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id","pou_id") REFERENCES "public"."workflow_pou_checkpoint"("workflow_session_id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_safety_assessment_run" ADD CONSTRAINT "assessment_run_specification_organisation_pou_fk" FOREIGN KEY ("specification_id","organisation_id","pou_id") REFERENCES "public"."safety_specification_version"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_safety_assessment_run" ADD CONSTRAINT "assessment_run_projection_organisation_pou_fk" FOREIGN KEY ("projection_id","organisation_id","pou_id") REFERENCES "public"."provider_assessment_projection"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_assessment_delivery" ADD CONSTRAINT "provider_delivery_assessment_run_fk" FOREIGN KEY ("assessment_run_id") REFERENCES "public"."conversation_safety_assessment_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_assessment_projection" ADD CONSTRAINT "provider_projection_specification_organisation_pou_fk" FOREIGN KEY ("specification_id","organisation_id","pou_id") REFERENCES "public"."safety_specification_version"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_assessment_review" ADD CONSTRAINT "provider_assessment_review_assessment_run_fk" FOREIGN KEY ("provider_rule_assessment_id","assessment_run_id") REFERENCES "public"."conversation_provider_rule_assessment"("id","assessment_run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_assessment_review" ADD CONSTRAINT "provider_assessment_review_run_organisation_session_fk" FOREIGN KEY ("assessment_run_id","organisation_id","workflow_session_id") REFERENCES "public"."conversation_safety_assessment_run"("id","organisation_id","workflow_session_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_assessment_review" ADD CONSTRAINT "provider_assessment_review_session_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_assessment_review" ADD CONSTRAINT "provider_assessment_review_actor_organisation_fk" FOREIGN KEY ("reviewed_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_assessment_review" ADD CONSTRAINT "provider_assessment_review_observation_organisation_session_fk" FOREIGN KEY ("canonical_observation_id","organisation_id","workflow_session_id") REFERENCES "public"."workflow_safety_observation"("id","organisation_id","workflow_session_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_specification_activation" ADD CONSTRAINT "safety_specification_activation_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_specification_activation" ADD CONSTRAINT "safety_activation_specification_organisation_pou_fk" FOREIGN KEY ("specification_id","organisation_id","pou_id") REFERENCES "public"."safety_specification_version"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_specification_activation" ADD CONSTRAINT "safety_activation_projection_organisation_pou_fk" FOREIGN KEY ("projection_id","organisation_id","pou_id") REFERENCES "public"."provider_assessment_projection"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_specification_activation" ADD CONSTRAINT "safety_activation_actor_organisation_fk" FOREIGN KEY ("activated_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_specification_version" ADD CONSTRAINT "safety_specification_version_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_specification_version" ADD CONSTRAINT "safety_specification_approval_actor_organisation_fk" FOREIGN KEY ("approved_for_pilot_by","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_rule_assessment_run_rule_version_uq" ON "conversation_provider_rule_assessment" USING btree ("assessment_run_id","rule_code","rule_version");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_run_one_per_conversation_uq" ON "conversation_safety_assessment_run" USING btree ("workflow_conversation_id");--> statement-breakpoint
CREATE INDEX "assessment_run_workflow_pou_status_idx" ON "conversation_safety_assessment_run" USING btree ("workflow_session_id","pou_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_assessment_delivery_identity_uq" ON "provider_assessment_delivery" USING btree ("provider","provider_delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_projection_organisation_code_version_uq" ON "provider_assessment_projection" USING btree ("organisation_id","projection_code","projection_version");--> statement-breakpoint
CREATE INDEX "provider_projection_provider_agent_idx" ON "provider_assessment_projection" USING btree ("provider","provider_agent_reference","provider_environment");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_assessment_review_one_final_uq" ON "provider_assessment_review" USING btree ("provider_rule_assessment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_assessment_review_observation_uq" ON "provider_assessment_review" USING btree ("canonical_observation_id") WHERE "provider_assessment_review"."canonical_observation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "safety_activation_one_active_per_organisation_pou_uq" ON "safety_specification_activation" USING btree ("organisation_id","pou_id") WHERE "safety_specification_activation"."deactivated_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "safety_specification_organisation_code_version_uq" ON "safety_specification_version" USING btree ("organisation_id","specification_code","specification_version");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_safety_policy_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Provisioned safety policy records are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "safety_specification_version_immutable" BEFORE UPDATE OR DELETE ON "public"."safety_specification_version" FOR EACH ROW EXECUTE FUNCTION "public"."reject_safety_policy_mutation"();--> statement-breakpoint
CREATE TRIGGER "provider_assessment_projection_immutable" BEFORE UPDATE OR DELETE ON "public"."provider_assessment_projection" FOR EACH ROW EXECUTE FUNCTION "public"."reject_safety_policy_mutation"();
