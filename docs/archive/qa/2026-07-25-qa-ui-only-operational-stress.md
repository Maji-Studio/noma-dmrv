# 2026-07-25 UI-only operational stress test

Status: **Blocked — Computer Use unavailable after three consecutive goal turns**

This report is the execution ledger for the authorized staging-only operational
stress test. Source-derived expectations are not execution evidence. Only
behavior visibly observed through the bundled `@oai/sky` Computer Use runtime
may be recorded as a product pass, failure, or defect.

## Executive summary

The staging product was not assessed in this run. Three consecutive visible
Computer Use attempts returned the same external blocker: macOS is locked and
automatic unlock cannot unlock it. No GitHub Actions or noma-dmrv page opened,
no credential was entered, no staging record or document was created, and the
user-run staging reset was not rerun.

The three-turn blocked-audit threshold is satisfied. The goal is formally
blocked pending a manual desktop unlock. When resumed, execution starts in the
visible GitHub Actions UI by confirming the existing `Database management` /
`reset-empty-staging` run succeeded on `staging`; it must not be rerun.

## Execution record

| Attempt | Time (Europe/Zurich) | Transport | Result |
| --- | --- | --- | --- |
| 1 | 2026-07-25 12:49 | `mcp__node_repl__js` → plugin-owned `@oai/sky` → Chrome | Blocked: Mac locked; manual unlock required |
| 2 | 2026-07-25 12:50 | `mcp__node_repl__js` → plugin-owned `@oai/sky` → Chrome | Blocked: identical lock condition |
| 3 | 2026-07-25 12:51 | `mcp__node_repl__js` → plugin-owned `@oai/sky` → Chrome | Blocked: identical lock condition; formal threshold met |

## Confirmed findings

No application defect is confirmed. The lock is an execution-environment
blocker, not evidence about noma-dmrv.

## Severity-sorted findings ledger

No product findings can be entered until staging is visibly exercised.

## Section checklist

| Section | Status | Evidence / blocker |
| --- | --- | --- |
| Reset confirmation | Blocked | Chrome state unavailable; existing user-run reset was not rerun |
| A. Empty-state onboarding | Untested | Staging never opened |
| B. Active-facility context and isolation | Untested | Staging never opened |
| C. Roles and permissions | Untested | Staging never opened; additional authorized accounts not yet discoverable |
| D. Storage and inventory integrity | Untested | Staging never opened |
| E. Record lifecycle and dependency protection | Untested | Staging never opened |
| F. Documents and evidence | Untested | Staging never opened |
| G. Tables, filters, and navigation | Untested | Staging never opened |
| H. Session and recovery | Untested | Staging never opened |
| I. Dashboard, maps, and traceability | Untested | Staging never opened |
| J. Accessibility and responsive behavior | Untested | Staging never opened |

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

| Lane | Opening | Additions | Transfers out | Transfers in | Consumption | Delivery/application | Adjustments | Displayed ending | Reconciled |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Feedstock dry kg | — | — | — | — | — | — | — | — | Untested |
| Biochar dry kg | — | — | — | — | — | — | — | — | Untested |
| Product wet kg | — | — | — | — | — | — | — | — | Untested |

### Facility B

| Lane | Opening | Additions | Transfers out | Transfers in | Consumption | Delivery/application | Adjustments | Displayed ending | Reconciled |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Feedstock dry kg | — | — | — | — | — | — | — | — | Untested |
| Biochar dry kg | — | — | — | — | — | — | — | — | Untested |
| Product wet kg | — | — | — | — | — | — | — | — | Untested |

## Created-record and document inventory

No staging records or documents were created.

Local synthetic upload fixtures are prepared but have not been transmitted:

- Valid PDF
- Valid image
- Unsupported text file
- Empty file
- Two PDFs with the same filename and different contents
- Synthetic readings CSV from the prior staging QA fixture set, subject to
  visible file-picker availability

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

None observed because Chrome and staging never became visible. No alternative
console, network, API, or CLI path was used.

## Evidence inventory

No staging screenshots exist for this run. The Computer Use runtime returned
only the textual locked-Mac blocker and no application screenshot.

## Five most important fixes

No product fixes can be ranked without application evidence. The five required
release-evidence actions are:

1. Manually unlock the Mac.
2. Confirm the already user-run empty-staging reset succeeded through visible
   GitHub Actions; do not rerun it.
3. Execute the full two-facility staging walkthrough only through visible
   Computer Use.
4. Capture major-checkpoint and defect evidence while maintaining exact record,
   document, and stock inventories.
5. Replace this blocker-only verdict with an evidence-backed product risk
   verdict after every required matrix is populated.

## Worst security/scoping risk

Unassessed. The absence of visible execution is not evidence that isolation is
safe or unsafe.

## Worst operator-experience gap

Unassessed. The external desktop lock prevented reaching the product.

## Quick UX fixes versus product decisions

No product change is recommended without visible reproduction.

## Untested steps and exact blocker

Every application and GitHub Actions step is untested because the authorized
visible Computer Use runtime cannot acquire Chrome state while macOS is locked.
The safety boundary forbids substituting browser scripting, direct APIs,
GitHub CLI, database access, request manipulation, or session manipulation.

## Computer Use confirmation

All attempted GitHub/application interaction used the user-authorized
`mcp__node_repl__js` transport solely to invoke the installed bundled visible
`@oai/sky` Computer Use runtime. No prohibited interaction method was used.

## Final verdict

**Production-blocking — release evidence absent.**

This verdict applies to the inability to complete the required staging
validation, not to noma-dmrv product quality. Product safety remains unassessed.
Routine or production use should not be justified from this run.
