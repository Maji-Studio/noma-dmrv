ALTER TABLE "credit_batches" DROP CONSTRAINT "credit_batches_certifier_is_isometric";--> statement-breakpoint
CREATE INDEX "production_run_readings_run_timestamp_idx" ON "production_run_readings" USING btree ("production_run_id","timestamp");--> statement-breakpoint
CREATE INDEX "transport_legs_entity_type_entity_id_idx" ON "transport_legs" USING btree ("entity_type","entity_id");--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_certifier_is_isometric" CHECK ("credit_batches"."certifier" is null or "credit_batches"."certifier" = 'isometric');