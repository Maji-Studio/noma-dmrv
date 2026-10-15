ALTER TABLE "customer_locations" DROP CONSTRAINT "customer_locations_distance_from_facility_km_non_negative";--> statement-breakpoint
ALTER TABLE "supplier_locations" DROP CONSTRAINT "supplier_locations_distance_from_facility_km_non_negative";--> statement-breakpoint
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_gps_latitude_range";--> statement-breakpoint
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_gps_longitude_range";--> statement-breakpoint
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_distance_to_facility_km_non_negative";--> statement-breakpoint
ALTER TABLE "facilities" ALTER COLUMN "gps_latitude" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ALTER COLUMN "gps_longitude" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ALTER COLUMN "country" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "customer_locations" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_locations" ALTER COLUMN "country" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "customer_locations" ALTER COLUMN "gps_latitude" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_locations" ALTER COLUMN "gps_longitude" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_locations" ALTER COLUMN "country" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "supplier_locations" ALTER COLUMN "gps_latitude" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_locations" ALTER COLUMN "gps_longitude" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" DROP COLUMN "gps_latitude";--> statement-breakpoint
ALTER TABLE "suppliers" DROP COLUMN "gps_longitude";--> statement-breakpoint
ALTER TABLE "suppliers" DROP COLUMN "distance_to_facility_km";--> statement-breakpoint
ALTER TABLE "suppliers" DROP COLUMN "distance_source";--> statement-breakpoint
ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_distance_from_facility_km_positive" CHECK ("customer_locations"."distance_from_facility_km" is null or "customer_locations"."distance_from_facility_km" > 0);--> statement-breakpoint
ALTER TABLE "supplier_locations" ADD CONSTRAINT "supplier_locations_distance_from_facility_km_positive" CHECK ("supplier_locations"."distance_from_facility_km" is null or "supplier_locations"."distance_from_facility_km" > 0);