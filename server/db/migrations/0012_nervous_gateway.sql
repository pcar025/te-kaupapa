CREATE TYPE "public"."conversation_transcript_speaker" AS ENUM('kaimahi', 'assistant', 'unknown');--> statement-breakpoint
CREATE TABLE "conversation_transcript_turn" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transcript_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"speaker" "conversation_transcript_speaker" NOT NULL,
	"text" text NOT NULL,
	"provider_sequence" integer,
	"provider_timestamp" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_turn_ordinal_positive" CHECK ("conversation_transcript_turn"."ordinal" > 0),
	CONSTRAINT "transcript_turn_text_nonempty" CHECK (length("conversation_transcript_turn"."text") between 1 and 120000)
);
--> statement-breakpoint
CREATE TABLE "conversation_transcript" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"workflow_session_id" uuid NOT NULL,
	"pou_id" "workflow_pou_id" NOT NULL,
	"workflow_conversation_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_conversation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_whakapapa_only" CHECK ("conversation_transcript"."pou_id" = 'whakapapa')
);
--> statement-breakpoint
ALTER TABLE "conversation_provider_rule_assessment" ADD COLUMN "evidence_turn_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_provider_rule_assessment" ALTER COLUMN "evidence_turn_ids" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_conversation_id_scope_uq" ON "workflow_conversation" USING btree ("id","organisation_id","workflow_session_id","pou_id");--> statement-breakpoint
ALTER TABLE "conversation_transcript_turn" ADD CONSTRAINT "transcript_turn_transcript_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."conversation_transcript"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_transcript" ADD CONSTRAINT "transcript_conversation_scope_fk" FOREIGN KEY ("workflow_conversation_id","organisation_id","workflow_session_id","pou_id") REFERENCES "public"."workflow_conversation"("id","organisation_id","workflow_session_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_transcript" ADD CONSTRAINT "transcript_checkpoint_organisation_fk" FOREIGN KEY ("workflow_session_id","organisation_id","pou_id") REFERENCES "public"."workflow_pou_checkpoint"("workflow_session_id","organisation_id","pou_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_turn_transcript_ordinal_uq" ON "conversation_transcript_turn" USING btree ("transcript_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_one_per_workflow_conversation_uq" ON "conversation_transcript" USING btree ("workflow_conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_id_organisation_workflow_uq" ON "conversation_transcript" USING btree ("id","organisation_id","workflow_session_id");
