CREATE TYPE "public"."document_upload_status" AS ENUM('pending', 'uploaded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."document_visibility" AS ENUM('private', 'public');--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "file_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "storage_provider" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "storage_bucket" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "visibility" "document_visibility" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "upload_status" "document_upload_status" DEFAULT 'uploaded' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_resolvable" CHECK ("documents"."storage_key" is not null or "documents"."file_url" is not null);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_storage_fields_cohere" CHECK ("documents"."storage_key" is null or ("documents"."storage_provider" is not null and "documents"."storage_bucket" is not null));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_pending_requires_storage_key" CHECK ("documents"."upload_status" <> 'pending' or "documents"."storage_key" is not null);