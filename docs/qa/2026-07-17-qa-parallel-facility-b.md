# Parallel Facility B isolation QA — 2026-07-17

## 1. Executive isolation verdict

**Material context risk, with no cross-facility data leakage reproduced.**

Reviewer B created a complete second-facility tracer bullet through Credit Batch and
three chemistry-complete Samples using only the UI. Ten facility-scoped list surfaces,
Dashboard totals, and all available Chain-of-Custody views remained isolated in both
directions. Foreign Production Run links failed closed; foreign Credit Batch links
switched the selector and URL to the owning facility rather than rendering the record
under the wrong heading. Certification Settings stayed facility-specific while shared
environment health was consistently labelled read-only.

The verdict is not “Isolated” because two recoverable but material context failures
remain:

- `B-001` (P2): signing out clears the session but leaves the protected dashboard
  visibly rendered until reload. This independently reproduces known `DEF-009`.
- `B-002` (P3): the populated-facility archive preview says what it will hide but
  omits Facility B's application and three samples from its impact count.

No source fix, issue filing, external registry submission, populated-facility archive,
database reset, or direct domain-data mutation was performed.

## 2. Browser/context strategy

- Strategy: isolated headless Google Chrome Playwright contexts, 1440 × 1000,
  `en-US`, browser timezone `Europe/Zurich`, with no persisted storage state.
- Reason: the repository computer-use skill disallows privileged interactive control
  for an unattended heartbeat, while the companion brief explicitly permits an
  isolated Playwright context.
- Concurrency: interleaved/post-primary, not truly concurrent. Facility A already
  existed; the A/B tab checks used the same Reviewer B browser profile, while the
  primary review itself was no longer clicking.
- Credentials were read from `.env.local` into memory and never written to the report,
  screenshots, URLs, request evidence, or artifacts.

## 3. Revision, server identity, handoff, and timeline

| Item | Result |
| --- | --- |
| Repository | `/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv` |
| Branch / revision | `staging` / `05272d11571ada982a950363d948c1ababfed1d3` |
| Server | Next 16.2.6, exact checkout, port 3100, final PID 57848 |
| Primary state | Existing Facility A chain from the primary ledger was present and intact |
| Reset | Companion did not reset or migrate the database, despite later permission to reset |
| Authorized recovery | User explicitly authorized Docker restart, server start, and local admin bootstrap |
| Local bootstrap | `pnpm db:ensure-admin` updated local auth/default-org bootstrap state; no domain chain was seeded |
| Domain mutations | Facility B chain and disposable facility were created only through rendered UI forms |
| External writes | None; unlinked Certification routes failed closed before submission |

The requested start was 2026-07-16 23:59 Europe/Zurich. The heartbeat arrived at
2026-07-17 01:59 CEST because its timestamp was 23:59Z. The late wake is coordination
evidence, not a noma-dmrv product finding.

### Operation timeline

| Time (CEST) | Operation | Result |
| --- | --- | --- |
| 01:59–02:08 | Launch checks and first isolated login | Existing server rendered login but auth returned HTTP 500; original run stopped |
| 07:34–07:38 | User resumed; server was absent | Launch stop condition recorded |
| 07:38–07:50 | User-authorized Docker/server recovery and local admin bootstrap | Docker healthy; exact-checkout server ready; configured auth succeeded |
| 07:50–07:54 | Browser-input diagnosis and clean isolated login | A malformed 16-character form value explained the 401s; corrected in-memory fill returned 200 |
| 07:54–08:03 | Create Facility B and independent operational chain | `FAC-26-003` through `AP-26-002` created through UI |
| 08:03–08:06 | Create `CB-26-002` and three Samples | Three chemistry-complete 1000-year samples created |
| 08:06–08:13 | Bidirectional list, URL, deep-link, Quick Add, history, two-tab, Dashboard, and Chain checks | No facility-scoped leakage reproduced |
| 08:13–08:17 | Settings, Removal/GHG gates, disposable archive, populated archive preview | Gates passed; archive-preview omission reproduced |
| 08:17–08:19 | Sign-out/reload/re-login recovery and report evidence pass | Known stale protected-view failure reproduced; hard refresh failed closed to login |

Recovered environment events (`ENV-B-001` login HTTP 500 and `ENV-B-002` missing
server) are retained as timeline evidence only. They did not block the resumed pass and
are not product findings in the final verdict.

## 4. Facility identifiers

