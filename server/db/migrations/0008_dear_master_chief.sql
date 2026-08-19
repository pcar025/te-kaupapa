ALTER TABLE "conversation_safety_assessment_run" ADD COLUMN "assessment_provider" text;--> statement-breakpoint
ALTER TABLE "conversation_safety_assessment_run" ADD COLUMN "assessment_provider_model" text;--> statement-breakpoint
ALTER TABLE "conversation_safety_assessment_run" ADD COLUMN "transcript_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_safety_assessment_run" ADD COLUMN "assessment_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_safety_assessment_run" ADD COLUMN "assessment_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_safety_assessment_run" ADD COLUMN "review_available_at" timestamp with time zone;