CREATE TABLE "emission_line_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"credit_batch_id" uuid NOT NULL,
	"component_id" text NOT NULL,
	"created_by" text,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emission_line_files_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "emission_line_files_component_unique" UNIQUE("organization_id","credit_batch_id","component_id")
);
--> statement-breakpoint
ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_entity_type";--> statement-breakpoint
ALTER TABLE "emission_line_files" ADD CONSTRAINT "emission_line_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_line_files" ADD CONSTRAINT "emission_line_files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_line_files" ADD CONSTRAINT "emission_line_files_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_line_files" ADD CONSTRAINT "emission_line_files_credit_batch_id_organization_id_credit_batches_id_organization_id_fk" FOREIGN KEY ("credit_batch_id","organization_id") REFERENCES "public"."credit_batches"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_emission_line_active_unique" ON "documents" USING btree ("organization_id","entity_id") WHERE "documents"."entity_type" = 'emission_line' and "documents"."upload_status" in ('pending', 'uploaded');--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_entity_type" CHECK ("activity_events"."entity_type" in ('emission_entry', 'emission_line', 'emission_line_comment', 'removal_template_observation', 'removal', 'ghg_statement', 'production_run', 'biochar_product', 'lab_sample', 'order', 'delivery', 'application', 'credit_batch', 'document', 'transport_leg', 'feedstock', 'bin_movement', 'supplier', 'supplier_location', 'customer', 'customer_location', 'formulation'));