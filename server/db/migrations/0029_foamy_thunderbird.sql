ALTER TABLE "workflow_action" ADD COLUMN "source_candidate_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_action" ADD CONSTRAINT "workflow_action_source_candidate_id_workflow_action_candidate_id_fk" FOREIGN KEY ("source_candidate_id") REFERENCES "public"."workflow_action_candidate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_action_source_candidate_uq" ON "workflow_action" USING btree ("source_candidate_id");--> statement-breakpoint
CREATE FUNCTION "workflow_action_source_candidate_matches_scope"() RETURNS trigger AS $$
DECLARE
  candidate record;
BEGIN
  IF NEW."source_candidate_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO candidate FROM "workflow_action_candidate" WHERE "id" = NEW."source_candidate_id";
  IF candidate."workflow_session_id" IS DISTINCT FROM NEW."workflow_session_id"
    OR candidate."organisation_id" IS DISTINCT FROM NEW."organisation_id"
    OR candidate."pou_id" IS DISTINCT FROM NEW."pou_id" THEN
    RAISE EXCEPTION 'candidate-derived action must match its source workflow, organisation, and Pou';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."status" IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'candidate-derived action must begin open';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "workflow_action_source_candidate_scope"
BEFORE INSERT OR UPDATE ON "workflow_action"
FOR EACH ROW EXECUTE FUNCTION "workflow_action_source_candidate_matches_scope"();--> statement-breakpoint
CREATE FUNCTION "workflow_action_source_candidate_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW."source_candidate_id" IS DISTINCT FROM OLD."source_candidate_id" THEN
    RAISE EXCEPTION 'canonical action candidate provenance is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "workflow_action_source_candidate_immutable"
BEFORE UPDATE ON "workflow_action"
FOR EACH ROW EXECUTE FUNCTION "workflow_action_source_candidate_immutable"();
