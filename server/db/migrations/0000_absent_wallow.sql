CREATE TYPE "public"."application_role" AS ENUM('KAIMAHI', 'SUPERVISOR');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "external_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "role_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "application_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supervision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"supervisor_user_id" uuid NOT NULL,
	"kaimahi_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_session" ADD CONSTRAINT "application_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_identity" ADD CONSTRAINT "external_identity_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervision" ADD CONSTRAINT "supervision_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervision" ADD CONSTRAINT "supervision_supervisor_user_id_app_user_id_fk" FOREIGN KEY ("supervisor_user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervision" ADD CONSTRAINT "supervision_kaimahi_user_id_app_user_id_fk" FOREIGN KEY ("kaimahi_user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_organisation_email_uq" ON "app_user" USING btree ("organisation_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "external_identity_provider_subject_uq" ON "external_identity" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignment_user_role_uq" ON "role_assignment" USING btree ("user_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "supervision_relation_uq" ON "supervision" USING btree ("organisation_id","supervisor_user_id","kaimahi_user_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_supervision_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.supervisor_user_id = NEW.kaimahi_user_id THEN
    RAISE EXCEPTION 'A person cannot supervise themselves';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app_user
    WHERE id = NEW.supervisor_user_id AND organisation_id = NEW.organisation_id
  ) THEN
    RAISE EXCEPTION 'Supervisor must belong to the supervision organisation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app_user
    WHERE id = NEW.kaimahi_user_id AND organisation_id = NEW.organisation_id
  ) THEN
    RAISE EXCEPTION 'Kaimahi must belong to the supervision organisation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM role_assignment
    WHERE user_id = NEW.supervisor_user_id AND role = 'SUPERVISOR'
  ) THEN
    RAISE EXCEPTION 'Supervisor user requires the SUPERVISOR role';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM role_assignment
    WHERE user_id = NEW.kaimahi_user_id AND role = 'KAIMAHI'
  ) THEN
    RAISE EXCEPTION 'Kaimahi user requires the KAIMAHI role';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER supervision_invariants
BEFORE INSERT OR UPDATE ON supervision
FOR EACH ROW EXECUTE FUNCTION enforce_supervision_invariants();