| Role | Identifier | Synthetic name / status |
| --- | --- | --- |
| Facility A | `FAC-26-001`; ID `920a427d-5c1b-4c9d-ab3e-dcc390b864ac` | `QA Ember Vale Primary`; primary chain intact |
| Existing secondary | `FAC-26-002` | `QA Frost Hollow Secondary`; not edited |
| Facility B | `FAC-26-003`; ID `06916bd4-783d-41ec-bf04-d6f890aed929` | `QA-B-20260717-NORTHSTAR Facility`; active and populated |
| Disposable | `FAC-26-004` | `QA-B-DELETE-20260717-NORTHSTAR`; created empty, then safely archived |

Facility B used timezone `Asia/Tokyo`, a distinct synthetic location, and the unique
marker `QA-B-20260717-NORTHSTAR`. The UI exposed only the 1000-year durability choice,
so a different valid durability tier from A was not available.

## 5. Scope map

| Domain object | Scope | Assertion used |
| --- | --- | --- |
| Feedstock types | Organization-scoped master data | Shared visibility expected; usage needs clear scope |
| Isometric catalogue / credential health | External/global and organization-scoped | Shared, read-only health is not leakage |
| Suppliers/customers and locations | Organization-scoped | Shared visibility expected; facility-relative distance remains an ambiguous seam |
| Facilities, reactors, storage, feedstock intakes, production runs | Facility-scoped | A/B rows and choices must not cross |
| Production processes | Facility + feedstock scoped | Selected/derived process must stay with its facility |
| Documents | Organization row; effective scope inherited from parent | Evaluated through the parent entity |
| Applications | Derived facility scope through delivery/order/product | A/B rows and readiness must not cross |
| Credit batches | Facility-scoped | Runs, applications, samples, and quantities must be same-facility |
| Samples | Facility derived through credit batch | A Samples must not count for B and vice versa |
| Facility project link, durability, emission estimates | Facility-scoped | A settings must not appear as B settings |
| Removals / GHG Statements | Facility-scoped | Only same-facility eligible inputs may appear |
| Registry credentials/environment | Organization-scoped/admin-managed | Must appear shared and non-secret |

## 6. A/B stage and record inventory

| Stage | Facility A | Facility B |
| --- | --- | --- |
| Facility | `FAC-26-001` | `FAC-26-003` |
| Reactor | `R-26-001` | `R-26-002`; low-risk cache probe `R-26-003` |
| Storage | Three A bins | `SL-26-001`–`SL-26-003`, Quick Add bin, and same-name isolation bin |
| Supplier / customer | Shared `SUP-26-001` / `CUS-26-001` | Intentionally reused organization-scoped parties |
| Feedstock type | Shared `FT-26-001` | Intentionally reused organization-scoped type |
| Feedstock intake | `FS-26-001` | `FS-26-002` — 2,400 kg wet / 1,800 kg dry |
| Production run | `PR-26-001` | `PR-26-002` — completed, 600 kg dry input / 300 kg wet output |
| Biochar product | `BP-26-001` | `BP-26-002` — 285 kg wet |
| Order / delivery | `OR-26-001` / `DL-26-001` | `OR-26-002` / `DL-26-002` |
| Application | `AP-26-001` | `AP-26-002` — 180 kg wet / 171 kg dry |
| Credit batch | `CB-26-001` | `CB-26-002` — 0.18 t applied weight |
| Samples | `SAM-26-001`–`SAM-26-003` | `SAM-26-004`–`SAM-26-006`, chemistry complete |
| Removal / GHG Statement | None | None; correctly project-link gated |

## 7. Cross-facility acceptance matrix

