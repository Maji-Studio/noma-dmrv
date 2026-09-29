ALTER TABLE "bin_movements" DROP CONSTRAINT "bin_movements_output_contract";--> statement-breakpoint
ALTER TABLE "biochar_products" ALTER COLUMN "placed_at" SET DATA TYPE timestamp with time zone USING ("placed_at"::timestamp AT TIME ZONE 'UTC');--> statement-breakpoint
ALTER TABLE "bin_movements" RENAME COLUMN "physical_date" TO "occurred_at";--> statement-breakpoint
ALTER TABLE "bin_movements" ALTER COLUMN "occurred_at" SET DATA TYPE timestamp with time zone USING ("occurred_at"::timestamp AT TIME ZONE 'UTC');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_output_allocations_org_delivery_idx" ON "application_output_allocations" USING btree ("organization_id","delivery_id");--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_output_contract" CHECK ("bin_movements"."output_kind" is null or (
      "bin_movements"."lane" in ('biochar', 'product') and "bin_movements"."occurred_at" is not null
      and "bin_movements"."idempotency_key" is not null and length("bin_movements"."idempotency_key") > 0
      and "bin_movements"."basis_fingerprint" is not null and "bin_movements"."input_snapshot" is not null
      and "bin_movements"."balance_before_dry_kg" >= 0 and "bin_movements"."balance_after_dry_kg" >= 0
      and "bin_movements"."balance_before_dry_kg" is not null and "bin_movements"."balance_after_dry_kg" is not null
      and "bin_movements"."output_dry_delta_kg" is not null
      and "bin_movements"."balance_after_dry_kg" = "bin_movements"."balance_before_dry_kg" + "bin_movements"."output_dry_delta_kg"
      and ("bin_movements"."output_kind" = 'reversal' or "bin_movements"."output_dry_delta_kg" <= 0)
      and length(trim("bin_movements"."reason")) > 0
      and ("bin_movements"."output_kind" not in ('reversal', 'replacement') or "bin_movements"."corrects_movement_id" is not null)
    ));