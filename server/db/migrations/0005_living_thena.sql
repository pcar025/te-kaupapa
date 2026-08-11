CREATE TYPE "public"."workflow_conversation_status" AS ENUM('preparing', 'authorized', 'active', 'ended', 'failed');--> statement-breakpoint
CREATE TABLE "workflow_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"started_by_user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_conversation_id" text,
	"provider_agent_reference" text NOT NULL,
	"provider_branch_reference" text,
	"provider_environment" text NOT NULL,
	"conversation_specification_code" text NOT NULL,
	"conversation_specification_version" integer NOT NULL,
	"status" "workflow_conversation_status" DEFAULT 'preparing' NOT NULL,
	"start_idempotency_key" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"authorized_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"termination_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_conversation_provider_length" CHECK (length("workflow_conversation"."provider") between 1 and 80),
	CONSTRAINT "workflow_conversation_provider_reference_length" CHECK ("workflow_conversation"."provider_conversation_id" is null or length("workflow_conversation"."provider_conversation_id") between 1 and 255),
	CONSTRAINT "workflow_conversation_agent_reference_length" CHECK (length("workflow_conversation"."provider_agent_reference") between 1 and 255),
	CONSTRAINT "workflow_conversation_branch_reference_length" CHECK ("workflow_conversation"."provider_branch_reference" is null or length("workflow_conversation"."provider_branch_reference") between 1 and 255),
	CONSTRAINT "workflow_conversation_environment_length" CHECK (length("workflow_conversation"."provider_environment") between 1 and 80),
	CONSTRAINT "workflow_conversation_specification_code_length" CHECK (length("workflow_conversation"."conversation_specification_code") between 1 and 120),
	CONSTRAINT "workflow_conversation_specification_version_positive" CHECK ("workflow_conversation"."conversation_specification_version" > 0),
	CONSTRAINT "workflow_conversation_termination_reason_length" CHECK ("workflow_conversation"."termination_reason" is null or length("workflow_conversation"."termination_reason") between 1 and 80),
	CONSTRAINT "workflow_conversation_connection_requires_authorization" CHECK ("workflow_conversation"."connected_at" is null or "workflow_conversation"."authorized_at" is not null),
	CONSTRAINT "workflow_conversation_terminal_timestamp" CHECK (("workflow_conversation"."ended_at" is null) = ("workflow_conversation"."status" in ('preparing', 'authorized', 'active'))),
	CONSTRAINT "workflow_conversation_lifecycle_consistency" CHECK (("workflow_conversation"."status" = 'preparing' and "workflow_conversation"."provider_conversation_id" is null and "workflow_conversation"."authorized_at" is null and "workflow_conversation"."connected_at" is null and "workflow_conversation"."ended_at" is null and "workflow_conversation"."termination_reason" is null) or ("workflow_conversation"."status" = 'authorized' and "workflow_conversation"."provider_conversation_id" is not null and "workflow_conversation"."authorized_at" is not null and "workflow_conversation"."connected_at" is null and "workflow_conversation"."ended_at" is null and "workflow_conversation"."termination_reason" is null) or ("workflow_conversation"."status" = 'active' and "workflow_conversation"."provider_conversation_id" is not null and "workflow_conversation"."authorized_at" is not null and "workflow_conversation"."connected_at" is not null and "workflow_conversation"."ended_at" is null and "workflow_conversation"."termination_reason" is null) or ("workflow_conversation"."status" = 'ended' and "workflow_conversation"."provider_conversation_id" is not null and "workflow_conversation"."authorized_at" is not null and "workflow_conversation"."ended_at" is not null and "workflow_conversation"."termination_reason" is not null) or ("workflow_conversation"."status" = 'failed' and "workflow_conversation"."ended_at" is not null and "workflow_conversation"."termination_reason" is not null and (("workflow_conversation"."provider_conversation_id" is null and "workflow_conversation"."authorized_at" is null and "workflow_conversation"."connected_at" is null) or ("workflow_conversation"."provider_conversation_id" is not null and "workflow_conversation"."authorized_at" is not null))))
);
--> statement-breakpoint
ALTER TABLE "workflow_conversation" ADD CONSTRAINT "workflow_conversation_session_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_conversation" ADD CONSTRAINT "workflow_conversation_checkpoint_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id","pou_id") REFERENCES "public"."workflow_pou_checkpoint"("workflow_session_id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_conversation" ADD CONSTRAINT "workflow_conversation_actor_organisation_fk" FOREIGN KEY ("started_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_conversation_provider_reference_uq" ON "workflow_conversation" USING btree ("provider","provider_conversation_id") WHERE "workflow_conversation"."provider_conversation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_conversation_actor_start_idempotency_uq" ON "workflow_conversation" USING btree ("started_by_user_id","start_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_conversation_one_open_per_pou_uq" ON "workflow_conversation" USING btree ("workflow_session_id","pou_id") WHERE "workflow_conversation"."status" in ('preparing', 'authorized', 'active');--> statement-breakpoint
CREATE INDEX "workflow_conversation_workflow_created_idx" ON "workflow_conversation" USING btree ("workflow_session_id","created_at");