| Surface / behavior | Result | Evidence |
| --- | --- | --- |
| Selector, URL, heading agreement | Pass | B query, selector, facility code/name, and loaded records agreed |
| Hard refresh and A→B→A back/forward | Pass | Both history directions and B hard refresh preserved coherent context |
| Two A/B tabs in Reviewer B profile | Pass | Each explicit query retained its own selector, heading, and records |
| Ten facility-scoped lists | Pass | Reactors, storage, feedstocks, runs, products, orders, deliveries, applications, batches, samples passed in both directions |
| Dropdown scope | Pass | B run/product/batch pickers offered B facility records; shared parties/types were reusable |
| Organization-shared labels | Partial | Parties were shared as designed, but the UI does not explicitly label them organization-wide; see known #456 |
| Form opened before facility switch | Pass | Modal form removed access to the facility selector; ambiguous save was impossible and the draft was cancelled |
| In-flight mutation/cache isolation | Pass | Immediate A navigation after B reactor save showed no B row; B hard refresh showed exactly one saved row |
| Quick Add isolation | Pass | B Quick Add biochar bin returned selected in the B run form and remained absent from A storage |
| Same human-readable value | Pass/Partial | B accepted an A-like bin name with B marker in description; facility-scoped lists distinguished it, but names alone remain ambiguous in compact pickers |
| Foreign Production Run link | Pass/Partial | Foreign `run` query was removed and record hidden; no explanation was shown |
| Foreign Credit Batch route | Pass/Partial | Route rewrote `facility` to the owning facility and selector/data agreed; change was silent |
| Dashboard | Pass | A and B markers never crossed; A showed 0.8 t processed, B 0.6 t |
| Chain DAG / Map / Sankey | Pass | Matched captures showed only owning-facility codes, totals, markers, and edges |
| Chain Trail | Not present | Current UI offered DAG, Map, and Sankey only |
| Credit Batch readiness | Pass | B detail showed B run/application, 3/3 usable samples, and only B gaps |
| Certification Settings | Pass | Facility headers/links stayed scoped; shared sandbox credential health was identical and read-only |
| Removal readiness | Pass (blocked state) | B route failed closed to B Settings because no project link existed |
| GHG Statement readiness | Pass (blocked state) | B route failed closed to B Settings; no A Removal/statement was exposed |
| Sign-out / re-login | Fail/Partial | Session cleared, but protected dashboard remained rendered until reload (`B-001`); login then defaulted to A and explicit B navigation recovered correctly |
| Empty third-facility archive | Pass | Preview said no attached data, archive was reversible, stale disposable query cleared, A/B remained intact |
| Populated B archive contract | Fail/Partial | Reversible behavior was explained, but impact count omitted application and Samples (`B-002`); archive was cancelled |

## 8. Findings ledger

| ID | Severity | Route / target | Expected | Actual | Reproducibility | Mapping |
| --- | --- | --- | --- | --- | --- | --- |
| B-001 | P2 | `/dashboard?facility=FAC-26-003` Sign out | Protected view is immediately replaced by login/non-sensitive state | Auth sign-out returned 200 and cookie disappeared, but the populated dashboard remained visible until hard refresh | 2/2 activations; hard refresh then redirected to `/login` | Duplicate of `DEF-009` in `2026-07-16-qa-ui-only-operational-stress.md` |
| B-002 | P3 | `/facilities?facility=FAC-26-003`, Archive `FAC-26-003` | Impact preview enumerates all hidden dependent record families/counts | Preview listed direct records but omitted `AP-26-002` and `SAM-26-004`–`006`, which are hidden transitively | 2/2 previews | New companion finding; no exact known issue found |
| B-003 | P3 | Foreign run/batch direct links | Fail closed or switch context with explicit feedback | Data and selector stayed safe, but run IDs disappeared and batch facility context changed silently | 2/2 directions for each entity type | Related to open #253 and #372 |
| B-004 | P3 | B feedstock/order forms with shared party locations | Shared scope and facility-relative distance ownership are explicit | Supplier/customer records were intentionally shared, but forms did not label organization scope; distances were presented as supplier/customer defaults for the active facility | Reproduced in feedstock and order/delivery flows | Duplicate/extension of open #456 |

No P0 or P1 cross-facility disclosure, write, total, readiness, or destructive-loss
finding was reproduced.

## 9. Detailed evidence

### B-001 — Sign-out leaves protected dashboard visible until reload (P2, duplicate)

- Active facility: `FAC-26-003`; URL `/dashboard?facility=<B>` before sign-out.
- Steps: activate the visible Sign out control; observe the auth request; inspect the
  page and browser cookies; hard refresh.
- Expected: immediate navigation to login or an opaque non-sensitive transition.
- Actual: `POST /api/auth/sign-out` returned 200 and the auth cookie was absent, but
  the same populated dashboard and Sign out control remained rendered at `/dashboard`.
  Hard refresh redirected to `/login` and protected UI disappeared.
- Impact: operational data can remain visible on a shared screen after the operator
  believes logout completed. No post-logout write was attempted.
- Suspected root: `src/components/navigation/sidebar-content.tsx:363` invokes the
  async sign-out without awaiting it or navigating/refreshing protected state;
  `src/lib/auth/providers/better-auth-client.ts:202` only clears the provider session.
- Mapping: independently confirms known `DEF-009`; no new issue was filed.

### B-002 — Populated archive preview omits applications and samples (P3)

- Active facility/URL: selector `FAC-26-003 — QA-B-20260717-NORTHSTAR Facility`;
  `/facilities?facility=06916bd4-783d-41ec-bf04-d6f890aed929`.
- Steps: open Archive on populated Facility B; wait for impact preview; compare the
  enumerated counts with the B chain; cancel.
- Expected: because the dialog promises to hide “this facility and all of its data,”
  the concrete “Also archives” count should include every meaningful dependent family.
