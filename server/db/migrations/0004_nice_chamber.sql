CREATE TYPE "public"."workflow_safety_assessment_context" AS ENUM('setup', 'pou');--> statement-breakpoint
CREATE TYPE "public"."workflow_safety_broad_class" AS ENUM('whanau_safety', 'practice_quality', 'practitioner_wellbeing');--> statement-breakpoint
CREATE TYPE "public"."workflow_safety_concern_level" AS ENUM('unsure', 'low', 'watch', 'action', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."workflow_safety_consequence_cessation_reason" AS ENUM('observation_corrected', 'observation_retracted');--> statement-breakpoint
CREATE TYPE "public"."workflow_safety_consequence_state" AS ENUM('required', 'ceased');--> statement-breakpoint
CREATE TYPE "public"."workflow_safety_consequence_type" AS ENUM('supervisor_review_required', 'supervisor_notification_required');--> statement-breakpoint
CREATE TYPE "public"."workflow_safety_observation_status" AS ENUM('active', 'retracted');--> statement-breakpoint
CREATE TYPE "public"."workflow_safety_revision_operation" AS ENUM('confirmed', 'corrected', 'retracted');--> statement-breakpoint
ALTER TYPE "public"."workflow_interaction_type" ADD VALUE 'safety_observation_confirmed';--> statement-breakpoint
ALTER TYPE "public"."workflow_interaction_type" ADD VALUE 'safety_observation_corrected';--> statement-breakpoint
ALTER TYPE "public"."workflow_interaction_type" ADD VALUE 'safety_observation_retracted';--> statement-breakpoint
ALTER TYPE "public"."workflow_interaction_type" ADD VALUE 'supervisor_review_requested';--> statement-breakpoint
CREATE TABLE "workflow_safety_consequence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"observation_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"type" "workflow_safety_consequence_type" NOT NULL,
	"state" "workflow_safety_consequence_state" DEFAULT 'required' NOT NULL,
	"created_by_evaluation_id" uuid NOT NULL,
	"required_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ceased_by_evaluation_id" uuid,
	"cessation_reason" "workflow_safety_consequence_cessation_reason",
	"ceased_at" timestamp with time zone,
	CONSTRAINT "workflow_safety_consequence_state_fields" CHECK (("workflow_safety_consequence"."state" = 'required' and "workflow_safety_consequence"."ceased_by_evaluation_id" is null and "workflow_safety_consequence"."cessation_reason" is null and "workflow_safety_consequence"."ceased_at" is null) or ("workflow_safety_consequence"."state" = 'ceased' and "workflow_safety_consequence"."ceased_by_evaluation_id" is not null and "workflow_safety_consequence"."cessation_reason" is not null and "workflow_safety_consequence"."ceased_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "workflow_safety_observation_revision" (
	"observation_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"assessment_context" "workflow_safety_assessment_context" NOT NULL,
	"pou_id" "workflow_pou_id",
	"broad_class" "workflow_safety_broad_class" NOT NULL,
	"concern_level" "workflow_safety_concern_level" NOT NULL,
	"context_note" text,
	"resulting_status" "workflow_safety_observation_status" NOT NULL,
	"operation" "workflow_safety_revision_operation" NOT NULL,
	"change_reason" text,
	"actor_user_id" uuid NOT NULL,
	"interaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_safety_observation_revision_pk" PRIMARY KEY("observation_id","revision"),
	CONSTRAINT "workflow_safety_observation_revision_positive" CHECK ("workflow_safety_observation_revision"."revision" > 0),
	CONSTRAINT "workflow_safety_observation_revision_context_pou" CHECK (("workflow_safety_observation_revision"."assessment_context" = 'setup' and "workflow_safety_observation_revision"."pou_id" is null) or ("workflow_safety_observation_revision"."assessment_context" = 'pou' and "workflow_safety_observation_revision"."pou_id" is not null)),
	CONSTRAINT "workflow_safety_observation_revision_context_concern" CHECK (("workflow_safety_observation_revision"."assessment_context" = 'setup' and "workflow_safety_observation_revision"."concern_level" in ('unsure', 'urgent')) or ("workflow_safety_observation_revision"."assessment_context" = 'pou' and "workflow_safety_observation_revision"."concern_level" in ('low', 'watch', 'action', 'urgent'))),
	CONSTRAINT "workflow_safety_observation_revision_context_note_length" CHECK ("workflow_safety_observation_revision"."context_note" is null or length("workflow_safety_observation_revision"."context_note") <= 4000),
	CONSTRAINT "workflow_safety_observation_revision_reason" CHECK (("workflow_safety_observation_revision"."operation" = 'confirmed' and "workflow_safety_observation_revision"."change_reason" is null) or ("workflow_safety_observation_revision"."operation" in ('corrected', 'retracted') and length("workflow_safety_observation_revision"."change_reason") between 1 and 4000))
);
--> statement-breakpoint
CREATE TABLE "workflow_safety_observation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"assessment_context" "workflow_safety_assessment_context" NOT NULL,
	"pou_id" "workflow_pou_id",
	"broad_class" "workflow_safety_broad_class" NOT NULL,
	"concern_level" "workflow_safety_concern_level" NOT NULL,
	"context_note" text,
	"status" "workflow_safety_observation_status" DEFAULT 'active' NOT NULL,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"confirmed_by_user_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retracted_at" timestamp with time zone,
	CONSTRAINT "workflow_safety_observation_context_pou" CHECK (("workflow_safety_observation"."assessment_context" = 'setup' and "workflow_safety_observation"."pou_id" is null) or ("workflow_safety_observation"."assessment_context" = 'pou' and "workflow_safety_observation"."pou_id" is not null)),
	CONSTRAINT "workflow_safety_observation_context_concern" CHECK (("workflow_safety_observation"."assessment_context" = 'setup' and "workflow_safety_observation"."concern_level" in ('unsure', 'urgent')) or ("workflow_safety_observation"."assessment_context" = 'pou' and "workflow_safety_observation"."concern_level" in ('low', 'watch', 'action', 'urgent'))),
	CONSTRAINT "workflow_safety_observation_revision_positive" CHECK ("workflow_safety_observation"."current_revision" > 0),
	CONSTRAINT "workflow_safety_observation_context_note_length" CHECK ("workflow_safety_observation"."context_note" is null or length("workflow_safety_observation"."context_note") <= 4000),
	CONSTRAINT "workflow_safety_observation_retracted_state" CHECK (("workflow_safety_observation"."status" = 'retracted') = ("workflow_safety_observation"."retracted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "workflow_safety_rule_evaluation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"observation_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"observation_revision" integer NOT NULL,
	"rule_code" text NOT NULL,
	"rule_version" integer NOT NULL,
	"decision_code" text NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_safety_rule_evaluation_rule_code_length" CHECK (length("workflow_safety_rule_evaluation"."rule_code") between 1 and 200),
	CONSTRAINT "workflow_safety_rule_evaluation_rule_version_positive" CHECK ("workflow_safety_rule_evaluation"."rule_version" > 0),
	CONSTRAINT "workflow_safety_rule_evaluation_decision_code_length" CHECK (length("workflow_safety_rule_evaluation"."decision_code") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "workflow_supervisor_review_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id",
	"request_note" text,
	"requested_by_user_id" uuid NOT NULL,
	"interaction_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_supervisor_review_request_note_length" CHECK ("workflow_supervisor_review_request"."request_note" is null or length("workflow_supervisor_review_request"."request_note") <= 4000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_safety_observation_revision_organisation_uq" ON "workflow_safety_observation_revision" USING btree ("observation_id","organisation_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_safety_observation_id_organisation_uq" ON "workflow_safety_observation" USING btree ("id","organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_safety_observation_id_organisation_session_uq" ON "workflow_safety_observation" USING btree ("id","organisation_id","workflow_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_safety_rule_evaluation_id_observation_organisation_uq" ON "workflow_safety_rule_evaluation" USING btree ("id","observation_id","organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_interaction_id_organisation_session_uq" ON "workflow_interaction" USING btree ("id","organisation_id","workflow_session_id");--> statement-breakpoint
ALTER TABLE "workflow_safety_consequence" ADD CONSTRAINT "workflow_safety_consequence_observation_organisation_fk" FOREIGN KEY ("observation_id","organisation_id") REFERENCES "public"."workflow_safety_observation"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_safety_consequence" ADD CONSTRAINT "workflow_safety_consequence_created_evaluation_observation_organisation_fk" FOREIGN KEY ("created_by_evaluation_id","observation_id","organisation_id") REFERENCES "public"."workflow_safety_rule_evaluation"("id","observation_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_safety_consequence" ADD CONSTRAINT "workflow_safety_consequence_ceased_evaluation_observation_organisation_fk" FOREIGN KEY ("ceased_by_evaluation_id","observation_id","organisation_id") REFERENCES "public"."workflow_safety_rule_evaluation"("id","observation_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_safety_observation_revision" ADD CONSTRAINT "workflow_safety_observation_revision_observation_organisation_session_fk" FOREIGN KEY ("observation_id","organisation_id","workflow_session_id") REFERENCES "public"."workflow_safety_observation"("id","organisation_id","workflow_session_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_safety_observation_revision" ADD CONSTRAINT "workflow_safety_observation_revision_actor_organisation_fk" FOREIGN KEY ("actor_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_safety_observation_revision" ADD CONSTRAINT "workflow_safety_observation_revision_interaction_organisation_session_fk" FOREIGN KEY ("interaction_id","organisation_id","workflow_session_id") REFERENCES "public"."workflow_interaction"("id","organisation_id","workflow_session_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_safety_observation" ADD CONSTRAINT "workflow_safety_observation_session_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_safety_observation" ADD CONSTRAINT "workflow_safety_observation_checkpoint_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id","pou_id") REFERENCES "public"."workflow_pou_checkpoint"("workflow_session_id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_safety_observation" ADD CONSTRAINT "workflow_safety_observation_confirmed_by_organisation_fk" FOREIGN KEY ("confirmed_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_safety_rule_evaluation" ADD CONSTRAINT "workflow_safety_rule_evaluation_revision_organisation_fk" FOREIGN KEY ("observation_id","organisation_id","observation_revision") REFERENCES "public"."workflow_safety_observation_revision"("observation_id","organisation_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_supervisor_review_request" ADD CONSTRAINT "workflow_supervisor_review_request_session_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_supervisor_review_request" ADD CONSTRAINT "workflow_supervisor_review_request_checkpoint_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id","pou_id") REFERENCES "public"."workflow_pou_checkpoint"("workflow_session_id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_supervisor_review_request" ADD CONSTRAINT "workflow_supervisor_review_request_requester_organisation_fk" FOREIGN KEY ("requested_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_supervisor_review_request" ADD CONSTRAINT "workflow_supervisor_review_request_interaction_organisation_session_fk" FOREIGN KEY ("interaction_id","organisation_id","workflow_session_id") REFERENCES "public"."workflow_interaction"("id","organisation_id","workflow_session_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_safety_consequence_active_observation_type_uq" ON "workflow_safety_consequence" USING btree ("observation_id","type") WHERE "workflow_safety_consequence"."state" = 'required';--> statement-breakpoint
CREATE INDEX "workflow_safety_consequence_observation_state_idx" ON "workflow_safety_consequence" USING btree ("observation_id","state");--> statement-breakpoint
CREATE INDEX "workflow_safety_observation_workflow_active_idx" ON "workflow_safety_observation" USING btree ("workflow_session_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_safety_rule_evaluation_observation_rule_uq" ON "workflow_safety_rule_evaluation" USING btree ("observation_id","observation_revision","rule_code","rule_version");--> statement-breakpoint
CREATE INDEX "workflow_supervisor_review_request_workflow_requested_idx" ON "workflow_supervisor_review_request" USING btree ("workflow_session_id","requested_at");--> statement-breakpoint
