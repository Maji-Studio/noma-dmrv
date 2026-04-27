CREATE TYPE "public"."loss_entity_type" AS ENUM('production_run', 'delivery', 'application', 'storage');--> statement-breakpoint
CREATE TYPE "public"."loss_type_code" AS ENUM('residue', 'spillage', 'runoff', 'volatilization', 'transport_loss', 'other');--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('loss_records') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM loss_records
    WHERE entity_type NOT IN ('production_run', 'delivery', 'application', 'storage')
  ) THEN
    RAISE EXCEPTION 'Migration blocked: loss_records contains entity_type values not in loss_entity_type enum. Run: SELECT DISTINCT entity_type FROM loss_records WHERE entity_type NOT IN (''production_run'', ''delivery'', ''application'', ''storage'')';
  END IF;

  IF EXISTS (
    SELECT 1 FROM loss_records
    WHERE loss_type_code NOT IN ('residue', 'spillage', 'runoff', 'volatilization', 'transport_loss', 'other')
  ) THEN
    RAISE EXCEPTION 'Migration blocked: loss_records contains loss_type_code values not in loss_type_code enum. Run: SELECT DISTINCT loss_type_code FROM loss_records WHERE loss_type_code NOT IN (''residue'', ''spillage'', ''runoff'', ''volatilization'', ''transport_loss'', ''other'')';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "loss_records" ALTER COLUMN "entity_type" SET DATA TYPE "public"."loss_entity_type" USING "entity_type"::"public"."loss_entity_type";--> statement-breakpoint
ALTER TABLE "loss_records" ALTER COLUMN "loss_type_code" SET DATA TYPE "public"."loss_type_code" USING "loss_type_code"::"public"."loss_type_code";--> statement-breakpoint
ALTER TABLE "biochar_storage_inventory" ADD CONSTRAINT "biochar_storage_inventory_no_self_transfer" CHECK ("biochar_storage_inventory"."source_inventory_id" IS NULL OR "biochar_storage_inventory"."source_inventory_id" <> "biochar_storage_inventory"."id");