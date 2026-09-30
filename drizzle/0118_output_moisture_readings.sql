CREATE TABLE "output_stock_moisture_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"biochar_product_id" uuid,
	"production_run_id" uuid,
	"moisture_percent" numeric(9, 6) NOT NULL,
	"solids_basis_kg" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "output_stock_moisture_readings_movement_product_unique" UNIQUE("movement_id","biochar_product_id"),
	CONSTRAINT "output_stock_moisture_readings_movement_run_unique" UNIQUE("movement_id","production_run_id"),
	CONSTRAINT "output_stock_moisture_readings_one_layer" CHECK ("output_stock_moisture_readings"."biochar_product_id" is null or "output_stock_moisture_readings"."production_run_id" is null),
	CONSTRAINT "output_stock_moisture_readings_percent" CHECK ("output_stock_moisture_readings"."moisture_percent" >= 0 and "output_stock_moisture_readings"."moisture_percent" < 100)
);
--> statement-breakpoint
ALTER TABLE "product_ingredient_snapshots" ADD COLUMN "moisture_estimate" jsonb;--> statement-breakpoint
ALTER TABLE "output_stock_moisture_readings" ADD CONSTRAINT "output_stock_moisture_readings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_moisture_readings" ADD CONSTRAINT "output_stock_moisture_readings_movement_id_organization_id_bin_movements_id_organization_id_fk" FOREIGN KEY ("movement_id","organization_id") REFERENCES "public"."bin_movements"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_moisture_readings" ADD CONSTRAINT "output_stock_moisture_readings_storage_location_id_organization_id_storage_locations_id_organization_id_fk" FOREIGN KEY ("storage_location_id","organization_id") REFERENCES "public"."storage_locations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_moisture_readings" ADD CONSTRAINT "output_stock_moisture_readings_biochar_product_id_organization_id_biochar_products_id_organization_id_fk" FOREIGN KEY ("biochar_product_id","organization_id") REFERENCES "public"."biochar_products"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_moisture_readings" ADD CONSTRAINT "output_stock_moisture_readings_production_run_id_organization_id_production_runs_id_organization_id_fk" FOREIGN KEY ("production_run_id","organization_id") REFERENCES "public"."production_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "output_stock_moisture_readings_org_bin_idx" ON "output_stock_moisture_readings" USING btree ("organization_id","storage_location_id");--> statement-breakpoint
ALTER TABLE "product_ingredient_snapshots" DROP COLUMN "moisture_source";--> statement-breakpoint
ALTER TABLE "product_ingredient_snapshots" DROP COLUMN "moisture_source_snapshot";