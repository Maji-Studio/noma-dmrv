CREATE TABLE "certifier_production_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "certifier_provider" DEFAULT 'isometric' NOT NULL,
	"credit_batch_id" uuid NOT NULL,
	"external_production_batch_id" text NOT NULL,
	"supplier_reference" text NOT NULL,
	"mass_kg" numeric(14, 3) NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "certifier_production_batches_provider_credit_batch_unique" UNIQUE("provider","credit_batch_id"),
	CONSTRAINT "certifier_production_batches_provider_reference_unique" UNIQUE("provider","supplier_reference"),
	CONSTRAINT "certifier_production_batches_provider_external_id_unique" UNIQUE("provider","external_production_batch_id"),
	CONSTRAINT "certifier_production_batches_provider_is_isometric" CHECK ("certifier_production_batches"."provider" = 'isometric'),
	CONSTRAINT "certifier_production_batches_mass_positive" CHECK ("certifier_production_batches"."mass_kg" > 0),
	CONSTRAINT "certifier_production_batches_window_chronology" CHECK ("certifier_production_batches"."started_on" <= "certifier_production_batches"."ended_on")
);
--> statement-breakpoint
ALTER TABLE "certifier_production_batches" ADD CONSTRAINT "certifier_production_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_production_batches" ADD CONSTRAINT "certifier_production_batches_credit_batch_id_organization_id_credit_batches_id_organization_id_fk" FOREIGN KEY ("credit_batch_id","organization_id") REFERENCES "public"."credit_batches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certifier_production_batches_organization_id_idx" ON "certifier_production_batches" USING btree ("organization_id");