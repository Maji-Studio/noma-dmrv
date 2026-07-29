CREATE TABLE "certifier_ghg_statement_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"ghg_statement_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"lifecycle" text DEFAULT 'prepared' NOT NULL,
	"source_fingerprint" text NOT NULL,
	"content_checksum_sha256" text NOT NULL,
	"frozen_input" jsonb NOT NULL,
	"report_model" jsonb NOT NULL,
	"reviewed_narratives" jsonb NOT NULL,
	"preparation_idempotency_key" uuid NOT NULL,
	"verifier_token_hash" text NOT NULL,
	"prepared_by" text NOT NULL,
	"prepared_at" timestamp NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"submitted_by" text,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "certifier_ghg_statement_reports_statement_version_unique" UNIQUE("ghg_statement_id","version"),
	CONSTRAINT "certifier_ghg_statement_reports_statement_preparation_key_unique" UNIQUE("ghg_statement_id","preparation_idempotency_key"),
	CONSTRAINT "certifier_ghg_statement_reports_document_id_unique" UNIQUE("document_id"),
	CONSTRAINT "certifier_ghg_statement_reports_version_positive" CHECK ("certifier_ghg_statement_reports"."version" > 0),
	CONSTRAINT "certifier_ghg_statement_reports_lifecycle_check" CHECK ("certifier_ghg_statement_reports"."lifecycle" in ('prepared', 'approved', 'submitted')),
	CONSTRAINT "certifier_ghg_statement_reports_approval_coheres" CHECK (("certifier_ghg_statement_reports"."approved_by" is null) = ("certifier_ghg_statement_reports"."approved_at" is null)),
	CONSTRAINT "certifier_ghg_statement_reports_submission_coheres" CHECK (("certifier_ghg_statement_reports"."submitted_by" is null) = ("certifier_ghg_statement_reports"."submitted_at" is null)),
	CONSTRAINT "certifier_ghg_statement_reports_lifecycle_timestamps_check" CHECK ((
        ("certifier_ghg_statement_reports"."lifecycle" = 'prepared' and "certifier_ghg_statement_reports"."approved_at" is null and "certifier_ghg_statement_reports"."submitted_at" is null)
        or ("certifier_ghg_statement_reports"."lifecycle" = 'approved' and "certifier_ghg_statement_reports"."approved_at" is not null and "certifier_ghg_statement_reports"."submitted_at" is null)
        or ("certifier_ghg_statement_reports"."lifecycle" = 'submitted' and "certifier_ghg_statement_reports"."approved_at" is not null and "certifier_ghg_statement_reports"."submitted_at" is not null)
      ))
);
--> statement-breakpoint
ALTER TABLE "certifier_ghg_statement_reports" ADD CONSTRAINT "certifier_ghg_statement_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_ghg_statement_reports" ADD CONSTRAINT "certifier_ghg_statement_reports_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_ghg_statement_reports" ADD CONSTRAINT "certifier_ghg_statement_reports_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_ghg_statement_reports" ADD CONSTRAINT "certifier_ghg_statement_reports_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_ghg_statement_reports" ADD CONSTRAINT "certifier_ghg_statement_reports_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_ghg_statements" ADD CONSTRAINT "certifier_ghg_statements_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "certifier_ghg_statement_reports" ADD CONSTRAINT "certifier_ghg_statement_reports_ghg_statement_id_organization_id_certifier_ghg_statements_id_organization_id_fk" FOREIGN KEY ("ghg_statement_id","organization_id") REFERENCES "public"."certifier_ghg_statements"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certifier_ghg_statement_reports_organization_id_idx" ON "certifier_ghg_statement_reports" USING btree ("organization_id");
