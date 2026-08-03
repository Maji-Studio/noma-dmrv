CREATE TABLE "organization_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"default_currency" text DEFAULT 'TZS' NOT NULL,
	"default_country" text,
	"default_timezone" text DEFAULT 'UTC' NOT NULL,
	"default_trip_type" "transport_trip_type" DEFAULT 'return' NOT NULL,
	"default_evidence_method" "application_evidence_method" DEFAULT 'visual' NOT NULL,
	"default_packaging" "packaging_type" DEFAULT 'loose' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_settings_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;