ALTER TABLE "documents" ADD COLUMN "upload_storage_key" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "upload_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_object_deletions" ADD COLUMN "not_before" timestamp;--> statement-breakpoint
CREATE INDEX "documents_pending_upload_expires_idx" ON "documents" USING btree ("upload_expires_at") WHERE "documents"."upload_status" = 'pending';