DROP TABLE "api_audit_events" CASCADE;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "operation_id" text;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "version_before" integer;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "version_after" integer;