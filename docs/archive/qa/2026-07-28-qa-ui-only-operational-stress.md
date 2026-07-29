# 2026-07-28 UI-only operational stress test

Status: **Blocked — Computer Use unavailable after three consecutive goal turns**

This is the execution ledger for the authorized staging-only operational stress
test. Source-derived expectations are preflight material, not execution
evidence. Only behavior visibly observed through the bundled `@oai/sky`
Computer Use runtime may be recorded as a product pass, failure, or defect.

## Executive summary

The staging product has not yet been assessed in this run. The automation
arrived at approximately 04:01 Europe/Zurich, after the brief's stated 02:00
start. Visible Computer Use acquisitions in three consecutive goal turns
returned the same external blocker: macOS is locked and automatic unlock cannot
unlock it. The first turn's plugin-required bundle-identifier retry returned
the identical result.

No GitHub Actions or noma-dmrv page opened, no credential was entered, no
staging record or document was created, and the user-run staging reset was not
rerun. The strict three-turn blocked-audit threshold is now satisfied. The goal
is formally blocked pending a manual desktop unlock.

## Execution record

| Goal turn | Time (Europe/Zurich) | Transport | Result |
| --- | --- | --- | --- |
| 1 | 2026-07-28 04:02 | `mcp__node_repl__js` → plugin-owned `@oai/sky` → Google Chrome | Blocked: Mac locked; manual unlock required |
| 1 retry | 2026-07-28 04:02 | Same runtime → `com.google.Chrome` | Blocked: identical lock condition |
| 2 | 2026-07-28 04:11 | Same runtime → `com.google.Chrome` | Blocked: identical lock condition |
| 3 | 2026-07-28 04:12 | Same runtime → `com.google.Chrome` | Blocked: identical lock condition; formal threshold met |

## Read-only preflight expectations

These expectations came from repository documentation and source inspection
permitted by the brief. They are not staging evidence and must not be promoted
to findings without visible reproduction.

- The visible onboarding guide should lead through Facility, Reactor, optional
  Registry, Supplier, Feedstock, Production run, and Credit batch. Facility
  management should remain discoverable from the active-facility selector.
- Facility-scoped operational rows, counts, maps, dependencies, and defaults
  must switch cleanly. Suppliers, Customers, their locations, and Feedstock
  Types are organization-wide by design and must be judged by their
  facility-relative use rather than their mere presence in both facilities.
- Clean Facility A arithmetic for the visible pass: 1,000 wet kg intake at 10%
  moisture = 900 dry kg; consume 400 wet / 360 dry kg; produce 150 wet kg;
  create 100 wet kg product; an upcoming 60 kg delivery must not reduce stock;
  marking it delivered must leave 40 kg product on hand.
- Operator stock actions are expected to be append-only stock-take and
  loss/write-off. Whether a generic transfer control exists must be established
  visibly. Stock-take should not increase inventory, exact-full consumption is
  allowed, and overdraw must fail with available/requested context.
- Facility archive is expected to be reversible; nonzero or used storage,
  reactor/run, supplier/intake, product/order, order/delivery, and
  delivery/application dependencies should fail with actionable blocker copy.
  Certification-linked lineage should become correction-locked.
- Canonical organization roles are Owner, Admin, and Member, with Platform
  Admin above them. Ordinary CRUD is broadly available; membership/settings
  and certification submission are privileged. No additional role may be
  simulated without an authorized account.
- User uploads are expected to enforce a 10 MB limit, allow duplicate filenames
  through unique storage keys, reject invalid confirmation without creating a
  false attachment, and lock mirrored/submitted evidence against deletion.
- Sign-out should invalidate the session, notify other tabs, and prevent Back
  from restoring protected views. Organization switching should clear the
  remembered facility and load the new dashboard.
- Dashboard and batch-anchored DAG, Map, Sankey, Lineage, Split, and Trail
  representations should reconcile quantities and facility context. Narrow
  screens should use labelled cards, modal navigation should trap focus, and
  keyboard/200% zoom operation must keep controls reachable.

## Confirmed findings

No application defect is confirmed. The desktop lock is an
execution-environment blocker, not evidence about noma-dmrv.

## Severity-sorted findings ledger

No product findings can be entered until staging is visibly exercised.

## Section checklist

| Section | Status | Evidence / blocker |
| --- | --- | --- |
| Reset confirmation | Blocked | Chrome state unavailable; existing user-run reset was not rerun |
| A. Empty-state onboarding | Untested | Staging has not opened |
| B. Active-facility context and isolation | Untested | Staging has not opened |
| C. Roles and permissions | Untested | Staging has not opened; additional authorized accounts not yet discoverable |
| D. Storage and inventory integrity | Untested | Staging has not opened |
| E. Record lifecycle and dependency protection | Untested | Staging has not opened |
| F. Documents and evidence | Untested | Staging has not opened |
| G. Tables, filters, and navigation | Untested | Staging has not opened |
| H. Session and recovery | Untested | Staging has not opened |
| I. Dashboard, maps, and traceability | Untested | Staging has not opened |
| J. Accessibility and responsive behavior | Untested | Staging has not opened |

## Two-facility isolation matrix

| Probe | Facility A | Facility B | Cross-facility result | Status |
| --- | --- | --- | --- | --- |
| Header and active context | — | — | — | Untested |
| Dashboard counts | — | — | — | Untested |
| Facility-scoped lists | — | — | — | Untested |
| Create-form dependency selectors | — | — | — | Untested |
| Refresh persistence | — | — | — | Untested |
| Back/forward across switches | — | — | — | Untested |
| Two-tab context behavior | — | — | — | Untested |
| Visible deep-link behavior | — | — | — | Untested |
| Documents | — | — | — | Untested |
| Traceability DAG / Map / Sankey / Trail | — | — | — | Untested |

