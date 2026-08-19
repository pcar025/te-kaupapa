CREATE TYPE "public"."provider_assessment_delivery_status" AS ENUM('reserved', 'completed');--> statement-breakpoint
ALTER TABLE "provider_assessment_delivery" ADD COLUMN "status" "provider_assessment_delivery_status" DEFAULT 'reserved' NOT NULL;--> statement-breakpoint
UPDATE "provider_assessment_delivery" SET "status" = 'completed';
