CREATE TYPE "public"."workflow_action_candidate_disposition" AS ENUM('pending', 'accepted_as_action', 'rejected', 'routed_to_referral');--> statement-breakpoint
CREATE TYPE "public"."workflow_action_candidate_origin" AS ENUM('kaimahi_carry_forward', 'ai_suggestion', 'deterministic_required');--> statement-breakpoint
CREATE TABLE "workflow_action_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"workflow_pou_review_id" uuid NOT NULL,
	"review_draft_revision_id" uuid NOT NULL,
	"criterion_snapshot_id" uuid,
	"source_carry_forward_id" uuid,
	"source_safety_observation_id" uuid,
	"origin_kind" "workflow_action_candidate_origin" NOT NULL,
	"proposed_description" text NOT NULL,
	"disposition" "workflow_action_candidate_disposition" DEFAULT 'pending' NOT NULL,
	"dispositioned_at" timestamp with time zone,
	"dispositioned_by_user_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_candidate_description_length" CHECK (length("workflow_action_candidate"."proposed_description") between 1 and 1000),
	CONSTRAINT "action_candidate_disposition_audit" CHECK (("workflow_action_candidate"."disposition" = 'pending' and "workflow_action_candidate"."dispositioned_at" is null and "workflow_action_candidate"."dispositioned_by_user_id" is null) or ("workflow_action_candidate"."disposition" <> 'pending' and "workflow_action_candidate"."dispositioned_at" is not null and "workflow_action_candidate"."dispositioned_by_user_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "workflow_action_candidate" ADD CONSTRAINT "action_candidate_checkpoint_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id","pou_id") REFERENCES "public"."workflow_pou_checkpoint"("workflow_session_id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action_candidate" ADD CONSTRAINT "action_candidate_confirmed_review_fk" FOREIGN KEY ("workflow_pou_review_id") REFERENCES "public"."workflow_pou_review"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action_candidate" ADD CONSTRAINT "action_candidate_review_revision_fk" FOREIGN KEY ("review_draft_revision_id") REFERENCES "public"."conversation_review_draft_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action_candidate" ADD CONSTRAINT "action_candidate_criterion_snapshot_fk" FOREIGN KEY ("criterion_snapshot_id") REFERENCES "public"."workflow_pou_review_criterion_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action_candidate" ADD CONSTRAINT "action_candidate_source_carry_forward_fk" FOREIGN KEY ("source_carry_forward_id") REFERENCES "public"."workflow_carry_forward"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action_candidate" ADD CONSTRAINT "action_candidate_source_safety_observation_fk" FOREIGN KEY ("source_safety_observation_id") REFERENCES "public"."workflow_safety_observation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action_candidate" ADD CONSTRAINT "action_candidate_created_by_organisation_fk" FOREIGN KEY ("created_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action_candidate" ADD CONSTRAINT "action_candidate_dispositioned_by_organisation_fk" FOREIGN KEY ("dispositioned_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_candidate_source_carry_forward_uq" ON "workflow_action_candidate" USING btree ("source_carry_forward_id");--> statement-breakpoint
CREATE INDEX "action_candidate_workflow_pending_idx" ON "workflow_action_candidate" USING btree ("workflow_session_id","disposition","created_at");--> statement-breakpoint
CREATE FUNCTION "workflow_action_candidate_matches_provenance"() RETURNS trigger AS $$
DECLARE
  canonical_review record;
  selection record;
  snapshot record;
  safety_observation record;
BEGIN
  SELECT * INTO canonical_review FROM "workflow_pou_review" WHERE "id" = NEW."workflow_pou_review_id";
  IF canonical_review."workflow_session_id" IS DISTINCT FROM NEW."workflow_session_id"
    OR canonical_review."organisation_id" IS DISTINCT FROM NEW."organisation_id"
    OR canonical_review."pou_id" IS DISTINCT FROM NEW."pou_id"
    OR canonical_review."review_draft_revision_id" IS DISTINCT FROM NEW."review_draft_revision_id"
    OR canonical_review."criterion_snapshots_version" IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'action candidate must be pinned to its exact confirmed Pou review';
  END IF;

  IF NEW."origin_kind" = 'kaimahi_carry_forward' THEN
    IF NEW."source_carry_forward_id" IS NULL THEN
      RAISE EXCEPTION 'Kaimahi carry-forward candidate requires its selected source';
    END IF;
    SELECT * INTO selection FROM "workflow_carry_forward" WHERE "id" = NEW."source_carry_forward_id";
    IF selection."workflow_session_id" IS DISTINCT FROM NEW."workflow_session_id"
      OR selection."organisation_id" IS DISTINCT FROM NEW."organisation_id"
      OR selection."pou_id" IS DISTINCT FROM NEW."pou_id"
      OR (selection."source" IN ('review_criterion', 'areas_for_attention') AND selection."review_draft_revision_id" IS DISTINCT FROM NEW."review_draft_revision_id") THEN
      RAISE EXCEPTION 'action candidate carry-forward source provenance is invalid';
    END IF;
    IF selection."source" = 'review_criterion' THEN
      SELECT * INTO snapshot FROM "workflow_pou_review_criterion_snapshot" WHERE "id" = NEW."criterion_snapshot_id";
      IF snapshot."workflow_pou_review_id" IS DISTINCT FROM NEW."workflow_pou_review_id"
        OR snapshot."criterion_code" IS DISTINCT FROM selection."criterion_code" THEN
        RAISE EXCEPTION 'criterion-linked action candidate requires its exact confirmed snapshot';
      END IF;
    ELSIF NEW."criterion_snapshot_id" IS NOT NULL THEN
      RAISE EXCEPTION 'only criterion carry-forward candidates may link a criterion snapshot';
    END IF;
    IF selection."source" = 'safety_observation' THEN
      IF NEW."source_safety_observation_id" IS DISTINCT FROM selection."safety_observation_id" THEN
        RAISE EXCEPTION 'safety-linked action candidate provenance is invalid';
      END IF;
      SELECT * INTO safety_observation FROM "workflow_safety_observation" WHERE "id" = NEW."source_safety_observation_id";
      IF safety_observation."workflow_session_id" IS DISTINCT FROM NEW."workflow_session_id"
        OR safety_observation."organisation_id" IS DISTINCT FROM NEW."organisation_id"
        OR safety_observation."pou_id" IS DISTINCT FROM NEW."pou_id"
        OR safety_observation."status" IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'safety-linked action candidate requires an active formal safety observation';
      END IF;
    ELSIF NEW."source_safety_observation_id" IS NOT NULL THEN
      RAISE EXCEPTION 'only a selected safety observation may link a safety source';
    END IF;
  ELSIF NEW."source_carry_forward_id" IS NOT NULL OR NEW."source_safety_observation_id" IS NOT NULL THEN
    RAISE EXCEPTION 'non-Kaimahi action candidates cannot claim a Kaimahi carry-forward source';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "workflow_action_candidate_source_provenance"
BEFORE INSERT OR UPDATE ON "workflow_action_candidate"
FOR EACH ROW EXECUTE FUNCTION "workflow_action_candidate_matches_provenance"();--> statement-breakpoint
CREATE FUNCTION "workflow_action_candidate_origin_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW."workflow_session_id" IS DISTINCT FROM OLD."workflow_session_id"
    OR NEW."organisation_id" IS DISTINCT FROM OLD."organisation_id"
    OR NEW."pou_id" IS DISTINCT FROM OLD."pou_id"
    OR NEW."workflow_pou_review_id" IS DISTINCT FROM OLD."workflow_pou_review_id"
    OR NEW."review_draft_revision_id" IS DISTINCT FROM OLD."review_draft_revision_id"
    OR NEW."criterion_snapshot_id" IS DISTINCT FROM OLD."criterion_snapshot_id"
    OR NEW."source_carry_forward_id" IS DISTINCT FROM OLD."source_carry_forward_id"
    OR NEW."source_safety_observation_id" IS DISTINCT FROM OLD."source_safety_observation_id"
    OR NEW."origin_kind" IS DISTINCT FROM OLD."origin_kind"
    OR NEW."proposed_description" IS DISTINCT FROM OLD."proposed_description"
    OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'action candidate origin is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "workflow_action_candidate_origin_immutable"
BEFORE UPDATE ON "workflow_action_candidate"
FOR EACH ROW EXECUTE FUNCTION "workflow_action_candidate_origin_immutable"();--> statement-breakpoint
CREATE FUNCTION "workflow_action_candidate_delete_prohibited"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'action candidates are retained with their disposition' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "workflow_action_candidate_delete_prohibited"
BEFORE DELETE ON "workflow_action_candidate"
FOR EACH ROW EXECUTE FUNCTION "workflow_action_candidate_delete_prohibited"();
