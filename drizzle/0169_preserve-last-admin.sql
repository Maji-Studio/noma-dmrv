CREATE FUNCTION preserve_last_organization_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role <> 'admin' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role = 'admin' THEN
    RETURN NULL;
  END IF;

  -- Serialize all losses of Admin membership, including plugin writes.
  -- Compatible with FK KEY SHARE locks held by keyed API-key issuance.
  -- A cascading organization deletion has already removed the parent row.
  PERFORM id FROM organizations WHERE id = OLD.organization_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM members
    WHERE organization_id = OLD.organization_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'An organization must keep at least one Admin'
      USING ERRCODE = '23514', CONSTRAINT = 'members_last_admin';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER members_last_admin
AFTER UPDATE OF role OR DELETE ON members
FOR EACH ROW EXECUTE FUNCTION preserve_last_organization_admin();
