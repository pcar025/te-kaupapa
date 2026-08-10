CREATE TYPE "public"."workflow_engagement_type" AS ENUM('home-visit', 'phone', 'office', 'hui', 'outreach');--> statement-breakpoint
CREATE TYPE "public"."workflow_immediate_concern" AS ENUM('none', 'unsure', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."workflow_interaction_type" AS ENUM('workflow_created', 'setup_confirmed', 'pou_review_confirmed');--> statement-breakpoint
CREATE TYPE "public"."workflow_pou_concern" AS ENUM('low', 'watch', 'action', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."workflow_pou_id" AS ENUM('whakapapa', 'manaakitanga', 'tikanga', 'kaitiakitanga', 'puukenga', 'haepapa', 'oranga');--> statement-breakpoint
CREATE TYPE "public"."workflow_pou_progress" AS ENUM('not_started', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."workflow_stage" AS ENUM('setup', 'pou-overview', 'pou-convo', 'pou-summary');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('draft', 'in_progress', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "workflow_interaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"type" "workflow_interaction_type" NOT NULL,
	"pou_id" "workflow_pou_id",
	"idempotency_key" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"expected_version" integer,
	"resulting_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_interaction_resulting_version_positive" CHECK ("workflow_interaction"."resulting_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "workflow_pou_checkpoint" (
	"workflow_session_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"ordinal" integer NOT NULL,
	"progress" "workflow_pou_progress" DEFAULT 'not_started' NOT NULL,
	"user_selected_concern" "workflow_pou_concern",
	"note" text,
	"referral_suggested" boolean DEFAULT false NOT NULL,
	"supervisor_review_suggested" boolean DEFAULT false NOT NULL,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_pou_checkpoint_pk" PRIMARY KEY("workflow_session_id","pou_id"),
	CONSTRAINT "workflow_pou_checkpoint_ordinal_range" CHECK ("workflow_pou_checkpoint"."ordinal" between 1 and 7)
);
--> statement-breakpoint
CREATE TABLE "workflow_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"kaimahi_user_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"whanau_reference" text,
	"engagement_type" "workflow_engagement_type",
	"session_focus" text,
	"additional_notes" text,
	"immediate_concern" "workflow_immediate_concern",
	"status" "workflow_status" DEFAULT 'draft' NOT NULL,
	"current_stage" "workflow_stage" DEFAULT 'setup' NOT NULL,
	"current_pou_id" "workflow_pou_id",
	"version" integer DEFAULT 1 NOT NULL,
	"setup_confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_session_version_positive" CHECK ("workflow_session"."version" > 0),
	CONSTRAINT "workflow_session_whanau_reference_length" CHECK ("workflow_session"."whanau_reference" is null or length("workflow_session"."whanau_reference") <= 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_session_id_organisation_uq" ON "workflow_session" USING btree ("id","organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_id_organisation_uq" ON "app_user" USING btree ("id","organisation_id");--> statement-breakpoint
ALTER TABLE "workflow_interaction" ADD CONSTRAINT "workflow_interaction_session_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_interaction" ADD CONSTRAINT "workflow_interaction_actor_organisation_fk" FOREIGN KEY ("actor_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_pou_checkpoint" ADD CONSTRAINT "workflow_pou_checkpoint_session_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_pou_checkpoint" ADD CONSTRAINT "workflow_pou_checkpoint_confirming_user_organisation_fk" FOREIGN KEY ("confirmed_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_session" ADD CONSTRAINT "workflow_session_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_session" ADD CONSTRAINT "workflow_session_kaimahi_organisation_fk" FOREIGN KEY ("kaimahi_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_interaction_actor_idempotency_uq" ON "workflow_interaction" USING btree ("actor_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "workflow_interaction_session_created_idx" ON "workflow_interaction" USING btree ("workflow_session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_pou_checkpoint_session_ordinal_uq" ON "workflow_pou_checkpoint" USING btree ("workflow_session_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_session_organisation_reference_uq" ON "workflow_session" USING btree ("organisation_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_session_one_resumable_per_kaimahi_uq" ON "workflow_session" USING btree ("kaimahi_user_id") WHERE "workflow_session"."status" in ('draft', 'in_progress');--> statement-breakpoint
CREATE INDEX "workflow_session_kaimahi_status_updated_idx" ON "workflow_session" USING btree ("kaimahi_user_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "workflow_session_organisation_whanau_updated_idx" ON "workflow_session" USING btree ("organisation_id","whanau_reference","updated_at");--> statement-breakpoint
