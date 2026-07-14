CREATE TABLE "certifier_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "certifier_provider" NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"client_secret_encrypted" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "certifier_credentials_organization_id_provider_unique" UNIQUE("organization_id","provider")
);
--> statement-breakpoint
ALTER TABLE "certifier_credentials" ADD CONSTRAINT "certifier_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;