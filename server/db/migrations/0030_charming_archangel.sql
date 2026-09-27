CREATE UNIQUE INDEX "carry_forward_review_criterion_source_uq" ON "workflow_carry_forward" USING btree ("workflow_session_id","review_draft_revision_id","criterion_code") WHERE "workflow_carry_forward"."source" = 'review_criterion';--> statement-breakpoint
CREATE UNIQUE INDEX "carry_forward_areas_source_uq" ON "workflow_carry_forward" USING btree ("workflow_session_id","review_draft_revision_id") WHERE "workflow_carry_forward"."source" = 'areas_for_attention';--> statement-breakpoint
CREATE UNIQUE INDEX "carry_forward_safety_source_uq" ON "workflow_carry_forward" USING btree ("workflow_session_id","safety_observation_id") WHERE "workflow_carry_forward"."source" = 'safety_observation';--> statement-breakpoint
CREATE FUNCTION "workflow_action_source_candidate_must_be_accepted"() RETURNS trigger AS $$
DECLARE
  candidate_disposition "workflow_action_candidate_disposition";
BEGIN
  IF NEW."source_candidate_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "disposition" INTO candidate_disposition FROM "workflow_action_candidate" WHERE "id" = NEW."source_candidate_id";
  IF candidate_disposition IS DISTINCT FROM 'accepted_as_action' THEN
    RAISE EXCEPTION 'candidate-derived action requires an accepted candidate' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "workflow_action_source_candidate_accepted"
AFTER INSERT OR UPDATE ON "workflow_action"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "workflow_action_source_candidate_must_be_accepted"();--> statement-breakpoint
CREATE FUNCTION "workflow_action_candidate_acceptance_requires_action"() RETURNS trigger AS $$
BEGIN
  IF NEW."disposition" = 'accepted_as_action' THEN
    IF NOT EXISTS (SELECT 1 FROM "workflow_action" WHERE "source_candidate_id" = NEW."id") THEN
      RAISE EXCEPTION 'accepted candidate requires its canonical action' USING ERRCODE = 'P0001';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM "workflow_action" WHERE "source_candidate_id" = NEW."id") THEN
    RAISE EXCEPTION 'candidate linked to a canonical action must remain accepted' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "workflow_action_candidate_acceptance_action"
AFTER INSERT OR UPDATE OF "disposition" ON "workflow_action_candidate"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "workflow_action_candidate_acceptance_requires_action"();
