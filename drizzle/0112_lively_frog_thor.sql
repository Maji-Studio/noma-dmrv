ALTER TABLE "certifier_biochar_applications" RENAME COLUMN "gate_reason" TO "drift_reason";--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" DROP CONSTRAINT "certifier_biochar_applications_payload_pair";--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" DROP CONSTRAINT "certifier_biochar_applications_confirmed_identity";--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_truck_mass_on_arrival_non_negative";--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_truck_mass_on_departure_non_negative";--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_truck_mass_arrival_gte_departure";--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ALTER COLUMN "lifecycle_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ALTER COLUMN "lifecycle_status" SET DEFAULT 'creating'::text;--> statement-breakpoint
DROP TYPE "public"."certifier_biochar_application_lifecycle_status";--> statement-breakpoint
CREATE TYPE "public"."certifier_biochar_application_lifecycle_status" AS ENUM('creating', 'confirmed', 'deleted');--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ALTER COLUMN "lifecycle_status" SET DEFAULT 'creating'::"public"."certifier_biochar_application_lifecycle_status";--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ALTER COLUMN "lifecycle_status" SET DATA TYPE "public"."certifier_biochar_application_lifecycle_status" USING "lifecycle_status"::"public"."certifier_biochar_application_lifecycle_status";--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ALTER COLUMN "submitted_payload" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ALTER COLUMN "payload_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" DROP COLUMN "truck_mass_on_arrival_kg";--> statement-breakpoint
ALTER TABLE "deliveries" DROP COLUMN "truck_mass_on_departure_kg";--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ADD CONSTRAINT "certifier_biochar_applications_confirmed_identity" CHECK ("certifier_biochar_applications"."lifecycle_status" <> 'confirmed' or "certifier_biochar_applications"."external_application_id" is not null);