ALTER TABLE "workflow_session" ADD COLUMN "verbal_consent_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_session" ADD COLUMN "written_consent_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_session" ADD COLUMN "initial_risk_assessment_completed" boolean DEFAULT false NOT NULL;