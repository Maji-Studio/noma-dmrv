ALTER TABLE "applications" ALTER COLUMN "application_date" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "field_size_ha" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "delivered_wet_mass_kg" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "biochar_products" ALTER COLUMN "production_date" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "biochar_products" ALTER COLUMN "source_biochar_storage_location_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "biochar_products" ALTER COLUMN "mass_kg" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "biochar_products" ALTER COLUMN "moisture_content_percent" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "biochar_products" ALTER COLUMN "water_added_kg" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "biochar_products" ALTER COLUMN "storage_location_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "biochar_products" DROP COLUMN "expires_at";