CREATE TABLE "organisation_pou_safety_policy_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"base_safety_specification_id" uuid NOT NULL,
	"draft_version" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"policy" jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"activated_by_user_id" uuid,
	"activated_at" timestamp with time zone,
	CONSTRAINT "organisation_pou_safety_policy_draft_positive_revision" CHECK ("organisation_pou_safety_policy_draft"."revision" > 0),
	CONSTRAINT "organisation_pou_safety_policy_draft_version" CHECK ("organisation_pou_safety_policy_draft"."draft_version" ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$'),
	CONSTRAINT "organisation_pou_safety_policy_draft_approval_lifecycle" CHECK (("organisation_pou_safety_policy_draft"."approved_by_user_id" is null and "organisation_pou_safety_policy_draft"."approved_at" is null and "organisation_pou_safety_policy_draft"."activated_by_user_id" is null and "organisation_pou_safety_policy_draft"."activated_at" is null) or ("organisation_pou_safety_policy_draft"."approved_by_user_id" is not null and "organisation_pou_safety_policy_draft"."approved_at" is not null and (("organisation_pou_safety_policy_draft"."activated_by_user_id" is null and "organisation_pou_safety_policy_draft"."activated_at" is null) or ("organisation_pou_safety_policy_draft"."activated_by_user_id" is not null and "organisation_pou_safety_policy_draft"."activated_at" is not null))))
);
--> statement-breakpoint
DROP INDEX "organisation_pou_safety_link_specification_uq";--> statement-breakpoint
ALTER TABLE "organisation_pou_safety_policy_draft" ADD CONSTRAINT "organisation_pou_safety_policy_draft_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_safety_policy_draft" ADD CONSTRAINT "organisation_pou_safety_policy_draft_base_scope_fk" FOREIGN KEY ("base_safety_specification_id","organisation_id","pou_id") REFERENCES "public"."safety_specification_version"("id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_safety_policy_draft" ADD CONSTRAINT "organisation_pou_safety_policy_draft_created_by_scope_fk" FOREIGN KEY ("created_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_safety_policy_draft" ADD CONSTRAINT "organisation_pou_safety_policy_draft_updated_by_scope_fk" FOREIGN KEY ("updated_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_safety_policy_draft" ADD CONSTRAINT "organisation_pou_safety_policy_draft_approved_by_scope_fk" FOREIGN KEY ("approved_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_pou_safety_policy_draft" ADD CONSTRAINT "organisation_pou_safety_policy_draft_activated_by_scope_fk" FOREIGN KEY ("activated_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_pou_safety_policy_draft_one_open_uq" ON "organisation_pou_safety_policy_draft" USING btree ("organisation_id","pou_id") WHERE "organisation_pou_safety_policy_draft"."activated_at" is null;