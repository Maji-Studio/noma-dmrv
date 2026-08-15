ALTER TABLE "credit_batches" DROP CONSTRAINT "credit_batches_removal_id_certifier_removals_id_fk";
--> statement-breakpoint
DROP INDEX "credit_batches_removal_id_idx";--> statement-breakpoint
ALTER TABLE "credit_batch_applications" ADD COLUMN "allocated_wet_mass_kg" numeric(14, 3) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_batch_applications" ADD COLUMN "allocated_dry_mass_kg" numeric(14, 3) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_batch_applications" ADD COLUMN "removal_id" uuid;--> statement-breakpoint
ALTER TABLE "certifier_removals" ADD CONSTRAINT "certifier_removals_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "credit_batch_applications" ADD CONSTRAINT "credit_batch_applications_removal_id_organization_id_certifier_removals_id_organization_id_fk" FOREIGN KEY ("removal_id","organization_id") REFERENCES "public"."certifier_removals"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_batch_applications_removal_id_idx" ON "credit_batch_applications" USING btree ("removal_id");--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "removal_id";--> statement-breakpoint
ALTER TABLE "credit_batch_applications" ADD CONSTRAINT "credit_batch_applications_allocated_mass_non_negative" CHECK ("credit_batch_applications"."allocated_wet_mass_kg" >= 0 and "credit_batch_applications"."allocated_dry_mass_kg" >= 0);--> statement-breakpoint
ALTER TABLE "credit_batch_applications" ALTER COLUMN "allocated_wet_mass_kg" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "credit_batch_applications" ALTER COLUMN "allocated_dry_mass_kg" DROP DEFAULT;
