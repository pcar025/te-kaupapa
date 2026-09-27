CREATE TABLE "workflow_criterion_source_evidence_access_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	"organisation_id" uuid NOT NULL,
	"target_kaimahi_user_id" uuid NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"workflow_pou_review_id" uuid NOT NULL,
	"criterion_snapshot_id" uuid NOT NULL,
	"criterion_code" text NOT NULL,
	"workflow_conversation_id" uuid NOT NULL,
	"referenced_turn_ids" jsonb NOT NULL,
	"referenced_turn_count" integer NOT NULL,
	"request_id" text NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "criterion_source_evidence_audit_event_type" CHECK ("workflow_criterion_source_evidence_access_audit"."event_type" = 'criterion_source_evidence_viewed'),
	CONSTRAINT "criterion_source_evidence_audit_actor_role" CHECK ("workflow_criterion_source_evidence_access_audit"."actor_role" in ('KAIMAHI', 'SUPERVISOR')),
	CONSTRAINT "criterion_source_evidence_audit_outcome" CHECK ("workflow_criterion_source_evidence_access_audit"."outcome" = 'success'),
	CONSTRAINT "criterion_source_evidence_audit_criterion_code" CHECK (length("workflow_criterion_source_evidence_access_audit"."criterion_code") between 2 and 120),
	CONSTRAINT "criterion_source_evidence_audit_turns" CHECK ("workflow_criterion_source_evidence_access_audit"."referenced_turn_count" between 1 and 200 and jsonb_typeof("workflow_criterion_source_evidence_access_audit"."referenced_turn_ids") = 'array' and jsonb_array_length("workflow_criterion_source_evidence_access_audit"."referenced_turn_ids") = "workflow_criterion_source_evidence_access_audit"."referenced_turn_count"),
	CONSTRAINT "criterion_source_evidence_audit_request_id" CHECK (length("workflow_criterion_source_evidence_access_audit"."request_id") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "workflow_criterion_source_evidence_access_audit" ADD CONSTRAINT "criterion_source_evidence_audit_actor_scope_fk" FOREIGN KEY ("actor_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_criterion_source_evidence_access_audit" ADD CONSTRAINT "criterion_source_evidence_audit_kaimahi_scope_fk" FOREIGN KEY ("target_kaimahi_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_criterion_source_evidence_access_audit" ADD CONSTRAINT "criterion_source_evidence_audit_workflow_scope_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_criterion_source_evidence_access_audit" ADD CONSTRAINT "criterion_source_evidence_audit_checkpoint_scope_fk" FOREIGN KEY ("workflow_session_id","organisation_id","pou_id") REFERENCES "public"."workflow_pou_checkpoint"("workflow_session_id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_criterion_source_evidence_access_audit" ADD CONSTRAINT "criterion_source_evidence_audit_review_fk" FOREIGN KEY ("workflow_pou_review_id") REFERENCES "public"."workflow_pou_review"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_criterion_source_evidence_access_audit" ADD CONSTRAINT "criterion_source_evidence_audit_snapshot_fk" FOREIGN KEY ("criterion_snapshot_id") REFERENCES "public"."workflow_pou_review_criterion_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_criterion_source_evidence_access_audit" ADD CONSTRAINT "criterion_source_evidence_audit_conversation_scope_fk" FOREIGN KEY ("workflow_conversation_id","organisation_id","workflow_session_id","pou_id") REFERENCES "public"."workflow_conversation"("id","organisation_id","workflow_session_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "criterion_source_evidence_audit_workflow_created_idx" ON "workflow_criterion_source_evidence_access_audit" USING btree ("workflow_session_id","created_at");--> statement-breakpoint
CREATE INDEX "criterion_source_evidence_audit_actor_created_idx" ON "workflow_criterion_source_evidence_access_audit" USING btree ("actor_user_id","created_at");