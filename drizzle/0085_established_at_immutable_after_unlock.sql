-- ADR 0017 — operational-start (`established_at`) correction path, DB backstop.
--
-- Owners/admins may fix a back-entered process's `established_at` so samples that
-- predate the auto-created row rejoin the baseline window and the facility can
-- reach Method B. That correction is only legitimate BEFORE Method B unlocks:
-- once `method_b_unlocked_at` is stamped, the baseline window `[established_at,
-- method_b_unlocked_at)` is fixed history, and moving `established_at` would
-- retroactively redraw which samples were the ≥30 baseline the unlock relied on.
--
-- The app guard (`setProcessOperationalStart`) and its `method_b_unlocked_at IS
-- NULL` UPDATE predicate already refuse a post-unlock edit; this trigger closes
-- the same hole against direct SQL. It fires only when `established_at` actually
-- changes on an already-unlocked row, so ordinary post-unlock updates (e.g.
-- `updated_at`) are unaffected.

CREATE OR REPLACE FUNCTION enforce_established_at_immutable_after_unlock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.method_b_unlocked_at IS NOT NULL
     AND NEW.established_at IS DISTINCT FROM OLD.established_at THEN
    RAISE EXCEPTION
      'Production process % has unlocked Method B: established_at is fixed history and cannot change (ADR 0017).',
      NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS production_process_established_at_immutable ON production_processes;
--> statement-breakpoint
CREATE TRIGGER production_process_established_at_immutable
  BEFORE UPDATE ON production_processes
  FOR EACH ROW
  EXECUTE FUNCTION enforce_established_at_immutable_after_unlock();
