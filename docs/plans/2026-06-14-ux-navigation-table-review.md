# UX Review — App Structure, Navigation & Table Usefulness — 2026-06-14

Browser-based UX/UI review on branch `fix/ux-navigation-table-review` (off `staging`).
Focus: app structure, navigation/menus, route hierarchy, task discoverability, and
the usefulness of table content on every route. Reviewed through three personas:

- **New operator** — complete facility setup → produce → generate a GHG statement.
- **Admin** — manage organizations, users, facilities, exceptions.
- **Certifier** — review submitted information, make certification decisions.

**Method**: authenticated session at `http://localhost:3100`, full-page screenshots of
all 24 routes at desktop (1440px) + mobile (390px); three read-only source-inventory
agents mapped every list/table (columns, actions, filters, empty states). Findings
verified against code and `CONTEXT.md` before any change.

---

## 1. Current route & menu map

Sidebar (`src/components/navigation/sidebar-content.tsx`), grouped by area with a color accent:

| Section (accent) | Items → route |
|---|---|
| _(top, no header)_ | Dashboard `/dashboard` · Chain of Custody `/chain-of-custody` |
| **Production** (orange) | Feedstocks `/feedstocks` · Production Runs `/production-runs` · Formulations `/formulations` · Biochar Products `/biochar-products` |
| **Infrastructure** (purple) | Reactors `/reactors` · Storage Locations `/storage-locations` · Energy `/energy` |
| **Distribution** (rose) | Suppliers `/suppliers` · Customers `/customers` · Orders `/orders` · Deliveries `/deliveries` · Applications `/applications` |
| **Verification** (pink) | Credit Batches `/credit-batches` · Lab Samples `/samples` |
| **Certification** (pink) | Removals `/certification/removals` · GHG Statements `/certification/ghg-statements` · Settings `/certification/settings` |
| **Admin** (red, admin-only) | Admin Panel `/admin` |

Above the nav: brand header + **Facility selector** (switch facility; footer "Manage Facilities" → `/facilities`; empty-state "Add First Facility").

**Gating**: Certification's Removals + GHG Statements are hidden until the active facility
has an Isometric registry link; only Settings shows when unlinked (verified — unlinked
facility redirects `/certification/removals` and `/certification/ghg-statements` →
`/certification/settings`).

**Routes not in the menu**: `/facilities` (+ `/facilities` detail via side-sheet),
`/admin/users`, `/admin/emission-estimates` (redirects → `/certification/settings?tab=emissions`),
detail routes `/credit-batches/[id]`, `/customers/[customerId]`, `/suppliers/[supplierId]`,
`/production-runs/[productionRunId]`, `/certification/removals/[removalId]` and `/.../review`.

---

## 2. Per-route table inventory

Legend: ✓ present · ✗ absent. "Cert." column = the certification-readiness pill.

