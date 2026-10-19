ALTER TYPE "public"."documentation_type" ADD VALUE 'reflectance_histogram' BEFORE 'delivery_receipt';--> statement-breakpoint
ALTER TABLE "feedstocks" DROP CONSTRAINT "feedstocks_feedstock_delivery_id_feedstock_deliveries_id_fk";
--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "feedstock_delivery_id";--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "feedstock_deliveries" CASCADE;--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_distance_km_override_non_negative";--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_distance_km_override_positive" CHECK ("deliveries"."distance_km_override" is null or "deliveries"."distance_km_override" > 0);
