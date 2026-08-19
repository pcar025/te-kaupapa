CREATE TYPE "public"."conversation_review_draft_revision_source" AS ENUM('generated', 'edited');--> statement-breakpoint
CREATE TYPE "public"."conversation_review_draft_status" AS ENUM('generated', 'failed');--> statement-breakpoint
CREATE TABLE "conversation_review_draft_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_draft_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"source" "conversation_review_draft_revision_source" NOT NULL,
	"overall_summary" text,
	"strengths_summary" text,
	"areas_for_attention_summary" text,
	"evidence_turn_ids" jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_draft_revision_positive" CHECK ("conversation_review_draft_revision"."revision" > 0),
	CONSTRAINT "review_draft_revision_content_bound" CHECK (coalesce(length("conversation_review_draft_revision"."overall_summary"), 0) + coalesce(length("conversation_review_draft_revision"."strengths_summary"), 0) + coalesce(length("conversation_review_draft_revision"."areas_for_attention_summary"), 0) > 0 and ("conversation_review_draft_revision"."overall_summary" is null or length("conversation_review_draft_revision"."overall_summary") <= 1200) and ("conversation_review_draft_revision"."strengths_summary" is null or length("conversation_review_draft_revision"."strengths_summary") <= 900) and ("conversation_review_draft_revision"."areas_for_attention_summary" is null or length("conversation_review_draft_revision"."areas_for_attention_summary") <= 900)),
	CONSTRAINT "review_draft_revision_source_actor" CHECK (("conversation_review_draft_revision"."source" = 'generated' and "conversation_review_draft_revision"."revision" = 1 and "conversation_review_draft_revision"."created_by_user_id" is null) or ("conversation_review_draft_revision"."source" = 'edited' and "conversation_review_draft_revision"."revision" > 1 and "conversation_review_draft_revision"."created_by_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "conversation_review_draft_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_draft_id" uuid NOT NULL,
	"viewed_by_user_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_review_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_run_id" uuid NOT NULL,
	"workflow_conversation_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"status" "conversation_review_draft_status" NOT NULL,
	"provider" text,
	"provider_model" text,
	"provider_config_hash" text,
	"schema_version" text,
	"generated_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_category" text,
	"specification_hash" text NOT NULL,
	"projection_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_draft_whakapapa_only" CHECK ("conversation_review_draft"."pou_id" = 'whakapapa'),
	CONSTRAINT "review_draft_hash_format" CHECK (length("conversation_review_draft"."specification_hash") = 64 and length("conversation_review_draft"."projection_hash") = 64 and ("conversation_review_draft"."provider_config_hash" is null or length("conversation_review_draft"."provider_config_hash") = 64)),
	CONSTRAINT "review_draft_status_lifecycle" CHECK (("conversation_review_draft"."status" = 'generated' and "conversation_review_draft"."generated_at" is not null and "conversation_review_draft"."failed_at" is null and "conversation_review_draft"."provider" is not null and "conversation_review_draft"."provider_model" is not null and "conversation_review_draft"."provider_config_hash" is not null and "conversation_review_draft"."schema_version" is not null and "conversation_review_draft"."failure_category" is null) or ("conversation_review_draft"."status" = 'failed' and "conversation_review_draft"."generated_at" is null and "conversation_review_draft"."failed_at" is not null and "conversation_review_draft"."provider" is null and "conversation_review_draft"."provider_model" is null and "conversation_review_draft"."provider_config_hash" is null and "conversation_review_draft"."schema_version" is null and "conversation_review_draft"."failure_category" is not null))
);
--> statement-breakpoint
CREATE TABLE "workflow_pou_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"review_draft_revision_id" uuid NOT NULL,
	"overall_summary" text,
	"strengths_summary" text,
	"areas_for_attention_summary" text,
	"confirmed_by_user_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_pou_review_whakapapa_only" CHECK ("workflow_pou_review"."pou_id" = 'whakapapa'),
	CONSTRAINT "workflow_pou_review_content_bound" CHECK (coalesce(length("workflow_pou_review"."overall_summary"), 0) + coalesce(length("workflow_pou_review"."strengths_summary"), 0) + coalesce(length("workflow_pou_review"."areas_for_attention_summary"), 0) > 0 and ("workflow_pou_review"."overall_summary" is null or length("workflow_pou_review"."overall_summary") <= 1200) and ("workflow_pou_review"."strengths_summary" is null or length("workflow_pou_review"."strengths_summary") <= 900) and ("workflow_pou_review"."areas_for_attention_summary" is null or length("workflow_pou_review"."areas_for_attention_summary") <= 900))
);
--> statement-breakpoint
ALTER TABLE "conversation_review_draft_revision" ADD CONSTRAINT "review_draft_revision_draft_fk" FOREIGN KEY ("review_draft_id") REFERENCES "public"."conversation_review_draft"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_review_draft_view" ADD CONSTRAINT "review_draft_view_draft_fk" FOREIGN KEY ("review_draft_id") REFERENCES "public"."conversation_review_draft"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_review_draft_view" ADD CONSTRAINT "review_draft_view_user_fk" FOREIGN KEY ("viewed_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_review_draft" ADD CONSTRAINT "review_draft_run_organisation_session_fk" FOREIGN KEY ("assessment_run_id","organisation_id","workflow_session_id") REFERENCES "public"."conversation_safety_assessment_run"("id","organisation_id","workflow_session_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_review_draft" ADD CONSTRAINT "review_draft_conversation_scope_fk" FOREIGN KEY ("workflow_conversation_id","organisation_id","workflow_session_id","pou_id") REFERENCES "public"."workflow_conversation"("id","organisation_id","workflow_session_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_review_draft" ADD CONSTRAINT "review_draft_checkpoint_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id","pou_id") REFERENCES "public"."workflow_pou_checkpoint"("workflow_session_id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_pou_review" ADD CONSTRAINT "workflow_pou_review_checkpoint_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id","pou_id") REFERENCES "public"."workflow_pou_checkpoint"("workflow_session_id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_pou_review" ADD CONSTRAINT "workflow_pou_review_revision_fk" FOREIGN KEY ("review_draft_revision_id") REFERENCES "public"."conversation_review_draft_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_pou_review" ADD CONSTRAINT "workflow_pou_review_confirming_user_organisation_fk" FOREIGN KEY ("confirmed_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_draft_revision_draft_revision_uq" ON "conversation_review_draft_revision" USING btree ("review_draft_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "review_draft_revision_id_draft_uq" ON "conversation_review_draft_revision" USING btree ("id","review_draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_draft_view_draft_user_uq" ON "conversation_review_draft_view" USING btree ("review_draft_id","viewed_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_draft_one_per_assessment_run_uq" ON "conversation_review_draft" USING btree ("assessment_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_draft_id_organisation_workflow_uq" ON "conversation_review_draft" USING btree ("id","organisation_id","workflow_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_pou_review_session_pou_uq" ON "workflow_pou_review" USING btree ("workflow_session_id","pou_id");
--> statement-breakpoint
CREATE FUNCTION "review_draft_provenance_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'review draft provenance is immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "conversation_review_draft_immutable" BEFORE UPDATE OR DELETE ON "conversation_review_draft" FOR EACH ROW EXECUTE FUNCTION "review_draft_provenance_immutable"();
--> statement-breakpoint
CREATE TRIGGER "conversation_review_draft_revision_immutable" BEFORE UPDATE OR DELETE ON "conversation_review_draft_revision" FOR EACH ROW EXECUTE FUNCTION "review_draft_provenance_immutable"();
--> statement-breakpoint
CREATE TRIGGER "workflow_pou_review_immutable" BEFORE UPDATE OR DELETE ON "workflow_pou_review" FOR EACH ROW EXECUTE FUNCTION "review_draft_provenance_immutable"();
