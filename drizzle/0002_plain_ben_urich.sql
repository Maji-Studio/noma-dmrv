CREATE TYPE "public"."ingredient_type" AS ENUM('compost', 'mineral', 'lime', 'binder', 'amendment', 'other');--> statement-breakpoint
CREATE TABLE "formulation_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"formulation_id" uuid NOT NULL,
	"ingredient_type" "ingredient_type" NOT NULL,
	"name" text NOT NULL,
	"ratio" real,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "formulation_ingredients_ratio_range" CHECK ("formulation_ingredients"."ratio" is null or ("formulation_ingredients"."ratio" >= 0 and "formulation_ingredients"."ratio" <= 1))
);
--> statement-breakpoint
CREATE INDEX "idx_formulation_ingredients_formulation_id" ON "formulation_ingredients" USING btree ("formulation_id");--> statement-breakpoint
ALTER TABLE "formulation_ingredients" ADD CONSTRAINT "formulation_ingredients_formulation_id_formulations_id_fk" FOREIGN KEY ("formulation_id") REFERENCES "public"."formulations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "formulation_ingredients" ("formulation_id", "ingredient_type", "name", "ratio", "description", "sort_order")
SELECT "id", 'compost', 'Legacy compost ratio', "compost_ratio", 'Migrated from formulations.compost_ratio', 0
FROM "formulations"
WHERE "compost_ratio" IS NOT NULL;--> statement-breakpoint
UPDATE "formulation_ingredients" fi
SET "ratio" = f."compost_ratio"
FROM "formulations" f
WHERE fi."formulation_id" = f."id"
  AND f."compost_ratio" IS NOT NULL
  AND fi."ratio" IS NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "formulations" f
    WHERE f."compost_ratio" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "formulation_ingredients" fi
        WHERE fi."formulation_id" = f."id"
          AND fi."ratio" = f."compost_ratio"
      )
  ) THEN
    RAISE EXCEPTION 'Backfill failed: missing formulation_ingredients rows for formulations.compost_ratio values';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "formulations" DROP CONSTRAINT "formulations_compost_ratio_range";--> statement-breakpoint
ALTER TABLE "formulations" DROP COLUMN "compost_ratio";
