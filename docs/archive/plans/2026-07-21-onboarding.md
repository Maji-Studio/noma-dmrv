# Onboarding — first-run setup for a new admin

**Date:** 2026-07-21 · **Status:** Implemented (PR #500) · **Scope:** Owner/Admin
first-run facility setup. Org creation stays with the Platform Admin and is out
of scope.

## Problem

A brand-new Owner/Admin lands in an org the Platform Admin created for them. The
org is seeded with 9 starter feedstock types and **nothing else** — no facility.
After login they are redirected to `/dashboard`, which is 100% facility-scoped
and renders only a "Select a facility" empty state. A fresh org has no facility,
so the dashboard is a **dead-end**: the sole path forward is a small dashed "Add
First Facility" link buried in the sidebar facility selector. Every other nav
destination repeats the same "Select a facility" gate. There is no wizard, no
guide, no welcome — nothing that teaches the setup order.

This plan gives that admin a guided path from an empty org to a working MRV loop.

## Shape: two surfaces

1. **First-run wizard** — a thin modal that captures only the create-once
   foundation that unblocks the app.
2. **Getting-started guide** — a computed, self-clearing dashboard guide that
   walks the remaining setup at the admin's own pace.

Both are **Owner/Admin only**. A Member who lands in a half-provisioned facility
sees a calm "Setup in progress — your admin is still configuring this facility"
state instead of the guide.

## Trigger (no stored flag)

The wizard auto-opens when, and only when, **the user is Owner/Admin AND the org
has zero facilities**. This is derived from data — there is no `hasOnboarded`
column. Once a facility exists the wizard never auto-opens again; remaining setup
lives in the dashboard guide. A skip is dismissible for the session but the
wizard re-opens on the next login until a facility exists.

## Surface 1 — First-run wizard

Built on the existing `StepFlow` primitive (`src/components/ui`, step rail +
content slot + pinned footer) inside a `Modal` with
`dismissOnClickOutside={false}` so a stray backdrop click never discards
in-progress work. `StepFlow` is deliberately dumb (it never validates); the
wizard owns the active index and gates its own Next button.

Steps:

| # | Step | Captures | Notes |
|---|------|----------|-------|
| 0 | **Welcome** | — | Sets expectations; one screen. |
| 1 | **Facility** | name, location, durability tier | Reuses `facility-form.tsx`. Durability tier field already exists (`durabilityOption`, ADR 0021). **200-yr option is greyed/"coming soon"; only 1000-yr is selectable** until 200-yr is supported end-to-end. |
| 2 | **Reactor** | first reactor | Requires the facility just created. |
| 3 | **Connect registry** | Isometric connection | Registry picker shows **Isometric (active) + Puro Earth + CSI, the latter two greyed with their logos** (pure UI — stored provider stays `isometric`; no enum change). Then the Isometric connection (org credentials + facility project mapping). **Skippable** via "I'll connect later". |

- The wizard is **skippable** at any point; the dashboard behind it always
  carries a first guide card, so a skip is never a dead-end.
- If the registry step is skipped, "Connect your registry" becomes the first
  card in the getting-started guide (see below).

## Surface 2 — Getting-started guide

A computed guide on the dashboard. **Phase 1 only** for this effort; Phase 2
(the downstream removal chain) is explicitly deferred.

### Phase 1 steps (in dependency order)

1. Facility ✓ *(done in wizard)*
2. Reactor ✓ *(done in wizard)*
3. **Connect registry (Isometric)** — done when the facility has a linked
   certifier project. Shown checked if connected in the wizard; otherwise this
   is the first actionable card.
4. **Add a supplier** — done when the org has ≥1 supplier.
5. **Record first feedstock intake** — done when the facility has ≥1 feedstock.
   The feedstock form's inline storage-bin quick-add covers the bin
   prerequisite, so this step does not dead-end on a missing bin.
6. **Complete a production run** — done when ≥1 production run is `complete`.
7. **Create a credit batch** — done when the facility has ≥1 credit batch.

Reaching a credit batch proves the core MRV loop works.

### Engine: computed & self-clearing

Each step's done-ness is **derived from record existence**, never a saved
per-step flag — it can never drift from reality, and the whole guide auto-
vanishes when the last Phase-1 step is satisfied. A per-user "hide guide"
preference lets power users collapse it early (and bring it back). See the
**Setup step** glossary entry — this is a sibling to **Attention item**, not the
same concept (setup gaps vs. operational MRV gaps).

### Layout: takeover, then recede

While Phase 1 is incomplete, the guide **is** the dashboard body — it replaces
the all-zero `HeroKpiBand` and flow hero (which would render as meaningless
zeros on a fresh facility). The dashboard's display headline + facility eyebrow
stay on top throughout. Once Phase 1 is complete, the guide collapses to a slim
strip and the real dashboard (KPIs, flow hero, attention feed) takes over.

### Step actions: deep-link to real forms

Each step's CTA reuses the existing `?create=true` / `useOpenCreateIntent`
deep-link pattern: clicking navigates to the entity's page with its create
side-sheet already open. No entity forms are rebuilt inside the guide — one
source of truth per form. On return, the guide re-computes and the step shows
done.

## Design signature

Rather than a generic checkbox list, render the guide as the **traceability
spine itself** — a vertical chain of links (Facility → Reactor → Registry →
Supplier → Feedstock → Production run → Credit batch) where completed links fill
in, echoing the app's chain-of-custody identity and the isometric flow-hero. One
bold element; everything around it stays quiet and disciplined. Refine in the
frontend-design build pass. Brutalist tokens apply (`rounded-none`, plum-alpha
greys, borders-not-shadows — see `docs/design-system.md`).

## What's deferred (not in this effort)

- **Phase 2** of the guide: customer → order → delivery → application → lab
  samples → submit Removal. This is recurring operational work better served by
  ordinary **Attention items** once the facility is producing.
- **Real multi-registry**: Puro Earth / CSI stay greyed placeholders. Making them
  real needs enum + `credit_batches` CHECK-constraint changes and
  provider-specific integration libs — out of scope here. (Note: the enum's
  third slot today is `verra`, not `csi`; the greyed logos are UI-only and do not
  touch it.)
- **200-yr durability** end-to-end support.
- **Self-signup** and Member-orientation onboarding.

## Implementation notes / to verify at build

- Exact Owner/Admin role check for the trigger (roles: Owner / Admin / Member).
- The durability-tier greying is an onboarding-context concern on the reused
  `facility-form.tsx` — confirm the form can accept a "disable 200-yr" prop
  without forking the component.
- Registry connection reuses the existing certifier connection UI
  (`organization-certifier-credentials.tsx` + `facility-certifier-dialog.tsx`);
  the wizard step should embed/route to those rather than reimplement.

## Build outcome (deviations from this plan)

- The 200-yr greying already existed globally in `DurabilityTierSelect` (with a
  single available tier the facility form renders read-only 1000-yr info,
  #348) — no per-form prop was needed.
- Registry connection was platform-admin-only server-side; a follow-up product
  decision made it **self-serve for org Owners/Admins** (same-org enforced;
  platform admins keep cross-org access). The wizard registry step and
  certification settings both carry the credentials + link surfaces.
- The wizard **auto-opens only for real org Owners/Admins** — a platform admin
  browsing a fresh org gets the guide takeover, not a modal.
- Members are blocked from the dashboard only while the facility is
  **pre-operational** (no reactor); later open steps (registry, supplier, …)
  must not lock them out of a producing facility.
- The "hide guide" preference is localStorage (per-browser), mirroring the
  facility-selection precedent.

## Key references

- `src/components/ui` — `StepFlow`, `Modal`, `EmptyState`.
- `src/components/dashboard/` — `dashboard-view.tsx`, `HeroKpiBand`, flow hero.
- `src/components/navigation/facility-provider.tsx`,
  `facility-selector.tsx` (current zero-facility CTA),
  `select-facility-empty-state.tsx`.
- `src/lib/auth/better-auth.ts` (session org auto-select, org-defaults seeding),
  `src/lib/auth/server.ts` (`getOrgContext`, role resolution).
- `src/components/facilities/facility-form.tsx`, `src/schemas/facilities.ts`
  (`durabilityOption`).
- `docs/design-system.md`, `CONTEXT.md` (**Setup step**, **Attention item**).
