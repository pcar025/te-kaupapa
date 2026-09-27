DROP TRIGGER "workflow_action_source_candidate_accepted" ON "workflow_action";--> statement-breakpoint
DROP FUNCTION "workflow_action_source_candidate_must_be_accepted"();--> statement-breakpoint
CREATE FUNCTION "workflow_action_source_candidate_must_be_accepted"() RETURNS trigger AS $$
DECLARE
  linked_candidate_id uuid;
  candidate_disposition "workflow_action_candidate_disposition";
BEGIN
  linked_candidate_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."source_candidate_id" ELSE NEW."source_candidate_id" END;
  IF linked_candidate_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'accepted candidate requires its canonical action' USING ERRCODE = 'P0001';
  END IF;
  SELECT "disposition" INTO candidate_disposition FROM "workflow_action_candidate" WHERE "id" = linked_candidate_id;
  IF candidate_disposition IS DISTINCT FROM 'accepted_as_action' THEN
    RAISE EXCEPTION 'candidate-derived action requires an accepted candidate' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "workflow_action_source_candidate_accepted"
AFTER INSERT OR UPDATE OR DELETE ON "workflow_action"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "workflow_action_source_candidate_must_be_accepted"();
