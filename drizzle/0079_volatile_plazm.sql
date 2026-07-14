INSERT INTO organizations (id, name, slug) VALUES ('org_dark_earth_carbon', 'Dark Earth Carbon', 'dark-earth-carbon') ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "applications" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "soil_temperature_measurements" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "soil_temperature_measurements" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "soil_temperature_measurements" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "bin_movements" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "bin_movements" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "certification_submissions" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "certification_submissions" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "certification_submissions" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "certifier_document_uploads" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "certifier_document_uploads" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "certifier_document_uploads" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "certifier_ghg_statements" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "certifier_ghg_statements" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "certifier_ghg_statements" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "certifier_projects" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "certifier_projects" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "certifier_projects" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "certifier_removals" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "certifier_removals" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "certifier_removals" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "certifier_sensors" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "certifier_sensors" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "certifier_sensors" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "certifier_sync_events" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "certifier_sync_events" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "certifier_sync_events" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "power_procurement_evidence" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "power_procurement_evidence" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "power_procurement_evidence" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stockpile_events" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "stockpile_events" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "stockpile_events" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_batch_applications" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "credit_batch_applications" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "credit_batch_applications" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_batch_production_runs" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "credit_batch_production_runs" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "credit_batch_production_runs" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "credit_batches" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "credit_batches" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "documents" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "facilities" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "facilities" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reactors" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "reactors" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "reactors" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "storage_locations" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "storage_locations" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "feedstock_deliveries" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedstock_types" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "feedstock_types" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "feedstock_types" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedstocks" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "feedstocks" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "feedstocks" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_locations" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "customer_locations" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "customer_locations" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "customers" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "drivers" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "drivers" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "operators" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "operators" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_locations" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "supplier_locations" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "supplier_locations" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "suppliers" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "incident_reports" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "incident_reports" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "production_run_feedstocks" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "production_run_feedstocks" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "production_run_feedstocks" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "production_run_readings" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "production_run_readings" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "production_run_readings" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "production_runs" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "production_runs" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "production_samples" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "production_samples" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "production_samples" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "samples" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "samples" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "production_processes" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "production_processes" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "production_processes" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "biochar_products" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "biochar_products" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "formulation_ingredients" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "formulation_ingredients" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "formulation_ingredients" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "formulations" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "formulations" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "formulations" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "deliveries" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "orders" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transport_legs" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "transport_legs" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "transport_legs" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "vehicles" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "biochar_storage_inventory" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "biochar_storage_inventory" SET "organization_id" = 'org_dark_earth_carbon' WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "biochar_storage_inventory" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" DROP CONSTRAINT "applications_code_unique";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP CONSTRAINT "credit_batches_code_unique";--> statement-breakpoint
ALTER TABLE "facilities" DROP CONSTRAINT "facilities_code_unique";--> statement-breakpoint
ALTER TABLE "reactors" DROP CONSTRAINT "reactors_code_unique";--> statement-breakpoint
ALTER TABLE "storage_locations" DROP CONSTRAINT "storage_locations_code_unique";--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" DROP CONSTRAINT "feedstock_deliveries_code_unique";--> statement-breakpoint
ALTER TABLE "feedstock_types" DROP CONSTRAINT "feedstock_types_code_unique";--> statement-breakpoint
ALTER TABLE "feedstock_types" DROP CONSTRAINT "feedstock_types_name_usage_unique";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP CONSTRAINT "feedstocks_code_unique";--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_code_unique";--> statement-breakpoint
ALTER TABLE "drivers" DROP CONSTRAINT "drivers_code_unique";--> statement-breakpoint
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_code_unique";--> statement-breakpoint
ALTER TABLE "production_runs" DROP CONSTRAINT "production_runs_code_unique";--> statement-breakpoint
ALTER TABLE "samples" DROP CONSTRAINT "samples_sample_code_unique";--> statement-breakpoint
ALTER TABLE "biochar_products" DROP CONSTRAINT "biochar_products_code_unique";--> statement-breakpoint
ALTER TABLE "formulations" DROP CONSTRAINT "formulations_code_unique";--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_code_unique";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_code_unique";--> statement-breakpoint
ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_code_unique";--> statement-breakpoint
ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_name_unique";--> statement-breakpoint
ALTER TABLE "biochar_storage_inventory" DROP CONSTRAINT "biochar_storage_inventory_code_unique";--> statement-breakpoint
ALTER TABLE "applications" DROP CONSTRAINT "applications_delivery_id_deliveries_id_fk";--> statement-breakpoint
ALTER TABLE "soil_temperature_measurements" DROP CONSTRAINT "soil_temperature_measurements_application_id_applications_id_fk";--> statement-breakpoint
ALTER TABLE "certifier_ghg_statements" DROP CONSTRAINT "certifier_ghg_statements_facility_id_facilities_id_fk";--> statement-breakpoint
ALTER TABLE "certifier_projects" DROP CONSTRAINT "certifier_projects_facility_id_facilities_id_fk";--> statement-breakpoint
ALTER TABLE "certifier_removals" DROP CONSTRAINT "certifier_removals_facility_id_facilities_id_fk";--> statement-breakpoint
ALTER TABLE "power_procurement_evidence" DROP CONSTRAINT "power_procurement_evidence_facility_id_facilities_id_fk";--> statement-breakpoint
ALTER TABLE "stockpile_events" DROP CONSTRAINT "stockpile_events_facility_id_facilities_id_fk";--> statement-breakpoint
ALTER TABLE "credit_batch_applications" DROP CONSTRAINT "credit_batch_applications_credit_batch_id_credit_batches_id_fk";--> statement-breakpoint
ALTER TABLE "credit_batch_applications" DROP CONSTRAINT "credit_batch_applications_application_id_applications_id_fk";--> statement-breakpoint
ALTER TABLE "credit_batch_production_runs" DROP CONSTRAINT "credit_batch_production_runs_credit_batch_id_credit_batches_id_fk";--> statement-breakpoint
ALTER TABLE "credit_batch_production_runs" DROP CONSTRAINT "credit_batch_production_runs_production_run_id_production_runs_id_fk";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP CONSTRAINT "credit_batches_facility_id_facilities_id_fk";--> statement-breakpoint
ALTER TABLE "reactors" DROP CONSTRAINT "reactors_facility_id_facilities_id_fk";--> statement-breakpoint
ALTER TABLE "storage_locations" DROP CONSTRAINT "storage_locations_facility_id_facilities_id_fk";--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" DROP CONSTRAINT "feedstock_deliveries_facility_id_facilities_id_fk";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP CONSTRAINT "feedstocks_facility_id_facilities_id_fk";--> statement-breakpoint
ALTER TABLE "incident_reports" DROP CONSTRAINT "incident_reports_production_run_id_production_runs_id_fk";--> statement-breakpoint
ALTER TABLE "production_run_feedstocks" DROP CONSTRAINT "production_run_feedstocks_production_run_id_production_runs_id_fk";--> statement-breakpoint
ALTER TABLE "production_run_readings" DROP CONSTRAINT "production_run_readings_production_run_id_production_runs_id_fk";--> statement-breakpoint
ALTER TABLE "production_runs" DROP CONSTRAINT "production_runs_facility_id_facilities_id_fk";--> statement-breakpoint
ALTER TABLE "production_samples" DROP CONSTRAINT "production_samples_production_run_id_production_runs_id_fk";--> statement-breakpoint
ALTER TABLE "samples" DROP CONSTRAINT "samples_production_run_id_production_runs_id_fk";--> statement-breakpoint
ALTER TABLE "production_processes" DROP CONSTRAINT "production_processes_facility_id_facilities_id_fk";--> statement-breakpoint
ALTER TABLE "biochar_products" DROP CONSTRAINT "biochar_products_facility_id_facilities_id_fk";--> statement-breakpoint
ALTER TABLE "biochar_products" DROP CONSTRAINT "biochar_products_linked_production_run_id_production_runs_id_fk";--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_facility_id_facilities_id_fk";--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_order_id_orders_id_fk";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_facility_id_facilities_id_fk";--> statement-breakpoint
DROP INDEX "customers_name_unique";--> statement-breakpoint
DROP INDEX "suppliers_name_unique";--> statement-breakpoint
DROP INDEX "reactors_facility_identifier_unique";--> statement-breakpoint
DROP INDEX "storage_locations_facility_name_unique";--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "certifier_projects" ADD CONSTRAINT "certifier_projects_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_delivery_id_organization_id_deliveries_id_organization_id_fk" FOREIGN KEY ("delivery_id","organization_id") REFERENCES "public"."deliveries"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soil_temperature_measurements" ADD CONSTRAINT "soil_temperature_measurements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soil_temperature_measurements" ADD CONSTRAINT "soil_temperature_measurements_application_id_organization_id_applications_id_organization_id_fk" FOREIGN KEY ("application_id","organization_id") REFERENCES "public"."applications"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certification_submissions" ADD CONSTRAINT "certification_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_document_uploads" ADD CONSTRAINT "certifier_document_uploads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_ghg_statements" ADD CONSTRAINT "certifier_ghg_statements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_ghg_statements" ADD CONSTRAINT "certifier_ghg_statements_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_projects" ADD CONSTRAINT "certifier_projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_projects" ADD CONSTRAINT "certifier_projects_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_removals" ADD CONSTRAINT "certifier_removals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_removals" ADD CONSTRAINT "certifier_removals_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_sensors" ADD CONSTRAINT "certifier_sensors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_sync_events" ADD CONSTRAINT "certifier_sync_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_procurement_evidence" ADD CONSTRAINT "power_procurement_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_procurement_evidence" ADD CONSTRAINT "power_procurement_evidence_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stockpile_events" ADD CONSTRAINT "stockpile_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stockpile_events" ADD CONSTRAINT "stockpile_events_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batch_applications" ADD CONSTRAINT "credit_batch_applications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batch_applications" ADD CONSTRAINT "credit_batch_applications_credit_batch_id_organization_id_credit_batches_id_organization_id_fk" FOREIGN KEY ("credit_batch_id","organization_id") REFERENCES "public"."credit_batches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batch_applications" ADD CONSTRAINT "credit_batch_applications_application_id_organization_id_applications_id_organization_id_fk" FOREIGN KEY ("application_id","organization_id") REFERENCES "public"."applications"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batch_production_runs" ADD CONSTRAINT "credit_batch_production_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batch_production_runs" ADD CONSTRAINT "credit_batch_production_runs_credit_batch_id_organization_id_credit_batches_id_organization_id_fk" FOREIGN KEY ("credit_batch_id","organization_id") REFERENCES "public"."credit_batches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batch_production_runs" ADD CONSTRAINT "credit_batch_production_runs_production_run_id_organization_id_production_runs_id_organization_id_fk" FOREIGN KEY ("production_run_id","organization_id") REFERENCES "public"."production_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactors" ADD CONSTRAINT "reactors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactors" ADD CONSTRAINT "reactors_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" ADD CONSTRAINT "feedstock_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" ADD CONSTRAINT "feedstock_deliveries_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstock_types" ADD CONSTRAINT "feedstock_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstocks" ADD CONSTRAINT "feedstocks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstocks" ADD CONSTRAINT "feedstocks_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operators" ADD CONSTRAINT "operators_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_locations" ADD CONSTRAINT "supplier_locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_production_run_id_organization_id_production_runs_id_organization_id_fk" FOREIGN KEY ("production_run_id","organization_id") REFERENCES "public"."production_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_feedstocks" ADD CONSTRAINT "production_run_feedstocks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_feedstocks" ADD CONSTRAINT "production_run_feedstocks_production_run_id_organization_id_production_runs_id_organization_id_fk" FOREIGN KEY ("production_run_id","organization_id") REFERENCES "public"."production_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_readings" ADD CONSTRAINT "production_run_readings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_readings" ADD CONSTRAINT "production_run_readings_production_run_id_organization_id_production_runs_id_organization_id_fk" FOREIGN KEY ("production_run_id","organization_id") REFERENCES "public"."production_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_samples" ADD CONSTRAINT "production_samples_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_samples" ADD CONSTRAINT "production_samples_production_run_id_organization_id_production_runs_id_organization_id_fk" FOREIGN KEY ("production_run_id","organization_id") REFERENCES "public"."production_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_production_run_id_organization_id_production_runs_id_organization_id_fk" FOREIGN KEY ("production_run_id","organization_id") REFERENCES "public"."production_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_processes" ADD CONSTRAINT "production_processes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_processes" ADD CONSTRAINT "production_processes_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD CONSTRAINT "biochar_products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD CONSTRAINT "biochar_products_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD CONSTRAINT "biochar_products_linked_production_run_id_organization_id_production_runs_id_organization_id_fk" FOREIGN KEY ("linked_production_run_id","organization_id") REFERENCES "public"."production_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulation_ingredients" ADD CONSTRAINT "formulation_ingredients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulations" ADD CONSTRAINT "formulations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_organization_id_orders_id_organization_id_fk" FOREIGN KEY ("order_id","organization_id") REFERENCES "public"."orders"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_legs" ADD CONSTRAINT "transport_legs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_storage_inventory" ADD CONSTRAINT "biochar_storage_inventory_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "reactors" ADD CONSTRAINT "reactors_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" ADD CONSTRAINT "feedstock_deliveries_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "feedstock_types" ADD CONSTRAINT "feedstock_types_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "feedstock_types" ADD CONSTRAINT "feedstock_types_organization_id_name_usage_unique" UNIQUE("organization_id","name","usage");--> statement-breakpoint
ALTER TABLE "feedstocks" ADD CONSTRAINT "feedstocks_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_organization_id_sample_code_unique" UNIQUE("organization_id","sample_code");--> statement-breakpoint
ALTER TABLE "biochar_products" ADD CONSTRAINT "biochar_products_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "formulations" ADD CONSTRAINT "formulations_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_name_unique" UNIQUE("organization_id","name");--> statement-breakpoint
ALTER TABLE "biochar_storage_inventory" ADD CONSTRAINT "biochar_storage_inventory_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
CREATE INDEX "soil_temperature_measurements_organization_id_idx" ON "soil_temperature_measurements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "bin_movements_organization_id_idx" ON "bin_movements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certification_submissions_organization_id_idx" ON "certification_submissions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certifier_document_uploads_organization_id_idx" ON "certifier_document_uploads" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certifier_ghg_statements_organization_id_idx" ON "certifier_ghg_statements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certifier_projects_organization_id_idx" ON "certifier_projects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certifier_removals_organization_id_idx" ON "certifier_removals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certifier_sensors_organization_id_idx" ON "certifier_sensors" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certifier_sync_events_organization_id_idx" ON "certifier_sync_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "power_procurement_evidence_organization_id_idx" ON "power_procurement_evidence" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "stockpile_events_organization_id_idx" ON "stockpile_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "credit_batch_applications_organization_id_idx" ON "credit_batch_applications" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "credit_batch_production_runs_organization_id_idx" ON "credit_batch_production_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "documents_organization_id_idx" ON "documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "customer_locations_organization_id_idx" ON "customer_locations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_organization_id_code_unique" ON "customers" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_organization_id_name_unique" ON "customers" USING btree ("organization_id",lower(trim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_organization_id_code_unique" ON "drivers" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "operators_organization_id_idx" ON "operators" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "supplier_locations_organization_id_idx" ON "supplier_locations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_organization_id_code_unique" ON "suppliers" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_organization_id_name_unique" ON "suppliers" USING btree ("organization_id",lower(trim("name")));--> statement-breakpoint
CREATE INDEX "incident_reports_organization_id_idx" ON "incident_reports" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "production_run_feedstocks_organization_id_idx" ON "production_run_feedstocks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "production_run_readings_organization_id_idx" ON "production_run_readings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "production_samples_organization_id_idx" ON "production_samples" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "production_processes_organization_id_idx" ON "production_processes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "formulation_ingredients_organization_id_idx" ON "formulation_ingredients" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "transport_legs_organization_id_idx" ON "transport_legs" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reactors_facility_identifier_unique" ON "reactors" USING btree ("organization_id","facility_id",lower(trim("identifier")));--> statement-breakpoint
CREATE UNIQUE INDEX "storage_locations_facility_name_unique" ON "storage_locations" USING btree ("organization_id","facility_id",lower(trim("name")));