| Route | Title | Layout | Columns (in order) | Row actions | Search / Filter / Sort | Empty state CTA |
|---|---|---|---|---|---|---|
| `/feedstocks` | Feedstocks | table | Code · Delivery Date · Supplier · Feedstock Type · Wet Mass · Dry Mass · Storage Bin · Moisture % · Status · **Cert.** · ⋯ | Edit, Delete | search ✓ / ✗ / sort ✓ | ✓ |
| `/production-runs` | Production Runs | table + 4 KPIs | Code · Date · Facility · Reactor · Feedstock (kg) · Biochar Wet (kg) · Status · **Cert.** · ⋯ | Open details, Edit, Delete | search ✓ / status ✓ / sort ✓ | ✓ |
| `/formulations` | Formulations | table | Code · Name · Biochar Ratio · Ingredients · Description · ⋯ | Edit, Delete | search ✓ / ✗ / sort ✓ | ✓ |
| `/biochar-products` | Biochar Products | table + 2 KPIs | Code · Production Date · Facility · Formulation · Wet Mass · Moisture % · Dry Mass · Storage · ⋯ | Edit, Delete | search ✓ / ✗ / sort ✓ | ✓ |
| `/reactors` | Reactors | table + 3 KPIs | Code · Identifier · Facility · Type · Sampling Method · Method B Status · ⋯ | Edit, Delete | search ✓ / ✗ / sort ✓ | ✓ |
| `/storage-locations` | Storage | 3-lane board | (board tiles: Code · Name · Type · Mass · fill gauge) | open | search ✓ / ✗ / — | ✓ |
| `/energy` | Energy | summary + stage table | Stage · Split % · Grid Electricity · Genset Energy | — (read-only) | ✗ | n/a (gated msgs) |
| `/suppliers` | Suppliers | table | Code · Name · Location · Contact · ⋯ | Open details, Edit, Delete | search ✓ / ✗ / sort ✓ | ✓ |
| `/customers` | Customers | table | Code · Name · Crop Type · Locations(count) · ⋯ | Open details, Edit, Delete | search ✓ / ✗ / sort ✓ | ✓ |
| `/orders` | Orders | table | Code · Date · Customer · Facility · Quantity (kg) · Deliveries(count) · ⋯ | Edit, Delete | search ✓ / ✗ / sort ✓ | ✓ |
| `/deliveries` | Deliveries | table + 4 KPIs | Code · Date · Order · Customer · Wet Mass · Dry Mass · Status · **Cert.** · ⋯ | Edit, Delete | search ✓ / ✗ / sort ✓ | ✓ |
| `/applications` | Applications | table + 2 KPIs | Code · Date · Biochar Applied (kg) · Dry Biochar (kg) · Field Size (ha) · Method · Status · **Cert.** · ⋯ | Edit, Delete | search ✓ / ✗ / sort ✓ | ✓ |
| `/credit-batches` | Credit Batches | card grid + 3 KPIs | (card: Code · Status · Facility · Period · Durability · CO₂e · App count) | View, Edit, Delete | search ✓ / status ✓ / — | ✓ |
| `/samples` | Lab Samples | table + 4 KPIs | Code · Sampling Time · Production Run · Total C % · Organic C % · H:C Ratio · Durability · **Cert.** · ⋯ | Edit, Delete | search ✓ / run ✓ / sort ✓ | ✓ |
| `/certification/removals` | Removals | table | Removal(id+period) · Credit batches · Status · Readiness | row → side-sheet | ✗ / ✗ / ✗ | ✓ |
| `/certification/ghg-statements` | GHG Statements | table | Reporting period · Linked removals · Registry record · Status | row → modal | ✗ / ✗ / ✗ | ✓ (gated) |
| `/certification/settings` | Settings | tabs (Connection/Emissions/Environment) | — | Link/Unlink | — | n/a |
| `/facilities` | Facilities | card grid + 3 KPIs | (card: Code · Country · Name · Location · Reactors · Storage · Feedstock) | View, Edit, Archive | search ✓ / country ✓ / — | ✓ |
| `/admin` | Admin | 2 tiles | Emission estimates · Users | tile → page | — | n/a |
| `/admin/users` | User Management | **stub** | "User invitation UI coming soon" | — | — | n/a |
| `/dashboard` | _(facility name)_ | KPI strip + panels | Record Checks · Now · Pipeline · Feedstock Mix · Evidence Health · Map | drill-down links | range toggle | EmptyState (no facility) |

---

## 3. Navigation & structure issues

1. **Facilities is buried.** `/facilities` is the area="Infrastructure" hub with full CRUD and
   setup signals, but it has **no sidebar link** — reachable only via the facility-selector
   dropdown footer ("Manage Facilities") or its empty state. A new operator doing facility
   setup is unlikely to find it. → Issue (nav-model decision: sidebar link vs. selector-owned).
2. **Menu order vs. setup order.** Sections lead with Production, but a new operator sets up
   Infrastructure (facility → reactors → storage) and master data (suppliers) first. Daily use
   favors Production-first; setup favors Infrastructure-first. → Issue (consider an onboarding
   checklist rather than reordering).
3. **`/admin/emission-estimates` → `/certification/settings` redirect.** The Energy empty
   state and the `/admin` "Emission estimates" tile both point at emission-estimates, which
   redirects into Certification Settings. The hop is intentional (consolidation) but the
   cross-area bounce is disorienting, and on an *unlinked* facility it lands on "link your
   facility" rather than the emissions form. → covered in deferred + docs.
4. **Certification empty-until-linked is good, but the "why" is only on Settings.** The gating
   is sound; Settings clearly explains linking. No change needed beyond a "what next" cue
   after linking (deferred).
5. **No breadcrumbs on facility-scoped pages.** Detail routes (credit-batch, customer, supplier,
   removal) rely on side-sheets/back; the new credit-batch detail has a breadcrumb — others
   don't. Low priority; consistent side-sheet pattern mitigates.
6. **Admin is thin.** `/admin/users` is a stub; no organization management yet (multi-tenancy
   is planned — ADR 0010). Expected at this stage. → tracked by existing multi-tenancy work.

---

