CREATE TYPE "public"."workflow_referral_candidate_decision_status" AS ENUM('accepted_as_referral', 'declined');--> statement-breakpoint
CREATE TABLE "workflow_referral_candidate_decision" (
	"source_candidate_id" uuid PRIMARY KEY NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"referral_id" uuid,
	"disposition" "workflow_referral_candidate_decision_status" NOT NULL,
	"decided_by_user_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_candidate_decision_shape" CHECK (("workflow_referral_candidate_decision"."disposition" = 'accepted_as_referral' and "workflow_referral_candidate_decision"."referral_id" is not null) or ("workflow_referral_candidate_decision"."disposition" = 'declined' and "workflow_referral_candidate_decision"."referral_id" is null))
);
--> statement-breakpoint
ALTER TABLE "workflow_referral" ADD COLUMN "source_candidate_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_referral_candidate_decision" ADD CONSTRAINT "workflow_referral_candidate_decision_source_candidate_id_workflow_action_candidate_id_fk" FOREIGN KEY ("source_candidate_id") REFERENCES "public"."workflow_action_candidate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_referral_candidate_decision" ADD CONSTRAINT "workflow_referral_candidate_decision_referral_id_workflow_referral_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."workflow_referral"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_referral_candidate_decision" ADD CONSTRAINT "referral_candidate_decision_session_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id") REFERENCES "public"."workflow_session"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_referral_candidate_decision" ADD CONSTRAINT "referral_candidate_decision_actor_organisation_fk" FOREIGN KEY ("decided_by_user_id","organisation_id") REFERENCES "public"."app_user"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_candidate_decision_referral_uq" ON "workflow_referral_candidate_decision" USING btree ("referral_id");--> statement-breakpoint
ALTER TABLE "workflow_referral" ADD CONSTRAINT "workflow_referral_source_candidate_id_workflow_action_candidate_id_fk" FOREIGN KEY ("source_candidate_id") REFERENCES "public"."workflow_action_candidate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_referral_source_candidate_uq" ON "workflow_referral" USING btree ("source_candidate_id");--> statement-breakpoint
CREATE FUNCTION "workflow_referral_source_candidate_matches_scope"() RETURNS trigger AS $$
DECLARE
  candidate_workflow_id uuid;
  candidate_organisation_id uuid;
  candidate_pou_id "workflow_pou_id";
  candidate_disposition "workflow_action_candidate_disposition";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."source_candidate_id" IS DISTINCT FROM OLD."source_candidate_id" THEN
    RAISE EXCEPTION 'canonical referral candidate provenance is immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."source_candidate_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "workflow_session_id", "organisation_id", "pou_id", "disposition"
    INTO candidate_workflow_id, candidate_organisation_id, candidate_pou_id, candidate_disposition
    FROM "workflow_action_candidate"
    WHERE "id" = NEW."source_candidate_id";
  IF candidate_workflow_id IS DISTINCT FROM NEW."workflow_session_id"
    OR candidate_organisation_id IS DISTINCT FROM NEW."organisation_id"
    OR candidate_pou_id IS DISTINCT FROM NEW."pou_id" THEN
    RAISE EXCEPTION 'candidate-derived referral must match its source workflow, organisation, and Pou' USING ERRCODE = 'P0001';
  END IF;
  IF candidate_disposition IS DISTINCT FROM 'routed_to_referral' THEN
    RAISE EXCEPTION 'candidate-derived referral requires a routed candidate' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "workflow_referral_source_candidate_scope"
BEFORE INSERT OR UPDATE ON "workflow_referral"
FOR EACH ROW EXECUTE FUNCTION "workflow_referral_source_candidate_matches_scope"();--> statement-breakpoint
CREATE FUNCTION "workflow_action_candidate_routing_requires_referral_consistency"() RETURNS trigger AS $$
BEGIN
  IF (EXISTS (SELECT 1 FROM "workflow_referral" WHERE "source_candidate_id" = NEW."id")
    OR EXISTS (SELECT 1 FROM "workflow_referral_candidate_decision" WHERE "source_candidate_id" = NEW."id"))
    AND NEW."disposition" IS DISTINCT FROM 'routed_to_referral' THEN
    RAISE EXCEPTION 'candidate with a referral outcome must remain routed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "workflow_action_candidate_referral_routing"
AFTER UPDATE OF "disposition" ON "workflow_action_candidate"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "workflow_action_candidate_routing_requires_referral_consistency"();--> statement-breakpoint
CREATE FUNCTION "workflow_referral_candidate_decision_matches_source"() RETURNS trigger AS $$
DECLARE
  candidate_workflow_id uuid;
  candidate_organisation_id uuid;
  candidate_disposition "workflow_action_candidate_disposition";
  referral_workflow_id uuid;
  referral_organisation_id uuid;
  referral_source_candidate_id uuid;
BEGIN
  SELECT "workflow_session_id", "organisation_id", "disposition"
    INTO candidate_workflow_id, candidate_organisation_id, candidate_disposition
    FROM "workflow_action_candidate"
    WHERE "id" = NEW."source_candidate_id";
  IF candidate_workflow_id IS DISTINCT FROM NEW."workflow_session_id"
    OR candidate_organisation_id IS DISTINCT FROM NEW."organisation_id"
    OR candidate_disposition IS DISTINCT FROM 'routed_to_referral' THEN
    RAISE EXCEPTION 'referral candidate decision must match a routed candidate in the same workflow and organisation' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."disposition" = 'accepted_as_referral' THEN
    SELECT "workflow_session_id", "organisation_id", "source_candidate_id"
      INTO referral_workflow_id, referral_organisation_id, referral_source_candidate_id
      FROM "workflow_referral"
      WHERE "id" = NEW."referral_id";
    IF referral_workflow_id IS DISTINCT FROM NEW."workflow_session_id"
      OR referral_organisation_id IS DISTINCT FROM NEW."organisation_id"
      OR referral_source_candidate_id IS DISTINCT FROM NEW."source_candidate_id" THEN
      RAISE EXCEPTION 'accepted referral decision must link its matching canonical referral' USING ERRCODE = 'P0001';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM "workflow_referral" WHERE "source_candidate_id" = NEW."source_candidate_id") THEN
    RAISE EXCEPTION 'declined referral decision cannot link a canonical referral' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "workflow_referral_candidate_decision_scope"
BEFORE INSERT OR UPDATE ON "workflow_referral_candidate_decision"
FOR EACH ROW EXECUTE FUNCTION "workflow_referral_candidate_decision_matches_source"();--> statement-breakpoint
CREATE FUNCTION "workflow_referral_source_candidate_requires_decision"() RETURNS trigger AS $$
BEGIN
  IF NEW."source_candidate_id" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "workflow_referral_candidate_decision"
    WHERE "source_candidate_id" = NEW."source_candidate_id"
      AND "referral_id" = NEW."id"
      AND "disposition" = 'accepted_as_referral'
  ) THEN
    RAISE EXCEPTION 'candidate-derived referral requires its accepted referral decision' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "workflow_referral_source_candidate_decision"
AFTER INSERT OR UPDATE ON "workflow_referral"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "workflow_referral_source_candidate_requires_decision"();--> statement-breakpoint
CREATE FUNCTION "workflow_referral_candidate_decision_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'referral candidate decision is immutable' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "workflow_referral_candidate_decision_immutable"
BEFORE UPDATE OR DELETE ON "workflow_referral_candidate_decision"
FOR EACH ROW EXECUTE FUNCTION "workflow_referral_candidate_decision_immutable"();