- Actual: it listed 2 reactors, 5 bins, 1 feedstock batch, 1 run, 1 product, 1 order,
  1 delivery, and 1 batch, but did not mention the application or three samples.
- Impact: the action is reversible, but an operator cannot accurately assess what
  disappears from lists, pickers, stats, and readiness before confirming.
- Root cause: `src/data-access/facilities.ts:696` and the queries beginning at line
  720 count only selected direct children; `src/components/facilities/archive-facility-dialog.tsx:23`
  renders only those keys. The archive function explicitly hides grandchildren
  transitively.
- Evidence: `10-populated-b-archive-impact.png`. The archive was cancelled.

### B-003 / B-004 — Safe but silent context and shared-scope ambiguity (P3)

- Foreign run IDs were removed in both A-under-B and B-under-A directions; foreign
  rows never rendered. Foreign batch routes rewrote the facility query to the owning
  facility and displayed the matching selector/heading.
- Neither behavior gave an explicit “context changed” or “record belongs to another
  facility” explanation.
- Shared supplier/customer/type reuse was functionally correct. The feedstock form
  described distance as autofilled “from the supplier,” and the order/delivery flow
  described a customer-location default, without stating that the party is
  organization-shared while the route is facility-relative.

## 10. Cache/context-switch timeline

| Sequence | Result |
| --- | --- |
| Create B run, inspect immediate list | Row appeared; summary cards briefly remained at pre-create zero until navigation/refresh, then reconciled |
| Submit B cache-probe reactor and immediately navigate to A | A never showed the B row; B hard refresh showed one saved row |
| B Quick Add bin → cancel run → A storage → B storage | Selected in originating form, absent in A, persisted once in B |
| A→B→A history and forward to B | URL, selector, heading, and rows stayed coherent |
| A/B same-profile tabs | Explicit query state remained coherent in each tab |
| Sign out | Session cleared, protected render stayed stale until reload (`B-001`) |
| Re-login | Default facility was A; explicit B URL restored B with no A rows |

No transient A-data flash was observed in the final rendered states; frame-by-frame
paint instrumentation was not performed.

## 11. Artifact index

| Artifact | Caption |
| --- | --- |
| `00-login-http-500.png` | Cropped, credential-free evidence from the recovered initial launch blocker |
| `01-facility-b-active.png` | Facility B active in selector/list; credential label hidden |
| `02-b-chain-dag.png` / `05-a-chain-dag.png` | Matched B/A DAG views |
| `03-b-chain-map.png` / `06-a-chain-map.png` | Matched B/A Map views |
| `04-b-chain-sankey.png` / `07-a-chain-sankey.png` | Matched B/A Sankey views |
| `08-a-dashboard.png` / `09-b-dashboard.png` | Matched isolated Dashboard states |
| `10-populated-b-archive-impact.png` | Populated B archive preview omitting application/sample counts |

All screenshots were captured at the same viewport. Account identifiers were hidden
before capture; no credential, cookie, token, or request body is present.

## 12. Known-issue mapping and blocked/not-tested scenarios

- `B-001` duplicates `DEF-009` from the current operational-stress ledger.
- `B-003` relates to facility/query-sheet context issues #253 and #372.
- `B-004` maps to organization-shared party/facility-relative distance issue #456.
- Readiness issue #246 was not reproduced as cross-facility contamination: B batch
  detail consistently named only B gaps and 3/3 B samples.
- Chain issue #308 was not reproduced as cross-facility graph leakage at desktop size.
- Removal/GHG status issues #380/#263/#250 were project-link gated; no external link
  was created, so draft membership, reconciliation, and submission remain untested.
- Genuine simultaneous A/B writes were not possible after the primary reviewer had
  finished. The run exercised interleaved writes, refreshes, two tabs, in-flight
  navigation, and session recovery instead.
- No destructive shared-record conflict, post-logout mutation, populated facility
  archive, external upload, registry project link, Removal, or GHG Statement was
  submitted.

## 13. Top isolation fixes and riskiest behavior

1. Await sign-out, immediately replace protected UI, clear client caches, and broadcast
   invalidation to every tab/context (`B-001` / `DEF-009`).
2. Make the facility archive preview enumerate applications, samples, readings, and
   other transitively hidden grandchildren, or clearly label the list as direct
   records only (`B-002`).
3. Add explicit context-change feedback for foreign deep links and label shared party
   records plus facility-relative distance ownership in forms (`B-003`, `B-004`).

The single riskiest cross-facility behavior remains an organization-shared supplier or
customer location carrying a distance that silently governs a different facility's
transport accounting. This pass did not find an A/B data leak, but the UI still leaves
that ownership boundary too implicit for a certification-sensitive value.
