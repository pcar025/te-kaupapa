CREATE OR REPLACE FUNCTION public.assert_workflow_final_record_confirmed_synthesis_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.workflow_confirmed_synthesis confirmation
    WHERE confirmation.id = NEW.confirmed_synthesis_id
      AND confirmation.workflow_session_id = NEW.workflow_session_id
      AND confirmation.organisation_id = NEW.organisation_id
  ) THEN
    RAISE EXCEPTION 'final record confirmed synthesis does not belong to workflow' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workflow_final_record_confirmed_synthesis_lineage
BEFORE INSERT OR UPDATE OF confirmed_synthesis_id, workflow_session_id, organisation_id
ON public.workflow_final_record
FOR EACH ROW EXECUTE FUNCTION public.assert_workflow_final_record_confirmed_synthesis_lineage();