## 4. Table content issues by route (highest-value)

- **Certifier lens — Removals**: no submission timestamp, no Isometric external ID in the table,
  Readiness blank for submitted/rejected rows (can't tell at a glance if a rejected removal is
  resubmittable). First question "what needs review / is resubmittable?" is only answerable by
  opening each row.
- **Certifier lens — GHG Statements**: no "submitted on / last sync" timestamp, so a certifier
  can't spot a statement stuck "Awaiting verifier" for weeks; no source-completeness signal
  (are all linked removals submitted?).
- **Facilities**: cards show reactor/storage counts but **no setup-completeness signal** (registry
  linked? emissions configured? ready to certify?) and no "next action".
- **Orders**: **no status column**; the "Deliveries" count is a bare number, not progress
  (e.g. `2/3 delivered`). A user can't tell if an order is fulfilled.
- **Applications**: table answers "how much / when / method" but **not "where / which customer"** —
  field location and customer are side-sheet-only. Evidence method (cert-critical) also hidden.
- **Credit Batches**: cards don't show submission/registry state or application-lineage health
  (0 apps = broken lineage is invisible); "Total Value" KPI label is ambiguous (currency? credits?).
- **Cross-cutting**: no "last updated" anywhere; the readiness column was mislabeled "Certifier"
  (fixed, see §6); samples "Sampling Time" renders a raw `toLocaleString()` (with seconds),
  inconsistent with `formatSafeDate` elsewhere.

---

## 5. Proposed table columns / filters / sorts / actions

**Removals** (certifier): add **Submitted on** + **Registry ID** columns; make Readiness show a
resubmit-eligible hint for rejected rows; add a Status filter. Sort by Submitted on / Status.

**GHG Statements**: add **Submitted / Last sync** column and a **Status** filter; show source
completeness (e.g. "3/3 removals submitted").

**Facilities**: add a **Setup** column/badge (registry linked · emissions set · ≥1 reactor) and a
"next action" affordance; surface it on the card.

**Orders**: add a **Status** column and change Deliveries to a **progress** indicator (`x/y delivered`);
add Status + Customer filters.

**Applications**: add **Customer / Location** and **Evidence method** columns; add Evidence-method
and Status filters.

**Credit Batches**: surface **submission/registry state** and **applications-ready/total** on the card;
clarify the "Total Value" KPI label and unit.

**All entity lists**: consider a **Last updated** (sortable) column; keep destructive Delete in the
row ⋯ menu (already separated), and confirm dialogs (already present).

---

## 6. Quick fixes implemented (this pass — verified, low-risk, copy-only)

- **Renamed the certification-readiness column "Certifier" → "Certification"** across all six
  surfaces that show it (feedstocks, production-runs, deliveries, applications, samples tables +
  credit-batch side-sheet) and updated the badge's doc comment. "Certifier" named a person/org;
  the column shows a **readiness** pill ("Ready" / "Incomplete (N)"), now parallel to the sibling
  "Status" column. Display-only; no test pinned the old header.
- **Reactors: column "Sampling" → "Sampling Method"** — disambiguates from the adjacent
  "Method B Status" column.

---

## 7. Deferred improvements (need design, not just copy)

- Samples "Sampling Time": replace raw `toLocaleString()` with a standard formatter — needs a
  decision on whether time-of-day matters (only `formatSafeDate`, date-only, exists today).
- Energy / `/admin/emission-estimates` cross-area redirect: make the path to the emissions form
  feel intentional (e.g. label the admin tile "→ Certification Settings") and improve the
  unlinked-facility message on that destination.
- "What next" cue after linking a facility to Isometric (Settings → "Create your first GHG statement").
- Dashboard / list "last updated" + data-freshness affordances.
- Breadcrumb consistency on detail routes.

---

## 8. Larger decisions → GitHub issues

Filed:

- **#262 — Facilities: discoverability + setup-completeness.** Sidebar-entry-vs-selector
  nav-model decision, plus a setup/readiness + next-action signal on the facilities list.
- **#263 — Certification tables (Removals & GHG Statements).** Submission timestamps, registry
  IDs, resubmit-eligibility, and source-completeness signals for the certifier; some need data
  plumbing.
- **#264 — Distribution tables (Orders & Applications).** Order status + delivery-progress
  indicator; Applications Customer/Location + Evidence-method columns and filters.

Tracked elsewhere: admin user management + organizations (multi-tenancy, ADR 0010 / existing work);
menu setup-vs-daily ordering (consider an onboarding checklist rather than reordering).
