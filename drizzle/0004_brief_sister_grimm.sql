ALTER TABLE "feedstock_deliveries" DROP CONSTRAINT "feedstock_deliveries_driver_id_drivers_id_fk";
--> statement-breakpoint
ALTER TABLE "feedstocks" DROP CONSTRAINT "feedstocks_driver_id_drivers_id_fk";
--> statement-breakpoint
ALTER TABLE "biochar_products" ADD COLUMN "water_added_kg" real;--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" DROP COLUMN "driver_id";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "driver_id";