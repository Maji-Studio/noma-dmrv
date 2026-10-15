ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_customer_location_id_customer_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_biochar_product_id_biochar_products_id_fk";
--> statement-breakpoint
ALTER TABLE "deliveries" DROP COLUMN "customer_location_id";--> statement-breakpoint
ALTER TABLE "deliveries" DROP COLUMN "biochar_product_id";