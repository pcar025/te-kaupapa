ALTER TYPE "public"."workflow_interaction_type" ADD VALUE 'kaitiakitanga_phq9_confirmed';--> statement-breakpoint
CREATE TABLE "workflow_kaitiakitanga_phq9_confirmation" (
	"workflow_session_id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" DEFAULT 'kaitiakitanga' NOT NULL,
	"phq9_indicated" boolean NOT NULL,
	"phq9_completed" boolean NOT NULL,
	"confirmed_total_score" integer,
	"supervisor_escalation_required" boolean NOT NULL,
	"escalation_rule_code" text NOT NULL,
	"escalation_rule_version" integer NOT NULL,
	"confirmed_by_user_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"interaction_id" uuid NOT NULL,
	CONSTRAINT "workflow_kaitiakitanga_phq9_pou" CHECK ("workflow_kaitiakitanga_phq9_confirmation"."pou_id" = 'kaitiakitanga'),
	CONSTRAINT "workflow_kaitiakitanga_phq9_shape" CHECK (("workflow_kaitiakitanga_phq9_confirmation"."phq9_indicated" = false and "workflow_kaitiakitanga_phq9_confirmation"."phq9_completed" = false and "workflow_kaitiakitanga_phq9_confirmation"."confirmed_total_score" is null) or ("workflow_kaitiakitanga_phq9_confirmation"."phq9_indicated" = true and "workflow_kaitiakitanga_phq9_confirmation"."phq9_completed" = false and "workflow_kaitiakitanga_phq9_confirmation"."confirmed_total_score" is null) or ("workflow_kaitiakitanga_phq9_confirmation"."phq9_indicated" = true and "workflow_kaitiakitanga_phq9_confirmation"."phq9_completed" = true and "workflow_kaitiakitanga_phq9_confirmation"."confirmed_total_score" between 0 and 27)),
	CONSTRAINT "workflow_kaitiakitanga_phq9_escalation_derivation" CHECK ("workflow_kaitiakitanga_phq9_confirmation"."supervisor_escalation_required" = case when "workflow_kaitiakitanga_phq9_confirmation"."phq9_completed" and "workflow_kaitiakitanga_phq9_confirmation"."confirmed_total_score" >= 12 then true else false end),
	CONSTRAINT "workflow_kaitiakitanga_phq9_rule_code_length" CHECK (length("workflow_kaitiakitanga_phq9_confirmation"."escalation_rule_code") between 1 and 200),
	CONSTRAINT "workflow_kaitiakitanga_phq9_rule_version_positive" CHECK ("workflow_kaitiakitanga_phq9_confirmation"."escalation_rule_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "workflow_kaitiakitanga_phq9_confirmation" ADD CONSTRAINT "workflow_kaitiakitanga_phq9_checkpoint_scope_fk" FOREIGN KEY ("workflow_session_id","organisation_id","pou_id") REFERENCES "public"."workflow_pou_checkpoint"("workflow_session_id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_kaitiakitanga_phq9_confirmation" ADD CONSTRAINT "workflow_kaitiakitanga_phq9_confirmed_by_scope_fk" FOREIGN KEY ("confirmed_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_kaitiakitanga_phq9_confirmation" ADD CONSTRAINT "workflow_kaitiakitanga_phq9_interaction_scope_fk" FOREIGN KEY ("interaction_id","organisation_id","workflow_session_id") REFERENCES "public"."workflow_interaction"("id","organisation_id","workflow_session_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_kaitiakitanga_phq9_interaction_uq" ON "workflow_kaitiakitanga_phq9_confirmation" USING btree ("interaction_id");
--> statement-breakpoint
CREATE FUNCTION "enforce_workflow_kaitiakitanga_phq9_interaction"() RETURNS trigger AS $$
begin
  if not exists (
    select 1 from "workflow_interaction"
    where "id" = new."interaction_id"
      and "workflow_session_id" = new."workflow_session_id"
      and "organisation_id" = new."organisation_id"
      and "actor_user_id" = new."confirmed_by_user_id"
      and "type" = 'kaitiakitanga_phq9_confirmed'
      and "pou_id" = 'kaitiakitanga'
  ) then
    raise exception 'PHQ-9 confirmation interaction provenance is invalid';
  end if;
  return new;
end;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "workflow_kaitiakitanga_phq9_interaction_provenance"
BEFORE INSERT OR UPDATE ON "workflow_kaitiakitanga_phq9_confirmation"
FOR EACH ROW EXECUTE FUNCTION "enforce_workflow_kaitiakitanga_phq9_interaction"();
