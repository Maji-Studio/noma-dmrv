# Lifecycle coverage matrix

This matrix records the audit depth for every route family and entity at staging `ef857545`. Read it with [the exact route/action/table inventory](inventory.md), [findings](findings.md), and the independent [production](production.md), [distribution/evidence](distribution-evidence.md), and [registry](registry.md) investigations. It is an inspection and isolated-simulation matrix, not a claim that every state was exercised in a browser.

## Evidence grades

- **DB**: actual data-access code executed against a disposable PostgreSQL 18 database migrated from this baseline.
- **Mock**: actual function/module executed with injected dependencies or an extracted function body. This proves local control flow, not provider semantics.
- **Static**: traced through baseline code; operation not executed end to end.
- **Existing tests**: relevant tests executed by parent; exact suite list and results in [verification](verification.md).
- **Not offered**: no operator operation found. This is a coverage result, not automatically a defect.

The normal state axis is incomplete input, valid mutable record, downstream use, certification freeze, archived/deleted parent, stale caller, and failed/unknown mutation. Registry workflows additionally cover unregistered, in flight, registered, drifted, confirmed absent, ambiguous, submitted/finalized, and cleanup interrupted.

## Entity × operation × state

| Entity / route | Create | Edit / transition | Delete / retire | States assessed; evidence and gaps |
|---|---|---|---|---|
| Facility `/facilities` | Required setup; scoped name/code uniqueness | Full form; durability-tier lock | Atomic archive/restore, no hard delete | Active/archived, tier freeze, individual child archives: existing DB tests. Stale full save: DB F03. Missing credentials do not prevent local setup. |
| Reactor `/reactors` | Active facility and unique identifier | Identifier/type/capacity; facility move accepted by action | Refuses production references; transactional evidence retirement | Static; archived stale edit and facility moves with historical runs need further DB interleaving tests. No reactor retirement action independent of facility archive. |
| Storage bin `/storage-locations` | Type/restriction/formulation validation | Full or partial patch | Zero-stock archive/restore; reference-blocked hard delete | DB F01 stocked role/type changes. Existing archive and stock-lock tests pass. Registry Storage Location is a different entity. |
| Feedstock Type `/feedstock-types` | Admin CRUD or Isometric import | Category/usage/mapping/name | Archive/restore; delete when unused | DB F02 partial merged-state defect. Quick-add mapping loss F14. Archive is a picker policy, not removal of historical identity. |
| Feedstock intake `/feedstocks` | Multi-bin allocations in transaction; derived dry mass | Mass/metadata/route; stock and lineage locks | Reference guards and evidence retirement | DB F06 negative stock after reduction; DB F07 inconsistent partial moisture. Draft/missing values, moves and downstream use traced. |
| Legacy Feedstock Delivery (no current page) | Internal/legacy table only | No standalone current CRUD | Restrictive supplier FK remains | DB F08 proves its relevance despite absent UI. Do not omit legacy tables from deletion dependency checks. |
| Production Run `/production-runs` | Bin/facility/time/stock checks | Lifecycle, readings, output, cancellation | Lineage/stock guards; child retirement | Static + existing stock/lineage tests. State transitions and stale dependency snapshots in production report. |
| Production reading (run sheet) | Single reading/import | Reading edits and immutable telemetry checks | Guarded deletion | Time-series units, interval coverage, parse failures, parent state traced; live device/import UI not exercised. |
| Reading import (run sheet) | Validate/parse/import batch | Retry import; no general batch editor | Underlying readings | Partial/duplicate import policy inspected; full fuzzed file and browser upload matrix untested. |
| Production Incident (run sheet) | Timestamp/severity/note/evidence | Incident fields | Evidence retirement | Local datetime string interpreted on server: F15, mock timezone proof. In-process, not automatically a certification lock violation. |
| Production measurement / Production Sample (run sheet) | In-process QC | Values/time/notes | Evidence retirement | F15 timezone issue. Composite run/org FK inspected. Distinct from lab Sample. |
| Production Process (feedstock sampling setup) | Find/create per facility/type | Epoch and prerequisites | No ordinary delete | Method B is computed eligibility, not stored unlock. Existing eligibility and source guards inspected; thresholds are policy. |
| Bin movement / reconciliation (bin sheet) | Adjustment/loss/stock-take | Append/correct through supported flow | No ordinary destructive history removal | Existing DB stock-lock tests pass. Type edits escaping same lock are F01. Do not erase movement history to retire a bin. |
| Biochar Product `/biochar-products` | Source/ingredient allocation; atomic stock checks | Composition/source/bin/quantity | Guarded downstream removal and evidence retirement | Existing stock tests; detailed source-mass and formulation coverage in production report. Duplicate create response loss still open. |
| Formulation `/formulations` | Recipe with ingredient identity | Ratios and stable line IDs | Reference-aware delete | Static. Product recipes preserve references; changed ingredient usage and zero-ratio policy assessed by production investigator. |
| Order `/orders` | Product/customer/destination/value | Quantity and derived fulfillment | Downstream delivery guard | Existing stock tests; F10 clearing, F13 first-100 customer selection, F17 nonexistent cancel recovery. Fulfillment is derived. |
| Delivery `/deliveries` | Upcoming/delivered; balance/stock | Delivered mass, route, assignments | Applications/lineage guard | Existing DB guards, static F29 status/date gap. Upcoming allocation differs from physical stock consumption. |
| Application `/applications` | Delivered mass, evidence method, location | GIS/optional fields; derived dry mass | Slice and certification lock | F09 held GIS blocks save; F10 null clearing. Existing freezes pass. Site sync is separate admin registry work. |
| Customer `/customers` | Parent then child locations | Profile | Orders block delete | Mock F11 partial customer creation. Static F17 impossible cancel instruction. |
| Customer Location `/customers/[customerId]` | Location/default selection | GPS/address/default/transport | Reference protection | Partial-patch omission clearing is independently reproduced in companion audit; see F10 scope note. Static F30 derived-transport freeze inconsistency. Concurrency of first default not exercised. |
| Supplier `/suppliers` | Atomic supplier-plus-locations | Profile | Locations then parent, non-atomic | DB F08 actual partial delete. Do not confuse safe compound create with unsafe delete. |
| Supplier Location `/suppliers/[supplierId]` | Location/default | Location/route metadata | Location delete | Static auth/default uniqueness; parent delete loses locations in F08. |
| Driver (quick-add selector) | Independent persisted master record | Not offered | Not offered | Static scoped create. Cancelling parent leaves driver saved; correction workflow is product gap. |
| Vehicle (quick-add selector) | Unique name/type/fuel metadata | Not offered | Not offered | Static. Wrong existing metadata cannot be repaired through audited UI. |
| Operator (quick-add selector) | Independent persisted record | Not offered | Not offered | Static. No standalone management route found. |
| Transport Leg (entity editors) | Manual/derived/deferred | Route/mode/mass/distance | Guarded retirement | Static + evidence tests. Auth resolves parent; derived legs are not ordinary unrelated records. |
| Lab Sample `/samples` | Credit-batch link, chemistry, evidence | Carbon/tier/sample-window validation | Certification and Method B guards | Existing tests + static. Do not apply in-process timestamp finding to all lab date fields. |
| Document/evidence (all owning forms) | Pending row → PUT → confirm | Classification/visibility | Review protection, transactional retirement/outbox | F12 lost acknowledgement can duplicate upload; unmapped reviewed evidence/parent-lifetime race remains qualified, not claimed reproduced. |
| Removal `/certification/removals` | Atomic local slice grouping | Review, compile, submit, resume, supersede | Never-finalized cleanup only | Existing registry tests pass. Stale review hash/frozen evidence protected. Partial deletion needs durable cleanup state F20. |
| GHG Statement `/certification/ghg-statements` | Remote period create/adopt | Refresh/sync, generated report, submit/resubmit | Not offered | Empty/overlap/stale report/pending token recovery tested or traced. Missing remote identity has no general repair. |
| GHG Statement report | Prepare immutable version | Approve latest; stage/promote capability | Not offered | Existing evidence/API tests; protected history and capability auth. Internal action helper risk F18. |
| Isometric Source | Mirror/upload from local evidence | Visibility/classification under policy | No ordinary remote-delete action | F12 upload uncertainty, F19 pool dependency. Local mirrored ID does not prove continued remote existence. |
| Isometric Production Batch | Implicit per credit cohort | Exact reuse/recovery after absence | Eligible unshared cleanup | Existing recovery tests; lookup ambiguity fails closed. No arbitrary edit. |
| Isometric Storage Location | Sync application site | Check drift / recover confirmed absence | No independent operator delete | Existing recovery tests. 404 is different from 403/5xx; F21 recovery/copy gaps. |
| Isometric Biochar Application | Versioned application/batch claim | Reconcile; immutable claim | Eligible Removal cleanup | Existing tests. Replaced site with old claim stops for review; no completed claim-repair action. |
| Telemetry / Sensor | Backend upload pipeline | Journal resume/poll | Not offered | UI panel not mounted. Mock F16 sensor race and F22 unknown telemetry response. Do not offer fictitious UI recovery. |
| Facility registry mapping `/certification/settings` | Link project/template/facility | Guarded save/unlink/config | Guarded unlink | Static + registry-boundary tests. Destination changes with frozen history need explicit migration policy. |
| Registry credentials (organization panel) | Admin/Owner write-only pair | Partial rotation preserves omitted secret | Disconnect deletes local credentials | Existing authorization/rotation tests. Registry records survive disconnect. Mid-operation destination/account changes untested. |
| Organization Defaults `/settings/defaults` | Defaults when row absent | Admin upsert, full-form semantics | Not offered | Existing tests; settings seed new forms, do not rewrite records. Stale full-save conflict policy remains open. |
| Organization `/admin/organizations` | Platform Admin selects existing Owner; transaction | Enter organization | Not offered | Existing creation/owner/auth tests pass. Defaults seeding is best effort; no operator repair for seed failure. |
| Member/invitation `/settings/organization` | Admin invite; copy link | Role change, accept, switch | Remove member/revoke invite | Existing tests. F04 reports unswitched after actual switch if preference persistence fails. Email send was not exercised. |

