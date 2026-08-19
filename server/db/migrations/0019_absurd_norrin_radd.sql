CREATE TYPE "public"."workflow_synthesis_revision_source" AS ENUM('generated', 'edited');--> statement-breakpoint
CREATE TYPE "public"."workflow_synthesis_status" AS ENUM('generating', 'generated', 'failed');--> statement-breakpoint
ALTER TYPE "public"."workflow_interaction_type" ADD VALUE 'workflow_synthesis_confirmed' BEFORE 'pou_summary_confirmed';--> statement-breakpoint
CREATE TABLE "workflow_confirmed_synthesis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"synthesis_revision_id" uuid NOT NULL,
	"confirmed_by_user_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_final_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"confirmed_synthesis_id" uuid NOT NULL,
	"workflow_reference" text NOT NULL,
	"organisation_name" text NOT NULL,
	"kaimahi_display_name" text NOT NULL,
	"overall_summary" text NOT NULL,
	"key_themes" text,
	"strengths_summary" text,
	"areas_for_attention_summary" text,
	"information_still_to_explore_summary" text,
	"confirmed_safety_concerns_summary" text,
	"actions" jsonb NOT NULL,
	"referrals" jsonb NOT NULL,
	"safety_observations" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"finalized_by_user_id" uuid NOT NULL,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_final_record_hash_format" CHECK (length("workflow_final_record"."content_hash") = 64),
	CONSTRAINT "workflow_final_record_summary_bound" CHECK (length("workflow_final_record"."overall_summary") between 1 and 1800)
);
--> statement-breakpoint
CREATE TABLE "workflow_synthesis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"status" "workflow_synthesis_status" DEFAULT 'generating' NOT NULL,
	"source_hash" text NOT NULL,
	"provider" text,
	"provider_model" text,
	"provider_config_hash" text,
	"schema_version" text,
	"generated_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_synthesis_hash_format" CHECK (length("workflow_synthesis"."source_hash") = 64),
	CONSTRAINT "workflow_synthesis_generated_state" CHECK (("workflow_synthesis"."status" = 'generated') = ("workflow_synthesis"."generated_at" is not null)),
	CONSTRAINT "workflow_synthesis_failed_state" CHECK (("workflow_synthesis"."status" = 'failed') = ("workflow_synthesis"."failed_at" is not null and "workflow_synthesis"."failure_category" is not null))
);
--> statement-breakpoint
CREATE TABLE "workflow_synthesis_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"synthesis_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"source" "workflow_synthesis_revision_source" NOT NULL,
	"overall_summary" text NOT NULL,
	"key_themes" text,
	"strengths_summary" text,
	"areas_for_attention_summary" text,
	"information_still_to_explore_summary" text,
	"confirmed_safety_concerns_summary" text,
	"edited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_synthesis_revision_positive" CHECK ("workflow_synthesis_revision"."revision" > 0),
	CONSTRAINT "workflow_synthesis_revision_source_actor" CHECK (("workflow_synthesis_revision"."source" = 'generated' and "workflow_synthesis_revision"."edited_by_user_id" is null) or ("workflow_synthesis_revision"."source" = 'edited' and "workflow_synthesis_revision"."edited_by_user_id" is not null)),
	CONSTRAINT "workflow_synthesis_revision_bounds" CHECK (length("workflow_synthesis_revision"."overall_summary") between 1 and 1800 and ("workflow_synthesis_revision"."key_themes" is null or length("workflow_synthesis_revision"."key_themes") <= 1200) and ("workflow_synthesis_revision"."strengths_summary" is null or length("workflow_synthesis_revision"."strengths_summary") <= 1200) and ("workflow_synthesis_revision"."areas_for_attention_summary" is null or length("workflow_synthesis_revision"."areas_for_attention_summary") <= 1200) and ("workflow_synthesis_revision"."information_still_to_explore_summary" is null or length("workflow_synthesis_revision"."information_still_to_explore_summary") <= 1200) and ("workflow_synthesis_revision"."confirmed_safety_concerns_summary" is null or length("workflow_synthesis_revision"."confirmed_safety_concerns_summary") <= 1200))
);
--> statement-breakpoint
ALTER TABLE "workflow_confirmed_synthesis" ADD CONSTRAINT "workflow_confirmed_synthesis_session_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_confirmed_synthesis" ADD CONSTRAINT "workflow_confirmed_synthesis_revision_fk" FOREIGN KEY ("synthesis_revision_id") REFERENCES "public"."workflow_synthesis_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_confirmed_synthesis" ADD CONSTRAINT "workflow_confirmed_synthesis_actor_organisation_fk" FOREIGN KEY ("confirmed_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_final_record" ADD CONSTRAINT "workflow_final_record_session_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_final_record" ADD CONSTRAINT "workflow_final_record_confirmed_synthesis_fk" FOREIGN KEY ("confirmed_synthesis_id") REFERENCES "public"."workflow_confirmed_synthesis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_final_record" ADD CONSTRAINT "workflow_final_record_actor_organisation_fk" FOREIGN KEY ("finalized_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_synthesis" ADD CONSTRAINT "workflow_synthesis_session_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_synthesis_revision" ADD CONSTRAINT "workflow_synthesis_revision_synthesis_fk" FOREIGN KEY ("synthesis_id") REFERENCES "public"."workflow_synthesis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_synthesis_revision" ADD CONSTRAINT "workflow_synthesis_revision_editor_fk" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_confirmed_synthesis_session_uq" ON "workflow_confirmed_synthesis" USING btree ("workflow_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_final_record_session_uq" ON "workflow_final_record" USING btree ("workflow_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_synthesis_session_uq" ON "workflow_synthesis" USING btree ("workflow_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_synthesis_revision_synthesis_revision_uq" ON "workflow_synthesis_revision" USING btree ("synthesis_id","revision");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_workflow_synthesis_provenance_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workflow synthesis provenance is immutable' USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_workflow_confirmed_synthesis_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_synthesis_revision revision
    INNER JOIN public.workflow_synthesis synthesis ON synthesis.id = revision.synthesis_id
    WHERE revision.id = NEW.synthesis_revision_id
      AND synthesis.workflow_session_id = NEW.workflow_session_id
      AND synthesis.organisation_id = NEW.organisation_id
  ) THEN
    RAISE EXCEPTION 'confirmed synthesis revision does not belong to workflow' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workflow_synthesis_revision_immutable BEFORE UPDATE OR DELETE ON public.workflow_synthesis_revision FOR EACH ROW EXECUTE FUNCTION public.reject_workflow_synthesis_provenance_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_confirmed_synthesis_immutable BEFORE UPDATE OR DELETE ON public.workflow_confirmed_synthesis FOR EACH ROW EXECUTE FUNCTION public.reject_workflow_synthesis_provenance_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_confirmed_synthesis_lineage BEFORE INSERT OR UPDATE ON public.workflow_confirmed_synthesis FOR EACH ROW EXECUTE FUNCTION public.assert_workflow_confirmed_synthesis_lineage();
--> statement-breakpoint
CREATE TRIGGER workflow_final_record_immutable BEFORE UPDATE OR DELETE ON public.workflow_final_record FOR EACH ROW EXECUTE FUNCTION public.reject_workflow_synthesis_provenance_mutation();
