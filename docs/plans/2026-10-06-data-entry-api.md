# Data-entry API (REST + MCP): plan

- **Owner:** Kenji Nguyen
- **Status:** in progress; Phases 0 to 3 done (sections 15 to 17), Phase 4 (production) next
- **Last reviewed:** 2026-10-06 (against `e4ba77c2`, plus the Phase 0 branch `feat/data-entry-api-spike`)

Drafted from four Codex research memos (gpt-6.1-sol: REST practice, MCP and auth, codebase audit; gpt-6-astra: independent architecture draft). Reviewed by gpt-6-astra (adversarial), gpt-6.1-sol (fact-check and QA), Fable 5.1 (architecture) and Sonnet 5.5 (API consumer walk-throughs). Section 14 lists what changed and why.

## 1. Decision

Build **one transport-neutral operation layer** that owns decoding, validation, orchestration and the guarded write for each exposed entity operation. Three thin adapters call it in-process: the UI's server actions, a versioned **REST API** (`/api/v1`), and a remote **MCP server** (`/api/mcp`). REST is the primary contract for scripts and the mobile app. MCP is a curated, scope-filtered tool surface for agents, generated from the same operations.

No adapter calls `data-access/` directly, and no adapter calls another over HTTP. OpenAPI and MCP JSON Schemas are generated descriptions. The runtime authority stays the shared Zod schemas plus the transactional guards in `data-access/`.

## 2. What the code tells us

- **Validation lives in four places**: Zod schemas (`src/schemas/*`), checks and orchestration in `fn/` actions, transactional invariants in `data-access/` (row locks, bin stock guards, certification lineage guards, `assertExpectedVersion`), and DB constraints. `withAction` authenticates and formats, it does not parse (`src/fn/with-action.ts:76`); mutating actions parse their own input.
- **Behaviour that lives only in `fn/`** and would be lost by an adapter that called `data-access/` directly:
  - sample date not before the credit batch's production start, in the facility time zone (lower bound only, `src/fn/samples.ts:51`, `:62`);
  - document upload MIME/size/CSV checks, confirm-time storage HEAD, evidence classification (`src/fn/documents.ts:103`, `:191`, `:285`);
  - live Isometric catalogue lookup on feedstock-type import (`src/fn/feedstock-types.ts:101`);
  - facility-ownership refusals on reads and writes across reactors, orders, storage, readings, feedstocks, products, deliveries, applications, samples (`src/fn/reactors.ts:63`, `src/fn/orders.ts:47`, `src/fn/production-run-readings.ts:39`);
  - duplicate-code and existence preflights with friendly errors (`src/fn/applications.ts:179`, `:185`, `src/fn/credit-batches.ts:181`, `:187`), sample update merge (`src/fn/samples.ts:287`);
  - reading-import CSV format and run-window checks (`src/fn/production-run-reading-imports.ts:53`, `:65`);
  - `withAutoCode` code generation, and normalisations (distance provenance `src/fn/suppliers.ts:168`, composition `src/fn/biochar-products.ts:128`, loss to negative delta `src/fn/bin-movements.ts:146`).
  Some of these are duplicated in `data-access/` (production-process admin checks, feedstock-type import role checks); for those only the error wording would change.
- **Schemas are form-shaped but generate well.** About ten helpers in `src/schemas/helpers.ts` (`:93` to `:185`, `:305`, `:443`) and a few inline schemas use `z.preprocess` to accept form strings. With the installed Zod 4.3.6, `z.toJSONSchema(schema, { io: "input" })` emits the inner schema for a plain preprocess, bounds included. It does **not** for the piped helpers the real fields use: `requiredPositiveMassKgSchema()` generates only `{"type":"number"}` (positive minimum, 100,000,000 kg maximum and 0.001 kg step lost), and `optionalStoredPercent` keeps 0 to 100 but loses its precision step. `z.date()` branches throw, and preprocess around `.optional()` is advertised as required. Runtime validation is unaffected; the published contract is incomplete.
- **Business dates are parsed as instants.** `deliveryDateSchema` calls `new Date(val)` (`src/schemas/feedstocks.ts:52`): `2026-02-31` parses as 3 March, and `2026-10-06T23:00:00-07:00` becomes 7 October UTC. Both checked locally. Server schemas are often the form schema (`createSupplierSchema = supplierFormSchema`, `src/schemas/suppliers.ts:92`). Patch helpers already keep omission distinct from null (`src/schemas/helpers.ts:152`).
- **Two encodings that need care:** application mass is entered in kg and converted to tonnes by the form before submit (`src/components/applications/application-form.tsx:392`), so the form schema field `biocharAppliedTons` holds kg (`src/schemas/applications.ts:143` vs `:188`). That is intentional but badly named. Production-run create accepts `"HH:MM"` time strings plus dates (`src/schemas/production-runs.ts:229`), and the action converts with `new Date()` (`src/fn/production-runs.ts:118`).
- **Errors are prose.** Failure is `{ error, conflict?, blockers? }` (`src/types/actions.ts:20`); `formatZodActionError` drops issue paths (`src/fn/action-errors.ts:49`); the read adapter maps every non-conflict `SafeError` to 400 (`src/app/api/reads/read-response.ts:177`).
- **Concurrency checks are optional** and compare a JS-set `updatedAt` in milliseconds (the `expectedUpdatedAt` check, since replaced by integer row versions in Phase 1b); deletes take no version (`src/data-access/suppliers.ts:530`); some writes touch sibling rows (supplier default-location promotion, `src/data-access/suppliers.ts:717`).
- **Transactions:** simple creates use the global `db` (`src/data-access/suppliers.ts:323`); compound creates open their own transaction (`:362`); `withAutoCode` catches unique violations and retries (`src/data-access/code-generator.ts:216`), and `generateNextCode` reads through `db` (`:66`). The default pool has **one** connection (`src/db/pool-config.ts:4`), so a global-`db` read inside a transaction waits on itself.
- **Auth:** org context comes from the session (`resolveOrgContext`, `src/lib/auth/server.ts:167`) or the CLI seam, which builds Platform Admin authority and must never serve a request (`src/lib/cli/org-context.ts:2`, `:74`). `OrgContext` requires `userId` and has no scopes (`src/lib/auth/server.ts:137`). A Platform Admin can act in a non-member org with `orgRole: null` (`:204`). `better-auth` is pinned to 1.7.7, with only `organization` and `nextCookies`. The proxy demands a session for `/api/*` except `/api/auth` (`src/lib/auth/middleware.ts:47`, `:82`) and answers unverified sessions with 403 (`:95`).
- **What already fits:** `src/lib/read-models/*` + `/api/reads/*` is the pattern we want for reads; trusted-context modules stay directive-free and `pnpm check:server-action-exports` guards them; no CRUD action uses `revalidatePath`, `after()` or `redirect()`.
- **Delete is a domain operation.** Facilities archive and restore; posted products and deliveries refuse and require corrections; most others hard-delete behind dependency, stock or certification lineage guards; supplier locations have plain ownership checks.

## 3. Architecture

```text
 Browser UI ─ hooks ─ server action (fn/<entity>.ts, "use server")
                       session ─► OrgContext ─────────────────────────────┐
 Scripts, mobile ─ REST /api/v1/<resource>                                 │
                       API key | OAuth token ─► resolveApiContext ─────────┤
 Agents ─ MCP /api/mcp (Streamable HTTP, stateless)                        │
                       API key (Phase 3) | OAuth token (OAuth track) ──────┤
                                                                           ▼
        src/lib/operations/<entity>.ts   (directive-free, server-only)
        operation = { id, scope, input schema, output schema, execute }
          1. decode input with the operation's Zod schema
          2. scope ∩ role ∩ permission check
          3. moved fn/ logic: preflights, normalisation, withAutoCode
          4. guarded data-access write in ONE transaction owned by the runner
             (+ idempotency record and audit row for API calls)
          5. typed outcome: data + warnings | DomainError
                                   │
        src/data-access/*   ctx first, requireOrgScope, org predicates,
                            locks, stock guards, certification guards,
                            version check, state validation after merge
```

`ApiContext` extends `OrgContext` with `principal` (`userId`, `credentialId`, credential kind, OAuth client id when present), `scopes`, and `isPlatformAdmin: false`. External credentials never get the Platform Admin override.

### 3.1 Operation layer

- `src/lib/operations/<entity>.ts`, mirroring `src/lib/read-models/`, plus src/lib/operations/registry.ts (new in Phase 1): an explicit allowlist of exposed operations. Existing read models become the read side of the same registry. Update `docs/architecture.md` (it names `fn/**/*-core.ts` today) when the first operation lands.
- An operation **moves** today's action body; the server action becomes `withAction((ctx) => runOperation(op, ctx, input))`. Nothing is copied, so UI and API cannot drift.
- Avoid a framework: a plain object per operation and one `runOperation` function. No effect metadata until something consumes it.
- **Decode, then validate state.** Step 1 decodes the payload. A PATCH cannot be fully validated on its own: writers keep locking the row, merging omitted fields from the saved state, then validating the result (as `src/data-access/applications.ts:689`, `:723` does). State-dependent preflights (sample vs batch window, document existence) move into the writer's transaction where feasible.
- **One transaction owner.** `runOperation` opens the transaction and threads `tx` through every helper it reaches, including `withAutoCode` and `generateNextCode`. Each auto-code attempt runs in a savepoint (`tx.transaction(...)`) so a unique violation does not abort the whole transaction. Existing bin lock ordering (`src/data-access/lock-bin-stocks.ts:46`) is preserved. Phase 0 proves this on one compound create and one stock-moving write.
- Destructive data-access functions that lack their own role guard get one (defence in depth); scope enforcement is in the runner.

### 3.2 One schema per operation (keep the schemas, fix generation)

The draft proposed separate canonical and form schemas; review measured that at 63 schema files and 45 `zodResolver` call sites. A second proposal, rewriting the preprocess helpers as typed unions, turned out worse: a transformed union drops its bounds from the generated input schema. Generation is good for plain preprocess and loses constraints after `.pipe(...)` (section 2), so:

- **Keep the existing schemas.** Forms and the API parse with the **same schema per operation**. The API accepts the form encodings (`"12.5"`, `""` to clear) at runtime because the schema does. That is documented leniency, not a weaker path: the same rules run either way. The published contract advertises the canonical JSON type with its constraints.
- **Fix what generation cannot express**, per exposed schema:
  - piped helpers (mass, percent, moisture): attach the canonical constraints as schema metadata in the ~10 shared helpers, so `exclusiveMinimum`, `maximum` and `multipleOf` reach the generated schema; the rule values stay defined once;
  - `z.date()` branches on instants: `format: date-time` override, keeping the runtime branch for server re-validation;
  - preprocess around `.optional()`: override so optional fields are not advertised as required;
  - refinements and cross-field rules: documented in the operation description; Zod still enforces them.
