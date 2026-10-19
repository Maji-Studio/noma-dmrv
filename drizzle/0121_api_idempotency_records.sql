CREATE TABLE "api_idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"outcome" jsonb,
	"outcome_schema_version" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "api_idempotency_records_org_credential_key_unique" UNIQUE("organization_id","credential_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "api_idempotency_records" ADD CONSTRAINT "api_idempotency_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_idempotency_records_expires_at_idx" ON "api_idempotency_records" USING btree ("expires_at");