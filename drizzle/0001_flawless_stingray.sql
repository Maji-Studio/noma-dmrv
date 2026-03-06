UPDATE "credit_batches"
SET "certifier" = 'isometric'
WHERE "certifier" IS NULL OR "certifier" <> 'isometric';--> statement-breakpoint
ALTER TABLE "credit_batches" ALTER COLUMN "certifier" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_certifier_is_isometric" CHECK ("credit_batches"."certifier" = 'isometric');
