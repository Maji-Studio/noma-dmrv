CREATE TABLE "removal_template_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_project_id" text NOT NULL,
	"external_template_id" text NOT NULL,
	"semantic_fingerprint" text NOT NULL,
	"full_fingerprint" text NOT NULL,
	"definition" jsonb NOT NULL,
	"enrichment" jsonb NOT NULL,
	"line_sources" jsonb NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"first_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "removal_template_observations_identity_unique" UNIQUE("organization_id","provider","external_template_id","semantic_fingerprint","full_fingerprint"),
	CONSTRAINT "removal_template_observations_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "credit_batches" ADD COLUMN "removal_template_id" text;--> statement-breakpoint
ALTER TABLE "removal_template_observations" ADD CONSTRAINT "removal_template_observations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "removal_template_observations" ADD CONSTRAINT "removal_template_observations_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "removal_template_observations_latest_idx" ON "removal_template_observations" USING btree ("organization_id","provider","external_template_id","last_observed_at");