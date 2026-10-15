DROP INDEX "samples_organization_id_credit_batch_id_sampling_time_idx";--> statement-breakpoint
ALTER TABLE "samples" ALTER COLUMN "credit_batch_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "samples_organization_id_credit_batch_id_sampling_time_idx" ON "samples" USING btree ("organization_id","credit_batch_id","sampling_time");--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "registry";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "buffer_pool_percent";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "h_to_c_org_ratio";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "mean_random_reflectance_percent";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "std_random_reflectance";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "mean_non_reactive_carbon_percent";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "std_non_reactive_carbon_percent";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "f_durable_calculated";--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "arsenic_mg_kg";--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "cadmium_mg_kg";--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "chromium_mg_kg";--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "copper_mg_kg";--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "lead_mg_kg";--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "mercury_mg_kg";--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "nickel_mg_kg";--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "zinc_mg_kg";--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "pah_total_mg_kg";--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "pcb_total_mg_kg";--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "dioxins_ng_kg";--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "furans_ng_kg";--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "r0_histogram_file_url";--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "tga_thermogram_file_url";