Organization-wide Suppliers, Customers, their locations, and Feedstock Types
must not be misclassified as facility leakage. The visible pass must assess
their facility-relative selectors and derived distances separately.

## Role-permission matrix

| Capability | Platform Admin | Owner | Admin | Member | Status |
| --- | --- | --- | --- | --- | --- |
| View operational records | — | — | — | — | Untested |
| Create/edit operational records | — | — | — | — | Untested |
| Delete/archive | — | — | — | — | Untested |
| Documents | — | — | — | — | Untested |
| Inventory adjustments | — | — | — | — | Untested |
| Organization members/settings | — | — | — | — | Untested |
| Certification access/submission | — | — | — | — | Untested |
| Platform administration | — | — | — | — | Untested |

If no additional authorized test accounts are visible, multi-role execution
will be reported blocked and no invitations will be sent.

## Storage reconciliation

### Facility A

| Lane | Opening | Additions | Transfers out | Transfers in | Production consumption | Delivery/application | Adjustments | Displayed ending | Reconciled |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Feedstock dry kg | — | — | — | — | — | — | — | — | Untested |
| Biochar dry kg | — | — | — | — | — | — | — | — | Untested |
| Product wet kg | — | — | — | — | — | — | — | — | Untested |

### Facility B

| Lane | Opening | Additions | Transfers out | Transfers in | Production consumption | Delivery/application | Adjustments | Displayed ending | Reconciled |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Feedstock dry kg | — | — | — | — | — | — | — | — | Untested |
| Biochar dry kg | — | — | — | — | — | — | — | — | Untested |
| Product wet kg | — | — | — | — | — | — | — | — | Untested |

No generic operator bin-to-bin transfer action was confirmed by read-only
preflight. The visible pass will mark transfers unavailable rather than
simulate them if no control exists.

## Created-record and document inventory

No staging records or documents have been created.

Prepared local synthetic fixtures have not been transmitted:

- Valid PDF: `output/pdf/2026-07-22-ui-stress/qa-2026-07-22-valid-evidence.pdf`
- Valid image: `output/pdf/2026-07-22-ui-stress/qa-2026-07-22-valid-image.png`
- Unsupported text: `output/pdf/2026-07-22-ui-stress/qa-2026-07-22-unsupported.txt`
- Empty file: `output/pdf/2026-07-22-ui-stress/qa-2026-07-22-empty.txt`
- Same-name PDFs with different contents under `duplicate-a/` and `duplicate-b/`
- Synthetic readings CSV:
  `output/pdf/staging-qa-2026-07-15/reactor-readings-current.csv`

## Lifecycle and dependency matrix

| Entity | Created | Edited / persisted | Cancel / unsaved behavior | Duplicate code | Delete/archive before dependency | Protection after dependency | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Facility | — | — | — | — | — | — | Untested |
| Reactor | — | — | — | — | — | — | Untested |
| Storage location | — | — | — | — | — | — | Untested |
| Supplier / location | — | — | — | — | — | — | Untested |
| Feedstock type | — | — | — | — | — | — | Untested |
| Feedstock | — | — | — | — | — | — | Untested |
| Customer / location | — | — | — | — | — | — | Untested |
| Production run | — | — | — | — | — | — | Untested |
| Biochar product | — | — | — | — | — | — | Untested |
| Order | — | — | — | — | — | — | Untested |
| Delivery | — | — | — | — | — | — | Untested |
| Application | — | — | — | — | — | — | Untested |

## Console errors and failed requests

None observed because Chrome and staging have not become visible. No
alternative console, network, API, or CLI path was used.

## Evidence inventory

No staging screenshot exists for this run. The Computer Use runtime returned
only the textual locked-Mac blocker and no application screenshot.

## Five most important release-evidence actions

No product fixes can be ranked without application evidence. The five required
release-evidence actions are:

1. Manually unlock the Mac.
2. Confirm the already user-run empty-staging reset succeeded through visible
   GitHub Actions; do not rerun it.
3. Execute the full two-facility staging walkthrough only through visible
   Computer Use.
4. Capture major-checkpoint and defect evidence while maintaining exact record,
   document, and stock inventories.
5. Replace this blocker-only ledger with an evidence-backed product risk
   verdict after every required matrix is populated.

## Worst security/scoping risk

Unassessed. The absence of visible execution is not evidence that isolation is
safe or unsafe.

## Worst operator-experience gap

Unassessed. The external desktop lock prevented reaching the product.

## Quick UX fixes versus product decisions

No quick UX fix or product decision is recommended without visible
reproduction.

## Untested steps and exact blocker

Every application and GitHub Actions step remains untested because the
authorized visible Computer Use runtime cannot acquire Chrome state while
macOS is locked. The safety boundary forbids substituting browser scripting,
direct APIs, GitHub CLI, database access, request manipulation, or session
manipulation.

## Computer Use confirmation

All attempted GitHub/application interaction used the user-authorized
`mcp__node_repl__js` transport solely to invoke the installed bundled visible
`@oai/sky` Computer Use runtime. No prohibited interaction method was used.

## Final verdict

**Production-blocking — release evidence absent.**

This verdict applies to the inability to complete the required staging
validation, not to noma-dmrv product quality. Product safety remains
unassessed. Routine or production use should not be justified from this run.
