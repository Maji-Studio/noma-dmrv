ALTER TABLE "samples" DROP CONSTRAINT "samples_credit_batch_id_credit_batches_id_fk";
--> statement-breakpoint
ALTER TABLE "samples" DROP COLUMN "credit_batch_id";