- **Fix the two real cases locally:**
  - Application mass: rename the form field so kg and tonnes have distinct names (no behaviour change, no double conversion); the API takes a unit-named field.
  - Production-run times: the API accepts either an RFC 3339 instant with offset or a facility-local `{ date, time }` pair resolved in the facility time zone (the form's rule). A bare `"HH:MM"` never reaches `new Date()`.
  - **Business dates get a strict calendar-date decoder** (`YYYY-MM-DD` only, real calendar days, no timestamps), advertised as `format: date`, stored and returned as the same day. This replaces `new Date(val)` in `deliveryDateSchema` and its siblings and also fixes the UI path. DST policy for facility-local `{ date, time }` pairs: a time in a spring-forward gap and an ambiguous fall-back time are both rejected, as `combineDateAndTime` (`src/lib/date-utils.ts`) already does for the UI (section 15).
- Omission-to-null helpers never appear in update schemas (the documented rule at `helpers.ts:151`); a test enforces it for registry operations.
- **Unknown fields:** API mutations reject unknown keys (422 naming the key) so a misspelled optional field cannot silently disappear. Forms keep today's stripping.
- **Phase 0 exit criterion:** semantic assertions on the actual pilot schemas (types, `exclusiveMinimum`, `maximum`, `multipleOf`, required, nullable, formats, enums match a hand-written expectation), plus calendar-date cases (31 February, 29 February in a non-leap year, offsets, round trip across time zones).

### 3.3 Structured failures

- A typed `DomainError` family with stable codes: `validation_failed`, `not_found`, `stale_version`, `conflict`, `certification_locked`, `insufficient_stock`, `forbidden`, `reference_not_found`, `reference_ambiguous`, `concurrent_write_retry` (retryable after bounded pre-COMMIT retries, decision 49). Errors are thrown with a code, never classified from message text.
- `ActionResult` failure gains `code` and `issues?: { path, code, message, meta? }[]`; `error` (prose) stays, so current UI consumers are unaffected and forms can start highlighting by path. `meta` carries non-sensitive limits (`max`, `unit`, allowed enum values), never the rejected value.
- Business conflicts carry actionable detail: `insufficient_stock` returns bin id, available and requested mass; `conflict`/`blockers` refs (`src/types/actions.ts:31`) pass through.

## 4. REST contract (`/api/v1`)

**Resources.** Flat and plural: `/api/v1/suppliers`, `/api/v1/feedstocks`, `/api/v1/production-runs/{id}`. Facility is a filter (`?facilityId=`); nest only owned children (`/production-runs/{id}/readings`). The organization is implied by the credential (each credential is bound to exactly one organization, section 6), so there is no organization id in the path and no drift with the session's active organization.

**Identifiers.** Every resource returns `id` (UUID) and `code` (e.g. `SUP-26-003`). `GET /{resource}/{idOrCode}` accepts either. Write payloads take UUIDs; lookups resolve codes and names first:
- list endpoints take `?q=` (case-insensitive prefix on code and name) and `?code=`;
- an unresolved or ambiguous reference returns 422 with `reference_not_found` / `reference_ambiguous` and the candidates (scoped to the organization, and to a facility where codes repeat across facilities).

**Methods.** `GET` list and get; `POST` create (201 + `Location`); `PATCH` update (200); `DELETE` (204) only where the entity has a delete. Domain transitions are explicit commands (`POST /facilities/{id}/archive`), never a force flag. Stock corrections are not on the API yet (decision 50).

**Biochar products and output stock (Phase 4b).** `GET /biochar-products` and `/{idOrCode}` (`biochar-products:read`), `POST /biochar-products` (201, `Location`, ETag; the body takes the weighed parts, decision 52), `PATCH /biochar-products/{id}` (`code`, `status`, `densityKgM3`; `If-Match` required), `GET /formulations` and `/{idOrCode}` (`formulations:read`), `GET /storage-locations/{idOrCode}/stock-movements` (`biochar-products:read`, read-only history) and `POST /storage-locations/{id}/stock-movements` (`biochar-products:write`; `loss` and `count`). Creates require `Idempotency-Key`, dry runs return `stockEffects` and `basisFingerprint`, and a stale fingerprint answers 409 `stock_basis_changed` with `preview`.

**Lab samples and credit batches (Phase 5a).** `GET /lab-samples` and `/{idOrCode}` (`lab-samples:read`), `POST /lab-samples` (`lab-samples:write`; `Idempotency-Key` required, dry runs too; 201, `Location`, ETag), `PATCH /lab-samples/{id}` (UUID only, `If-Match` required; accepts `code` and a move to another credit batch) and `DELETE /lab-samples/{id}` (`lab-samples:delete`, off by default; `If-Match`; also deletes the sample's transport legs and retires its lab report documents). `GET /credit-batches` and `/{idOrCode}` (`credit-batches:read`, on by default) are the lookup a sample needs; credit batch writes stay UI-only. The facility representation gains `durabilityOption`. Lists use the `(createdAt, id)` keyset; samples on archived credit batches are hidden from lists and readable by id. A lab sample write answers `{ data, warnings }`: the warnings say which ratios the server calculated and what a registry submission will still need, and never block the write. The sampling time takes the two event-instant shapes, read in the credit batch facility's zone, and a future time is refused. Create, update and move are refused on an archived credit batch (decision 65).

**Deliveries (Phase 5b-2).** List and detail reads use default-on `deliveries:read`; create and metadata PATCH use opt-in `deliveries:write`. There is no delivery delete. See [delivery API contracts](../api.md#deliveries-on-rest-and-mcp) for allocations, stock-basis previews, archive refusals and moisture semantics.

**Customers and orders (Phase 5b-1).** `GET /customers`, `/{idOrCode}` and `/{idOrCode}/locations` use `customers:read`; customer contact details are excluded. `GET /orders`, `/{idOrCode}` and `/{idOrCode}/balance` use `orders:read`. Both read scopes are on by default. `POST /orders` and `PATCH /orders/{id}` use opt-in `orders:write`; `DELETE /orders/{id}` needs the separate `orders:delete`, off by default. Creates require `Idempotency-Key` even for dry runs; PATCH and DELETE take a UUID and `If-Match`. The order body contains stored fields only. Balance is a separate snapshot with a body-hash ETag. Storage locations expose `formulationId` (revision 3) and accept `type` and `formulationId` list filters.

**Dry run.** Writes accept `?dryRun=true`: decode, run the locked guards inside the transaction, return the would-be result (or the domain error), roll back. Rules:
- Work outside the database never runs in a dry run. Essential external work is **enqueued in the transaction** (the existing storage-deletion queue, `src/data-access/documents.ts:577`, is the pattern) and drained by idempotent consumers with an independent retry path. The runner's after-commit hook only triggers an early drain, after the real commit, never after a savepoint or a dry run. Best-effort telemetry may be a plain hook. A hook failure never makes a committed write look rolled back.
- Operations with irreversible external effects do not offer dry run: upload request and confirm (confirm deletes invalid objects before throwing, `src/fn/documents.ts:218`), and anything touching Isometric.
- Returned codes and ids are provisional; sequences (e.g. bin movement `bigserial`, `src/db/schema/bin-movements.ts:49`) advance on rollback, so gaps are expected.
- Logs from a dry run are labelled as such.

Existing stock previews (`previewProductStock`, `previewOutputStock`) stay for detailed stock breakdowns.

**PATCH.** Our convention: missing = unchanged, `null` = clear, `0` stays `0`. `Content-Type: application/json`. Not RFC 7396 Merge Patch.

**Representations.** Explicit output schemas, never raw Drizzle rows. Body `{ data, warnings? }`; lists add `nextCursor`. Request id travels in the `X-Request-Id` header, not the body, so the body is a stable representation for ETags. Field names carry units (`massWetKg`, `moisturePercent`), with one documented convention for percent vs fraction.

**Time.** Two kinds of field, documented on each:
- *business dates* (`deliveryDate`): date-only, facility-local, never converted;
- *event instants*: accepted as RFC 3339 with offset, or as facility-local `{ date, time }` resolved in the facility time zone. Production-run responses return UTC instants and reference ids only, without facility codes or the facility time zone (decision 48). Clients read the zone from `/facilities` or `whoami`.
Facility reads include `timeZone`. "Today" for a client comes from `GET /api/v1/me`, not the device or model clock.

**Discovery.** `GET /api/v1/me` returns organization, accessible facilities with time zones, role, scopes, and the server's current date per facility. Enum values ship in OpenAPI with descriptions.

**Errors.** RFC 9457 `application/problem+json`: `type`, `title`, `status`, `detail`, `instance`, plus `code`, `retryable`, `errors: [{ pointer, code, detail, meta? }]`, and `conflict`/`blockers` where the caller may see them. A 404 for a referenced id says which pointer was not found.

| Outcome | Status |
|---|---|
| Malformed JSON, bad query syntax | 400 |
| Missing or invalid credential (`WWW-Authenticate`) | 401 |
| Valid credential, missing scope or role | 403 |
| Target absent or in another organization | 404 |
| Business conflict (stock, lineage, certification lock, uniqueness); idempotent request still running (`Retry-After`); exhausted pre-COMMIT retries (`concurrent_write_retry`, retryable) | 409 |
| `If-Match` does not match | 412 |
| Validation failed; unresolved reference; idempotency key reused with a different payload | 422 |
| `If-Match` missing on PATCH or DELETE | 428 |
| Rate limited (`Retry-After`, `RateLimit-*`) | 429 |
| Payload too large / wrong media type | 413 / 415 |
| Unexpected | 500, sanitised |

**Versions and preconditions.**
- Integer `version` column on each exposed entity, incremented by **every** writer (UI actions included) inside the locked update, including writes that change a sibling's represented state (default-location promotion, archive cascades, stock corrections). Pre-production: add per entity as it is exposed, then retire `expectedUpdatedAt`. **UI writes carry the version too:** ordinary UI updates, deletes and transitions send `expectedVersion` and the check is mandatory, otherwise an old form could overwrite a newer API change. Internal commands that deliberately act on current state get a named, narrow exception, not an optional version on ordinary writes.
- Strong `ETag` = version of a stable, unexpanded representation (no includes in v1). Every create, update and list item returns `version`.
- `If-Match` **required** on resource PATCH and DELETE (428 if absent); state-changing commands (`/archive`, `/corrections`) carry `expectedVersion` in the body instead, because the command URL has no representation of its own. On a mismatch the problem body includes the current representation. `If-Match: *` and weak tags are refused on writes, because they cannot prove which version the client loaded. The ETag covers row version plus a representation revision, so a v1 serializer change also changes it; warnings are not part of the validated representation.

**Idempotency** (design fixed in Phase 0, built in Phase 2).
- `Idempotency-Key` required on every REST POST create, including dry runs, and commands that move stock; optional (recommended) on other POSTs and on PATCH/DELETE. Semantics follow the expired draft-ietf-httpapi-idempotency-key-header, published as our convention.
- Table `api_idempotency_records`, unique on `(organization_id, credential_id, key)`. The namespace is the **credential** (API key or OAuth grant): rotating a key starts a new namespace, two integrations owned by one person never collide. It stores a fingerprint (operation id, target, canonical decoded input, precondition, API version) and a **transport-neutral operation outcome** (outcome code, data or domain error, entity ids, version) with a schema version; each adapter renders it, so a write committed over REST and retried over MCP with the same key replays correctly.
- What is recorded: committed successes only. Failures roll back with the transaction, leave no record, and are re-evaluated on retry (a validation error stays an error; a stock conflict may clear).
- Dry runs never claim, consume or replay a key. A dry run with a key that already has a committed record returns 409 `key_already_used`, never the old result dressed as a preview.
- The claim sequence runs at Read Committed (the app default) and relies on its per-statement snapshot.
- At expiry the record is purged and the key may be reused as a new request; stored outcomes from an older schema version are rendered through a compatibility mapper or answered with 409 `replay_unavailable`.
- Claim protocol (real writes only): at the start of the operation's transaction, `SET LOCAL lock_timeout` to a short claim budget, then `INSERT ... ON CONFLICT DO NOTHING`. While another transaction holds an uncommitted record with the same key, PostgreSQL makes this INSERT wait on it and cannot see it. Outcomes: the lock times out, so roll back and answer 409 + `Retry-After` (the transaction is aborted, so never continue in it); the first request commits, so the INSERT inserts nothing and a following read sees the committed record (same fingerprint replays, different fingerprint is 422); the first request rolls back, so this request becomes the owner. After a successful claim, restore the normal lock budget, and never report a later domain-lock timeout as "request still running". An application deadline covers pool acquisition too: at pool size 1 a duplicate can wait for a connection before it reaches PostgreSQL.
- Replays **re-authenticate and re-authorize** (credential revoked, owner removed), and happen before the stored request's precondition is re-evaluated, so a lost PATCH response is recoverable. Replays carry `Idempotent-Replayed: true`.
- Stored responses can contain organization data (contact names), so retention is short: 7 days (`IDEMPOTENCY_RETENTION_DAYS` in `@/config`), records purged by a job, never logged. The audit log stays value-free. Offline mobile (Phase 8) raises retention to at least the maximum offline window.

**Pagination.** One fixed keyset ordering per collection, `(createdAt, id)`, opaque cursor bound to organization and filters; default 50, max 200; no totals. More sort orders later, each with its own cursor tuple. No `include` in v1 (two calls are fine; each include is another authorization surface).

**Limits.** JSON bodies capped at 256 KiB, streamed; arrays in operation inputs and list responses capped; Node runtime; route `maxDuration` 30 s, application budget 10 s, DB statement and lock timeouts below it.

**Deadline and cancellation.** A timer winning a race does not stop a transaction, so the runner follows a fixed sequence:
- the deadline covers authentication and pool acquisition, and a request whose deadline passed while queued never starts its mutation;
- an acquired connection is held until rollback, or destroyed if rollback fails;
- the remaining budget is checked before `COMMIT`;
- a connection failure after `COMMIT` was sent is an **unknown outcome**: the response says so, and the client retries with the same idempotency key, which replays the stored result or runs once.

The API never promises rollback once `COMMIT` may have reached PostgreSQL. Files never travel in API bodies: request upload, presigned PUT, confirm (`docs/storage.md`).

**Rate limiting.** A coarse per-IP limit before authentication (invalid credentials still cost work). After it, a Postgres-backed token bucket per credential and per organization, with separate read and write budgets sized for a mobile outbox replay burst. Failed writes and dry runs are charged too. The bucket is debited outside the business transaction, so a rollback does not refund it. Revisit Redis only if load demands it. The in-memory limiter is per instance and does not hold on Vercel.

**Versioning.** Additive changes stay in v1; breaking changes ship as v2 with RFC 9745 `Deprecation` and RFC 8594 `Sunset` headers and a changelog.

**Docs and SDK.** `/api/v1/openapi.json` is public (no secrets in it) so SDK generators and agents can fetch it; a rendered reference and `llms.txt` sit next to it. Stable `operationId`s match MCP tool names; examples use realistic data (wood-chip deliveries, not "foo"). CI generates a TypeScript client from the spec.

## 5. MCP server (`/api/mcp`)

- **Stack.** MCP revision 2026-07-28 (stateless core, Streamable HTTP) via `mcp-handler` 2.2.0 on `@modelcontextprotocol/server` 2.3.0 (SDK v2; not `@modelcontextprotocol/sdk` 1.x), in a Node route handler, without sessions or Redis. Pinned exactly after the Phase 0 interop check (section 15).
- **Auth, in two steps.** Phase 3: bearer API keys, which Claude Code, Cursor and similar clients send from config. This puts agents on data entry without waiting for OAuth. OAuth track (starts when Phase 3 lands): OAuth for clients that require it (claude.ai and ChatGPT connectors, third parties).
- **Tools come from operations**: same schema, same runner, same scopes. Names are verb-first and in domain language: `log_feedstock_delivery`, `start_production_run`, `record_application`, `find_suppliers`, `find_storage_locations`. Descriptions state preconditions, units, side effects ("deducts from the bin") and what to call first. No generic `create_record`, no SQL.
- **Biochar tools (Phase 4b):** `find_biochar_products`, `get_biochar_product`, `make_biochar_product`, `update_biochar_product`, `find_formulations`, `find_output_stock_movements` and `record_output_stock_movement`, on `biochar-products:read|write` and `formulations:read`. Descriptions tell agents to pass the dry run's `basisFingerprint` to the real write.
- **Lab sample tools (Phase 5a):** `find_lab_samples`, `get_lab_sample`, `find_credit_batches`, `record_lab_sample`, `update_lab_sample` and `delete_lab_sample`, on `lab-samples:read|write|delete` and `credit-batches:read`. They share REST's operations, idempotency records and `{ data, warnings }` results; the result text says when a ratio was calculated. Update and delete take the sample UUID and an `expectedVersion`.
- **Delivery tools (Phase 5b-2):** `find_deliveries` and `get_delivery` use `deliveries:read`; `record_delivery` and `update_delivery` use `deliveries:write`. Writes share REST adapters; update requires `expectedVersion`.
- **Application tools (Phase 6b):** `find_applications`, `get_application`, `record_application`, `update_application` and `delete_application`, on `applications:read|write|delete`. `get_delivery_application_balance` uses `deliveries:read`; `find_deliveries` accepts `hasRemainingMass`. Application documents use the shared tools with `ownerType: application`, for photos and PDFs. Updates and deletes take a UUID and `expectedVersion`.
- **Customer and order tools (Phase 5b-1):** `find_customers`, `find_customer_locations`, `find_orders`, `get_order`, `get_order_balance`, `record_order`, `update_order` and `delete_order`, on `customers:read` and `orders:read|write|delete`. Writes share REST's operations and idempotency records. Update and delete take the order UUID and `expectedVersion`. A committed delete returns `{ deleted: { id, code } }`; a dry run returns the order that would be deleted.
- **Grounding tools:** `whoami` (organization, facilities with time zones, current facility date, role, scopes) and `find_*` lookups returning compact `{ id, code, name, facility }`. Get and update tools accept `id` or `code`.
- **Toolsets by workflow**, in rollout order (`feedstock-intake`, `production`, `lab`, `logistics`, `field-application`, `master-data`), filtered by the credential's scopes. Grow a toolset only when end-to-end agent evaluations of its workflow pass; a tool count is not the gate.
- **Writes:** every write tool has `dryRun`. Updates, deletes and commands take a required `expectedVersion` (reads return `version`). Creates and stock-moving commands take a **required** `requestKey`, except on dry runs (decision 32). REST creates require `Idempotency-Key` even on dry runs (decision 47). Both transports route committed writes into the same idempotency records; the description tells agents to generate one per intended write and reuse it on retry. JSON-RPC request ids are not used as keys: MCP only requires them to be unique among a sender's unanswered requests, so they repeat. No server-side dedupe by payload hash either: two identical deliveries can be real.
- **Results:** `structuredContent` conforming to an `outputSchema` that is a success/error union, plus a short text line naming the record code ("Created feedstock FS-26-0231; bin B2 now 6.8 t wet"). Domain and validation failures are results with `isError: true` and the same `code`, `issues[]`, `conflict` and `blockers` as REST. Malformed requests, unknown tools and internal server failures are protocol errors. Missing or invalid credentials, and an OAuth token lacking the scope for a write, answer at the HTTP layer (401, or 403 with `WWW-Authenticate: Bearer error="insufficient_scope"`) so the client can ask for more scope.
- **Transport security:** validate `Origin` on every request and answer 403 to an invalid one even when the bearer credential is valid. Prove the pinned handler does this or add it at the boundary.
- **Annotations** describe a tool, not a call: a write tool keeps its write annotations even though it accepts `dryRun`. `readOnlyHint` only on read and preview tools, `destructiveHint` on updates, deletes and corrections, `idempotentHint` only where idempotency records back it. Hints, never authorization.
- **Destructive operations** need the delete permission for that entity, which an Owner or Admin grants per credential (section 6) and which is off by default. Third-party grants never get it by default. That admin grant is the control. A delete is one call with `expectedVersion` and `requestKey`, with no confirmation round trip in v1. Elicitation-based confirmation needs a resumable protocol (continuation bound to principal, organization, arguments and version; no locks held across the human step; revalidation on resume) and stays out of v1. A model-supplied `confirmed: true` proves nothing.
- **Prompt injection:** notes, document text and imported descriptions are untrusted data. Tool descriptions say so, and nothing in returned content can change scopes or the target organization.
- **A short domain prompt** in v1 (wet vs dry mass, feedstock vs delivery, facility clock, from `GLOSSARY.md` terms). Registry (Isometric) submission tools are out of scope.

## 6. Authentication and authorization

| Caller | Mechanism | Organization binding | Scopes |
|---|---|---|---|
| Browser UI | Better Auth session; keeps using server actions | Active organization (unchanged) | Role checks as today |
| Scripts, internal agents (REST and MCP) | API key (`@better-auth/api-key`, matching the Better Auth version): hashed, prefixed `noma_live_` / `noma_test_`, shown once, expiring, revocable, last-used tracked | Exactly one organization, server-set at creation, immutable | Per-operation allowlist |
| First-party mobile app | OAuth 2.1 authorization code + S256 PKCE, system browser, preregistered public client, refresh token in secure storage | One organization per grant, chosen at consent; switching = new grant | Field-operator bundle, no delete by default |
| Third-party agents (MCP) | OAuth 2.1 + PKCE + consent; Client ID Metadata Documents preferred, DCR only for a needed client; RFC 8707 resource indicator | One organization per grant, shown on consent | Read by default; writes opt-in; delete separate |

**Credential issuance is locked down at the plugin, not just the UI.** Better Auth's API-key endpoints live under `/api/auth`, which the proxy does not guard. Every create, update and delete endpoint must enforce:
- Owner or Admin in the target organization through a real membership row: a Platform Admin without membership cannot mint a key for that organization;
- a verified email;
- scopes from the allowlist only;
- a mandatory expiry;
- a server-owned organization binding.
Client-editable metadata never carries authority. API-key session emulation stays off. Tests call the plugin endpoints directly.

**Scopes are enumerated per exposed operation** (`feedstocks:read`, `feedstocks:write`, `feedstocks:delete`), never wildcards. Organization management, members, credentials, Isometric imports and certification submission have no API scope in v1. Effective authority = live membership role ∩ credential scopes ∩ operation permission.

**Every request re-checks the principal.** For API keys: the key is valid, unexpired and unrevoked, and its owner is still a member with a sufficient role. For OAuth: the persisted grant binds user, organization, client, resource (audience) and scopes; each request checks the grant is active and membership is current, so a locally verified JWT alone is not enough. Refresh keeps the binding and never reads the session's active organization. REST and MCP are separate audiences; a token for one is refused by the other. A key owned by someone who left returns 401 with `credential_owner_removed`, and expiry/owner-removal notices go to organization admins.

**Better Auth upgrade (decided 2026-10-07, section 13).** Upgrade `better-auth` 1.6.23 to 1.7.7 **before Phase 2**, as its own PR with the full auth E2E, so API keys are built once on the final version. 1.7.7 changes nothing for API keys (`@better-auth/api-key` 1.7.7 is functionally the same as 1.6.x) but ships what the OAuth track needs: `@better-auth/oauth-provider` (authorization code + S256 PKCE, an org-picker step whose choice is stored on the consent, RFC 8707 resources bound to the grant, refresh rotation, introspection, revocation; uses `jwt()`), `@better-auth/cimd` (Client ID Metadata Documents) and `@better-auth/mcp` (`requireMcpAuth`, protected-resource handler; the old `mcp()` plugin moved here and needs an explicit `resource`). Core and every `@better-auth/*` package move together. The installed 1.7.7 schema requires account `accessTokenExpiresAt`, `refreshTokenExpiresAt` and `scope`, with auth lookup indexes and optional Drizzle relations; it does not require `issuer`. API-key gaps open in every version, closed by our wrapper: client `update` can clear expiry (block client updates; create and update through our own server actions calling `auth.api`), no scope-versus-role hook, rate limit defaults to 10 per 24 h, and member removal does not touch keys.

**Resolver and proxy.** `resolveApiContext(request)` in src/lib/auth/api-context.ts (new in Phase 1) accepts exactly one credential type, rejects ambiguity, never falls back from a bad bearer token to cookies, and enforces verified email itself. The proxy returns early for `/api/v1/*`, `/api/mcp`, the public OpenAPI document and the OAuth discovery documents (`/.well-known/oauth-protected-resource`, authorization-server metadata and the path aliases Better Auth 1.7 documents), **before** the session lookup (`src/lib/auth/middleware.ts:51`), so neither the session branch nor the unverified-email branch fires (`:82`, `:95`). Every other route is unchanged. Tests cover cookie-free and unverified-cookie requests and exact route boundaries (`/api/v1x` is not carved out). The OpenAPI document is exempt from `resolveApiContext`. Cookie sessions are not accepted on `/api/v1` in v1 (no CSRF surface).

**Credential management UI (the access control for API and agents).** Organization settings page, Owners and Admins only:
- create a key: name, expiry, and a permission grid of entity × read / write / delete. Read is on by default, write is opt-in, delete is off by default and needs a deliberate tick;
- list keys with owner, permissions, last use and expiry; edit permissions; revoke.

Domain guards still apply on top: a key with delete permission still cannot delete a posted product, a delivery, or anything locked by certification. Copy follows `docs/ux-writing.md`.

**Simplest principal model (v1).** The Owner or Admin who creates a key owns it; the key acts with that person's membership, capped by the permissions ticked. If the owner leaves the organization or loses the role, the key stops working: `resolveApiContext` checks live membership and role on every request (401 `credential_owner_removed`), and the organization plugin's remove-member and role-change hooks disable the owner's keys so the admin list shows them as revoked (decided 2026-10-07). A disabled key is kept until it expires, so it can be reassigned; once expired, the plugin purges it (decided 2026-10-07: Better Auth 1.7.7 deletes expired keys during key maintenance with no switch, and the audit log keeps credential ids). Upgrade path: service accounts later, with the same key format, permissions and API contract, so clients do not change.

**Service accounts** (keys not owned by a person) come once the workflows are on the API (after Phase 7). They need an `OrgContext` without a human `userId`.

## 7. Reliability and operations

- **Audit log** `api_audit_events`, written in the mutation's transaction: organization, user, credential, OAuth client, operation id, entity ids, changed field *names*, versions before and after, request id, outcome code. No values, no PII.
- **Observability:** `X-Request-Id` on every response; structured logs with ids only; metrics for latency, 4xx by code, 5xx, 409/412 rates, replays, rate-limit hits, pool waits, dry-run vs commit ratio.
- **Kill switches:** API access flag per organization, global write kill switch, per-credential revoke.
- **Caching:** organization responses `Cache-Control: private, no-store`.
- **Long-running work** (registry submission, bulk imports) stays out of CRUD routes; later via 202 + status resource.

## 8. Batches and offline (design now, build later)

- **Homogeneous batch endpoints** where the data is naturally bulk: `POST /production-runs/{id}/readings/batch` (reuse the reading-import core) and lab sample results. Bounded size, per-item results, per-item `externalId` for idempotent upserts. Readings batch with production in Phase 4, additive to v1. Lab results stay single creates for now (decision 58); a later multi-sample endpoint must allow samples from different credit batches and sampling times.
- **Offline mobile** (Phase 8, its own plan):
  - client-generated UUIDs: a matching fingerprint replays, a different payload conflicts, no foreign record is ever exposed;
  - an outbox with idempotency key and base version: on 412 the app shows the operator a comparison and never auto-merges masses, allocations or certification state;
  - a cheap cached reference download (`GET /api/v1/sync/reference` with `If-None-Match`);
  - a change feed with tombstones (`updatedSince` alone misses deletes and late commits);
  - idempotency retention equal to the maximum offline window;
  - photos created before upload completes, with a pending document state.

## 9. Testing and QA

Use the existing Vitest layout and throwaway test DB (`docs/testing.md`; Vitest uses `TEST_DATABASE_URL`, Playwright the server's `DATABASE_URL`). API suites call real route handlers and a real MCP client against Postgres; mocks only for adapter unit tests. Do not hang API checks on `test:integration` (it opts into Isometric). CI must run the migration chain, not only a schema push (`.github/workflows/ci.yml:127`).

1. **Domain outcome tests (the oracle).** For each exposed operation: independently specified expected persisted state, stock effects, transport legs and warnings, with fixed clocks and seeded state. Cases include omitted/null/zero, DST gap and fold in facility-local times, the sample start-day boundary, duplicate codes, kg-to-tonnes conversion exactly once, post-commit enrichment failure.
2. **Transport parity.** Equivalent decoded commands through server action, REST and MCP give the same outcome code, issue paths, warnings and committed rows. Each transport's accepted and rejected *encodings* are tested separately (forms send `"12.5"`, REST may too). Each registered operation has a named, parameterized outcome and parity suite. A custom manifest is added only if the ordinary runner misses omissions. Phase 2 needs action vs REST; three-way parity starts with MCP in Phase 3.
3. **Authorization (BOLA first).**
   - Two organizations with valid ids each; foreign ids in path, body, filters, cursors and lookups return 404 with no side effect. Same-organization children under the wrong parent are refused.
   - Replay after revocation, role downgrade or membership removal is refused.
   - Cookie-only requests, ambiguous credentials, and a bad bearer token alongside a valid cookie are rejected.
   - Credential plugin endpoints are called directly to try scope escalation, a forged organization binding, a Platform Admin without membership, and a missing expiry.
   - 404 precedence is defined: a malformed cursor is 400 and a missing scope is 403.
4. **Concurrency and idempotency (real Postgres, barriers, separate connections):**
   - parallel duplicate POSTs give one row, one stock effect, one audit row and one record;
   - the second request answers 409 before the first is released;
   - same key with a different operation, target, precondition or credential, reordered JSON, expiry, lost response, rollback then retry;
   - a forced auto-code collision recovers inside the transaction;
   - UI vs REST update races, update vs delete, correction vs application, certification lock vs mutation;
   - sibling writes and cascades bump every affected version;
   - multi-bin lock ordering.
5. **Schema generation:** deterministic output; semantic assertions per exposed schema (types, bounds, required, formats, enums); every field described with its unit; typecheck plus representative form submissions after any schema change. `oasdiff` breaking-change baseline from the first REST release (Phase 2).
6. **Fuzzing:** Schemathesis from OpenAPI (coercion, null/omit/zero, unknown fields, 413/415/405, oversize), plus hand-written tests for refinements JSON Schema cannot express. From Phase 4.
7. **MCP protocol:**
   - discovery and scope-filtered tool lists, and a direct call to a hidden tool, which is refused;
   - a hostile `Origin` with a valid key is answered with 403; unknown tools and internal failures produce protocol errors; a REST-committed key retried over MCP replays;
   - output-schema conformance for success and error, malformed arguments, unknown tools, replay after disconnect;
   - on the OAuth track: wrong audience and issuer, PKCE, consent scope escalation, refresh reuse, CIMD SSRF refusal.
   A checklist pins the named client versions.
8. **Agent evaluations** per toolset: scripted operator requests ("log 4.2 t wet wood chips from supplier X into bin B2, then start a run on R1"), scored on correct records, units, facility date and number of tool calls.
9. **Reliability:**
   - kill switches and shared rate limits;
   - at pool size 1, hold the connection past a request's deadline, release it, and prove the timed-out request never writes;
   - many short statements that together exceed the budget;
   - cancellation just before `COMMIT`;
   - a lost commit acknowledgement, recovered by retrying with the same key;
   - UI and API version races in both orders.
10. **E2E:** Playwright for credential management, and "API write shows in the UI".

## 10. Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| 0. Spike | (a) Generate schemas for feedstock intake, production run and the intake lookups; constraint metadata on piped helpers; strict calendar-date decoder; `z.date()` and optional-preprocess overrides. (b) Run feedstock intake create (feedstock + bin allocation + transport) through a runner-owned transaction with savepointed `withAutoCode`, pool size 1. (c) Prototype the idempotency claim protocol under concurrency, with the transport-neutral outcome and dry-run rules. (e) Runner deadline and cancellation tests at pool size 1. (d) `mcp-handler` 2.x hello-world against Claude Code. | Generated pilot schemas pass semantic assertions incl. `multipleOf` and calendar dates; timed-out request never writes; no self-deadlock at pool 1; duplicate claim answers 409 within the application deadline (pool wait included); libraries pinned; decisions written into this plan |
| 1a. Foundations | `runOperation` + registry with after-commit hooks, schema generation overrides, `DomainError` + `issues` in `ActionResult`, CI runs the migration chain (today it runs `drizzle-kit push --force`, `.github/workflows/ci.yml:127`). Feedstock actions move onto operations. Integer `version` on feedstocks, UI sends `expectedVersion` (mandatory) and `expectedUpdatedAt` is retired there. `transaction_timeout` for the whole-transaction deadline once staging's Postgres version is confirmed (17+). The operations layer gets its place in `docs/architecture.md`. | UI behaviour unchanged (existing tests green); runner and error-mapping unit tests |
| 1b. Versions and dates | Integer `version` on **every other entity with an edit form**, following 1a's pattern, with `expectedUpdatedAt` retired; strict calendar dates for samples, production incidents and production runs | UI behaviour unchanged apart from the stricter dates; version-conflict tests per entity |
| 1.5 Better Auth 1.7.7 (parallel with Phase 1, merged before Phase 2) | Upgrade core and plugins together as its own PR; account token-expiry/scope migration (no `issuer` in 1.7.7); auth indexes and relations; full auth E2E | Auth E2E green; no session or organization regressions |
| 2. REST pilot: feedstock intake | `/api/v1/feedstocks` CRUD with dry run and stock preview; **read-only** lookups intake needs (facilities, suppliers + locations, feedstock types, storage locations, vehicles, drivers); API keys with the permission grid; `/me`; problem+json; ETag/If-Match; idempotency records + audit; rate limits; public OpenAPI | Outcome, action-vs-REST parity, BOLA, idempotency, stock-race and version-cascade suites green |
| 3. MCP on API keys | `/api/mcp` with `whoami`, `find_*` and the `feedstock-intake` toolset | Three-way parity; agent eval for "log 4.2 t wet wood chips from supplier X into bin B2" passes |
| 4. Production | Production runs (feedstock draws, output stock), then biochar products (stock posting, corrections) | Stock invariants and races per operation; agent eval "start a run on R1 with that feedstock"; Schemathesis on |
| 5. Lab and logistics | Lab samples (5a, single creates only, decision 58), then orders and deliveries | Per-operation outcome, parity, authorization and stock tests |
| 6. Field application | Applications with evidence documents (upload request, presigned PUT, confirm) | Same, plus document upload tests |
| 7. Master data writes | Suppliers, customers, formulations (reads already exist from Phase 2) | Same |
| OAuth track (starts when Phase 3 lands) | `@better-auth/oauth-provider` + `@better-auth/cimd` + `@better-auth/mcp` on 1.7.7 (already upgraded in 1.5): consent with organization choice, grant checks, discovery documents; mobile public client; claude.ai and ChatGPT connectors | OAuth test list green; named connectors work |
| 8. Offline mobile | Change feed, client ids, reference sync, outbox, longer idempotency retention | Separate plan |

Order follows the operator workflow (Kenji, 2026-10-06). Starting with feedstock intake means the pilot is also the hardest case (compound create, bin stock, transport). That is deliberate, and it is why Phase 0 proves the transaction and lock design on exactly that write. Credit batches stay UI-only until a client needs them; lab samples reference them through read-only lookups.

## 11. Not now

Generic table CRUD, arbitrary bulk endpoints, `include`, multiple sort orders, webhooks, GraphQL, a separate MCP deployment, registry submission over the API, service accounts, cookie-authenticated `/api/v1`, server-side payload-hash dedupe.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Validation drift between UI and API | Operations move action bodies; one schema per operation; outcome + parity tests gate the registry |
| Cross-organization access | Organization bound to credential; data-access predicates stay; 404 for foreign ids; BOLA suite |
| Credential misuse or escalation | Locked plugin endpoints, membership required to mint, per-operation scopes, no admin override, separate delete scope, kill switches |
| Revoked OAuth grants still working | Persisted grant + per-request grant and membership check |
| Duplicate stock movements from retries | Idempotency records in the write's transaction; claim protocol tested with barriers |
| Lost updates | Mandatory preconditions; integer version bumped by every writer incl. cascades |
| Transaction self-deadlock or aborted retries | Runner-owned `tx` for every read and write (audit row included); review the call graph for stray global-`db` use; savepointed auto-code; Phase 0 proves it at pool size 1 |
| Generated schema looser than runtime | Zod stays the authority; CI rejects `{}`; refinements documented |
| Agents writing the wrong record or unit | Code lookups, `whoami`, unit-named fields, dry run, actionable errors, agent evals |
| Better Auth 1.7 and MCP SDK churn | Upgrade as its own PR; pin versions; interop checklist |
| Scope creep | Registry-gated rollout by workflow, not by table |

## 13. Decisions (Kenji, 2026-10-06)

1. **Order:** feedstock intake, production run, biochar products, lab samples, order, delivery, application, supplier, customer, formulation (section 10).
2. **Principal:** simplest upgradeable model: keys owned by the Owner or Admin who creates them, capped by ticked permissions; service accounts later without client changes (section 6).
3. **Clients:** Claude Code (and other header-capable clients) on API keys from Phase 3; claude.ai and ChatGPT connectors and the mobile app on the OAuth track.
4. **Deletes:** allowed for agents and apps, controlled per key by an Owner or Admin through the permission grid (delete off by default); domain guards still refuse protected deletes.
5. **Idempotency retention:** 7 days as a config constant; raised for offline mobile.
6. **Input leniency:** keep the lenient input that shared schemas give for free; publish canonical types.

Decided 2026-10-07 (Kenji, via the open-questions round):

7. **DST fall-back times:** rejected, as `combineDateAndTime` does for the UI; clients send an RFC 3339 instant with an offset for the repeated hour.
8. **Credential expiry:** 90 days default, 1 year maximum; admins notified 14 days before expiry.
9. **Rate limits (starting values in `@/config`):** reads 600/min per credential and 1,200/min per organization; writes (dry runs included) 120/min per credential and 240/min per organization; pre-auth 300/min per IP. Revisited after the first agent evaluations.
10. **Strict calendar dates** for samples, production incidents and production runs land in Phase 1, not per entity.
11. **Integer `version`** on every entity with an edit form in Phase 1; `expectedUpdatedAt` retired at once.
12. **The MCP spike route** merges with #919 and stays until Phase 3 replaces it.
13. **Idempotency purge:** a daily Vercel Cron route (the repo's first; needs `CRON_SECRET` in all three 1Password items).
14. **#919 and Phase 1:** review-suite cutoff applies; Phase 1 is implemented by Codex (gpt-6-astra for migrations, runner wiring and auth; gpt-6.1-sol for UI forms and tests), scoped and inspected by Claude.
15. **Better Auth:** upgrade to 1.7.7 before Phase 2 (section 6); changed from the recommendation to stay on 1.6 until the OAuth track.
16. **Key owner leaves or loses the role:** per-request membership check plus disabling the keys in the organization hooks (section 6).

Decided 2026-10-07 (Kenji, round 2):

17. **Better Auth 1.7.7 runs in parallel with Phase 1:** its own worktree and PR, implemented by gpt-6-astra, merged before Phase 2 starts so API keys are built on `@better-auth/api-key` 1.7.7.
18. **Phase 3 ships API keys only;** the OAuth track (claude.ai and ChatGPT connectors, mobile app) starts as soon as Phase 3 lands.
19. **Phase 1 ships as two PRs.** 1a: runner wiring, `DomainError` codes and issue paths in `ActionResult`, the registry, CI on the migration chain, `version` on feedstocks. 1b: `version` on every other edit form and the remaining strict calendar dates, following 1a's version pattern.

Decided 2026-10-08 (Kenji, round 3, Phase 2b):

20. **Phase 2b ships as three PRs.** 2b-1: idempotency purge cron, audit log, rate limiter, kill switches. 2b-2: feedstock endpoints, read-only lookups, ETag/`If-Match`, unknown-key rejection, parity and BOLA suites. 2b-3: OpenAPI document, `oasdiff` in CI, docs and `llms.txt`.
21. **2b-1 and 2b-2 run in parallel;** 2b-1 merges first (it alone adds a migration) and 2b-2 rebases onto it to wire in the audit and the guards.
22. **Staging keeps the `noma_live_` prefix.** No deployment-stage variable; the prefix follows `NODE_ENV` only.
23. **`CRON_SECRET`** is added by Kenji with a wizard script covering the three 1Password items and Vercel. The cron route fails closed without it.
24. **Global write kill switch** is the env var `API_WRITES_DISABLED` (503 on API writes, reads unaffected); flipping it needs a redeploy.
25. **Per-organization API access** is on by default; only Platform Admins turn it off (403 `api_access_disabled`).
26. **The pre-auth per-IP limit** uses the same Postgres token bucket as the credential and organization limits.
27. **The audit log covers API writes only;** UI writes keep their existing history.
28. **`oasdiff` fails CI on a breaking change;** a deliberate break updates the committed baseline in the same PR.

Decided 2026-10-09 (Kenji, round 4, Phase 3):

29. **Phase 3 ships as two PRs.** 3a: representations move, `/api/mcp` on API keys, `whoami` and the read tools, protocol and BOLA tests. 3b: the three feedstock write tools, three-way parity, the domain prompt and the agent evaluation.
30. **Representations are transport-neutral** and live in `src/lib/representations/`; REST, MCP and the OpenAPI generator import them from there.
31. **MCP results reuse the REST representations unchanged.** `structuredContent` is the REST body (list or item envelope), the success branch of `outputSchema` is the OpenAPI response schema, and a text line names the record.
32. **`requestKey` is required on every MCP write tool** (dry runs excepted), with the `Idempotency-Key` format and the same per-credential idempotency records, so a key first used over REST replays over MCP.
33. **Read tools:** `whoami`, `find_*` for all eight REST lists (facilities, suppliers, supplier locations, feedstock types, storage locations, vehicles, drivers, feedstocks) and `get_feedstock`. Lookups have no `get_*` tool; the exact `code` filter covers it.
34. **Rate limits answer at HTTP** (429, same buckets as REST; a `tools/call` of a write tool counts as a write). **`API_WRITES_DISABLED` answers inside MCP** as an `isError` tool result with code `api_writes_disabled`, so reads keep working.
35. **`api_audit_events` gains a `transport` column** (`rest` or `mcp`, default `rest`) in 3b.
36. **The domain prompt is the server's `instructions`** on initialize, built from the same source as `llms.txt`.
37. **The agent evaluation is a local script** (`pnpm eval:mcp`): app on the test database, seeded fixture organization, a fresh key, Claude Code headless (`claude -p`) with the MCP config on the subscription, scored by the rows written. Run before merge; results go in the PR.

Decided 2026-10-09 (Kenji, round 5, Phase 4):

38. **Phase 4 ships as three PRs.** 4a: production runs (operation move, API input schema, REST, MCP, stock effects on dry runs, eval). 4s: Schemathesis, in parallel with 4a. 4b: biochar products and output-bin stock movements, started once 4a is in review.
39. **Runs expose create, update and delete only.** Completing, failing and cancelling are a PATCH of `status`. The readings batch (section 8) and incidents are deferred (`docs/open-questions.md`).
40. **Run times take both shapes:** an RFC 3339 instant with an explicit offset, or facility-local `{ date, time }`. A date-time without an offset is refused, and a DST fall-back stays refused (decision 7). The legacy `feedstockWetMassKg` is dropped from the API.
41. **"Now" comes from `whoami`:** `whoami` and `/me` report each facility's current local time next to `today`, and the domain prompt tells agents to use it.
42. **The run evaluation passes when no draw mass is invented.** The chained case passes on a running run with no draw where the agent says the mass is still needed, or on nothing saved where the agent asks for it; any draw mass fails. A second case that names the mass is scored on the run, the draw and the bin's stock.
43. **Products take POST and PATCH (code, status, density), no DELETE.** Output-bin loss, count and correction go through `POST /storage-locations/{id}/stock-movements` (MCP `record_output_stock_movement`).
44. **Stock corrections need their own scope,** `stock-corrections:write` (hyphenated like the existing scopes): off by default, granted per key like deletes, annotated destructive. Losses and counts need `biochar-products:write`.
45. **Product create takes an optional `basisFingerprint`** from a dry run; if stock moved since, it answers 409 `stock_basis_changed` with the new preview.
46. **Stock effects on dry runs land with runs:** feedstock PATCH and DELETE and every run write return the stock-effects shape in 4a; 4b reuses it. Schemathesis runs in CI against a production build on the CI Postgres, path-filtered to the API, with a bounded example count.

Decided 2026-10-09 (supervisor decision during Phase 4s, from the first Schemathesis run):

47. **REST creates require `Idempotency-Key` on every request, including dry runs.** OpenAPI cannot express a conditional requirement, and one rule is simpler for HTTP clients. A dry run still never claims or consumes the key. MCP keeps `requestKey` optional on dry runs (decision 32), a deliberate transport difference.

Decided 2026-10-09 (supervisor decision during Phase 4a review):

48. **Production-run responses carry UTC instants and reference ids only**, without facility codes or the facility time zone. A joined mutable field would change the response body under an unchanged strong ETag. Clients read the zone from `/facilities` or `whoami`.
49. **The operation runner retries operations aborted before COMMIT** with a deadlock (40P01), serialization failure (40001) or lock timeout (55P03), up to a fixed attempt cap within the original deadline. Exhausted retries answer the retryable `concurrent_write_retry` (409). Claim-lock waits still answer `idempotency_in_progress`, and an exhausted deadline answers `deadline_exceeded`. See `data/lock-order` in [open questions](../open-questions-architecture.md#run-writers-feedstock-edits-and-output-postings-lock-in-different-orders-datalock-order-opened-2026-10-09).

Decided 2026-10-12 (Kenji, round 6, Phase 4b):

50. **No stock corrections on the API for now.** This amends decisions 43 and 44: the `stock-corrections:write` scope is not added, REST and MCP take no `correctsMovementId`, and the published movement `kind` is `loss | count`. The UI keeps its corrections; the operation may carry `correctsMovementId` as an unpublished field for the UI. Movement history stays readable (decision 55). API corrections are in the backlog (`api/stock-corrections` in [open questions](../open-questions-architecture.md#output-stock-corrections-are-not-on-the-api-apistock-corrections-opened-2026-10-12)).
51. **Every layer whose moisture reading changes passes the certification-lineage guard,** not only the layers drawn from. A count on a bin holding certified material is refused with `certification_locked`. This applies to the UI too, including the original readings a UI correction removes.
52. **Product create takes the parts, not the blend:** `biocharWetMassKg` as weighed, `biocharMoisturePercent`, `waterAddedKg` (required) and `ingredients[]` with wet mass and moisture each. The server derives the stored blend `massKg` exactly as the form does.
53. **Stock movements take an optional `basisFingerprint` and no `expectedProductVersions`.** A stale fingerprint answers 409 `stock_basis_changed` with `preview`. Named exception to the version rule: without a fingerprint, a stock command acts on current stock under the bin lock.
54. **Delivery corrections stay off the API** (moot under decision 50).
55. **Discovery reads:** `GET /formulations[/{idOrCode}]` with lines `{ id, feedstockTypeId, ratio }` (scope `formulations:read`, on by default) and `find_formulations`; `GET /storage-locations/{id}/stock-movements` (scope `biochar-products:read`, read-only) and `find_output_stock_movements`. Sub-bin reads shipped in [PR C](#20-pr-c-results-2026-10-14).
56. **Future event times are refused** for product `placedAt` and movement `occurredAt`, in the app and the API, as for runs (`src/data-access/production-runs/future-time.ts`). Backdating stays allowed.

Decided 2026-10-13 (Kenji, round 7, Phase 5a). The numbering continues from decision 56; no renumbering was needed.

57. **Phase 5a is lab samples only** (Q48). Orders and deliveries get their own spec. Kenji asked about photographing a lab report and having AI fill the fields: issue #329 ("upload lab results file and autofill sample chemistry entries") already covers it and stays out of 5a.
58. **Lab samples are created one at a time** (Q49). There is no `POST /lab-samples/batch` and no `record_lab_samples`. Kenji's note: it should be possible to save several samples, but they usually come from different production dates, so a future multi-sample endpoint must not assume one credit batch or one sampling time (`api/multi-sample-create` in [open questions](../open-questions-architecture.md#a-multi-sample-create-must-not-assume-one-credit-batch-or-one-sampling-time-apimulti-sample-create-opened-2026-10-13)).
59. **The server derives the ratios** (Q50). H/C_org is always calculated from hydrogen and organic carbon, or empty when either is missing, including after an input is cleared. O/C_org is calculated whenever oxygen is present; a sent O/C_org is stored only when oxygen is absent. Values round to 4 decimals and anything above the column cap is refused, never clamped. The reply says the ratio was calculated, for example "H/C_org calculated from hydrogen and organic carbon: 0.2979"; the MCP result text says the same.
60. **Sampling times are read in the facility's zone** (Q51). The form switches from the browser zone to the credit batch facility's zone. The zone comes back on requests: the facility representation has `timeZone`, and `whoami` and `/me` give the facility's current local time. Tool descriptions point agents there.
61. **Certification gaps warn and do not block at entry** (Q52). The warnings mirror what readiness and the 1,000-year checks will require (complete H/C_org and O/C_org, measured inorganic carbon and S on every 1,000-year sample, sampling before the batch window).
62. **TGA stays required for 1,000-year batches, and fewer than 500 R0 readings only warns** (Q53). Kenji asked whether a removal can still be submitted below 500 readings: yes, the module says "should", so it is a warning and not a submission blocker, and the warning text says so. Biochar Agricultural Soils module v1.1 never mentions TGA, so `isometric/tga-1000-year-requirement` stays a `needs-registry-check` question.
63. **Submission blocks while a replicate in the submitted H/C mean lacks its paired O/C** (Q54). Separate small PR #948 with a four-replicate regression test, run in parallel with 5a. Operator copy follows `docs/ux-writing.md`.
64. **Batch edits that move the window past existing samples are allowed** (Q55). Readiness flags samples before the new window (submission already blocks them); there is no batch-edit refusal.
65. **Create, update and move are refused on an archived credit batch** (Q56), in the app and the API. Reads still work. Delete is not named in the answer and stays allowed.
66. **`lab-samples:delete` is off by default** (Q57). PATCH accepts `code` and a move to another credit batch.
67. **The sub-bin stock read is its own follow-up PR after 5a** (Q58). It shipped in [PR C](#20-pr-c-results-2026-10-14), designed as in the Phase 5a spec: one consistent snapshot and one evaluation instant, deterministic serialization, ETag = hash of the published body.
68. **Stock corrections stay UI-only** (Q59). They stay in the backlog as `api/stock-corrections`.

Decided 2026-10-13 (Kenji, round 8, PR C). These answers override the earlier round 8 placeholders.

69. **Only output bins answer the stock read** (Q60). Biochar and product bins answer; a feedstock bin returns 422 `validation_failed`.
70. **Mix bins show runs plus one pile moisture** (Q61). Held layers carry dry biochar and solids; each layer's wet mass, moisture and basis are null. The pile's figures are in `totals`.
71. **Unresolved stock answers 200 as stock unknown** (Q62). The body has a fixed reason sentence, `totals: null` and no sub-bins. Kenji noted that a finished run's dry biochar mass will become required. Staging #960, commit `4cb221b94` ("require output bin and moisture on completed runs"), now requires output kg, output bin and moisture on completion, from which dry mass is derived. The unresolved run path remains for older data; no new completion rule is needed here.
72. **The read carries stock figures only** (Q63). No recent movements or product source runs. Use movement history and the product detail read for those.

Decided 2026-10-14 (Kenji, round 9, Phase 5b).

73. **Phase 5b ships as two PRs** (Q64). 5b-1 `feat/api-orders` ships customer and customer location lookups, orders, the order balance read, and storage-location `formulationId` with `type` and `formulationId` filters. 5b-2 `feat/api-deliveries` follows. They are not stacked; shared files in 5b-2 integrate after rebasing on merged 5b-1.
74. **Orders and deliveries keep their plain names** (Q65). 5b-1 ships `/orders` and `record_order`; 5b-2 ships `/deliveries`, `record_delivery` and `deliveredAt`. Descriptions distinguish a product delivery from feedstock intake (`log_feedstock_delivery`).
75. **Order balance is a separate read** (Q66). 5b-1 ships `GET /orders/{id}/balance` and `get_order_balance`, with `{ orderId, quantityKg, deliveredWetMassKg, remainingWetMassKg, fulfillmentStatus }` from one snapshot and an ETag hashing the published body, as in decision 67. The order body carries stored fields only (decision 48); delivery writes in 5b-2 do not bump the order version.
76. **The stock read carries the bin's draw order** (Q67). 5b-2 commit 3 adds `drawOrder: "oldest_first" | "newest_first" | null` to `get_bin_stock`, null for mix bins, and raises its representation revision to 2. Sub-bins stay listed oldest first.
77. **Customer lookup excludes contact details** (Q68). 5b-1 returns customers as `{ id, code, name, version, createdAt, updatedAt }` and locations with `{ id, customerId, name, gpsLatitude, gpsLongitude, distanceFromFacilityKm, distanceSource, isDefault, version, createdAt, updatedAt }`. Distance is one-way km. No email, phone, address or soil temperature is published.
78. **A submitted Removal locks the order against new deliveries** (Q69). 5b-2 keeps the app's refusal as typed `certification_locked` with a pointer. 5b-1 commit 1 records `certification/order-lineage-lock` in [open questions](../open-questions-architecture.md#a-submitted-removal-locks-an-order-against-further-deliveries-certificationorder-lineage-lock-opened-2026-10-14): allowing further deliveries needs a check that derived per-product transport legs of submitted products cannot move, in the app and the API. Long-running partial-delivery orders need a second order today.
79. **Delivery previews and saved results show the drawn products** (Q70). 5b-2 returns `allocations[]` with `layerId`, product `code`, `dryBiocharKg`, `solidsKg`, `wetKg`, `moisturePercent` and `policy` on dry run and write. Bin-level `stockEffects` stays unchanged. Tool descriptions keep the promise that the dry run shows which products will be drawn.

Confirmed without another question:

- Delivery mass and moisture fixes in 5b-2 follow decisions 50, 54 and 68; the API does not expose corrections.
- The optional `basisFingerprint` and stale-fingerprint 409 `stock_basis_changed` with a fresh preview in 5b-2 follow decisions 45 and 53.

80. **Orders have their own delete scope and deliveries have no delete.** 5b-1 ships `orders:delete`, off by default as in decisions 4 and 66, and deletion works only while the order has no deliveries, including archived deliveries. 5b-2 adds no delivery DELETE route or delete scope.
81. **Future delivery times are refused in the app and the API.** 5b-2 extends decision 56 to `deliveredAt`, closing the app's delivery-create gap. An instant equal to now is allowed.
82. **A distance override must be greater than zero.** 5b-2 enforces this in the app and the API. Inputs remain one-way km and the server counts the round trip. Omit `distanceKmOverride` to use the customer location's distance; zero no longer silently falls back to it.
83. **Archive rules apply at each write.** 5b-1 extends decision 65: order create on an archived facility and PATCH on an archived order or facility are refused; an archived order with no deliveries may still be deleted. 5b-2 refuses delivery create on an archived order or facility and PATCH on an archived delivery or facility. Archive refusals answer 404 `not_found` with a pointer, as feedstocks and lab samples do. Archived orders and deliveries remain readable.
84. **Delivery evidence stays in app uploads until the field application phase.** 5b-1 keeps order uploads in the app; 5b-2 keeps receipts, bills of lading and delivery photos there too. A delivery with no bill of lading receives a non-blocking warning in 5b-2.
85. **One delivery is recorded per request and its facility comes from the order.** 5b-2 publishes no delivery `facilityId`. The single-create pattern follows decision 58.
86. **The shared app paths get copy and omitted-field fixes.** 5b-1 commit 1 fixes "Select a order" to "Select an order", choosing the article for every lineage label. 5b-2 fixes delivery edits so an omitted `distanceNote` keeps the stored note.

Decided 2026-10-15 (Kenji, round 10, Phase 6).

87. **Phase 6 ships documents first** (Q71). 6a `feat/api-documents` exposes evidence uploads for API records; 6b `feat/api-applications` follows. They are not stacked.
88. **Document routes nest under their record** (Q72). `/{owner}/{id}/documents` uses the owner's read and write scopes; there is no documents scope.
89. **Feedstocks, deliveries, lab samples and applications accept API uploads** (Q73), each with the document types its app uploader offers. The app keeps every record type it supports today.
90. **Documents cannot be deleted over the API** (Q74). There is no DELETE route, MCP tool or `documents:delete` scope; deletion stays in the app with certification safety.
91. **A submitted Removal freezes its records' documents** (Q75). Once a record's lineage holds a submitted Removal or GHG statement, uploads, confirmations, deletions, reclassification and visibility changes on that record are refused with `certification_locked`, in the app and the API. A confirmation that loses this race fails the upload and queues its files for deletion. Server-generated ledgers and reports are exempt.
92. **Agents upload through a presigned link** (Q76). Files never travel in API bodies; chat connectors wait for the OAuth track.
93. **Remaining delivery mass is a separate read** (Q77). `GET /deliveries/{id}/application-balance` and `get_delivery_application_balance` return remaining wet mass and site defaults from one snapshot with a body-hash ETag; `hasRemainingMass=true` filters the delivery list. Application writes do not bump the delivery version.
94. **A new application copies site defaults** (Q78). An omitted GPS pair (location method) and soil temperature come from the customer location or facility default, and a warning names each copy. PATCH never fills defaults.
95. **The GIS reference method needs a boundary** (Q79), in the app and the API, on create and after a PATCH merge. This settles #942 q14.

Confirmed without another question:

96. **Application scopes:** `applications:read` on by default, `applications:write` opt-in, `applications:delete` off by default.
97. **Application names and units:** `/applications` and `record_application`; the API takes `appliedWetMassKg` and derives `dryBiocharKg`; the form field becomes kg-named and is converted once.
98. **Application dates:** `applicationDate` is a calendar date compared with the delivery's facility-local day. It cannot be before the delivery or in the future, in the app and the API.
99. **Application archive:** create and PATCH on an archived delivery or facility answer 404 `not_found`; delete stays allowed. One application per request.
100. **No application stock fingerprint:** capacity is rechecked under the delivery lock, and the committed allocations are authoritative.
101. **No Isometric over the API:** the `visual` method stays unavailable; Removal-owned slices refuse mass, delivery and delete edits; submitted lineage refuses every edit.
102. **Upload rules:** upload request and confirm have no dry run, and REST upload requests require `Idempotency-Key`. Confirm keeps no idempotency record and takes no `If-Match` (named exceptions). Documents stay private on the API. Clients declare a SHA-256; the server verifies size and SHA-256 before promoting bytes to a server-only key.
103. **The bill-of-lading warning** stays create-only and points to the API upload.

Decided 2026-10-16 (Kenji, round 11, Phase 7).

104. **Phase 7 ships in three PRs** (Q80). 7a `feat/api-formulations` starts now and merges after #1080; 7b `feat/api-parties` (supplier and customer create, update, delete) follows #1080; 7c `feat/api-party-locations` (location writes, the distance fill on older records, the storage-site fence) follows 7b.
105. **Agents read and write places and site defaults, not contact details** (Q81). Country, region, city, site description, default soil temperature, facility distances, the customer's crop type and the supplier's source region join the API. Contact names, emails, phones and addresses stay in the app (Q68 stands for them); as Q81 option A stated, the customer location's site description (stored in the `address` column) is a place description published as `siteDescription`, while supplier location `address` and customer `address` stay in the app.
106. **Supplier, customer, location and formulation changes show in Activity** (Q82). Supplier, Supplier location, Customer, Customer location and Formulation become Activity record types with their own filter, after the custody chain and before Removals. Every write leaves one entry, from the app or the API.
107. **Suppliers, customers and formulations get archive and restore now** (Q83, against the recommendation). An archived record leaves the pickers and cannot be used for new intakes, orders, products or bin claims (decision 83 pattern); old records keep it. Archive and restore are their own operations.
108. **Deleting a customer deletes its locations** (Q84), as for suppliers, in the app and the API. It is refused while an order uses the customer or any of its locations is a registered Isometric storage site; then nothing is deleted.
109. **A registered storage site keeps its name and GPS** (Q85). Changes are refused in the app and the API; a save that sets them back to the registered values passes. Other fields stay editable. A real move means a new location.
110. **A feedstock type used by a formulation keeps its blend-ingredient use** (Q86). The change is refused until the ingredient is replaced.

Confirmed without another question:

111. **Scopes:** `formulations|suppliers|customers:write` opt-in, `:delete` off by default. Location deletes use the party's delete scope.
112. **In-use records cannot be deleted:** a supplier, customer, location or formulation used by an intake, order, delivery, product or bin is refused with the users listed. Three cases that fail with a database error today get this message, in the app too.
113. **Codes are server-generated** and can be changed later.
114. **Facility distances follow #1080:** one-way kilometres, the server doubles for the round trip, older intakes and deliveries without a distance are filled, submitted lineage is never touched.
115. **Formulations stay editable after products are made;** each product keeps its recipe. Removing an ingredient that products used is refused.
116. **Nothing goes to Isometric over the API;** storage sites are registered only in the app.
117. **One supplier or customer per request with 1 to 50 locations; one formulation per request.**
118. **Bin saves lock the formulation:** bin create, update and quick-add take the formulation `FOR SHARE`, so a bin cannot point at a formulation being deleted (found in review, fixed in the app too).
119. **Customer locations get their own archive and restore in 7c** (Q87). Archived locations leave the order destination picker and new order destinations return 404 at `/customerLocationId`; existing orders, deliveries, applications and storage-site registration keep them. Archiving the default moves it to another active location; archiving the last active location is refused. `archive_customer_location` and `restore_customer_location` use `POST /customers/{id}/locations/{locationId}/archive|restore`, `customers:write`, If-Match and Activity status changes, with a 7c migration. Supplier locations get no archive.
120. **Deliveries and applications on an existing order still save when its customer or formulation is archived** (Q88). Keep the existing behavior and every lineage refusal.

## 14. What review changed

| Change | Raised by |
|---|---|
| Canonical/form schema split dropped (Fable 5.1); the helper rewrite proposed instead was also dropped after a check showed Zod 4.3.6 already generates preprocess schemas with bounds, while transformed unions lose them | gpt-6.1-sol, verified locally |
| PATCH: decode, then validate merged state in the writer; "the only parse" dropped | gpt-6-astra, gpt-6.1-sol |
| Runner-owned transaction, savepointed `withAutoCode`, pool-size-1 deadlock check in Phase 0 | gpt-6-astra, Fable 5.1 |
| Idempotency claim protocol (`ON CONFLICT` + `lock_timeout`), replay before precondition, re-authorized replays, PII in stored responses | all three engineering reviews |
| ETag stability (request id to header, no includes), version bump by every writer incl. siblings | gpt-6-astra, gpt-6.1-sol |
| Credential issuance locked at the plugin endpoints; membership required to mint; per-operation scopes excluding admin operations | gpt-6-astra, Fable 5.1 |
| Persisted OAuth grant checks; separate audiences; `mcp()` replaces `oauthProvider()` in 1.7; discovery routes through the proxy | gpt-6-astra, gpt-6.1-sol |
| MCP on API keys in Phase 3, OAuth on a parallel track; Better Auth upgrade opens the OAuth track unless the spike says otherwise | Fable 5.1 (gpt-6-astra preferred upgrading first) |
| MCP: `expectedVersion`, `requestKey`, success/error output union, `dryRun`, `whoami`, `find_*`, verb-first names | all four |
| Codes and `?q=` lookup, reference errors with candidates, facility time-zone semantics, `/me`, unit-named fields, actionable error metadata, public OpenAPI, generated client | Sonnet 5.5, Fable 5.1 |
| Client-supplied ids deferred to offline; no payload-hash dedupe | gpt-6-astra (Sonnet proposed v1) |
| No `include`, one cursor ordering; Postgres rate limiter; oasdiff/Schemathesis from Phase 4 | Fable 5.1, gpt-6-astra |
| Testing: independent outcome oracle, encoding tests per transport, barrier races, direct plugin-endpoint tests, migrations in CI | gpt-6.1-sol, gpt-6-astra |
| Fact fixes: sample check is lower-bound only; application kg/t conversion is intentional; better-auth is `^1.6.23`; fuller fn-only inventory | gpt-6.1-sol |
| Glossary: `master-data`, "organization" not "tenant", "client" only for OAuth clients | Fable 5.1 |
| Final round: claim timeout on the INSERT with rollback on timeout; dry run keeps external effects out via after-commit hooks; required MCP `requestKey` (no JSON-RPC id fallback); annotations per tool; proxy early return before session lookup; executed-case manifest; Better Auth upgrade opens the OAuth track; CI migrations in Phase 1 | gpt-6.1-sol, Fable 5.1 |
| Third review: strict calendar-date decoder; constraint metadata for piped helpers; runner deadline and unknown-outcome rule; credential-scoped idempotency with transport-neutral outcomes and dry-run rules; mandatory UI version checks; command `expectedVersion`; MCP `Origin`, scope challenges, protocol errors; durable enqueued external work; pre-auth limits; unknown-field rejection; oasdiff from Phase 2; plans header. Not adopted: suppliers first and agent deletes off (Kenji decided otherwise); deletes stay admin-controlled, without elicitation | independent reviewer; both schema probes reproduced locally |

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


## 25. Phase 7a results (2026-10-16)

**Shipped on `feat/api-formulations`:** formulation create, update, delete,
archive and restore through the shared runner, REST and MCP; revision 2 reads;
scoped agent evals and fuzz examples. Supplier and customer writes follow in 7b.

**What shipped, by commit:**

1. Writers (`743e25c18`, `991570b64`): transaction writers, typed refusals,
   savepointed codes, exact ratio totals, order delete guard and used-line guard.
   App actions use the runner. New bin claims lock formulations; archived
   formulations refuse new product, order and bin references while kept references
   pass. Schema preparation (`56cb12b57`) adds `archived_at` and master-data
   Activity types. Archive/restore bump version and record `status_changed`.
2. Registry (`835f1cf7f`): five operations, separate read/write/delete scopes,
   formulation revision 2, real `archivedAt`, description and archived-only list
   filtering with cursor binding. Archived detail reads remain available.
3. REST (`1848b7e96`): POST, PATCH, DELETE and archive/restore command routes;
   UUID-only mutations, If-Match, replay, dry runs, current representations on
   stale writes and the OpenAPI contract. Staging merge `8fe81ef1a` supplies
   shared write checks before these routes.
4. MCP (`24fa1ce72`): five write tools with scope checks, shared preconditions,
   ratio and lookup guidance, and action/REST/MCP parity coverage.
5. Evals, fuzz and docs: blend creation, unknown ingredient, order-guarded delete,
   archive and restore evals with per-case scopes and scorer unit tests. Fuzz
   formulations are created through operations, with distinct unreferenced delete,
   active archive and archived restore targets. Examples cover create, PATCH,
   DELETE and commands as dry runs, current seeded ETags and exact millionth
   boundaries. Four formulation mutation ids join the 428 list. The API guide
   starts the master-data section; architectural follow-ups stay in open questions.

**Decisions made during implementation:**

- Cursor errors stay 400, including an active cursor reused with `archived=true`.
  Archive and restore use `formulations:write`; delete remains independently scoped.
- The runner extra-effect queue arrives in 7b for party/location cascades.
  Formulations need only the initiating row's effect.
- The restore eval uses an archived fixture and requires an archived-only lookup.
  Create/unknown-ingredient budgets are five calls; delete/archive/restore are four.
- Fuzz targets use generated codes and UUID writes. OpenAPI calls the path
  parameter `idOrCode`; command hooks read that name from the operation.
  The existing all-scope fuzz key includes formulation write and delete scopes;
  application delete remains excluded. JSON fixture loading supplies the new
  formulation targets without additional shell environment exports.
- Ratio examples accept 0.000001 and totals of exactly 1, and require 422 at
  `/biocharRatio` for 0.0000001. All positive seeded examples require 2xx, so
  generated-case status allowances cannot hide a broken fixture.

**Validation and follow-ups:** lint passed with 16 pre-existing warnings;
typecheck passed. OpenAPI generation left the snapshot unchanged.

Evals and fuzz: `pnpm eval:mcp` 19/19 (five formulation cases; the first run found two scorer false fails, one in the older lab case, fixed in the scorers); local Schemathesis 89/89 operations, 8,614 cases, 0 failures.

Formulation UI and Playwright belong to Claude's commit 6.
The restrictive bin/formulation FK remains `data/formulation-bin-fk-backstop`;
new bin references take a formulation lock meanwhile. No 7b/7c work ships here.

## 26. Phase 7b results (2026-10-16)

**Shipped on `feat/api-parties`:** supplier and customer create with initial
locations, update, delete, archive and restore on the runner, REST and MCP;
revision 2 reads, scoped evals, fuzz fixtures and master-data documentation.

**What shipped, by commit:**

1. Writers (`dec77a6d5`, `a7973b326`, `5266a3956`): typed party refusals, generated codes, shared child-reference delete
   guards and archive/restore. New intake and order references reject archived
   parties, while kept references pass. Existing location add/update paths check
   the parent's archive state under their existing locks. Party cascades queue
   child Activity effects in the transaction; rollback and replay add no events.
2. Registry (`a66e087f5`): ten party operations, separate read/write/delete scopes, revision 2
   place fields and real `archivedAt`, archived-only lists with cursor binding.
3. REST (`e626cb5a0`): create, PATCH, DELETE and archive/restore routes, UUID
   mutations, If-Match, replay, dry runs and stale `current` representations.
4. MCP (`74ad3f459`): ten tools from a shared party factory, real-key scope
   hiding, location create inputs and action/REST/MCP parity coverage.
5. Evals, fuzz and docs: supplier pickup and manual one-way distance, customer
   field, active and archived duplicate supplier, archived intake refusal,
   supplier restore and customer restore. Each case has its own scopes, DB
   snapshot and tested scorer. Fuzz parties use operations and separate delete,
   active archive and archived restore targets, with ids, codes and ETags.
   Dry-run examples cover all party writes, distance bounds, 5e-324 and 50/51 locations;
   eight party mutation ids join the 428 list. The master-data guide moves to
   `docs/api-master-data.md`, linked from the API guide.

**Decisions made during implementation:**

- The archived duplicate eval requires an explanation that the existing supplier
  is archived, and either no saved changes or a restore of exactly that supplier.
  A second supplier with the same name fails.
- Create budgets are six calls; archived-intake is eight, active duplicate is
  four, archived duplicate is six, and restore is five. Create scopes leave room
  for one party lookup before writing.
- Restore scorers require an earlier successful archived-only lookup and only
  the targeted row's archive, version and update-time changes.
- Fuzz hooks read the real OpenAPI path parameter name, currently `idOrCode`,
  and load targets from the private JSON fixture. All positive seeded examples
  require 2xx; out-of-range distance and location count examples require 422.
- Decisions 119 and 120 record round 12: customer-location archive/restore in
  7c, and existing-order delivery/application continuation after party archive.

**Validation and follow-ups:** lint passed with 16 existing warnings; typecheck,
docs references and eval unit tests passed. OpenAPI generation left the snapshot
unchanged. Offline hooks tests use CI's pinned Schemathesis 4.29.3 environment.

Evals and fuzz: <results recorded by the supervisor>

Customer-stale-version is skipped: `runClaude` has no deterministic hook between
an agent's read and write. Add that seam before enabling the case; no timer race
stands in for it. See `api/eval-stale-version` in architectural open questions.
Supplier-location-update and customer-field-missing-gps move to 7c because they
need `add_*_location`. Supplier/customer UI and Playwright are Claude's commit 6.
Customer-location archive/restore, default reassignment and last-active refusal
ship in 7c with its migration and location write tools.

The plan file was 984 lines before this fix round; 7c must move Phase 7 results to `docs/archive/` first, as Phase 6a did.
