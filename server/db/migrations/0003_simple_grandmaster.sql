CREATE TYPE "public"."workflow_action_status" AS ENUM('open', 'completed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."workflow_action_type" AS ENUM('follow-up', 'support', 'other');--> statement-breakpoint
CREATE TYPE "public"."workflow_referral_status" AS ENUM('draft', 'prepared', 'declined', 'withdrawn');--> statement-breakpoint
ALTER TYPE "public"."workflow_interaction_type" ADD VALUE 'pou_summary_confirmed';--> statement-breakpoint
ALTER TYPE "public"."workflow_interaction_type" ADD VALUE 'action_plan_confirmed';--> statement-breakpoint
ALTER TYPE "public"."workflow_interaction_type" ADD VALUE 'referral_plan_confirmed';--> statement-breakpoint
ALTER TYPE "public"."workflow_interaction_type" ADD VALUE 'structured_review_confirmed';--> statement-breakpoint
ALTER TYPE "public"."workflow_interaction_type" ADD VALUE 'workflow_completed';--> statement-breakpoint
ALTER TYPE "public"."workflow_stage" ADD VALUE 'action-planning';--> statement-breakpoint
ALTER TYPE "public"."workflow_stage" ADD VALUE 'referral-planning';--> statement-breakpoint
ALTER TYPE "public"."workflow_stage" ADD VALUE 'structured-review';--> statement-breakpoint
ALTER TYPE "public"."workflow_stage" ADD VALUE 'record-review';--> statement-breakpoint
ALTER TYPE "public"."workflow_stage" ADD VALUE 'complete';--> statement-breakpoint
CREATE TABLE "workflow_action" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id",
	"title" text NOT NULL,
	"type" "workflow_action_type" NOT NULL,
	"due_date" date,
	"status" "workflow_action_status" DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_action_title_length" CHECK (length("workflow_action"."title") between 1 and 300),
	CONSTRAINT "workflow_action_notes_length" CHECK ("workflow_action"."notes" is null or length("workflow_action"."notes") <= 4000),
	CONSTRAINT "workflow_action_owner_is_creator" CHECK ("workflow_action"."owner_user_id" = "workflow_action"."created_by_user_id"),
	CONSTRAINT "workflow_action_withdrawn_state" CHECK (("workflow_action"."status" = 'withdrawn') = ("workflow_action"."withdrawn_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "workflow_referral" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id",
	"destination_code" text,
	"destination_name" text NOT NULL,
	"reason" text NOT NULL,
	"handover_note" text,
	"notes" text,
	"status" "workflow_referral_status" DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_referral_destination_code_length" CHECK ("workflow_referral"."destination_code" is null or length("workflow_referral"."destination_code") between 1 and 100),
	CONSTRAINT "workflow_referral_destination_name_length" CHECK (length("workflow_referral"."destination_name") between 1 and 300),
	CONSTRAINT "workflow_referral_reason_length" CHECK (length("workflow_referral"."reason") between 1 and 4000),
	CONSTRAINT "workflow_referral_handover_note_length" CHECK ("workflow_referral"."handover_note" is null or length("workflow_referral"."handover_note") <= 4000),
	CONSTRAINT "workflow_referral_notes_length" CHECK ("workflow_referral"."notes" is null or length("workflow_referral"."notes") <= 4000),
	CONSTRAINT "workflow_referral_withdrawn_state" CHECK (("workflow_referral"."status" = 'withdrawn') = ("workflow_referral"."withdrawn_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "workflow_session" ADD COLUMN "completed_by_user_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_pou_checkpoint_session_organisation_pou_uq" ON "workflow_pou_checkpoint" USING btree ("workflow_session_id","organisation_id","pou_id");--> statement-breakpoint
ALTER TABLE "workflow_action" ADD CONSTRAINT "workflow_action_session_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action" ADD CONSTRAINT "workflow_action_checkpoint_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id","pou_id") REFERENCES "public"."workflow_pou_checkpoint"("workflow_session_id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action" ADD CONSTRAINT "workflow_action_created_by_organisation_fk" FOREIGN KEY ("created_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action" ADD CONSTRAINT "workflow_action_owner_organisation_fk" FOREIGN KEY ("owner_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_referral" ADD CONSTRAINT "workflow_referral_session_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_referral" ADD CONSTRAINT "workflow_referral_checkpoint_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id","pou_id") REFERENCES "public"."workflow_pou_checkpoint"("workflow_session_id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_referral" ADD CONSTRAINT "workflow_referral_created_by_organisation_fk" FOREIGN KEY ("created_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_action_workflow_status_idx" ON "workflow_action" USING btree ("workflow_session_id","status");--> statement-breakpoint
CREATE INDEX "workflow_referral_workflow_status_idx" ON "workflow_referral" USING btree ("workflow_session_id","status");--> statement-breakpoint
ALTER TABLE "workflow_session" ADD CONSTRAINT "workflow_session_completed_by_organisation_fk" FOREIGN KEY ("completed_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
