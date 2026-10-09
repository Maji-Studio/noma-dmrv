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

- A typed `DomainError` family with stable codes: `validation_failed`, `not_found`, `stale_version`, `conflict`, `certification_locked`, `insufficient_stock`, `forbidden`, `reference_not_found`, `reference_ambiguous`. Errors are thrown with a code, never classified from message text.
- `ActionResult` failure gains `code` and `issues?: { path, code, message, meta? }[]`; `error` (prose) stays, so current UI consumers are unaffected and forms can start highlighting by path. `meta` carries non-sensitive limits (`max`, `unit`, allowed enum values), never the rejected value.
- Business conflicts carry actionable detail: `insufficient_stock` returns bin id, available and requested mass; `conflict`/`blockers` refs (`src/types/actions.ts:31`) pass through.

## 4. REST contract (`/api/v1`)

**Resources.** Flat and plural: `/api/v1/suppliers`, `/api/v1/feedstocks`, `/api/v1/production-runs/{id}`. Facility is a filter (`?facilityId=`); nest only owned children (`/production-runs/{id}/readings`). The organization is implied by the credential (each credential is bound to exactly one organization, section 6), so there is no organization id in the path and no drift with the session's active organization.

**Identifiers.** Every resource returns `id` (UUID) and `code` (e.g. `SUP-26-003`). `GET /{resource}/{idOrCode}` accepts either. Write payloads take UUIDs; lookups resolve codes and names first:
- list endpoints take `?q=` (case-insensitive prefix on code and name) and `?code=`;
- an unresolved or ambiguous reference returns 422 with `reference_not_found` / `reference_ambiguous` and the candidates (scoped to the organization, and to a facility where codes repeat across facilities).

**Methods.** `GET` list and get; `POST` create (201 + `Location`); `PATCH` update (200); `DELETE` (204) only where the entity has a delete. Domain transitions are explicit commands (`POST /facilities/{id}/archive`, `POST /biochar-products/{id}/corrections`), never a force flag.

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
- *event instants*: accepted as RFC 3339 with offset, or as facility-local `{ date, time }` resolved in the facility time zone. Responses return the instant plus the facility time zone.
Facility reads include `timeZone`. "Today" for a client comes from `GET /api/v1/me`, not the device or model clock.

**Discovery.** `GET /api/v1/me` returns organization, accessible facilities with time zones, role, scopes, and the server's current date per facility. Enum values ship in OpenAPI with descriptions.

**Errors.** RFC 9457 `application/problem+json`: `type`, `title`, `status`, `detail`, `instance`, plus `code`, `retryable`, `errors: [{ pointer, code, detail, meta? }]`, and `conflict`/`blockers` where the caller may see them. A 404 for a referenced id says which pointer was not found.

| Outcome | Status |
|---|---|
| Malformed JSON, bad query syntax | 400 |
| Missing or invalid credential (`WWW-Authenticate`) | 401 |
| Valid credential, missing scope or role | 403 |
| Target absent or in another organization | 404 |
| Business conflict (stock, lineage, certification lock, uniqueness); idempotent request still running (`Retry-After`) | 409 |
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

- **Homogeneous batch endpoints** where the data is naturally bulk: `POST /production-runs/{id}/readings/batch` (reuse the reading-import core) and lab sample results. Bounded size, per-item results, per-item `externalId` for idempotent upserts. Lab results batch in Phase 5, readings batch with production in Phase 4, both additive to v1.
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
| 5. Lab and logistics | Lab samples (+ lab result batch endpoint), orders, deliveries | Per-operation outcome, parity, authorization and stock tests |
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
