ALTER TABLE "credit_batches" DROP CONSTRAINT "credit_batches_removal_id_certifier_removals_id_fk";
--> statement-breakpoint
DROP INDEX "credit_batches_removal_id_idx";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "removal_id";