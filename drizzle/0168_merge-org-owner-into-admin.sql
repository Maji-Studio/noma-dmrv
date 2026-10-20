-- Organization roles are text columns without enum or role CHECK constraints.
UPDATE "members" SET "role" = 'admin' WHERE "role" = 'owner';
--> statement-breakpoint
UPDATE "invitations" SET "role" = 'admin' WHERE "role" = 'owner' AND "status" = 'pending';
