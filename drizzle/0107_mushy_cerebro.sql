CREATE TYPE "public"."certifier_biochar_application_correction_status" AS ENUM('none', 'review_required', 'replacement_required');--> statement-breakpoint
CREATE TYPE "public"."certifier_biochar_application_lifecycle_status" AS ENUM('gated', 'confirmed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."certifier_storage_location_drift_status" AS ENUM('in_sync', 'drifted');--> statement-breakpoint
CREATE TABLE "certifier_biochar_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "certifier_provider" DEFAULT 'isometric' NOT NULL,
	"application_id" uuid NOT NULL,
	"credit_batch_id" uuid NOT NULL,
	"production_batch_registration_id" uuid NOT NULL,
	"storage_location_registration_id" uuid NOT NULL,
	"external_production_batch_id" text NOT NULL,
	"external_storage_location_id" text NOT NULL,
	"external_application_id" text,
	"supplier_reference" text NOT NULL,
	"submitted_payload" jsonb,
	"payload_hash" text,
	"observed_ghg_entry_id" text,
	"observed_removal_id" text,
	"lifecycle_status" "certifier_biochar_application_lifecycle_status" DEFAULT 'gated' NOT NULL,
	"correction_status" "certifier_biochar_application_correction_status" DEFAULT 'none' NOT NULL,
	"gate_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "certifier_biochar_applications_id_organization_id_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "certifier_biochar_applications_provider_application_batch_unique" UNIQUE("provider","application_id","credit_batch_id"),
	CONSTRAINT "certifier_biochar_applications_provider_reference_unique" UNIQUE("provider","supplier_reference"),
	CONSTRAINT "certifier_biochar_applications_provider_external_id_unique" UNIQUE("provider","external_application_id"),
	CONSTRAINT "certifier_biochar_applications_provider_is_isometric" CHECK ("certifier_biochar_applications"."provider" = 'isometric'),
	CONSTRAINT "certifier_biochar_applications_payload_pair" CHECK (("certifier_biochar_applications"."submitted_payload" is null) = ("certifier_biochar_applications"."payload_hash" is null)),
	CONSTRAINT "certifier_biochar_applications_confirmed_identity" CHECK ("certifier_biochar_applications"."lifecycle_status" <> 'confirmed' or ("certifier_biochar_applications"."external_application_id" is not null and "certifier_biochar_applications"."submitted_payload" is not null))
);
--> statement-breakpoint
CREATE TABLE "certifier_storage_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "certifier_provider" DEFAULT 'isometric' NOT NULL,
	"customer_location_id" uuid NOT NULL,
	"certifier_project_id" uuid NOT NULL,
	"external_project_id" text NOT NULL,
	"external_storage_location_id" text NOT NULL,
	"supplier_reference" text NOT NULL,
	"submitted_payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"drift_status" "certifier_storage_location_drift_status" DEFAULT 'in_sync' NOT NULL,
	"drift_details" jsonb,
	"drift_detected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "certifier_storage_locations_id_organization_id_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "certifier_storage_locations_provider_project_location_unique" UNIQUE("provider","external_project_id","customer_location_id"),
	CONSTRAINT "certifier_storage_locations_provider_reference_unique" UNIQUE("provider","supplier_reference"),
	CONSTRAINT "certifier_storage_locations_provider_external_id_unique" UNIQUE("provider","external_storage_location_id"),
	CONSTRAINT "certifier_storage_locations_provider_is_isometric" CHECK ("certifier_storage_locations"."provider" = 'isometric')
);
--> statement-breakpoint
ALTER TABLE "certifier_production_batches" ADD CONSTRAINT "certifier_production_batches_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ADD CONSTRAINT "certifier_biochar_applications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ADD CONSTRAINT "certifier_biochar_applications_application_id_organization_id_applications_id_organization_id_fk" FOREIGN KEY ("application_id","organization_id") REFERENCES "public"."applications"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ADD CONSTRAINT "certifier_biochar_applications_credit_batch_id_organization_id_credit_batches_id_organization_id_fk" FOREIGN KEY ("credit_batch_id","organization_id") REFERENCES "public"."credit_batches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ADD CONSTRAINT "certifier_biochar_applications_production_batch_registration_id_organization_id_certifier_production_batches_id_organization_id_fk" FOREIGN KEY ("production_batch_registration_id","organization_id") REFERENCES "public"."certifier_production_batches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ADD CONSTRAINT "certifier_biochar_applications_storage_location_registration_id_organization_id_certifier_storage_locations_id_organization_id_fk" FOREIGN KEY ("storage_location_registration_id","organization_id") REFERENCES "public"."certifier_storage_locations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_storage_locations" ADD CONSTRAINT "certifier_storage_locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_storage_locations" ADD CONSTRAINT "certifier_storage_locations_customer_location_id_organization_id_customer_locations_id_organization_id_fk" FOREIGN KEY ("customer_location_id","organization_id") REFERENCES "public"."customer_locations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_storage_locations" ADD CONSTRAINT "certifier_storage_locations_certifier_project_id_organization_id_certifier_projects_id_organization_id_fk" FOREIGN KEY ("certifier_project_id","organization_id") REFERENCES "public"."certifier_projects"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certifier_biochar_applications_organization_id_idx" ON "certifier_biochar_applications" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certifier_storage_locations_organization_id_idx" ON "certifier_storage_locations" USING btree ("organization_id");
