ALTER TABLE "conversation_guidance_projection" DROP CONSTRAINT "conversation_guidance_projection_whakapapa_only";--> statement-breakpoint
ALTER TABLE "conversation_review_draft" DROP CONSTRAINT "review_draft_whakapapa_only";--> statement-breakpoint
ALTER TABLE "conversation_safety_assessment_run" DROP CONSTRAINT "assessment_run_whakapapa_only";--> statement-breakpoint
ALTER TABLE "conversation_transcript" DROP CONSTRAINT "transcript_whakapapa_only";--> statement-breakpoint
ALTER TABLE "organisation_pou_safety_specification_link" DROP CONSTRAINT "organisation_pou_safety_link_whakapapa_only";--> statement-breakpoint
ALTER TABLE "organisation_pou_specification_activation" DROP CONSTRAINT "organisation_pou_specification_activation_whakapapa_only";--> statement-breakpoint
ALTER TABLE "organisation_pou_specification_version" DROP CONSTRAINT "organisation_pou_specification_whakapapa_only";--> statement-breakpoint
ALTER TABLE "pou_review_projection" DROP CONSTRAINT "pou_review_projection_whakapapa_only";--> statement-breakpoint
ALTER TABLE "provider_assessment_projection" DROP CONSTRAINT "provider_projection_whakapapa_only";--> statement-breakpoint
ALTER TABLE "safety_specification_activation" DROP CONSTRAINT "safety_activation_whakapapa_only";--> statement-breakpoint
ALTER TABLE "safety_specification_version" DROP CONSTRAINT "safety_specification_whakapapa_only";--> statement-breakpoint
ALTER TABLE "workflow_conversation_pou_specification_pin" DROP CONSTRAINT "conversation_pou_specification_pin_whakapapa_only";--> statement-breakpoint
ALTER TABLE "workflow_pou_review" DROP CONSTRAINT "workflow_pou_review_whakapapa_only";