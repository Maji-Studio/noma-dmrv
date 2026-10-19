CREATE TABLE "api_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"oauth_client_id" text,
	"operation_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_ids" text[] NOT NULL,
	"changed_fields" text[] NOT NULL,
	"version_before" integer,
	"version_after" integer,
	"request_id" text NOT NULL,
	"outcome_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_rate_limit_buckets" (
	"bucket_key" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"refilled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_api_access" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"changed_by_user_id" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_audit_events" ADD CONSTRAINT "api_audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_api_access" ADD CONSTRAINT "organization_api_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_audit_events_org_created_idx" ON "api_audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "api_rate_limit_buckets_refilled_at_idx" ON "api_rate_limit_buckets" USING btree ("refilled_at");