CREATE TYPE "public"."distance_source" AS ENUM('map_estimate', 'manual', 'document');--> statement-breakpoint
ALTER TABLE "customer_locations" ADD COLUMN "distance_source" "distance_source";--> statement-breakpoint
ALTER TABLE "supplier_locations" ADD COLUMN "distance_source" "distance_source";--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "distance_source" "distance_source";--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "distance_source" "distance_source";--> statement-breakpoint
ALTER TABLE "transport_legs" ADD COLUMN "distance_source" "distance_source";