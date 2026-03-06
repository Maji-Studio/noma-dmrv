ALTER TABLE "feedstock_deliveries" DROP CONSTRAINT "feedstock_deliveries_storage_location_id_storage_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" DROP COLUMN "storage_location_id";