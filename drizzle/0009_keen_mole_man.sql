ALTER TABLE "suppliers" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "suppliers"
SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1)
WHERE "user_id" IS NULL
  AND (SELECT COUNT(*) FROM "users") = 1;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_locations_supplier_id_idx" ON "supplier_locations" USING btree ("supplier_id");
