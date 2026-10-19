# Phase 7a and 7b results

Historical implementation results for the formulation, supplier and customer API
phases. Read alongside
[the active data-entry API plan](../plans/2026-10-06-data-entry-api.md).

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
6. App (`cf91d2ffe`, `40dc17714`): Archived toggle, archive and restore on both
   lists, "Archive instead" on in-use delete refusals, read-only archived sheets,
   archived kept selections in pickers, and an order destination locked under an
   archived customer (also while the customer loads). Every in-use delete refusal
   is built from `IN_USE_DELETE_MARKER` (`src/lib/delete-refusal.ts`).

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
- Feedstock types share the in-use delete notice with formulations, suppliers and
  customers (7a review round 2 asked for one pattern): the server refusal is now
  "Feedstock type was not deleted because records still use it. Archive it
  instead." and the notice is titled by code.

**Validation and follow-ups:** lint passed with 16 existing warnings; typecheck,
docs references and eval unit tests passed. OpenAPI generation left the snapshot
unchanged. Offline hooks tests use CI's pinned Schemathesis 4.29.3 environment.

Evals and fuzz (merged tree, staging `907c1d93c`): `pnpm eval:mcp` 27/27 after two
scorer false fails were fixed in `012633b82`; local Schemathesis 9,727 cases, 0
failures; related DB suites 264 files, 3,426 tests.

Customer-stale-version is skipped: `runClaude` has no deterministic hook between
an agent's read and write. Add that seam before enabling the case; no timer race
stands in for it. See `api/eval-stale-version` in architectural open questions.
Supplier-location-update and customer-field-missing-gps move to 7c because they
need `add_*_location`. Supplier/customer UI and Playwright are Claude's commit 6.
Customer-location archive/restore, default reassignment and last-active refusal
ship in 7c with its migration and location write tools.
Review round 2 on #1133 left two P2s for 7c: point the app party schemas
(`src/schemas/customers.ts`, `suppliers.ts`, `facility-distances.ts`) at the
`src/config/party-input.ts` bounds so app create and location saves refuse what
the runner refuses; and refresh or close a deep-linked archived sheet after a
stale Restore, so a retry uses the refreshed detail version.

The plan file was 984 lines before this fix round; 7c must move Phase 7 results to `docs/archive/` first, as Phase 6a did.
