CREATE TYPE "public"."registry_source_visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TABLE "certifier_organization_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "certifier_provider" DEFAULT 'isometric' NOT NULL,
	"source_visibility" "registry_source_visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "certifier_org_settings_organization_provider_unique" UNIQUE("organization_id","provider")
);
--> statement-breakpoint
ALTER TABLE "certifier_organization_settings" ADD CONSTRAINT "certifier_organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;