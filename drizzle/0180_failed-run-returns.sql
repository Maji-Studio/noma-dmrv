ALTER TYPE "public"."bin_movement_type" ADD VALUE 'failed_run_return' BEFORE 'adjustment';--> statement-breakpoint
ALTER TYPE "public"."bin_movement_type" ADD VALUE 'failed_run_return_reversal' BEFORE 'adjustment';--> statement-breakpoint
ALTER TABLE "bin_movements" ADD COLUMN "source_production_run_id" uuid;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD COLUMN "returned_feedstock_type_id" uuid;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD COLUMN "feedstock_dry_delta_kg" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "feedstock_types" ADD CONSTRAINT "feedstock_types_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_source_production_run_id_organization_id_production_runs_id_organization_id_fk" FOREIGN KEY ("source_production_run_id","organization_id") REFERENCES "public"."production_runs"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_returned_feedstock_type_id_organization_id_feedstock_types_id_organization_id_fk" FOREIGN KEY ("returned_feedstock_type_id","organization_id") REFERENCES "public"."feedstock_types"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bin_movements_source_run_idx" ON "bin_movements" USING btree ("organization_id","source_production_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bin_movements_one_return_reversal" ON "bin_movements" USING btree ("organization_id","corrects_movement_id") WHERE "bin_movements"."source_production_run_id" is not null and "bin_movements"."mass_delta_kg" < 0;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_return_contract" CHECK ("bin_movements"."movement_type"::text not in ('failed_run_return', 'failed_run_return_reversal') or (
      "bin_movements"."lane" = 'feedstock' and "bin_movements"."output_kind" is null
      and "bin_movements"."source_production_run_id" is not null and "bin_movements"."returned_feedstock_type_id" is not null
      and "bin_movements"."feedstock_dry_delta_kg" is not null and "bin_movements"."occurred_at" is not null
      and "bin_movements"."moisture_ratio_used" is not null and "bin_movements"."moisture_ratio_used" >= 0 and "bin_movements"."moisture_ratio_used" < 1
      and "bin_movements"."idempotency_key" is not null and length(trim("bin_movements"."idempotency_key")) > 0
      and "bin_movements"."input_snapshot" is not null and jsonb_typeof("bin_movements"."input_snapshot") = 'object'
      and "bin_movements"."input_snapshot" ?& array['version', 'sourceRunVersion', 'actorId', 'consumedDryKg', 'consumedWetKg', 'runMoisturePercent', 'allocations', 'draws']
      and jsonb_typeof("bin_movements"."input_snapshot"->'version') = 'number'
      and jsonb_typeof("bin_movements"."input_snapshot"->'sourceRunVersion') = 'number'
      and jsonb_typeof("bin_movements"."input_snapshot"->'actorId') = 'string'
      and jsonb_typeof("bin_movements"."input_snapshot"->'consumedDryKg') = 'number'
      and jsonb_typeof("bin_movements"."input_snapshot"->'consumedWetKg') = 'number'
      and jsonb_typeof("bin_movements"."input_snapshot"->'runMoisturePercent') = 'number'
      and jsonb_typeof("bin_movements"."input_snapshot"->'allocations') = 'array'
      and jsonb_typeof("bin_movements"."input_snapshot"->'draws') = 'array'
      and length(trim("bin_movements"."reason")) > 0
      and "bin_movements"."counted_mass_kg" is null and "bin_movements"."counted_wet_mass_kg" is null
      and "bin_movements"."output_dry_delta_kg" is null
      and abs("bin_movements"."feedstock_dry_delta_kg") <= abs("bin_movements"."mass_delta_kg")
      and (("bin_movements"."movement_type"::text = 'failed_run_return' and "bin_movements"."mass_delta_kg" > 0 and "bin_movements"."feedstock_dry_delta_kg" > 0)
        or ("bin_movements"."movement_type"::text = 'failed_run_return_reversal' and "bin_movements"."mass_delta_kg" < 0
          and "bin_movements"."feedstock_dry_delta_kg" < 0 and "bin_movements"."corrects_movement_id" is not null))
    ));--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_return_fields_only" CHECK ("bin_movements"."movement_type"::text in ('failed_run_return', 'failed_run_return_reversal') or (
      "bin_movements"."source_production_run_id" is null and "bin_movements"."returned_feedstock_type_id" is null and "bin_movements"."feedstock_dry_delta_kg" is null
    ));