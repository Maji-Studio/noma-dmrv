-- Remove the historical default organization only when unused, preserving shared staging data.
DO $$
DECLARE
  default_org_id CONSTANT text := 'org_dark_earth_carbon';
  reference record;
  has_reference boolean;
BEGIN
  -- These organization preferences have no FK, so protect them from concurrent writes too.
  LOCK TABLE public.users, public.session IN SHARE MODE;
  PERFORM 1 FROM public.organizations WHERE id = default_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE last_active_organization_id = default_org_id)
    OR EXISTS (SELECT 1 FROM public.session WHERE active_organization_id = default_org_id) THEN
    RETURN;
  END IF;

  FOR reference IN
    SELECT DISTINCT fk.conrelid::regclass AS table_name, child.attname AS column_name
    FROM pg_constraint AS fk
    CROSS JOIN LATERAL unnest(fk.conkey, fk.confkey) AS keys(child_attnum, parent_attnum)
    JOIN pg_attribute AS child ON child.attrelid = fk.conrelid AND child.attnum = keys.child_attnum
    JOIN pg_attribute AS parent ON parent.attrelid = fk.confrelid AND parent.attnum = keys.parent_attnum
    WHERE fk.confrelid = 'public.organizations'::regclass
      AND fk.contype = 'f'
      AND parent.attname = 'id'
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', reference.table_name, reference.column_name)
      INTO has_reference USING default_org_id;
    IF has_reference THEN
      RETURN;
    END IF;
  END LOOP;

  DELETE FROM public.organizations WHERE id = default_org_id;
END $$;
