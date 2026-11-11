-- #1046: retire the dormant credit_batches.status. Nothing ever moved it off 'pending'.
-- Hand-written first part: the P0-06 durability-evidence triggers (0053, 0054, 0070)
-- read status in plpgsql, which Postgres does not track as a dependency. Left in place
-- they would fail every credit batch write once the column is gone. They only fired
-- for 'verified'/'issued' batches, which never existed, so dropping them changes no
-- behaviour; Removal submission keeps its app-side durability evidence gates.
DROP TRIGGER IF EXISTS credit_batch_durability_evidence ON credit_batches;--> statement-breakpoint
DROP TRIGGER IF EXISTS credit_batch_application_durability_evidence ON credit_batch_applications;--> statement-breakpoint
DROP TRIGGER IF EXISTS application_durability_evidence_retained ON applications;--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_credit_batch_durability_evidence();--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_durability_evidence_on_batch_link();--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_application_durability_evidence_retained();--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "status";--> statement-breakpoint
DROP TYPE "public"."credit_batch_status";
