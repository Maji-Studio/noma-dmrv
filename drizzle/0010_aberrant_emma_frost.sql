ALTER TABLE "reactors" RENAME COLUMN "capacity_kg" TO "nominal_throughput_tph";--> statement-breakpoint
ALTER TABLE "storage_locations" DROP CONSTRAINT "storage_locations_latitude_range";--> statement-breakpoint
ALTER TABLE "storage_locations" DROP CONSTRAINT "storage_locations_longitude_range";--> statement-breakpoint
ALTER TABLE "storage_locations" DROP COLUMN "latitude";--> statement-breakpoint
ALTER TABLE "storage_locations" DROP COLUMN "longitude";