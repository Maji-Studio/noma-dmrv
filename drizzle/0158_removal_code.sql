ALTER TABLE "certifier_removals" ADD COLUMN "code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "certifier_removals" ADD CONSTRAINT "certifier_removals_organization_id_code_unique" UNIQUE("organization_id","code");
