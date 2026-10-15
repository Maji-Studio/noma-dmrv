CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"facility_id" uuid,
	"occurred_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"sequence" bigserial NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"from_status" text,
	"to_status" text,
	"from_remote" text,
	"to_remote" text,
	"submission_ref" jsonb,
	"credit_batch_id" uuid,
	"production_run_id" uuid,
	"source" text NOT NULL,
	"actor_user_id" text,
	"credential_id" text,
	"request_id" text,
	"registry_at" timestamp (3) with time zone,
	"reason_code" text,
	CONSTRAINT "activity_events_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "activity_events_entity_type" CHECK ("activity_events"."entity_type" in ('removal', 'ghg_statement', 'production_run', 'biochar_product', 'lab_sample', 'order', 'delivery', 'application', 'credit_batch', 'document', 'transport_leg', 'feedstock', 'bin_movement')),
	CONSTRAINT "activity_events_action" CHECK ("activity_events"."action" in ('created', 'updated', 'deleted', 'status_changed')),
	CONSTRAINT "activity_events_source" CHECK ("activity_events"."source" in ('form', 'rest', 'mcp', 'registry', 'system', 'script')),
	CONSTRAINT "activity_events_actor" CHECK ("activity_events"."actor_user_id" is not null or "activity_events"."source" in ('system', 'registry', 'script')),
	CONSTRAINT "activity_events_status_target" CHECK ("activity_events"."action" <> 'status_changed' or "activity_events"."to_status" is not null or "activity_events"."to_remote" is not null)
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_org_entity_occurred_sequence_idx" ON "activity_events" USING btree ("organization_id","entity_type","entity_id","occurred_at","sequence");--> statement-breakpoint
CREATE INDEX "activity_events_org_batch_occurred_sequence_idx" ON "activity_events" USING btree ("organization_id","credit_batch_id","occurred_at","sequence");--> statement-breakpoint
CREATE INDEX "activity_events_org_occurred_idx" ON "activity_events" USING btree ("organization_id","occurred_at");