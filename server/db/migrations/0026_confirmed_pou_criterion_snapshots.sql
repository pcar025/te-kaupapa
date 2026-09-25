CREATE TABLE "workflow_pou_review_criterion_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_pou_review_id" uuid NOT NULL,
	"source_criterion_assessment_id" uuid NOT NULL,
	"criterion_code" text NOT NULL,
	"availability_status" "pou_review_criterion_status" NOT NULL,
	"evidence_turn_ids" jsonb NOT NULL,
	"missing_information_codes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_pou_review_criterion_snapshot_code_length" CHECK (length("workflow_pou_review_criterion_snapshot"."criterion_code") between 2 and 120)
);
--> statement-breakpoint
ALTER TABLE "workflow_pou_review" ADD COLUMN "criterion_snapshots_version" integer;--> statement-breakpoint
ALTER TABLE "workflow_pou_review_criterion_snapshot" ADD CONSTRAINT "workflow_pou_review_criterion_snapshot_review_fk" FOREIGN KEY ("workflow_pou_review_id") REFERENCES "public"."workflow_pou_review"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_pou_review_criterion_snapshot" ADD CONSTRAINT "workflow_pou_review_criterion_snapshot_source_fk" FOREIGN KEY ("source_criterion_assessment_id") REFERENCES "public"."conversation_review_draft_criterion_assessment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_pou_review_criterion_snapshot_review_code_uq" ON "workflow_pou_review_criterion_snapshot" USING btree ("workflow_pou_review_id","criterion_code");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_pou_review_criterion_snapshot_review_source_uq" ON "workflow_pou_review_criterion_snapshot" USING btree ("workflow_pou_review_id","source_criterion_assessment_id");--> statement-breakpoint
ALTER TABLE "workflow_pou_review" ADD CONSTRAINT "workflow_pou_review_criterion_snapshots_version" CHECK ("workflow_pou_review"."criterion_snapshots_version" is null or "workflow_pou_review"."criterion_snapshots_version" = 1);
--> statement-breakpoint
CREATE FUNCTION "workflow_pou_review_criterion_snapshot_matches_source"() RETURNS trigger AS $$
DECLARE
  canonical_review record;
  source_assessment record;
BEGIN
  SELECT * INTO canonical_review
  FROM "workflow_pou_review"
  WHERE "id" = NEW."workflow_pou_review_id";

  IF canonical_review."criterion_snapshots_version" IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'canonical criterion snapshots require a versioned confirmed Pou review';
  END IF;

  SELECT assessment.*, draft."workflow_session_id" AS source_workflow_session_id,
    draft."organisation_id" AS source_organisation_id, draft."pou_id" AS source_pou_id
  INTO source_assessment
  FROM "conversation_review_draft_criterion_assessment" assessment
  JOIN "conversation_review_draft_revision" revision ON revision."id" = assessment."review_draft_revision_id"
  JOIN "conversation_review_draft" draft ON draft."id" = revision."review_draft_id"
  WHERE assessment."id" = NEW."source_criterion_assessment_id";

  IF source_assessment."review_draft_revision_id" IS DISTINCT FROM canonical_review."review_draft_revision_id"
    OR source_assessment.source_workflow_session_id IS DISTINCT FROM canonical_review."workflow_session_id"
    OR source_assessment.source_organisation_id IS DISTINCT FROM canonical_review."organisation_id"
    OR source_assessment.source_pou_id IS DISTINCT FROM canonical_review."pou_id"
    OR source_assessment."criterion_code" IS DISTINCT FROM NEW."criterion_code"
    OR source_assessment."status" IS DISTINCT FROM NEW."availability_status"
    OR source_assessment."evidence_turn_ids" IS DISTINCT FROM NEW."evidence_turn_ids"
    OR source_assessment."missing_information_codes" IS DISTINCT FROM NEW."missing_information_codes" THEN
    RAISE EXCEPTION 'canonical criterion snapshot provenance is invalid';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "workflow_pou_review_criterion_snapshot_source_provenance"
BEFORE INSERT OR UPDATE ON "workflow_pou_review_criterion_snapshot"
FOR EACH ROW EXECUTE FUNCTION "workflow_pou_review_criterion_snapshot_matches_source"();
--> statement-breakpoint
CREATE FUNCTION "workflow_pou_review_criterion_snapshot_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'confirmed Pou criterion snapshots are immutable' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "workflow_pou_review_criterion_snapshot_immutable"
BEFORE UPDATE OR DELETE ON "workflow_pou_review_criterion_snapshot"
FOR EACH ROW EXECUTE FUNCTION "workflow_pou_review_criterion_snapshot_immutable"();
--> statement-breakpoint
CREATE FUNCTION "enforce_workflow_pou_review_criterion_snapshot_set"() RETURNS trigger AS $$
DECLARE
  canonical_review_id uuid;
  canonical_review record;
BEGIN
  IF TG_TABLE_NAME = 'workflow_pou_review' THEN
    canonical_review_id := COALESCE(NEW."id", OLD."id");
  ELSE
    canonical_review_id := COALESCE(NEW."workflow_pou_review_id", OLD."workflow_pou_review_id");
  END IF;
  SELECT * INTO canonical_review FROM "workflow_pou_review" WHERE "id" = canonical_review_id;

  IF canonical_review."criterion_snapshots_version" IS NULL THEN
    RETURN NULL;
  END IF;

  IF canonical_review."criterion_snapshots_version" <> 1
    OR EXISTS (
      SELECT 1
      FROM "conversation_review_draft" draft
      JOIN "workflow_conversation_pou_specification_pin" pin ON pin."workflow_conversation_id" = draft."workflow_conversation_id"
      CROSS JOIN LATERAL jsonb_array_elements(pin."pou_review_projection_snapshot"->'criteria') criterion
      WHERE draft."id" = (
        SELECT "review_draft_id" FROM "conversation_review_draft_revision" WHERE "id" = canonical_review."review_draft_revision_id"
      )
        AND NOT EXISTS (
          SELECT 1 FROM "workflow_pou_review_criterion_snapshot" snapshot
          WHERE snapshot."workflow_pou_review_id" = canonical_review."id"
            AND snapshot."criterion_code" = criterion->>'criterionCode'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM "workflow_pou_review_criterion_snapshot" snapshot
      WHERE snapshot."workflow_pou_review_id" = canonical_review."id"
        AND NOT EXISTS (
          SELECT 1
          FROM "conversation_review_draft" draft
          JOIN "workflow_conversation_pou_specification_pin" pin ON pin."workflow_conversation_id" = draft."workflow_conversation_id"
          CROSS JOIN LATERAL jsonb_array_elements(pin."pou_review_projection_snapshot"->'criteria') criterion
          WHERE draft."id" = (
            SELECT "review_draft_id" FROM "conversation_review_draft_revision" WHERE "id" = canonical_review."review_draft_revision_id"
          )
            AND criterion->>'criterionCode' = snapshot."criterion_code"
        )
    ) THEN
    RAISE EXCEPTION 'canonical Pou review criterion snapshot set is incomplete or mismatched';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "workflow_pou_review_criterion_snapshot_set_on_review"
AFTER INSERT OR UPDATE ON "workflow_pou_review"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_workflow_pou_review_criterion_snapshot_set"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "workflow_pou_review_criterion_snapshot_set_on_snapshot"
AFTER INSERT OR UPDATE OR DELETE ON "workflow_pou_review_criterion_snapshot"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_workflow_pou_review_criterion_snapshot_set"();
