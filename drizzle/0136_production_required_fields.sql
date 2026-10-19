ALTER TABLE "production_runs" DROP CONSTRAINT "production_runs_low_carbon_percentage_range";--> statement-breakpoint
ALTER TABLE "production_runs" DROP CONSTRAINT "production_runs_feedstock_moisture_percent_range";--> statement-breakpoint
ALTER TABLE "production_runs" DROP CONSTRAINT "production_runs_biochar_moisture_percent_range";--> statement-breakpoint
ALTER TABLE "production_runs" DROP CONSTRAINT "production_runs_feedstock_storage_location_id_storage_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "incident_reports" ALTER COLUMN "severity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "production_runs" ALTER COLUMN "start_time" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "incident_reports" DROP COLUMN "incident_date";--> statement-breakpoint
ALTER TABLE "production_runs" DROP COLUMN "electricity_source_category";--> statement-breakpoint
ALTER TABLE "production_runs" DROP COLUMN "low_carbon_percentage";--> statement-breakpoint
ALTER TABLE "production_runs" DROP COLUMN "feedstock_storage_location_id";--> statement-breakpoint
ALTER TABLE "production_samples" DROP COLUMN "sample_code";--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_feedstock_moisture_percent_range" CHECK ("production_runs"."feedstock_moisture_percent" >= 0 and "production_runs"."feedstock_moisture_percent" < 100);--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_biochar_moisture_percent_range" CHECK ("production_runs"."biochar_moisture_percent" >= 0 and "production_runs"."biochar_moisture_percent" < 100);--> statement-breakpoint
ALTER TABLE "production_samples" ADD CONSTRAINT "production_samples_weight_grams_non_negative" CHECK ("production_samples"."weight_grams" is null or "production_samples"."weight_grams" >= 0);--> statement-breakpoint
ALTER TABLE "production_samples" ADD CONSTRAINT "production_samples_volume_ml_non_negative" CHECK ("production_samples"."volume_ml" is null or "production_samples"."volume_ml" >= 0);--> statement-breakpoint
DROP TYPE "public"."electricity_source_category";