## Remaining routes and handlers

| Route family | Lifecycle ownership / audit treatment |
|---|---|
| `/dashboard`, `/energy`, `/traceability` | Read/derive existing facts; actions/deep links use the owning entity flows. No separate energy-record CRUD UI. |
| `/chain-of-custody` | Redirect compatibility for traceability. |
| `/credit-batches/[id]`, `/production-runs/[id]`, Removal legacy detail/review | Routing/detail compatibility, not independent persistence strategies; inventory records every file. |
| `/admin`, `/admin/users`, `/settings`, `/certification` | Redirect to current owning route; no separate mutations. |
| `/login`, `/forgot-password`, `/reset-password`, `/set-password`, `/verify-email`, callback | Better Auth identity lifecycle; static guard/API review. No mail was sent and no account changed. Rate limits/cookie behavior not live tested. |
| `/accept-invitation/[id]` | Invitation bootstrap/accept then organization switch. F28 mocked middleware blocks anonymous bootstrap. Session/membership checked after admission; F04 applies to switch seam. |
| `/api/auth/[...all]`, `/auth/signout` | Better Auth session lifecycle, deliberate public endpoint admission followed by handler authentication. No hidden generic domain CRUD API. |
| `/api/certification/submissions` | Authenticated Admin NDJSON admission; validates/rate-limits before core. Disconnect does not guarantee cancellation or continued serverless execution. |
| `/api/documents/[id]` | Authenticated document read/redirect; uploaded-state check, scoped private access and intentional public policy; existing tests pass. |
| `/api/ghg-statement-reports/[reportId]` | Intentional bearer-capability seam. Unscoped lookup is not itself a leak; token proof authorizes it. |
| `/api/storage-local/[...key]` | Local-storage-only signed PUT/GET, method/key/size checks; absent under deployed S3 configuration. Static. |
| `/schema`, `/schema/[table]`, `/schema/links` | Public schema documentation, no data mutation; database table inventory is separate from customer data. |
| `/`, `/styleguide`, `/unauthorized` | Landing/demo/access-denied surfaces; no independent persisted entity lifecycle found. |

