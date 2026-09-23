CREATE TYPE "public"."phq9_supervisor_escalation_status" AS ENUM('recipient_unresolved', 'queued', 'sending', 'provider_accepted', 'failed', 'retry_pending');--> statement-breakpoint
CREATE TABLE "workflow_phq9_supervisor_escalation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" DEFAULT 'kaitiakitanga' NOT NULL,
	"phq9_confirmation_interaction_id" uuid NOT NULL,
	"rule_code" text NOT NULL,
	"rule_version" integer NOT NULL,
	"kaimahi_user_id" uuid NOT NULL,
	"supervisor_user_id" uuid,
	"delivery_channel" text DEFAULT 'email' NOT NULL,
	"recipient_email" text,
	"status" "phq9_supervisor_escalation_status" NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"provider_message_id" text,
	"provider_accepted_at" timestamp with time zone,
	"failure_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_phq9_escalation_pou" CHECK ("workflow_phq9_supervisor_escalation"."pou_id" = 'kaitiakitanga'),
	CONSTRAINT "workflow_phq9_escalation_channel" CHECK ("workflow_phq9_supervisor_escalation"."delivery_channel" = 'email'),
	CONSTRAINT "workflow_phq9_escalation_recipient" CHECK (("workflow_phq9_supervisor_escalation"."status" = 'recipient_unresolved' and "workflow_phq9_supervisor_escalation"."supervisor_user_id" is null and "workflow_phq9_supervisor_escalation"."recipient_email" is null) or ("workflow_phq9_supervisor_escalation"."status" <> 'recipient_unresolved' and "workflow_phq9_supervisor_escalation"."supervisor_user_id" is not null and "workflow_phq9_supervisor_escalation"."recipient_email" is not null)),
	CONSTRAINT "workflow_phq9_escalation_attempt_count" CHECK ("workflow_phq9_supervisor_escalation"."attempt_count" >= 0 and "workflow_phq9_supervisor_escalation"."attempt_count" <= 3),
	CONSTRAINT "workflow_phq9_escalation_provider_acceptance" CHECK (("workflow_phq9_supervisor_escalation"."status" = 'provider_accepted' and "workflow_phq9_supervisor_escalation"."provider_message_id" is not null and "workflow_phq9_supervisor_escalation"."provider_accepted_at" is not null) or ("workflow_phq9_supervisor_escalation"."status" <> 'provider_accepted' and "workflow_phq9_supervisor_escalation"."provider_message_id" is null and "workflow_phq9_supervisor_escalation"."provider_accepted_at" is null)),
	CONSTRAINT "workflow_phq9_escalation_failure_category" CHECK ("workflow_phq9_supervisor_escalation"."failure_category" is null or "workflow_phq9_supervisor_escalation"."failure_category" in ('configuration', 'permanent', 'ambiguous', 'transient')),
	CONSTRAINT "workflow_phq9_escalation_failure_state" CHECK (("workflow_phq9_supervisor_escalation"."status" in ('failed', 'retry_pending') and "workflow_phq9_supervisor_escalation"."failure_category" is not null) or ("workflow_phq9_supervisor_escalation"."status" not in ('failed', 'retry_pending') and "workflow_phq9_supervisor_escalation"."failure_category" is null))
);
--> statement-breakpoint
ALTER TABLE "workflow_phq9_supervisor_escalation" ADD CONSTRAINT "workflow_phq9_escalation_session_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_phq9_supervisor_escalation" ADD CONSTRAINT "workflow_phq9_escalation_checkpoint_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id","pou_id") REFERENCES "public"."workflow_pou_checkpoint"("workflow_session_id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_phq9_supervisor_escalation" ADD CONSTRAINT "workflow_phq9_escalation_confirmation_interaction_fk" FOREIGN KEY ("phq9_confirmation_interaction_id","organisation_id","workflow_session_id") REFERENCES "public"."workflow_interaction"("id","organisation_id","workflow_session_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_phq9_supervisor_escalation" ADD CONSTRAINT "workflow_phq9_escalation_kaimahi_organisation_fk" FOREIGN KEY ("kaimahi_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_phq9_supervisor_escalation" ADD CONSTRAINT "workflow_phq9_escalation_supervisor_organisation_fk" FOREIGN KEY ("supervisor_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_phq9_supervisor_escalation_workflow_uq" ON "workflow_phq9_supervisor_escalation" USING btree ("workflow_session_id");--> statement-breakpoint
CREATE INDEX "workflow_phq9_supervisor_escalation_delivery_idx" ON "workflow_phq9_supervisor_escalation" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "workflow_phq9_supervisor_escalation_supervisor_idx" ON "workflow_phq9_supervisor_escalation" USING btree ("supervisor_user_id","created_at");
--> statement-breakpoint
CREATE FUNCTION "enforce_workflow_phq9_supervisor_escalation_provenance"() RETURNS trigger AS $$
begin
  if not exists (
    select 1
    from "workflow_kaitiakitanga_phq9_confirmation" confirmation
    where confirmation."workflow_session_id" = new."workflow_session_id"
      and confirmation."organisation_id" = new."organisation_id"
      and confirmation."pou_id" = 'kaitiakitanga'
      and confirmation."interaction_id" = new."phq9_confirmation_interaction_id"
      and confirmation."confirmed_by_user_id" = new."kaimahi_user_id"
      and confirmation."supervisor_escalation_required" = true
      and confirmation."escalation_rule_code" = new."rule_code"
      and confirmation."escalation_rule_version" = new."rule_version"
  ) then
    raise exception 'PHQ-9 supervisor escalation provenance is invalid';
  end if;
  return new;
end;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "workflow_phq9_supervisor_escalation_provenance"
BEFORE INSERT OR UPDATE ON "workflow_phq9_supervisor_escalation"
FOR EACH ROW EXECUTE FUNCTION "enforce_workflow_phq9_supervisor_escalation_provenance"();
