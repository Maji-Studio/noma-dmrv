CREATE TABLE "application_output_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"application_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"biochar_product_id" uuid NOT NULL,
	"production_run_id" uuid NOT NULL,
	"wet_mass_kg" numeric(14, 3) NOT NULL,
	"dry_mass_kg" numeric(14, 3) NOT NULL,
	CONSTRAINT "application_output_allocations_application_product_run_unique" UNIQUE("application_id","biochar_product_id","production_run_id"),
	CONSTRAINT "application_output_allocations_nonnegative" CHECK ("application_output_allocations"."wet_mass_kg" >= 0 and "application_output_allocations"."dry_mass_kg" >= 0)
);
--> statement-breakpoint
CREATE TABLE "output_stock_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"movement_id" uuid NOT NULL,
	"source_storage_location_id" uuid NOT NULL,
	"biochar_product_id" uuid,
	"production_run_id" uuid,
	"delivery_id" uuid,
	"target_biochar_product_id" uuid,
	"reverses_allocation_id" uuid,
	"dry_mass_kg" numeric(14, 3) NOT NULL,
	"wet_mass_kg" numeric(14, 3),
	"basis_snapshot" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "output_stock_allocations_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "output_stock_allocations_movement_product_unique" UNIQUE("movement_id","biochar_product_id"),
	CONSTRAINT "output_stock_allocations_movement_run_unique" UNIQUE("movement_id","production_run_id"),
	CONSTRAINT "output_stock_allocations_reversal_link" CHECK ("output_stock_allocations"."dry_mass_kg" >= 0 or ("output_stock_allocations"."reverses_allocation_id" is not null and "output_stock_allocations"."reverses_allocation_id" <> "output_stock_allocations"."id")),
	CONSTRAINT "output_stock_allocations_one_layer" CHECK (("output_stock_allocations"."biochar_product_id" is null) <> ("output_stock_allocations"."production_run_id" is null)),
	CONSTRAINT "output_stock_allocations_delivery_wet_required" CHECK ("output_stock_allocations"."delivery_id" is null or "output_stock_allocations"."wet_mass_kg" is not null)
);
--> statement-breakpoint
CREATE TABLE "output_stock_run_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"allocation_id" uuid NOT NULL,
	"production_run_id" uuid NOT NULL,
	"dry_mass_kg" numeric(14, 3) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "output_stock_run_allocations_layer_run_unique" UNIQUE("allocation_id","production_run_id")
);
--> statement-breakpoint
CREATE TABLE "product_ingredient_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"biochar_product_id" uuid NOT NULL,
	"formulation_ingredient_id" uuid NOT NULL,
	"source_storage_location_id" uuid,
	"wet_mass_kg" numeric(14, 3) NOT NULL,
	"moisture_percent_used" numeric(9, 6) NOT NULL,
	"moisture_source" text NOT NULL,
	"moisture_source_snapshot" jsonb NOT NULL,
	"dry_solids_kg" numeric(14, 3) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_ingredient_snapshots_product_line_unique" UNIQUE("biochar_product_id","formulation_ingredient_id"),
	CONSTRAINT "product_ingredient_snapshot_calculation" CHECK ("product_ingredient_snapshots"."dry_solids_kg" = round("product_ingredient_snapshots"."wet_mass_kg" * (1 - "product_ingredient_snapshots"."moisture_percent_used" / 100), 3)),
	CONSTRAINT "product_ingredient_snapshot_mass" CHECK ("product_ingredient_snapshots"."wet_mass_kg" >= 0 and "product_ingredient_snapshots"."dry_solids_kg" >= 0 and "product_ingredient_snapshots"."dry_solids_kg" <= "product_ingredient_snapshots"."wet_mass_kg" and "product_ingredient_snapshots"."moisture_percent_used" >= 0 and "product_ingredient_snapshots"."moisture_percent_used" <= 100)
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_biochar_product_id_biochar_products_id_fk";
--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DEFAULT 'delivered'::text;--> statement-breakpoint
DROP TYPE "public"."delivery_status";--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('delivered');--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DEFAULT 'delivered'::"public"."delivery_status";--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DATA TYPE "public"."delivery_status" USING "status"::"public"."delivery_status";--> statement-breakpoint
ALTER TABLE "biochar_products" ALTER COLUMN "formulation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "storage_location_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD COLUMN "output_kind" text;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD COLUMN "physical_date" date;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD COLUMN "posting_sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD COLUMN "basis_fingerprint" text;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD COLUMN "input_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD COLUMN "output_dry_delta_kg" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "bin_movements" ADD COLUMN "balance_before_dry_kg" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "bin_movements" ADD COLUMN "balance_after_dry_kg" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "bin_movements" ADD COLUMN "corrects_movement_id" uuid;--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN "stock_posting_sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD COLUMN "placed_at" date NOT NULL;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD COLUMN "stock_posting_sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "formulation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "formulation_ingredients" ADD CONSTRAINT "formulation_ingredients_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "application_output_allocations" ADD CONSTRAINT "application_output_allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_output_allocations" ADD CONSTRAINT "application_output_allocations_application_id_organization_id_applications_id_organization_id_fk" FOREIGN KEY ("application_id","organization_id") REFERENCES "public"."applications"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_output_allocations" ADD CONSTRAINT "application_output_allocations_delivery_id_organization_id_deliveries_id_organization_id_fk" FOREIGN KEY ("delivery_id","organization_id") REFERENCES "public"."deliveries"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_output_allocations" ADD CONSTRAINT "application_output_allocations_biochar_product_id_organization_id_biochar_products_id_organization_id_fk" FOREIGN KEY ("biochar_product_id","organization_id") REFERENCES "public"."biochar_products"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_output_allocations" ADD CONSTRAINT "application_output_allocations_production_run_id_organization_id_production_runs_id_organization_id_fk" FOREIGN KEY ("production_run_id","organization_id") REFERENCES "public"."production_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_allocations" ADD CONSTRAINT "output_stock_allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_allocations" ADD CONSTRAINT "output_stock_allocations_reverses_allocation_id_organization_id_output_stock_allocations_id_organization_id_fk" FOREIGN KEY ("reverses_allocation_id","organization_id") REFERENCES "public"."output_stock_allocations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_allocations" ADD CONSTRAINT "output_stock_allocations_movement_id_organization_id_bin_movements_id_organization_id_fk" FOREIGN KEY ("movement_id","organization_id") REFERENCES "public"."bin_movements"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_allocations" ADD CONSTRAINT "output_stock_allocations_source_storage_location_id_organization_id_storage_locations_id_organization_id_fk" FOREIGN KEY ("source_storage_location_id","organization_id") REFERENCES "public"."storage_locations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_allocations" ADD CONSTRAINT "output_stock_allocations_biochar_product_id_organization_id_biochar_products_id_organization_id_fk" FOREIGN KEY ("biochar_product_id","organization_id") REFERENCES "public"."biochar_products"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_allocations" ADD CONSTRAINT "output_stock_allocations_production_run_id_organization_id_production_runs_id_organization_id_fk" FOREIGN KEY ("production_run_id","organization_id") REFERENCES "public"."production_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_allocations" ADD CONSTRAINT "output_stock_allocations_target_biochar_product_id_organization_id_biochar_products_id_organization_id_fk" FOREIGN KEY ("target_biochar_product_id","organization_id") REFERENCES "public"."biochar_products"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_allocations" ADD CONSTRAINT "output_stock_allocations_delivery_id_organization_id_deliveries_id_organization_id_fk" FOREIGN KEY ("delivery_id","organization_id") REFERENCES "public"."deliveries"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_run_allocations" ADD CONSTRAINT "output_stock_run_allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_run_allocations" ADD CONSTRAINT "output_stock_run_allocations_allocation_id_organization_id_output_stock_allocations_id_organization_id_fk" FOREIGN KEY ("allocation_id","organization_id") REFERENCES "public"."output_stock_allocations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_stock_run_allocations" ADD CONSTRAINT "output_stock_run_allocations_production_run_id_organization_id_production_runs_id_organization_id_fk" FOREIGN KEY ("production_run_id","organization_id") REFERENCES "public"."production_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_ingredient_snapshots" ADD CONSTRAINT "product_ingredient_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_ingredient_snapshots" ADD CONSTRAINT "product_ingredient_snapshots_biochar_product_id_organization_id_biochar_products_id_organization_id_fk" FOREIGN KEY ("biochar_product_id","organization_id") REFERENCES "public"."biochar_products"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_ingredient_snapshots" ADD CONSTRAINT "product_ingredient_snapshots_formulation_ingredient_id_organization_id_formulation_ingredients_id_organization_id_fk" FOREIGN KEY ("formulation_ingredient_id","organization_id") REFERENCES "public"."formulation_ingredients"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_ingredient_snapshots" ADD CONSTRAINT "product_ingredient_snapshots_source_storage_location_id_organization_id_storage_locations_id_organization_id_fk" FOREIGN KEY ("source_storage_location_id","organization_id") REFERENCES "public"."storage_locations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "output_stock_allocations_org_bin_idx" ON "output_stock_allocations" USING btree ("organization_id","source_storage_location_id");--> statement-breakpoint
CREATE INDEX "output_stock_allocations_org_delivery_idx" ON "output_stock_allocations" USING btree ("organization_id","delivery_id");--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_storage_location_id_organization_id_storage_locations_id_organization_id_fk" FOREIGN KEY ("storage_location_id","organization_id") REFERENCES "public"."storage_locations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_corrects_movement_id_organization_id_bin_movements_id_organization_id_fk" FOREIGN KEY ("corrects_movement_id","organization_id") REFERENCES "public"."bin_movements"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_formulation_id_formulations_id_fk" FOREIGN KEY ("formulation_id") REFERENCES "public"."formulations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "biochar_product_id";--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_org_idempotency_unique" UNIQUE("organization_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_output_contract" CHECK ("bin_movements"."output_kind" is null or (
      "bin_movements"."lane" in ('biochar', 'product') and "bin_movements"."physical_date" is not null
      and "bin_movements"."idempotency_key" is not null and length("bin_movements"."idempotency_key") > 0
      and "bin_movements"."basis_fingerprint" is not null and "bin_movements"."input_snapshot" is not null
      and "bin_movements"."balance_before_dry_kg" >= 0 and "bin_movements"."balance_after_dry_kg" >= 0
      and "bin_movements"."balance_before_dry_kg" is not null and "bin_movements"."balance_after_dry_kg" is not null
      and "bin_movements"."output_dry_delta_kg" is not null
      and "bin_movements"."balance_after_dry_kg" = "bin_movements"."balance_before_dry_kg" + "bin_movements"."output_dry_delta_kg"
      and ("bin_movements"."output_kind" = 'reversal' or "bin_movements"."output_dry_delta_kg" <= 0)
      and length(trim("bin_movements"."reason")) > 0
      and ("bin_movements"."output_kind" not in ('reversal', 'replacement') or "bin_movements"."corrects_movement_id" is not null)
    ));--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_no_self_correction" CHECK ("bin_movements"."corrects_movement_id" is null or "bin_movements"."corrects_movement_id" <> "bin_movements"."id");