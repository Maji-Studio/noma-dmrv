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
ALTER TABLE "formulations" DROP CONSTRAINT "formulations_compost_ratio_range";--> statement-breakpoint
ALTER TABLE "formulation_ingredients" ADD CONSTRAINT "formulation_ingredients_formulation_id_formulations_id_fk" FOREIGN KEY ("formulation_id") REFERENCES "public"."formulations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulations" DROP COLUMN "compost_ratio";