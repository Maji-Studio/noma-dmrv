CREATE TABLE "biochar_product_source_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"biochar_product_id" uuid NOT NULL,
	"production_run_id" uuid NOT NULL,
	"source_storage_location_id" uuid NOT NULL,
	"allocated_wet_mass_kg" numeric(14, 3) NOT NULL,
	"allocated_dry_mass_kg" numeric(14, 3) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "biochar_product_source_allocations_product_run_unique" UNIQUE("biochar_product_id","production_run_id"),
	CONSTRAINT "biochar_product_source_allocations_wet_non_negative" CHECK ("biochar_product_source_allocations"."allocated_wet_mass_kg" >= 0),
	CONSTRAINT "biochar_product_source_allocations_dry_non_negative" CHECK ("biochar_product_source_allocations"."allocated_dry_mass_kg" >= 0),
	CONSTRAINT "biochar_product_source_allocations_dry_lte_wet" CHECK ("biochar_product_source_allocations"."allocated_dry_mass_kg" <= "biochar_product_source_allocations"."allocated_wet_mass_kg")
);
--> statement-breakpoint
ALTER TABLE "biochar_products" ADD COLUMN "source_biochar_storage_location_id" uuid;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "biochar_products" ADD CONSTRAINT "biochar_products_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "biochar_product_source_allocations" ADD CONSTRAINT "biochar_product_source_allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_product_source_allocations" ADD CONSTRAINT "biochar_product_source_allocations_biochar_product_id_organization_id_biochar_products_id_organization_id_fk" FOREIGN KEY ("biochar_product_id","organization_id") REFERENCES "public"."biochar_products"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_product_source_allocations" ADD CONSTRAINT "biochar_product_source_allocations_production_run_id_organization_id_production_runs_id_organization_id_fk" FOREIGN KEY ("production_run_id","organization_id") REFERENCES "public"."production_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_product_source_allocations" ADD CONSTRAINT "biochar_product_source_allocations_source_storage_location_id_organization_id_storage_locations_id_organization_id_fk" FOREIGN KEY ("source_storage_location_id","organization_id") REFERENCES "public"."storage_locations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "biochar_product_source_allocations_organization_id_idx" ON "biochar_product_source_allocations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "biochar_product_source_allocations_source_bin_idx" ON "biochar_product_source_allocations" USING btree ("source_storage_location_id");--> statement-breakpoint
ALTER TABLE "biochar_products" ADD CONSTRAINT "biochar_products_source_biochar_storage_location_id_organization_id_storage_locations_id_organization_id_fk" FOREIGN KEY ("source_biochar_storage_location_id","organization_id") REFERENCES "public"."storage_locations"("id","organization_id") ON DELETE no action ON UPDATE no action;
