CREATE TYPE "public"."organisation_pou_specification_approval_status" AS ENUM('draft_derived', 'approved_for_pilot');--> statement-breakpoint
CREATE TYPE "public"."pou_evidence_scope" AS ENUM('current_conversation', 'application_state', 'longitudinal');--> statement-breakpoint
CREATE TYPE "public"."pou_review_criterion_status" AS ENUM('evidenced', 'partially_evidenced', 'not_explored', 'insufficient_information', 'not_applicable');--> statement-breakpoint
CREATE TABLE "conversation_guidance_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"specification_id" uuid NOT NULL,
	"projection_code" text NOT NULL,
	"projection_version" text NOT NULL,
	"projection_hash" text NOT NULL,
	"projection" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_guidance_projection_whakapapa_only" CHECK ("conversation_guidance_projection"."pou_id" = 'whakapapa'),
	CONSTRAINT "conversation_guidance_projection_hash_format" CHECK (length("conversation_guidance_projection"."projection_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "conversation_review_draft_criterion_assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_draft_revision_id" uuid NOT NULL,
	"criterion_code" text NOT NULL,
	"status" "pou_review_criterion_status" NOT NULL,
	"evidence_turn_ids" jsonb NOT NULL,
	"missing_information_codes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_draft_criterion_code_length" CHECK (length("conversation_review_draft_criterion_assessment"."criterion_code") between 2 and 120)
);
--> statement-breakpoint
CREATE TABLE "organisation_pou_safety_specification_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"organisation_pou_specification_id" uuid NOT NULL,
	"safety_specification_id" uuid NOT NULL,
	"safety_projection_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_pou_safety_link_whakapapa_only" CHECK ("organisation_pou_safety_specification_link"."pou_id" = 'whakapapa')
);
--> statement-breakpoint
CREATE TABLE "organisation_pou_specification_activation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"specification_id" uuid NOT NULL,
	"conversation_guidance_projection_id" uuid NOT NULL,
	"pou_review_projection_id" uuid NOT NULL,
	"safety_link_id" uuid NOT NULL,
	"activated_by_user_id" uuid NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "organisation_pou_specification_activation_whakapapa_only" CHECK ("organisation_pou_specification_activation"."pou_id" = 'whakapapa')
);
--> statement-breakpoint
CREATE TABLE "organisation_pou_specification_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"specification_code" text NOT NULL,
	"specification_version" text NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"approval_status" "organisation_pou_specification_approval_status" NOT NULL,
	"content_hash" text NOT NULL,
	"specification" jsonb NOT NULL,
	"source_document_code" text NOT NULL,
	"source_document_status" text NOT NULL,
	"source_reference" text NOT NULL,
	"source_document_hash" text NOT NULL,
	"derived_at" timestamp with time zone NOT NULL,
	"approved_for_pilot_by" uuid,
	"approved_for_pilot_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_pou_specification_whakapapa_only" CHECK ("organisation_pou_specification_version"."pou_id" = 'whakapapa'),
	CONSTRAINT "organisation_pou_specification_hash_format" CHECK (length("organisation_pou_specification_version"."content_hash") = 64 and length("organisation_pou_specification_version"."source_document_hash") = 64),
	CONSTRAINT "organisation_pou_specification_approval_fields" CHECK (("organisation_pou_specification_version"."approval_status" = 'draft_derived' and "organisation_pou_specification_version"."approved_for_pilot_by" is null and "organisation_pou_specification_version"."approved_for_pilot_at" is null) or ("organisation_pou_specification_version"."approval_status" = 'approved_for_pilot' and "organisation_pou_specification_version"."approved_for_pilot_by" is not null and "organisation_pou_specification_version"."approved_for_pilot_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "pou_review_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"specification_id" uuid NOT NULL,
	"projection_code" text NOT NULL,
	"projection_version" text NOT NULL,
	"projection_hash" text NOT NULL,
	"projection" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pou_review_projection_whakapapa_only" CHECK ("pou_review_projection"."pou_id" = 'whakapapa'),
	CONSTRAINT "pou_review_projection_hash_format" CHECK (length("pou_review_projection"."projection_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "workflow_conversation_pou_specification_pin" (
	"workflow_conversation_id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"specification_id" uuid NOT NULL,
	"specification_hash" text NOT NULL,
	"conversation_guidance_projection_id" uuid NOT NULL,
	"conversation_guidance_projection_hash" text NOT NULL,
	"pou_review_projection_id" uuid NOT NULL,
	"pou_review_projection_hash" text NOT NULL,
	"specification_snapshot" jsonb NOT NULL,
	"conversation_guidance_projection_snapshot" jsonb NOT NULL,
	"pou_review_projection_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_pou_specification_pin_whakapapa_only" CHECK ("workflow_conversation_pou_specification_pin"."pou_id" = 'whakapapa'),
	CONSTRAINT "conversation_pou_specification_pin_hash_format" CHECK (length("workflow_conversation_pou_specification_pin"."specification_hash") = 64 and length("workflow_conversation_pou_specification_pin"."conversation_guidance_projection_hash") = 64 and length("workflow_conversation_pou_specification_pin"."pou_review_projection_hash") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_pou_specification_id_organisation_pou_uq" ON "organisation_pou_specification_version" USING btree ("id","organisation_id","pou_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_guidance_projection_id_organisation_pou_uq" ON "conversation_guidance_projection" USING btree ("id","organisation_id","pou_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pou_review_projection_id_organisation_pou_uq" ON "pou_review_projection" USING btree ("id","organisation_id","pou_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_pou_safety_link_id_organisation_pou_uq" ON "organisation_pou_safety_specification_link" USING btree ("id","organisation_id","pou_id");
--> statement-breakpoint
ALTER TABLE "conversation_guidance_projection" ADD CONSTRAINT "conversation_guidance_projection_specification_scope_fk" FOREIGN KEY ("specification_id","organisation_id","pou_id") REFERENCES "public"."organisation_pou_specification_version"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_review_draft_criterion_assessment" ADD CONSTRAINT "review_draft_criterion_revision_fk" FOREIGN KEY ("review_draft_revision_id") REFERENCES "public"."conversation_review_draft_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_safety_specification_link" ADD CONSTRAINT "organisation_pou_safety_link_pou_specification_scope_fk" FOREIGN KEY ("organisation_pou_specification_id","organisation_id","pou_id") REFERENCES "public"."organisation_pou_specification_version"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_safety_specification_link" ADD CONSTRAINT "organisation_pou_safety_link_safety_specification_scope_fk" FOREIGN KEY ("safety_specification_id","organisation_id","pou_id") REFERENCES "public"."safety_specification_version"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_safety_specification_link" ADD CONSTRAINT "organisation_pou_safety_link_safety_projection_scope_fk" FOREIGN KEY ("safety_projection_id","organisation_id","pou_id") REFERENCES "public"."provider_assessment_projection"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_specification_activation" ADD CONSTRAINT "organisation_pou_specification_activation_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_specification_activation" ADD CONSTRAINT "organisation_pou_specification_activation_specification_scope_fk" FOREIGN KEY ("specification_id","organisation_id","pou_id") REFERENCES "public"."organisation_pou_specification_version"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_specification_activation" ADD CONSTRAINT "organisation_pou_specification_activation_guidance_scope_fk" FOREIGN KEY ("conversation_guidance_projection_id","organisation_id","pou_id") REFERENCES "public"."conversation_guidance_projection"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_specification_activation" ADD CONSTRAINT "organisation_pou_specification_activation_review_scope_fk" FOREIGN KEY ("pou_review_projection_id","organisation_id","pou_id") REFERENCES "public"."pou_review_projection"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_specification_activation" ADD CONSTRAINT "organisation_pou_specification_activation_safety_link_scope_fk" FOREIGN KEY ("safety_link_id","organisation_id","pou_id") REFERENCES "public"."organisation_pou_safety_specification_link"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_specification_activation" ADD CONSTRAINT "organisation_pou_specification_activation_actor_organisation_fk" FOREIGN KEY ("activated_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_specification_version" ADD CONSTRAINT "organisation_pou_specification_version_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_specification_version" ADD CONSTRAINT "organisation_pou_specification_approval_actor_organisation_fk" FOREIGN KEY ("approved_for_pilot_by","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pou_review_projection" ADD CONSTRAINT "pou_review_projection_specification_scope_fk" FOREIGN KEY ("specification_id","organisation_id","pou_id") REFERENCES "public"."organisation_pou_specification_version"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_conversation_pou_specification_pin" ADD CONSTRAINT "conversation_pou_specification_pin_conversation_scope_fk" FOREIGN KEY ("workflow_conversation_id","organisation_id","workflow_session_id","pou_id") REFERENCES "public"."workflow_conversation"("id","organisation_id","workflow_session_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_conversation_pou_specification_pin" ADD CONSTRAINT "conversation_pou_specification_pin_specification_scope_fk" FOREIGN KEY ("specification_id","organisation_id","pou_id") REFERENCES "public"."organisation_pou_specification_version"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_conversation_pou_specification_pin" ADD CONSTRAINT "conversation_pou_specification_pin_guidance_scope_fk" FOREIGN KEY ("conversation_guidance_projection_id","organisation_id","pou_id") REFERENCES "public"."conversation_guidance_projection"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_conversation_pou_specification_pin" ADD CONSTRAINT "conversation_pou_specification_pin_review_scope_fk" FOREIGN KEY ("pou_review_projection_id","organisation_id","pou_id") REFERENCES "public"."pou_review_projection"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_guidance_projection_organisation_code_version_uq" ON "conversation_guidance_projection" USING btree ("organisation_id","projection_code","projection_version");--> statement-breakpoint
CREATE UNIQUE INDEX "review_draft_criterion_revision_code_uq" ON "conversation_review_draft_criterion_assessment" USING btree ("review_draft_revision_id","criterion_code");--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_pou_safety_link_specification_uq" ON "organisation_pou_safety_specification_link" USING btree ("organisation_pou_specification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_pou_safety_link_safety_specification_uq" ON "organisation_pou_safety_specification_link" USING btree ("safety_specification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_pou_specification_one_active_uq" ON "organisation_pou_specification_activation" USING btree ("organisation_id","pou_id") WHERE "organisation_pou_specification_activation"."deactivated_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_pou_specification_organisation_code_version_uq" ON "organisation_pou_specification_version" USING btree ("organisation_id","specification_code","specification_version");--> statement-breakpoint
CREATE UNIQUE INDEX "pou_review_projection_organisation_code_version_uq" ON "pou_review_projection" USING btree ("organisation_id","projection_code","projection_version");--> statement-breakpoint
--> statement-breakpoint
CREATE FUNCTION "organisation_pou_specification_provenance_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'organisation Pou specification provenance is immutable' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "organisation_pou_specification_version_immutable" BEFORE UPDATE OR DELETE ON "organisation_pou_specification_version" FOR EACH ROW EXECUTE FUNCTION "organisation_pou_specification_provenance_immutable"();
--> statement-breakpoint
CREATE TRIGGER "conversation_guidance_projection_immutable" BEFORE UPDATE OR DELETE ON "conversation_guidance_projection" FOR EACH ROW EXECUTE FUNCTION "organisation_pou_specification_provenance_immutable"();
--> statement-breakpoint
CREATE TRIGGER "pou_review_projection_immutable" BEFORE UPDATE OR DELETE ON "pou_review_projection" FOR EACH ROW EXECUTE FUNCTION "organisation_pou_specification_provenance_immutable"();
--> statement-breakpoint
CREATE TRIGGER "organisation_pou_safety_specification_link_immutable" BEFORE UPDATE OR DELETE ON "organisation_pou_safety_specification_link" FOR EACH ROW EXECUTE FUNCTION "organisation_pou_specification_provenance_immutable"();
--> statement-breakpoint
CREATE TRIGGER "workflow_conversation_pou_specification_pin_immutable" BEFORE UPDATE OR DELETE ON "workflow_conversation_pou_specification_pin" FOR EACH ROW EXECUTE FUNCTION "organisation_pou_specification_provenance_immutable"();
--> statement-breakpoint
CREATE TRIGGER "conversation_review_draft_criterion_assessment_immutable" BEFORE UPDATE OR DELETE ON "conversation_review_draft_criterion_assessment" FOR EACH ROW EXECUTE FUNCTION "organisation_pou_specification_provenance_immutable"();
