ALTER TABLE "transport_legs" ALTER COLUMN "entity_type" SET DATA TYPE text;--> statement-breakpoint
DELETE FROM "transport_legs" WHERE "entity_type" = 'delivery';--> statement-breakpoint
DROP TYPE "public"."transport_entity_type";--> statement-breakpoint
CREATE TYPE "public"."transport_entity_type" AS ENUM('feedstock', 'biochar', 'sample');--> statement-breakpoint
ALTER TABLE "transport_legs" ALTER COLUMN "entity_type" SET DATA TYPE "public"."transport_entity_type" USING "entity_type"::"public"."transport_entity_type";
