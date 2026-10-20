-- Normalize legacy single and comma-separated organization roles.
UPDATE "members"
SET "role" = CASE WHEN EXISTS (
  SELECT 1 FROM unnest(string_to_array("role", ',')) AS token
  WHERE btrim(token) IN ('owner', 'admin')
)
  THEN 'admin' ELSE 'member' END
WHERE "role" NOT IN ('admin', 'member');
--> statement-breakpoint
UPDATE "invitations"
SET "role" = CASE WHEN EXISTS (
  SELECT 1 FROM unnest(string_to_array("role", ',')) AS token
  WHERE btrim(token) IN ('owner', 'admin')
)
  THEN 'admin' ELSE 'member' END
WHERE "status" = 'pending' AND "role" NOT IN ('admin', 'member');
