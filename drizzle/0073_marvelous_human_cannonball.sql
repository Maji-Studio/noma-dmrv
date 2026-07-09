CREATE UNIQUE INDEX "reactors_facility_identifier_unique" ON "reactors" USING btree ("facility_id",lower(trim("identifier")));--> statement-breakpoint
CREATE UNIQUE INDEX "storage_locations_facility_name_unique" ON "storage_locations" USING btree ("facility_id",lower(trim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "customers_name_unique" ON "customers" USING btree (lower(trim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_unique" ON "suppliers" USING btree (lower(trim("name")));