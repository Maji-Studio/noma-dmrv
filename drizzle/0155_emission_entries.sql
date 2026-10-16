CREATE TABLE "emission_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"credit_batch_id" uuid NOT NULL,
	"removal_template_id" text NOT NULL,
	"component_id" text NOT NULL,
	"input_shape" jsonb NOT NULL,
	"line_rule" text NOT NULL,
	"observation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"confirmed_for_removal_id" uuid,
	"occurred_on" date NOT NULL,
	"note" text,
	"created_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"content_revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"sent_by_removal_id" uuid,
	"send_reserved_by_submission_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emission_entries_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "emission_entries_kind" CHECK ("emission_entries"."kind" in ('value', 'zero')),
	CONSTRAINT "emission_entries_rule" CHECK ("emission_entries"."line_rule" in ('additive', 'single')),
	CONSTRAINT "emission_entries_zero_owner" CHECK (("emission_entries"."kind" = 'zero') = ("emission_entries"."confirmed_for_removal_id" is not null)),
	CONSTRAINT "emission_entries_revisions" CHECK ("emission_entries"."version" > 0 and "emission_entries"."content_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "emission_entry_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"input_key" text NOT NULL,
	"magnitude" numeric NOT NULL,
	"unit" text NOT NULL,
	"mass_distance_detail" jsonb,
	CONSTRAINT "emission_entry_values_input_unique" UNIQUE("entry_id","input_key"),
	CONSTRAINT "emission_entry_values_nonnegative" CHECK ("emission_entry_values"."magnitude" >= 0 and "emission_entry_values"."magnitude" <> 'NaN'::numeric and "emission_entry_values"."magnitude" <> 'Infinity'::numeric)
);
--> statement-breakpoint
ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_entity_type";--> statement-breakpoint
ALTER TABLE "emission_entries" ADD CONSTRAINT "emission_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_entries" ADD CONSTRAINT "emission_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_entries" ADD CONSTRAINT "emission_entries_credit_batch_id_organization_id_credit_batches_id_organization_id_fk" FOREIGN KEY ("credit_batch_id","organization_id") REFERENCES "public"."credit_batches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_entries" ADD CONSTRAINT "emission_entries_observation_id_organization_id_removal_template_observations_id_organization_id_fk" FOREIGN KEY ("observation_id","organization_id") REFERENCES "public"."removal_template_observations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_entries" ADD CONSTRAINT "emission_entries_sent_by_removal_id_organization_id_certifier_removals_id_organization_id_fk" FOREIGN KEY ("sent_by_removal_id","organization_id") REFERENCES "public"."certifier_removals"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_entries" ADD CONSTRAINT "emission_entries_confirmed_for_removal_id_organization_id_certifier_removals_id_organization_id_fk" FOREIGN KEY ("confirmed_for_removal_id","organization_id") REFERENCES "public"."certifier_removals"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_entries" ADD CONSTRAINT "emission_entries_send_reserved_by_submission_id_organization_id_certification_submissions_id_organization_id_fk" FOREIGN KEY ("send_reserved_by_submission_id","organization_id") REFERENCES "public"."certification_submissions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_entry_values" ADD CONSTRAINT "emission_entry_values_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_entry_values" ADD CONSTRAINT "emission_entry_values_entry_id_organization_id_emission_entries_id_organization_id_fk" FOREIGN KEY ("entry_id","organization_id") REFERENCES "public"."emission_entries"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "emission_entries_org_batch_idx" ON "emission_entries" USING btree ("organization_id","credit_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "emission_entries_single_value_unique" ON "emission_entries" USING btree ("credit_batch_id","removal_template_id","component_id") WHERE "emission_entries"."line_rule" = 'single' and "emission_entries"."kind" = 'value' and "emission_entries"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "emission_entries_confirmed_zero_unique" ON "emission_entries" USING btree ("confirmed_for_removal_id","credit_batch_id","component_id") WHERE "emission_entries"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_entity_type" CHECK ("activity_events"."entity_type" in ('emission_entry', 'removal', 'ghg_statement', 'production_run', 'biochar_product', 'lab_sample', 'order', 'delivery', 'application', 'credit_batch', 'document', 'transport_leg', 'feedstock', 'bin_movement'));