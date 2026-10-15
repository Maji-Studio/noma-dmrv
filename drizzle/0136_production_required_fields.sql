ALTER TABLE "production_runs" DROP CONSTRAINT "production_runs_low_carbon_percentage_range";--> statement-breakpoint
ALTER TABLE "production_runs" DROP CONSTRAINT "production_runs_feedstock_storage_location_id_storage_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "incident_reports" ALTER COLUMN "severity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "production_runs" ALTER COLUMN "start_time" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "incident_reports" DROP COLUMN "incident_date";--> statement-breakpoint
ALTER TABLE "production_runs" DROP COLUMN "electricity_source_category";--> statement-breakpoint
ALTER TABLE "production_runs" DROP COLUMN "low_carbon_percentage";--> statement-breakpoint
ALTER TABLE "production_runs" DROP COLUMN "feedstock_storage_location_id";--> statement-breakpoint
ALTER TABLE "production_samples" DROP COLUMN "sample_code";--> statement-breakpoint
DROP TYPE "public"."electricity_source_category";