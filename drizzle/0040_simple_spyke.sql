ALTER TYPE "public"."documentation_type" ADD VALUE 'sensor_data';--> statement-breakpoint
ALTER TABLE "production_runs" DROP COLUMN "plc_data_file_url";