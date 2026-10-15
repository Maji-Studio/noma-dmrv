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
ALTER TABLE "suppliers" DROP COLUMN "distance_source";