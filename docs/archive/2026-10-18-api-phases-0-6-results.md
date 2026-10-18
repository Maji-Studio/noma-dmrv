# Phase 0 to 6 results

Historical implementation results for the data-entry API phases 0 to 6 (sections 15 to 24 of the plan). Read alongside
[the active data-entry API plan](../plans/2026-10-06-data-entry-api.md).

## 15. Phase 0 results (2026-10-06)

Branch `feat/data-entry-api-spike` (PR #919). The exit criteria in section 10 are met except two parts noted below: the intake-lookup schemas (deferred to Phase 2, where the lookup endpoints are defined) and the full transport-neutral outcome (partial). The tests named below are the evidence.

**(a) Schemas.** `toOperationJsonSchema` (`src/lib/operations/json-schema.ts`) is the one generator for OpenAPI and MCP. Decisions:
- Constraint metadata is derived, not hand-written: `pipeToCanonicalNumber(input, canonical)` in `src/schemas/helpers.ts` reads the bounds from the canonical schema's own JSON Schema, so the rule values stay in the Zod chain. Applied to the mass, stored-percent and soil-temperature helpers and the feedstock moisture field.
- One rule replaces per-field overrides for optionality: a property is advertised as required exactly when its schema rejects `undefined` at runtime.
- `z.date()` publishes as `format: date-time`; `""` form-encoding branches are dropped from the published contract (runtime leniency stays).
- `calendarDateSchema()` is the strict business-date decoder: `YYYY-MM-DD` only, decoded to UTC midnight (the existing persisted convention, `toDateInputValue`), and a `Date` is accepted only at UTC midnight so a server action can re-validate the form's value. Feedstock delivery dates use it now. Still on `new Date(val)`, converted when each entity is exposed: `src/schemas/samples.ts` (`:174`, `:188`, `:249`, `:259`, `:350`, `:362`), `production-incidents.ts:26`, `production-runs.ts` (`:233`, `:250`, `:504`, `:518`).
- Feedstock create and update contracts are asserted field by field against a hand-written expectation (`src/lib/operations/json-schema.test.ts`), calendar cases in `src/schemas/calendar-date.test.ts`.
- The production-run form schema generates correct numbers, enums and required fields, but its timing fields are form-shaped (`date-time | string`) and it still advertises the refused legacy `feedstockWetMassKg`. Phase 4 gives production runs an API input schema (instant or facility-local `{ date, time }`, no legacy fields) rather than publishing the form schema.
- **DST policy changed from the draft:** a fall-back (ambiguous) wall clock is rejected, not resolved to the earlier instant, because `combineDateAndTime` already rejects it for the UI with a documented reason (silently choosing one shifts a run window by an hour). Section 3.2 is updated. Confirmed by Kenji 2026-10-07 (section 13, item 7).

**(b) Runner-owned transaction.** `runOperation` (`src/lib/operations/runner.ts`), `log_feedstock_delivery` (`src/lib/operations/feedstocks.ts`), and the connection and transaction mechanics in `src/data-access/owned-transaction.ts` (moved out of the operations layer after review).
- The runner checks out its own connection instead of `db.transaction`: Drizzle 0.45 releases a client to the pool even when ROLLBACK failed. A client whose BEGIN, ROLLBACK or COMMIT failed is destroyed.
- Phase 1a moves all three feedstock write actions onto the runner, using its in-process seam to preserve native Dates. Create, update and delete read and write through the runner's `tx`; the self-transacting wrappers are removed.
- `withAutoCodes` (`src/data-access/code-generator.ts`) runs each generated-code attempt in a savepoint and re-reads the maximum on retry. Feedstock intake previously generated codes before its transaction with no retry, so a concurrent intake failed on the unique index; it now recovers.
- Evidence: `tests/operation-runner.test.ts` runs with the global pool at size 1, so any stray `db` read inside the transaction hits the 10 s connection timeout (checked by reintroducing one: the test fails). `tests/operation-auto-code.test.ts` forces a collision on the unique index and gets the next code.

**(c) Idempotency.** Table `api_idempotency_records` (migration 0121), claim in `src/data-access/api-idempotency-records.ts`.
- Claim budget 500 ms (`IDEMPOTENCY_CLAIM_LOCK_TIMEOUT_MS`); `RESET lock_timeout` after the claim so a later domain-lock timeout is never "still running".
- An expired record is deleted and reclaimed inside the claiming transaction. The purge job is not built (Phase 2).
- The stored outcome is a success envelope `{ kind: "success", data }`, so a write that returns nothing still replays; `outcome IS NULL` only ever means an uncommitted claim. `runOperation` returns the JSON representation on every path (typed `Jsonified<Output>`), so a first response and its replay are identical. Still missing from the plan's transport-neutral outcome: the outcome code and entity ids; Phase 2 output schemas add them with a schema-version bump.
- At pool size 1 a duplicate cannot reach PostgreSQL before its deadline (it waits for the first request's connection), so the runner keeps an **in-process set of in-flight keys** and answers a same-instance duplicate with 409 at once. Cross-instance duplicates are answered by the PostgreSQL claim. The set is an early answer, never the guarantee.
- Evidence: `tests/operation-idempotency.test.ts` (duplicate answered before the first commits, hand-over on rollback, reuse with a different payload, expiry, credential namespaces, dry-run rules, failure leaves no record, lost COMMIT acknowledgement reported as `outcome_unknown` and recovered by replay).

**(e) Deadline.** `OPERATION_DEADLINE_MS` 10 s covers pool acquisition; `statement_timeout` and, in Phase 1a, `transaction_timeout` are set to the remaining budget at BEGIN; the budget is checked again before COMMIT; a COMMIT failure is `outcome_unknown` unless its SQLSTATE class (23, 40) or transaction timeout (`25P04`) proves a rollback. Evidence: the deadline cases in `tests/operation-runner.test.ts` (queued past the deadline never writes, one long statement, many short statements, after-commit hooks skipped on dry run and isolated from the write).

**(d) MCP and libraries.**
- `mcp-handler` 2.2.0 + `@modelcontextprotocol/server` 2.3.0, pinned exactly (2.3.1 was inside the 3-day `minimumReleaseAge`). Stateless; GET and DELETE answer 405.
- The handler does **not** validate `Origin`; the route wraps it with the server package's `originValidationResponse` (non-browser clients send no `Origin` and pass). Covered by `src/app/api/mcp/route.test.ts`.
- `toToolSchema` (`src/lib/operations/mcp-schema.ts`) makes `tools/list` publish `toOperationJsonSchema`, not Zod's own converter.
- The SDK validates tool arguments itself and answers a failure as an `isError` result whose only content is text ("Input validation error: ... deliveryDate: Enter a valid date."), with no `code` or `issues[]`. Phase 3 write tools therefore publish the contract through `toToolSchema` but let arguments through to `runOperation`, whose decode returns the structured `validation_failed` error the plan requires. Unknown tools are JSON-RPC errors (-32602), as section 5 expects.
- Interop: Claude Code 2.1.290 connected over HTTP to the spike route on a local dev server, called both tools, converted "4.2 tonnes" to `4200` kg from the field description, sent `deliveryDate` as `2026-10-06`, and surfaced the date error verbatim.
- The route answers 404 in production builds (staging included) because it checks no credential; the proxy lets exactly `/api/mcp` through before the session lookup (`tests/middleware.test.ts` covers `/api/mcpx` and `/api/mcp/tools`).

**Better Auth API keys (Phase 2 input).** The original review compared `@better-auth/api-key` 1.6.23 with `better-auth` 1.6.23; core is now pinned to 1.7.7 (`apiKey` is not exported from `better-auth/plugins` in 1.6). Usable on 1.6, but Phase 2 builds on 1.7.7 (section 13, items 15 and 17); the 1.7.7 plugin behaves the same. What Phase 2 must configure or wrap:
- `references: "organization"` binds the key to an organization and checks membership plus the organization's `apiKey` create permission on create.
- Clients cannot set `permissions` (server-only), so keys are created by our own server action through `auth.api.createApiKey`, which is also where the scope allowlist and the role check live.
- Expiry is optional by default: set `keyExpiration.defaultExpiresIn` and `maxExpiresIn`. The client `update` endpoint may clear `expiresAt` with a falsy `expiresIn`; block client updates.
- Session emulation refuses organization keys anyway; authenticate with `verifyApiKey` in `resolveApiContext`.
- The plugin's default rate limit (10 requests per 24 h per key) must be replaced by the section 4 limiter.

**Review.** gpt-6-astra reviewed the branch and raised two P2s, both fixed with regression tests: after-commit hooks now run after the connection is released (a hook reading through `db` at pool size 1 waited on the runner's own connection), and deleting an expired idempotency record runs under the claim budget, so a concurrent reclaim answers `idempotency_in_progress` instead of a raw lock timeout.

**Review suite (round 1, head `98cea6b8`).** No P1s. Fixed: null results not replayable, keyed and unkeyed result shapes differing, data-access importing the error type from the operations layer (now `src/lib/domain-errors.ts`), transaction mechanics outside data-access, raw errors in the hook-failure log, the hard-coded Retry-After, the duplicated auto-code retry loop, a non-UTC calendar-date test, and `docs/forms.md` gained `calendarDateSchema`. Phase 1a adds `transaction_timeout` on PostgreSQL 18 to terminate transactions whose short statements cumulatively exceed the remaining budget. SQLSTATE `25P04` maps to `deadline_exceeded`, and the terminated client is destroyed. Deferred to Phase 2: rejecting unknown keys on API mutations (the runner still strips them, as the forms do), and the intake-lookup schemas.

**Review suite (round 2, head `d223450e`).** No P1s; last round under the cutoff. Fixed: the auto-code test's lock-wait observer now matches only a backend blocked by the competitor's pid (it could match another suite's insert and pass without a collision), the MCP route reads `env` instead of `process.env`, and `docs/auth.md`, `docs/architecture.md` and `docs/schema-overview.md` gained the `/api/mcp` carve-out and `api.ts`. Not changed: the runner's pre-commit deadline check looks duplicated by the owned transaction's, but it also covers dry runs, which roll back before the owned check runs; Phase 1a adds the whole-transaction server deadline described above. Deferred to Phase 2: a date-only field such as `deliveryDate` replays as a full ISO instant (`2026-10-06T00:00:00.000Z`) because `toJson` serializes the `Date`; Phase 2 output schemas serialize business dates as `YYYY-MM-DD`, and the first and replayed responses already match.

**Phase 1a starts from:** moving the feedstock actions onto `runOperation` (and updating `docs/architecture.md`, which still names `fn/**/*-core.ts`), the registry, `DomainError` codes and `issues` in `ActionResult`, the `version` column, and CI on the migration chain.

## 16. Phase 2 results (2026-10-08)

Four PRs: 2a #925 (API keys, `/api/v1/me`, the credential resolver), 2b-1 #929 (audit log, Postgres rate limits, kill switches, purge cron), 2b-2 #930 (feedstock REST and intake lookups), 2b-3 #932 (OpenAPI document, `llms.txt`, `oasdiff` and client check in CI; replaced #931). The section 10 exit suites are green: outcome (`tests/api-feedstocks.test.ts`), action-vs-REST parity (`tests/api-feedstocks-parity.test.ts`), BOLA (foreign ids in path, body, filters and cursors), idempotency and stock races (`tests/api-feedstocks-concurrency.test.ts`) and version cascade (`tests/api-feedstocks-version-cascade.test.ts`).

**What review changed** (Codex cross-checks and review-suite rounds on #930 and #931/#932):
- Foreign references answer 404 with a JSON Pointer instead of 422; data-access throws `DomainError("not_found")` with `issues` (#930).
- The request deadline starts before authentication and is checked again before every handler (#930).
- DELETE refuses feedstocks archived with their facility, like PATCH. It reads an optional body that must be an empty JSON object, and the contract publishes that body with 413/415 (#930, #932).
- Vehicles and drivers gained `version` (migration `0129`), so every lookup detail read returns a strong ETag. Dry runs return no ETag (#930).
- Routes and the OpenAPI generator share one `resourceQueries` map, so published query parameters cannot drift from runtime parsing. operationIds follow the section 5 MCP names, and published limits, prefixes and body sizes come from `@/config` (#932).
- Not changed: `null` clears for `massWetKg`/`moistureContentPercent` (the shared update schema forbids them, for UI parity), rate limits on the static public documents, and the rendered HTML reference (in `docs/open-questions.md`). Stock preview on PATCH/DELETE dry runs moves to Phase 4.

**Phase 3 starts from:** where transport-neutral representations live (read models imported them from the REST folder; 3a moved them to `src/lib/representations`), whether MCP results reuse the REST representations, the `requestKey` contract, which lookups ship as tools first, and the agent-eval harness. The Phase 0 spike route (`src/app/api/mcp/route.ts`) is replaced. Tool names reuse the operationIds above.

## 17. Phase 3 results (2026-10-09)

Two PRs: 3a #933 (representations in `src/lib/representations/`, `/api/mcp` on API keys, `whoami` and the read tools) and 3b (the three feedstock write tools, the domain prompt and the agent evaluation). The section 10 exit criteria are met: three-way parity (`tests/api-feedstocks-parity.test.ts`) and the agent evaluation below.

- **Write tools** (`src/lib/mcp/tools/write-tools.ts`) share REST's operations, scopes, input checks (`src/lib/api/feedstock-write-checks.ts`) and idempotency records. For update and delete, MCP sends REST's exact target and `If-Match` precondition, so a key first used over REST replays over MCP. A committed delete returns `{ deleted: { id, code } }`; REST stores the deleted row in the idempotency outcome so a replay over MCP can name it. Update and delete take the feedstock UUID, as REST PATCH and DELETE do.
- **Admission:** a `tools/call` of a write tool the key can see is charged as a write; a hidden write tool is classified like an unknown tool and charges nothing extra. `API_WRITES_DISABLED` answers inside MCP as an `isError` result (`api_writes_disabled`, retryable) after the write buckets are charged.
- **Audit:** `api_audit_events.transport` (`rest` | `mcp`, migration `0130`).
- **Domain prompt:** `domainGuide` in `src/lib/api/llms-guide.ts` is shared by `llms.txt` and the MCP `instructions` (`src/lib/mcp/instructions.ts`). Shared wording lives in `src/lib/operations/agent-guidance.ts`.
- **Agent evaluation** (`pnpm eval:mcp`, `scripts/eval-mcp/`): intake requires moisture, so the decided sentence became two cases (Kenji, 2026-10-09). Case 1 adds "at 32% moisture" and is scored on the committed row; case 2 keeps the sentence and passes when nothing is saved and the agent asks for the moisture. Case 2's expectation is read from the published contract, so it follows later changes to required fields. First results with Claude Code 2.1.295: both cases pass; case 1 used 6 tool calls (whoami, three lookups, a dry run, the commit), case 2 used 4.
- **Not changed:** update and delete do not accept a code (plan section 5 says get and update tools accept `id` or `code`); they follow REST's UUID rule until a client needs codes.

## 18. Phase 4b results (2026-10-12)

Biochar products and output-stock movements on REST and MCP, in seven commits. Decisions 50 to 56 (section 13) override the first spec where they differ.

**What shipped, per commit:**
1. Foundations: `eventInstantSchema` and `resolveEventInstant` shared with runs, the `stock_basis_changed` domain error with an optional `preview`, and typed output-stock failures with a wrapper that maps them to domain errors.
2. Movements on the runner: `record_output_stock_movement` with dry run, posting through `withOutputStockPostingInTransaction`, an optional `basisFingerprint`, the certification-lineage guard on every layer whose reading changes (decision 51) and refused future times (decision 56).
3. Products on the runner: `make_biochar_product` (the same optional fingerprint and lineage guard) and `update_biochar_product` (a version precondition, no fingerprint).
4. Reads: scopes `biochar-products:read|write` and `formulations:read`, `GET /biochar-products`, `/formulations` and the movement history, with ETags.
5. REST writes: product create and update and movement POST, with dry runs, 404 pointers for foreign references, and the `stock_basis_changed` preview.
6. MCP: the seven tools above, agent guidance in `llms.txt`, and three-way parity through the real server actions.
7. Fuzzing and docs: the seed gained a biochar bin, a completed run with output, a product bin, a Pure and a blended formulation, one product and one loss; `hooks.py` gives the product create, product PATCH, movement history and movement POST seeded examples; the 428 list includes the product PATCH; this section.

**Decisions made during implementation:**
- The published blend takes parts (decision 52). The server derives the stored blend mass, and the form does the same.
- Replays are byte-stable: a stored result comes back from JSON storage with its keys reordered, so it is parsed through the representation schema again, which restores the published order.
- Product write results are `BiocharProductRecord`, without the bigint posting sequence, which the runner cannot serialize.
- A product request key's payload hash covers the operator's facts per ingredient (line, bin, wet mass, moisture), not the catalog names and ratios the server copies into the composition, so a retry after a catalog edit still replays.
- Product draws from certified stock stay allowed. Readings on certified layers are refused (decision 51).
- The stale-fingerprint preview is one adapter fallback: a dry run of the same input without the fingerprint, inside the request deadline. It never claims the key.
- `openapi/v1.json` is a generated file exempt from the 1000-line cap (Kenji, 2026-10-12, `docs/code-style.md`); it stays pretty-printed at a 1000-character line width. Sub-bin and ingredient lists are capped at 200 items.
- Decision 56 applies to corrections too, with no exception (Kenji, 2026-10-12): an entry whose own time is still in the future, such as a delivery dated later today, can be corrected only once that time has passed.
- A movement write names its bin by UUID only. The history read and the product read accept an id or a code.
- The MCP server instructions were not extended (1972 of 2000 characters); the product and stock guidance lives in tool descriptions and `llms.txt`.
- Movement history is ordered by posting sequence, newest first, since a reversal and its replacement share a timestamp.
- No agent-evaluation case was added for products; round 6 did not ask for one.
- The published `insufficient_stock` issue meta replaces the spec's `availableDryKg` and `requestedDryKg`. It carries `measure` (`dry_biochar` for a biochar bin, `total_solids` for a product bin, `ingredient_wet_stock` for an ingredient bin) and `unit: "kg"`. A bin shortage sends `availableSolidsKg` and `requestedSolidsKg`, plus `storageLocationId` and, for a short sub-bin, `layerId`. An ingredient shortage sends `availableWetKg` and `requestedWetKg` with `storageLocationId`. A product bin's total solids are not dry biochar, so one dry-named pair would mislead.

**Fuzzing:** Phase 4b adds no new harness mechanism beyond examples that pin both a path id and a create body (the movement POST). A stale `deliveryDate` assertion in `hooks.test.py` was fixed because the hook binds the real clock.

**Not changed:** stock corrections ([`api/stock-corrections`](../open-questions-architecture.md#output-stock-corrections-are-not-on-the-api-apistock-corrections-opened-2026-10-12)) and case-insensitive UUIDs (`api/uuid-case`) are in open questions. The product delete and the `data/lock-order` inversions are unchanged.

## 19. Phase 5a results (2026-10-13)

Lab samples and the credit batch lookup on REST and MCP, in seven commits on `feat/api-lab-samples`. Decisions 57 to 68 (section 13) override the first spec where they differ.

**What shipped, per commit:**
1. Foundations: strict input schemas for create and PATCH (dry-basis units, `uuidSchema` batch ids, event-instant sampling times), the ratio helper with calculated-ratio notices, typed sample errors with JSON pointers, and server action schemas that no longer parse times in the server's zone.
2. Writes on the runner: `record_lab_sample`, `update_lab_sample` and `delete_lab_sample`, called in process by the Server Actions. Lock order is certification artifacts, then credit batches in id order, then the sample; lineage is revalidated after the locks. Sample-parented transport legs take the same scope.
3. Reads: scopes `lab-samples:read|write|delete` and `credit-batches:read`, `GET /lab-samples` and `/credit-batches` with keyset lists, strong ETags and filters, and `durabilityOption` on the facility representation (revision 2).
4. REST writes: POST, PATCH and DELETE with dry runs, `Idempotency-Key`, `If-Match`, 412 with the current representation, and `warnings` on write responses.
5. MCP: six tools, agent guidance in `llms.txt`, and three-way parity (action, REST, MCP).
6. Agent evaluation: a credit batch on a 200-year facility and two cases (see the evaluation line below).
7. Fuzzing and docs: the seed gained a 200-year facility, a credit batch over the completed run and one lab sample; `hooks.py` gives the sample create, PATCH and DELETE seeded examples and the credit batch and sample by-id reads; this section.

**Decisions made during implementation:**
- The form drops a typed lab O/C_org when oxygen is present (decision 59), and starts that field empty so clearing oxygen cannot save a calculated value as a lab value. A legacy lab H/C_org without hydrogen is lost on any edit.
- Delete on an archived credit batch is allowed (decision 65 names create, update and move).
- A lineage change after the batch lock refuses with `certification_locked`; it does not retry.
- The legacy production run link decides facility and archive state only for samples with no credit batch.
- Archiving a facility locks its credit batches in id order first, like sample writers, so a sample move cannot deadlock against an archive.
- Reads return strong ETags but, like every other resource, do not answer `If-None-Match` with 304.

**Review findings fixed:** (gpt-6.1-sol and gpt-6-astra, per commit)
- Sample-parented transport legs did not lock their parent in artifact, batch, sample order, so a Removal assigned while a leg waited was missed.
- Update and delete did not lock the batch reached through a legacy run link.
- A move off an archived batch was allowed.
- A sample moved to another facility's batch kept matching its old run's facility; a legacy sample stayed listed after its run was archived.
- Facility archive locked batches in scan order against the sample writers' id order.
- PATCH and DELETE needed the request deadline applied while the body was still arriving.
- Keyed PATCH and DELETE replays, key reuse and key isolation had no tests.
- The after-window submission warning claimed that protocol section 8.3.1 permits sampling from stored material. Fixed in this PR: it now repeats what the protocol asks (biochar in its final pre-storage condition, and before blending when co-applied) and asks the operator to confirm the Sample represents the batch in that condition. It stays a warning.
- Entry warnings did not flag a saved sample without both H/C_org and O/C_org (no oxygen and no lab O/C_org, or zero organic carbon), which submission gate (c) does not count.

**Residual risks:**
- Transport-leg update and delete still read the parent through the global `db` before their transaction; only create was fixed (`data/transport-leg-parent-reads`).
- No `(organization_id, created_at, id)` index backs the API keyset lists (`data/api-keyset-list-indexes`).
- The facility representation's new required `durabilityOption` can break strict clients; check the OpenAPI breaking-change job.
- Readiness shows "O:Corg ratio" twice next to the #948 blocker; left as is.
- The R0 count floor and the TGA requirement still differ from module v1.1 (`isometric/tga-1000-year-requirement`).

**Tests:** full Vitest suite 6,893 passed (811 files, 75 s).
**Fuzzing:** local Schemathesis run against a production build, 4,582 cases, 0 failures. With the new operations, Schemathesis 4.29.3 handed the fuzzing phase a positive create without its required `Idempotency-Key` (lab samples and production runs); `hooks.py` now supplies the key on positive cases, and the coverage phase still sends the missing-header case.
**Agent evaluation:** `pnpm eval:mcp` passes all six cases on the second run: lab-complete 6/8 calls, lab-missing-organic 2/8. On the first run the Phase 4 case chained-complete went over its budget (11/10) after three supplier searches; the rerun used 7.

**Follow-ups:** the Q54 eligibility fix (#948). The sub-bin stock read shipped in [PR C](#20-pr-c-results-2026-10-14) (decision 67). Photo autofill is issue #329. A [multi-sample create](../open-questions-architecture.md#a-multi-sample-create-must-not-assume-one-credit-batch-or-one-sampling-time-apimulti-sample-create-opened-2026-10-13) and [stock corrections](../open-questions-architecture.md#output-stock-corrections-are-not-on-the-api-apistock-corrections-opened-2026-10-12) are in open questions.

## 20. PR C results (2026-10-14)

The output-bin stock read on REST and MCP. Decisions 69 to 72 record the round 8 answers.

**What shipped:**

1. Data layer: one repeatable read, read only snapshot, with the bin lookup first and the evaluation instant captured after it. The app picker and API use the same deterministic stock projection.
2. REST and MCP: `GET /api/v1/storage-locations/{idOrCode}/stock` and `get_bin_stock`, with output-only lookup, held layers, mix pile totals, fixed unresolved reasons and published precision. The REST ETag hashes the published body and representation revision; the body carries no evaluation instant. It validates reads and reserves no stock. Losses still use the dry run's `basisFingerprint`.
3. Docs and one MCP evaluation case: a loss from a named run's sub-bin in a split bin with two run layers. The scorer requires a stock read before any loss attempt, rejects invented layer ids, and accepts a committed loss from the named layer or a question with nothing saved.

**Behaviour changes:**

- The app picker uses the server's now, captured after the bin lookup, when no entry time is supplied.
- Mix bins have null per-layer wet mass, moisture and basis. The pile's figures remain in totals.

**Reviews:** gpt-6.1-sol implemented commits 2 and 3. gpt-6.1-sol and gpt-6-astra reviewed commit 1, gpt-6-astra and Opus commit 2, gpt-6-astra commit 3. Commit 3's two P2 scorer findings (an errored stock read counted as a read, date and reason questions not recognized) were fixed. No P1 or P2 findings remain.

**Verification:** full suite 7,135 passed. `pnpm eval:mcp` passes all seven cases. In the new stock case (5/10 calls) the agent read `get_bin_stock`, previewed the loss with PR-12's `layerId`, saved nothing and asked for the lost material's moisture.

**Follow-ups:** projection cost grows with bin history (`data/output-stock-projection-cost` in [open questions](../open-questions-architecture.md#output-stock-projection-cost-grows-with-bin-history-dataoutput-stock-projection-cost-opened-2026-10-14)). The `ingredient_snapshot_mismatch` sentence says "until the product is repaired" because the repair path is not settled (`data/product-ingredient-snapshot-repair` in [open questions](../open-questions-architecture.md#product-ingredient-snapshot-repair-has-no-operator-action-dataproduct-ingredient-snapshot-repair-opened-2026-10-14)).

## 21. Phase 5b-1 results (2026-10-14)

Customer and location lookups, orders and the order balance read on REST and MCP, in six commits on `feat/api-orders`. Decisions 73 to 86 (section 13) record round 9. Delivery writes follow in Phase 5b-2.

**What shipped, per commit:**

1. Foundations: strict order create and PATCH schemas, calendar dates in the API and app form, and typed errors with field pointers. The form preserves a saved date west of UTC. Round 9 decisions and the order lineage follow-up are recorded.
2. Writes on the runner: `record_order`, `update_order` and `delete_order`, shared by the app actions. All writer reads use the transaction. Packaging defaults from the organization setting after idempotency replay. PATCH keeps omitted fields and clears `customerLocationId` on null; deliveries freeze relationships and set the quantity floor. Delete retires documents and drains storage only after commit.
3. Reads: customer and location lookups without contact details; order keyset lists and detail reads with stored fields only; a separate balance read; storage-location `formulationId` (representation revision 3) and `type` and `formulationId` filters. `customers:read` and `orders:read` are on by default. `orders:write` is opt-in and `orders:delete` is a separate scope, off by default.
4. REST writes: POST, PATCH and DELETE with dry runs, idempotency, strong ETags and stale-write responses. POST requires `Idempotency-Key`, including dry runs, and returns 201 with `Location` and ETag. PATCH and DELETE require a UUID and `If-Match`. OpenAPI and the fuzz 428 list cover both preconditioned writes.
5. MCP: `find_customers`, `find_customer_locations`, `find_orders`, `get_order`, `get_order_balance`, `record_order`, `update_order` and `delete_order`, with shared REST readers and write adapters, agent guidance and three-way parity tests. A committed MCP delete returns `{ deleted: { id, code } }`; a dry run returns the order that would be deleted.
6. Fuzzing and docs: the seed gains a customer, a location with one-way distance, a large order on the product bin's formulation and a second, delivery-free order for DELETE. Fixture ids and both order ETags feed the seeded examples; codes are exported to the fixture. No delivery is seeded yet.

**Write and read contracts:**

- Order writes take topology first, then facilities in sorted id order, a supplied formulation, the order and its lineage, then key-share locks on the customer and location, skipping locks the operation does not need. Code generation holds topology, so parallel creates do not exhaust code retries. Delete takes topology, order and lineage without facility or formulation locks.
- Archive refusals answer 404 `not_found` with a pointer. Create refuses an archived facility; PATCH refuses an archived order. An archived order without deliveries can still be deleted. Any delivery, including an archived one, blocks deletion.
- `GET /orders/{idOrCode}/balance` and `get_order_balance` return `{ orderId, quantityKg, deliveredWetMassKg, remainingWetMassKg, fulfillmentStatus }` from one repeatable-read snapshot. The REST ETag hashes the published body and representation revision. Archived orders count their archived deliveries. Remaining wet mass clamps at zero and rounds down to the gram. Delivery writes do not bump the order version, and an order reserves no stock.
- `quantityKg` exposes the stored `real` value. The representation documents its limited precision rather than promising gram steps at large quantities.

**Verification for commit 6:** 22 offline hook tests pass with Schemathesis 4.29.3. `pnpm typecheck` passes; `pnpm lint` passes with 14 warnings in untouched files. Shell syntax and diff whitespace checks pass. Local Schemathesis on a migrated throwaway database: 5,363 cases, 0 failures. The first run found two bugs, both fixed in this commit: a quantity of 5e-324 reached the `real` column and answered 500 (order quantity now has a 0.001 kg minimum), and the shared calendar-date check refused real dates in years 1 to 99.

Follow-ups are tracked in [`api/keyset-cursor-position`](../open-questions-architecture.md#keyset-cursors-accept-foreign-or-unknown-positions-apikeyset-cursor-position-opened-2026-10-14), [`orders/order-date-display`](../open-questions-architecture.md#order-dates-display-the-previous-day-west-of-utc-ordersorder-date-display-opened-2026-10-14), [`orders/quantity-real-column`](../open-questions.md#order-quantity-loses-gram-precision-at-large-masses-ordersquantity-real-column-opened-2026-10-14) and [`api/mass-input-minimum`](../open-questions-architecture.md#positive-mass-inputs-can-be-stored-as-zero-apimass-input-minimum-opened-2026-10-14).

## 22. Phase 5b-2 results (2026-10-14)

Finished-product deliveries on REST and MCP, in seven commits on `feat/api-deliveries`. The app shares the transaction writers and runner. Decisions 73 to 86 remain the round 9 contract; [delivery API contracts](../api.md#deliveries-on-rest-and-mcp) describe the current behavior.

**What shipped, per commit:**

1. Foundations: delivery create inside the caller's transaction, typed reference, stock, balance and lineage refusals, strict create and metadata PATCH schemas, offset instants in the app, future-time refusal and positive distance overrides. Omitted distance notes survive edits. The posting result retains its fingerprint and allocations.
2. Operations: registered `record_delivery` and `update_delivery`, with public outcomes stripped of native product rows containing bigint posting sequences. App create uses the unregistered `record_posted_delivery` on the runner; `update_posted_delivery` remains unregistered for app metadata edits and corrections. `deliveries:write` is opt-in. Create now shares retries, deadlines and statement timeouts.
3. Reads: `deliveries:read` on by default, org-scoped keyset lists and id-or-code reads, stored-row representations and version ETags. Shipping-facility and instant range filters are published. Bin stock representation revision 2 adds `drawOrder`, null for mix bins, while sub-bins remain oldest first.
4. REST writes: POST with `Idempotency-Key`, metadata-only PATCH with `If-Match`, successful dry runs, allocation envelopes and fresh previews on stale stock fingerprints. Create carries a non-blocking bill-of-lading warning. Archived source bins answer 404. OpenAPI and the fuzz 428 list include delivery PATCH.
5. MCP: `find_deliveries`, `get_delivery`, `record_delivery` and `update_delivery` share REST readers and adapters. Three-way parity covers action, REST and MCP outcomes, issue codes, paths and metadata, plus instant encodings. The warning is API-only; the app uploads evidence after create and returns no warning.
6. Agent evaluation: `delivery-complete`, `delivery-missing-moisture` and `delivery-split-bin`. The complete prompt uses yesterday at 14:00 in the facility zone so the run needs no time-of-day gate. The split-bin preview path requires a request for moisture readings; a preview alone cannot pass. In both missing-reading cases, any committed delivery attempt carrying moisture fails the score even when the server refuses it.
7. Fuzzing and docs: a 0.1 kg delivery on the seeded order and product bin, with id, code and ETag exported through the fixture and harness. The second order stays delivery-free. The product ETag is refreshed after the delivery bumps its version. Seeded delivery GET, POST and PATCH examples require 2xx; writes are dry runs with a small mass or metadata-only change. The REST credential section moves from architecture into `docs/api.md`, with inbound anchors and the Docs Index updated.

**Decisions made during implementation:**

- Create locks topology, request key, sorted bins, the discovered order lineage artifact union, facility share, then order FOR UPDATE and balance. It revalidates lineage, inserts, then locks products inside posting. This replaces the earlier proposed products-before-facility sequence. Delivery update also locks artifacts before facility share and the delivery row. The order is read unlocked for facility and zone, then revalidated under its row lock.
- The delivery form shows refusals on fields only when every issue maps to a rendered field, focusing the first field; otherwise it shows the banner. This applies to create and update.
- The shared planner refuses `sources` at `/sources` with 422 when the bin is mix at the command instant, for every output-stock command, including losses and counts.
- Archived source bins return 404 `not_found` at `/storageLocationId`. An archived delivery refuses PATCH before a revision 412; an archived facility refuses PATCH at `/deliveryId`.
- Delivery masses publish at 3 decimal places and moisture at 6; distance retains the 32-bit real column precision. With `sources`, top-level moisture is accepted but ignored, and the stored overall reading is 100 times (1 minus total solids divided by wet mass), including ingredients. Otherwise the supplied reading is retained.
- Allocations appear on dry runs, committed creates and successful 409 previews. Stored dry and wet allocation masses have 3 decimal places, supplied readings up to 6, and exact rational solids truncate to 12. Precision is documented rather than rounded again; trailing allocation sums can differ from the delivery representation.
- Sub-millisecond range-bound handling was left unchanged: shared offset instant parsing truncates to milliseconds, as for placement and sampling filters. Stored delivery instants have millisecond precision.

**Verification for commit 7:** the supervisor ran the live seed and fuzz harness. Schemathesis passed 5,864 cases with 0 failures across 57 operations, including all four delivery operations.

**Follow-ups:** the production-run writer still takes its run row before lineage artifacts, tracked as `data/production-run-artifact-order` in [architecture open questions](../open-questions-architecture.md). Runner retries cover residual lock inversions, but heavy local load can exhaust the app create deadline. Duplicate transport synchronization during corrections remains a pre-existing harmless version bump. The submitted-order lineage restriction, cursor-position validation, order date display, large order quantity precision and shared mass-input minimum remain the follow-ups listed in section 21. Stock corrections and document uploads remain outside the API scope.

## 23. Phase 6a results (2026-10-15)

Moved to the [Phase 6a results archive](../archive/2026-10-15-api-phase-6a-results.md)
to keep this active plan under the file-size limit.

## 24. Phase 6b results (2026-10-15)

**Shipped on `feat/api-applications`:** applications on the shared runner,
REST and MCP; application documents; a separate delivery application balance;
fuzz fixtures and examples. No Phase 6b migration was needed.

**What shipped, by commit:**

1. Writer move (`673db0f86`): split reads from transaction writers and the
   shared `application-write-scope.ts`. App actions use unregistered runner
   operations, savepointed codes, version checks and after-commit cleanup.
   Fixed application/document lock ordering, archive refusals, calendar dates,
   field size, Q79 boundary validation and the form's kg naming.
1b. Membership order (`7b793d88e`): artifacts before facilities and runs, then
   process scope and batch; revalidate before links and slices. Shared bounded
   transaction retry covers remaining run and auto-attachment inversions.
2. Operations (`a51968cf1`): register `record_application`, `update_application`
   and `delete_application`; scopes and permissions; output contains the
   application, allocations, target delivery balance and warnings. Q78 copies
   omitted site defaults on create only. App actions return the application.
3. Reads (`fd0f0635b`): list, detail and boundary, strong ETags, physical batch
   lineage filtering, application document owner (photo and PDF), delivery
   application balance and `hasRemainingMass`. One site query feeds the picker,
   create defaults and balance. Owner type follows the extensible-enum precedent.
4. REST writes (`10953e19a`): POST, PATCH and DELETE, idempotency, If-Match,
   412 with the current representation, raw GeoJSON and additive OpenAPI paths.
5. MCP (`491673d56`): find, get, record, update and delete applications plus
   `get_delivery_application_balance`; shared REST write checks and three-way
   parity. Document tool hints point to `find_applications`.
6. Agent evals (`e7483dd8c`): complete application, missing field size and
   over-capacity, with only application read/write and delivery read scopes.
   The facility zone is chosen per run to align its date with the session.
   The Q79 Playwright update (`412445797`) pins refusal when clearing a required
   boundary and verifies the stored geometry survives.
7. Fuzz and docs: independent supply for a 50 kg delivered load and one 1 kg
   application, small boundary and uploaded/pending photo fixtures through real
   writers. Export application id/code/ETag, delivery id/code, date, GPS and
   uploaded photo id. Hooks add reads and a fresh-key 0.001 kg POST dry run;
   application PATCH/DELETE join the precondition status list. API, lock-order,
   activity and testing docs describe the shipped behavior.

**Staging merges:** `019afd56d` brought #1055 (0147), #1060 (0146), #1062,
#1063 (0148), #1064 and #1057. Two test import conflicts were resolved; the
supervisor reset/migrated the test database after leftover rows blocked 0147
and recorded 690 related files passing with OpenAPI in sync. `b594b8b9e` brought
#1065 and #1066 without a migration. Application activity moved to the runner's
`activity.scope(entityId, scopes)`, including former/current batches on update
and pre-delete scopes passed to document retirement. The supervisor recorded
697 related files passing after that merge.

**Decisions made during implementation:**

- The merged #1021 checkpoint (#1029, `014204888`) derives Removal transport
  from frozen application slices at read time. Application writes do not change
  stored transport legs, so they take no transport topology lock.
- Writers discover unlocked, then lock sorted lineage artifacts, facilities
  SHARE, runs SHARE, batches SHARE, deliveries UPDATE, application UPDATE and
  version, revalidate, then lock slices and write. Changed-set conflicts reach
  the client at `/applicationId` or `/deliveryId`; only 40P01, 40001 and 55P03
  are retried automatically. The form defaults to the earlier browser/facility
  today; dates remain UTC-midnight calendar values.
- Membership keeps non-waiting SKIP LOCKED acquisition of newly completed,
  unassigned matching runs after process scope. A miss returns conflict.
  Skipping a busy batch silently was declined. Scalar edits and deletes lock
  no member runs. `transaction-retry.ts` is shared by the runner and all three
  membership transactions; it also covers the residual scope/artifact order.
- Site identity follows `orders.customer_location_id`, after migration 0138
  removed the delivery override. The transaction helper's certifier-project
  join is unique by facility/provider. Soil defaults copy only when value and
  source are both omitted at a non-1000-year facility, with `global_database`
  provenance. Explicit null stays null and PATCH never fills defaults.
- `creditBatchId` means physical application lineage, through slices or frozen
  shares of member runs, including mix-bin held-out applications. The app page
  still filters through delivery lineage. The balance body hash covers defaults
  too; `hasRemainingMass=false` finds exhausted deliveries. No API resource
  answers 304; this is the existing API-wide rule.
- REST and MCP use `recordApplicationApi` and `updateApplicationApi`; these are
  the registry entries. Raw geometry is fingerprinted before normalization in
  execute creates the `source: "api"` envelope. App actions keep envelope-input
  operations. Malformed polygon structure is refused before turf, including
  app paste/upload; the app labels API boundaries "Added through the API".
- Deadlines retain retryable 500 `deadline_exceeded`, not 504. Nullable input
  descriptions say "null for none". Balance remains under `deliveries:read`.
  There is no MCP boundary tool; `get_application` points to the REST read.
- Runner activity emits one event per distinct batch/run scope. Repoints keep
  former and current scopes; deletes capture them before shares disappear.
  Activity source follows form, REST, MCP or the trusted script override.
- Fuzz uses a separate feedstock type and supply chain so the original stock,
  batch membership and exports stay intact. A 1 kg seeded application leaves
  49 kg. The key excludes `applications:delete`; no positive DELETE is added.
  No positive PATCH is added because hooks cannot chain fresh ETags. POST is
  a dry run so repeated positive examples retain capacity. Schemathesis never
  PUTs bytes or follows document content redirects.

**Validation and follow-ups:** the supervisor recorded all three application
evals passing in run 3 (`c6-6b/eval-table.md`) and all seven application
Playwright specs passing (eight opt-in gallery skips). The pre-existing
`delivery-split-bin` eval passed in runs 1 and 2 but failed once around facility
midnight with a scorer wording miss; that remains follow-up work. Final
post-commit-7 eval results are pending; this task does not rerun them. The
supervisor must run the new physical seed and Phase 6b fuzz script on the
throwaway fuzz database. Commit 7's database-free verification is reported in
the task handoff.

`data/production-run-artifact-order` retains the production-run run-before-artifact
residual; `data/lock-order` also retains auto-attachment scope/artifact and
feedstock/bin inversions. The application/document and explicit membership
cycles are fixed. `api/large-gis-boundary` tracks boundaries above the 256 KiB
body cap, currently added in the app. `app/application-batch-lineage-filter`
tracks aligning the app's batch filter with application physical lineage.
