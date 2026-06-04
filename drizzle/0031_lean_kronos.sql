ALTER TABLE "biochar_products" ALTER COLUMN "formulation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD COLUMN "formulation_id" uuid;