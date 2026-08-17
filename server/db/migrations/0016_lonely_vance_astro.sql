CREATE TYPE "public"."workflow_carry_forward_source" AS ENUM('review_criterion', 'areas_for_attention', 'safety_observation');--> statement-breakpoint
ALTER TYPE "public"."workflow_interaction_type" ADD VALUE 'carry_forward_marked';--> statement-breakpoint
CREATE TABLE "workflow_carry_forward" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"source" "workflow_carry_forward_source" NOT NULL,
	"review_draft_revision_id" uuid,
	"criterion_code" text,
	"safety_observation_id" uuid,
	"note" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carry_forward_note_length" CHECK ("workflow_carry_forward"."note" is null or length("workflow_carry_forward"."note") between 1 and 1000),
	CONSTRAINT "carry_forward_source_shape" CHECK (("workflow_carry_forward"."source" = 'review_criterion' and "workflow_carry_forward"."review_draft_revision_id" is not null and "workflow_carry_forward"."criterion_code" is not null and "workflow_carry_forward"."safety_observation_id" is null) or ("workflow_carry_forward"."source" = 'areas_for_attention' and "workflow_carry_forward"."review_draft_revision_id" is not null and "workflow_carry_forward"."criterion_code" is null and "workflow_carry_forward"."safety_observation_id" is null) or ("workflow_carry_forward"."source" = 'safety_observation' and "workflow_carry_forward"."review_draft_revision_id" is null and "workflow_carry_forward"."criterion_code" is null and "workflow_carry_forward"."safety_observation_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "workflow_carry_forward" ADD CONSTRAINT "carry_forward_checkpoint_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id","pou_id") REFERENCES "public"."workflow_pou_checkpoint"("workflow_session_id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_carry_forward" ADD CONSTRAINT "carry_forward_review_revision_fk" FOREIGN KEY ("review_draft_revision_id") REFERENCES "public"."conversation_review_draft_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_carry_forward" ADD CONSTRAINT "carry_forward_safety_observation_fk" FOREIGN KEY ("safety_observation_id") REFERENCES "public"."workflow_safety_observation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_carry_forward" ADD CONSTRAINT "carry_forward_created_by_organisation_fk" FOREIGN KEY ("created_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carry_forward_workflow_created_idx" ON "workflow_carry_forward" USING btree ("workflow_session_id","created_at");