## Scenario × investigation depth

| Scenario | Coverage / result |
|---|---|
| Empty and partial forms | Schemas traced across assigned areas; F02/F07/F10 show why schema-only validation is insufficient. Not every scalar boundary fuzzed. |
| Omitted versus null versus zero | Explicit defects reproduced; full entity-wide matrix remains implementation regression work. |
| Downstream dependencies/cascades | All mutation families traced; 30 existing suites exercised core stock/freeze/evidence boundaries; F08 proves incomplete dependency list. |
| Cross-org and role revocation | Static checker passes; actual authorization suites pass. No deployed two-session penetration test. |
| Duplicate click / create response lost | Registry and grouping locks inspected; ordinary-create logical idempotency remains incomplete. Upload retry gap confirmed statically. |
| Stale forms | Facility DB reproduction, plus stale review/report guards in existing tests. Whole-browser draft preservation not tested. |
| Concurrent stock/claim/delete | Existing deterministic DB barrier tests pass. Bin edit bypass reproduced without a race; sensor first-create mock race reproduced. |
| Transaction failure | Supplier DB FK partial-delete reproduction; customer mock child failure; existing atomic rollback tests pass. |
| Remote partial success / unknown response | Mock body stall and telemetry policy; existing Removal interrupted/journal tests. Provider duplicate acceptance not asserted. |
| Refresh / resume / disconnect | State machines and streamed transport inspected; F20 no durable deletion-only marker. Browser/serverless process death not exercised. |
| Evidence review / delete | Direct deletion and parent retirement tests pass for covered fixtures; unmapped review and late upload insertion remain open interleavings. |
| Remote deletion / recreation / drift | Existing Storage Location, Production Batch and Biochar Application mock suites pass. New live destructive validation intentionally excluded. |
| Local-only / registry-only identities | Exact-reference adoption and ambiguous lookup logic inspected. Strong provider consistency not established by OpenAPI. |
| Permission failure / 429 / 5xx | Client and recovery code inspected; existing tests distinguish absence from failed reads. Stalled body is F05. |
| Destination / credential / settings changes | Mapping locks and partial credential rotation tests; account switch during multi-stage operation untested. |
| Failed delete recovery | Existing deletion convergence tests; partial local supplier loss reproduced; durable Removal action-selection gap static. |
| Operator actionability | Every promoted finding has current truthful guidance and proposed copy. Support-only dead ends are explicitly marked. |
