-- Supersedes the reactor-level Method B baseline guard from migration 0052
-- (function enforce_reactor_method_b_minimum_samples + trigger
-- reactor_method_b_minimum_samples).
--
-- ADR 0015 moved `sampling_method` OFF `reactors` onto `production_processes`:
-- the Biochar Protocol (§8.3.1) scopes the Method A/B regime to
-- (feedstock × conditions), which SPANS reactors — reactor identity is not part
-- of that boundary. Migration 0056 dropped `reactors.sampling_method`, so
-- 0052's trigger function — which reads `NEW.sampling_method` on `reactors` —
-- now references a column that no longer exists and would raise on EVERY reactor
-- INSERT/UPDATE (including the reseed).
--
-- DEC runs Method A everywhere and Phase 1 ships no path that sets a process to
-- method_b (the super-admin unlock is deferred to ADR 0016), so this baseline
-- backstop has nothing left to guard. We DROP it here. The process-grain
-- equivalent — count a production process's samples since `established_at` via
-- credit_batches → samples — ships with the deferred Method-B unlock.
--
-- Hand-written: drizzle-kit cannot emit trigger/function DDL. Never edit an
-- applied migration; this new migration supersedes 0052's DB objects.

DROP TRIGGER IF EXISTS reactor_method_b_minimum_samples ON reactors;
--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_reactor_method_b_minimum_samples();
