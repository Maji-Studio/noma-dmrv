# Production-run natural-key uniqueness + reactor time-window overlap (#259)

Grilled and decided with Kenji on 2026-07-09. Implemented on `fix/production-run-unique-overlap`.

## Decisions (final)

1. **`end_time` is nullable** — `NULL` = run not ended yet. The old silent `endTime = startTime` coercion (zero-duration windows, the misleading readings-importer error from #207's bug half) is removed. `status = 'complete'` requires an end time (server + client guard).
2. **The `date` column is dropped.** All consumers derive from `start_time`. The form captures explicit **start date + time** (required) and **end date + time** (optional pair) — overnight runs simply set end date = next day; there is no implicit day-rollover.
3. **CHECK**: `end_time IS NULL OR end_time > start_time`.
4. **Partial unique index** on `(reactor_id, start_time)` `WHERE status <> 'void' AND archived_at IS NULL` — void (record-created-in-error) and archived runs don't block re-entry. When #254 renames `void → cancelled`, its migration carries this index along.
5. **Overlap rule** (server-side, create and edit, inside the transaction, same-reactor writers serialized via `pg_advisory_xact_lock(hashtext(reactor_id))`): candidate C (start `s`, end `e` nullable) conflicts with existing X iff

   ```sql
   X.status <> 'void' AND X.archived_at IS NULL AND X.id <> self
   AND s < COALESCE(X.end_time, 'infinity')
   AND X.start_time < COALESCE(e, 'infinity')
   ```

   One predicate encodes everything: closed windows intersect on `[start, end)`; an **open run occupies `[start, ∞)`** — stakeholder rule: no new run may be recorded at/after an unfinished run's start until it is closed (backfilling a run that fully precedes the open run is allowed); two open runs on one reactor always conflict.
6. **Friendly errors only** (#251): messages name the conflicting run's code and window; Postgres `23505` on the new index is caught as a race backstop and mapped to the same message. The failure arm of `ActionResult` gained an optional `conflict` payload so the form can link to the conflicting run from a field-level error.
7. **Rejected alternatives** (from #259): soft duplicate warning (double-count risk survives), separate idempotency key (the natural key already collides retries). Point-in-time semantics for open runs was rejected in grilling in favor of `[start, ∞)`.

## Downstream guards

- Certification aggregation and telemetry throw loudly (naming the run code) if a NULL-`end_time` run ever reaches them — only complete runs should.
- The readings importer rejects open runs with a clear "run has no end time yet" message.
- List UI shows `—` for an open end; the displayed date derives from `start_time`.

## Notes

- No production data exists — schema changes shipped as a fresh migration + reseed.
- `date`-column consumers reworked: production-run queries (filter/sort), credit-batch windows/membership, dashboards, biochar products, readings importer, seed data.
