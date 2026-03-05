-- Migrate existing delivery statuses to new values before changing the enum
-- "scheduled" and "processing" -> "upcoming", "delivered" stays as "delivered"
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
UPDATE "deliveries" SET "status" = 'upcoming' WHERE "status" IN ('scheduled', 'processing');--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DEFAULT 'upcoming'::text;--> statement-breakpoint
DROP TYPE "public"."delivery_status";--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('upcoming', 'delivered');--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DEFAULT 'upcoming'::"public"."delivery_status";--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DATA TYPE "public"."delivery_status" USING "status"::"public"."delivery_status";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "status";--> statement-breakpoint
DROP TYPE "public"."order_status";
