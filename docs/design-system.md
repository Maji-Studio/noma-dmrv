# Maji Noema Design System

Visual language for the app: the token model, the canonical page shell, and the
shared UI primitives in `src/components/ui/`. Read it before building or
changing any UI surface. It carries **intent, invariants, and gotchas only** —
token values live in `src/app/globals.css` (`:root`), and component props live
in the components' own TSDoc. Neither is duplicated here.

Related: [forms.md](./forms.md) (form/schema work) ·
[code-style.md](./code-style.md) (naming, React Compiler rules, a11y) ·
[architecture.md](./architecture.md) (layers, ActionResult, facility context) ·
[traceability.md](./traceability.md) (DAG / Map / Sankey surfaces) ·
[troubleshooting.md](./troubleshooting.md) ·
[open-questions.md](./open-questions.md) (deferred work).

---

## The invariants that break code silently

Read these first. Each one fails quietly rather than loudly.

- **The spacing scale is 1px per unit.** `p-4` is **4px**, not 16px. `gap-24`
  is 24px. Never carry a default-Tailwind mental model into this repo.
- **`@theme inline` sets `--spacing-*: initial` and `--radius-*: initial`**
  (`src/app/globals.css`). Default Tailwind spacing and radius classes are
  **deleted, not remapped** — `rounded-md` resolves to nothing at all and is
  dropped without any visible error. Only scale values that exist in the theme
  block work.
- **Radius: default to `rounded-none`** — the aesthetic is brutalist, and it is
  the majority (30 of 54 call sites). Sanctioned exceptions, all generated from
  the `--radius-*` tokens: `rounded-full` (dots, pills, avatars — 11),
  `rounded-4` (skeletons, micro-tags — 6), `rounded-8` (skeleton cards — 3).
  Three legacy surfaces hardcode `rounded-[8px]` (Accordion root, `Card.Root`
  with the opt-in `radius="default"`, bordered `Card.Icon`) — don't copy that
  into new code. Never write the bracket form `rounded-[var(--radius-*)]`; use
  the generated utility.
- **Two-greys rule:** every grey in the light theme is an **alpha of plum over
  white**, never a neutral grey — cool neutrals read dirty on the warm field.
  `--color-border-*`, `--color-text-*`, `--color-icon-*`,
  `--color-background-*`, `--color-surface-*` are all plum alphas. Never
  reintroduce `--color-gray-*` in component code.
- **Never re-apply a page background.** The body sits on the warm `--bg`;
  panels and cards are pure `--paper`.

---

## Color System

`src/app/globals.css` `:root` is the source of truth for every token value.
What the CSS can't tell you:

**Theme foundation (warm light).** `--bg` (warm field) → `--paper` (panels) →
`--ink` (near-black text). Light mode only, structured so a `html[data-theme]`
flip stays possible.

**Accent triad — always use the `-ink` variant for text on light.** The base
tokens (`--acc-prod` / `--acc-infra` / `--acc-dist`) are display fills; only
`--acc-prod-ink` / `--acc-infra-ink` / `--acc-dist-ink` pass 4.5:1. There is
**no `--acc-verif-ink` and no `--acc-cert-ink`** — Verification and
Certification deliberately share `--acc-dist-ink` (both read pink in the
sidebar). Don't invent the missing tokens.

**Status ramp** — `--st-ok` / `--st-run` / `--st-wait` / `--st-off` /
`--st-bad` is the canonical palette for status badges, dots, and state text.

`--color-signal-green` / `--color-signal-green-light` are **DEPRECATED** in
favour of `--st-ok` and an `--st-ok` tint, but still have ~22 live call sites
in `src/components`. Don't propagate them by copying a neighbouring component.

**Hairlines & the panel recipe.** Structure is drawn with borders, never drop
shadows — elevation is border + paper. Three steps: `--hair` (structural /
floating chrome) → `--hair-2` (secondary structure) → `--hair-3` (row dividers
in dense lists). Every surface on the warm field uses the `--panel-*` recipe,
applied **through shared components** (StatCard, DataTable frame, Card, entity
cards), never as per-page classes. Falls out of this:

- **Tables never sit flush on the field** — DataTable renders as a framed panel
  (toolbar inside, pagination as the footer row); headers are mono uppercase
  `.label-micro` on the `--sea` wash; rows separate with `--row-divider`,
  **no zebra striping**.
- **Elevated surfaces (side sheets, menus, dialogs) are pure `--paper` with a
  full-ink `--hair` border and no shadow** — scrim + border do the elevation.
  Alpha background tokens are translucent washes for fills *inside* panels;
  never an overlay's surface.

### Entity status

Five canonical state classes resolve every semantic entity status:

| State class | Statuses | Ramp token |
| --- | --- | --- |
| Neutral | Draft, superseded, cancelled, missing data | `--st-off` |
| In progress | Running, submitted, partial, ordered | `--st-run` |
| Success | Complete, delivered, applied, verified, issued, ready | `--st-ok` |
| Warning | Pending, upcoming, testing, scheduled, conditional | `--st-wait` |
| Error | Failed, rejected, void, ineligible | `--st-bad` |

The exhaustive mapping lives in `src/lib/status-state.ts`; its entry points are
`getStatusState(status)`, `getStatusStateColor(status)`, and
`STATUS_STATE_BADGE_CLASSES`. Entity status badges must use `StatusBadge`;
specialized renderers (map pills, graph pills) must use that shared mapping.
**Never pick an `--st-*` token in a feature component off an entity status.**
The ramp stays available for non-status uses (charts, feedback, accents).

---

## Typography

Class definitions live in `src/app/globals.css`. Size → class ladder:

- **12px:** `.body-caption` (captions) · `.label-micro` (mono uppercase table headers)
- **14px:** `.body-small`, `.label-button` (secondary text, buttons)
- **16px:** `.body-medium` (default body)
- **18px:** `.body-large`, `.label-input`
- **20px:** `.body-lead`
- **24px:** `.title-heading-3` (subsection titles)
- **32px:** `.title-heading-2` (section titles)

Use the design-system classes, never inline `text-4xl`. In-page section
headings on rollup/detail pages are `title-heading-3`, sentence case.

---

## Date and time display

Interactive read surfaces use the shared formatters from `@/lib/format-utils` —
`formatDate` (`Jun 13, 2026`), `formatDateTime` (24-hour), `formatDateRange`
(same-year and cross-year) — so dates have one timezone-safe vocabulary. Pass
bare `YYYY-MM-DD` calendar values straight in; `formatDate` and
`formatDateRange` protect them from UTC day drift. Never call
`toLocaleDateString`, `Intl.DateTimeFormat`, or a custom date-fns pattern in a
component, and never assemble a range by hand. Native date inputs and
machine-facing API/export/PDF contracts keep their ISO formats.

---

## Component library

**Base UI** ([base-ui.com](https://base-ui.com)) is the headless primitive
library — unstyled, accessible, styled with our tokens. Check it first for any
new primitive (dialog, select, menu). The package is **`@base-ui/react`** (it
was renamed; `@base-ui-components/react` will not resolve):

```tsx
import { Dialog } from "@base-ui/react/dialog";
```

Do not use shadcn or its theming system.

**Phosphor icons** — always the `*Icon`-suffixed export names (`TrashIcon`,
`PlusIcon`); the bare names are deprecated and appear nowhere in this codebase.
Both `@phosphor-icons/react` and `@phosphor-icons/react/dist/ssr` are in live
use, so match whichever the file you're editing already imports. Sizes: 16
(small) · 20 (in buttons) · 24 (standalone / StatCard) · 32 (large). Prefer
`weight="bold"`. Icon-only controls always need an `aria-label`.

---

## Base components

All live in `src/components/ui/<name>` (lowercase paths — capitalised paths
only resolve on macOS and break CI). Most re-export from the barrel:

```tsx
import { Button, EmptyState, Modal, PageHeader, StatCard } from "@/components/ui";
```

The barrel is **incomplete** — `Accordion`, `CertificationFieldTag`,
`DetailPanel`, `LoadingSkeleton`, `Toast`, `ViewRelatedLink` and
`DeleteConfirmDialog` are not exported. Import those from their own path. A
failed barrel import means the component exists elsewhere, not that it's
missing — don't rebuild it.

`@/` already maps to `src/` — `@/src/...` is always wrong.

### Button — `src/components/ui/button`

Always use `Button`; never a raw `<button>` with manual styling.

- **Variants:** `default` · `weak` · `primary` · `accent` · `noOutline` ·
  `destructive` (`--st-bad` outline, for delete actions).
- **Sizes:** `default` (40px) · `small` (32px) · `large` (48px, 60px at xl) ·
  `icon` (32×32, `p-0`).
- **`busy` is the one sanctioned in-flight convention.** It disables the button
  and renders a leading spinner. Do not hand-roll `disabled={isPending}` plus a
  text swap or your own spinner — `busy` exists to replace exactly that mix.
- **Quiet icon button:** `size="icon"` with `variant="noOutline"` (or
  `variant="destructive"` for a delete row action), plus an `aria-label`. Use
  this rather than `width="square"`, which yields a differently-sized control.
- There is **no `asChild` / Slot polymorphism** — `Button` is a plain
  `forwardRef` over `<button>`. To style a link, style the `<Link>` directly.
- Disabled is `disabled:opacity-40`, handled by the component.

### Modal — `src/components/ui/modal`

Built on Base UI `Dialog` (same primitive as `SlideOverPanel`) so the app
speaks one dialog library. Compose it for every centered dialog — you get the
built-in close button, ESC dismissal, focus trap, scroll lock, and focus
restore for free.

- Width tokens: `sm` 400px (confirmations) · `md` 560px (default: forms,
  wizards) · `lg` 720px (dense forms) · `xl` 880px (rich content). All are
  full-width below `sm`.
- **`dismissOnClickOutside={false}`** for multi-step workflows where a stray
  backdrop click would discard in-progress work. Close button and ESC stay live.
- **Accessibility is enforced, not suggested:** Modal dev-warns at runtime when
  neither `ariaLabelledBy` (preferred — id of a visible heading) nor
  `ariaLabel` is passed.
- Pass `contentClassName=""` to opt out of the default `p-24` when children
  render an edge-to-edge header and own their own spacing.
- The certification area's single confirm gate is `ConfirmActionDialog`
  (`src/components/certification/confirm-action-dialog.tsx`) — reuse it there
  instead of hand-rolling.

### Other primitives — intent only, props at source

- **`EmptyState`** — the shared dashed empty/zero-data card. Every empty and
  filtered-empty state uses it; **never a bare `<p>`**. Icon sizing is
  caller-owned.
- **`SelectFacilityEmptyState`** (`src/components/navigation`) — the *no
  facility chosen* state. Do not branch `EmptyState` copy on `facilityId`;
  this component exists so every first-run screen speaks with one voice.
  Facility-scoped pages early-return `container-max page-shell` + `PageHeader`
  + this, and gate the query `{ enabled: !!facilityId }` — skipping the gate
  fires an unscoped query.
- **`StepFlow`** — step rail + content slot + pinned footer. Deliberately dumb:
  **StepFlow never validates**; the parent owns the active index and gates
  forward progress by disabling its own Next button.
- **`StatCard`** — the one KPI card. **Always carries a 24px Phosphor icon.**
  Optional `sparkline` slot takes any node.
- **`ListPagination`** — same rows-per-page + first/previous/next/last contract
  as `DataTable.Pagination`. Facilities and Credit Batches are the sanctioned
  KPI-rich card-list hubs; ordinary entity lists stay data tables.
- **`PageHeader`** — mono uppercase area eyebrow → `title-heading-2` title →
  one-line subtitle → actions. `area` sets the eyebrow text and ink; `eyebrow`
  overrides the text; omit `area` for pages outside the nav groups
  (Traceability). **Every list page gets a subtitle** — one descriptive line,
  sentence case.
- **`DropdownMenu` / `RowActionsMenu`** — `RowActionsMenu` is *the* single
  row-action pattern for table and card lists: a quiet ⋮ per row, verbs in the
  menu. Row click opens the detail side sheet everywhere; explicit "View"
  buttons are retired (detail routes become an "Open details" item).
  `destructive: true` for irreversible actions only — **archive, restore, and
  unlink are reversible and stay neutral.** The wrapper stops propagation so
  menu clicks never fire the row click.
- **`Card`** (compound: `Card.Root` / `.Content` / `.Header` / `.Title` /
  `.Icon` / …) — a general-purpose panel with the shared recipe, used on the
  admin page. `Card.Root` defaults to `padding="none"` and `radius="none"`.
  For entity lists, use the Entity Card pattern below instead.

### EntitySideSheet mounting rule

`EntitySideSheet` must be **always mounted with a controlled `open` prop** —
conditional rendering skips the slide animation entirely (it mounts
already-open and unmounts instantly):

```tsx
// ✅ animates in and out
<EntitySideSheet open={!!sideSheet} onOpenChange={(o) => !o && closeSideSheet()}
  mode={sideSheet?.mode ?? "create"} … />

// ❌ no animation
{sideSheet && <EntitySideSheet open … />}
```

Derive title/subtitle/sections/form props with optional chaining + fallbacks
(see `order-list.tsx`), and keep `key={entity?.id ?? "create"}` on the form.
**`size` defaults to `"wide"`**, not `"default"` (`narrow` | `default` | `wide`
| `full`).

---

## Canonical Page Shell

The single anatomy for every routed page — list, rollup, and detail alike.
Reference implementations: `facility-list.tsx`, `reactor-list.tsx`,
`order-list.tsx`. **A main return that deviates from this shell is a bug**
(the early-return exceptions below are not deviations).

Routes themselves are 5–10 line server wrappers — `src/app/(app)/orders/page.tsx`
renders `src/components/orders/order-list.tsx`. The shell and all state live in
that `"use client"` component, **not** in `page.tsx`. Detail routes usually
redirect into the list's side sheet (`production-runs/[id]/page.tsx`); genuine
detail pages follow `credit-batches/[id]/page.tsx` — `requireOrgContext` → uuid
`safeParse` → `notFound()` → canonical `?facility=` redirect, plus a sibling
`not-found.tsx`.

```tsx
<div className="container-max page-shell">
  {/* 1. Header — area eyebrow → title → one-line subtitle → actions */}
  <PageHeader area="production" title="Orders" subtitle="…" actions={<Button …/>} />

  {/* 2. KPI strip — StatCards, every card carries a 24px Phosphor icon */}
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-24">
    <StatCard title="…" value={…} icon={<PackageIcon size={24} weight="bold" />} … />
  </div>

  {/* 3. Content — DataTable (framed panel) / card grid / panels */}
  <DataTable … emptyMessage={<EmptyState padding="md" … />} />
</div>
```

- The **main return** is always `container-max page-shell` — **no custom page
  padding.** Two sanctioned exceptions, both early returns before it: the
  no-facility state (above) and the query-error state, which is
  `<div className="container-max py-32"><ServerError … /></div>`
  (`ServerError` lives in `@/components/forms`, not `ui/`).
- `page-shell` (defined in `globals.css`) is the flex-column vertical rhythm
  and scales gap + vertical padding responsively (20px mobile → 24px ≥768px →
  32px ≥1024px), so pages don't carry a fixed 32px gap on phones.
- KPI strips: `gap-24` grid, `md:grid-cols-2` with `lg:grid-cols-3` (3 cards)
  or `lg:grid-cols-4` (4 cards).
- Tables/panels never sit flush on the warm field — use the `--panel-*` recipe.
- Side sheets: header title = entity code (or `Create X` in create mode — **no
  filler subtitle in create mode**); view/edit subtitle = the identifying
  secondary. Sections use `FormSection` / `DetailSection` — see
  [forms.md](./forms.md). The panel is `w-full` below `sm`, then locks to its
  size token. `DetailRow` pairs stack below `sm`, side-by-side at `sm`+.

**The one sanctioned exception is the Dashboard**: it keeps the container/gap
shell but opens with a display headline ("Dashboard" as `title-heading-2` under
a mono facility eyebrow) instead of `PageHeader`, its KPI strip is the 4-cell
**HeroKpiBand** (one ink-bordered strip, not iconed StatCards), and its hero is
the isometric traceability scene (`components/dashboard/flow-hero*`). No other
page gets a display headline.

### List-page idiom — copy `order-list.tsx:120-349`

Fifteen list components share one shape. Copy it rather than re-deriving:

- **State:** a single `sideSheet: { entity, mode } | null` with
  `openCreate/openView/openEdit/closeSideSheet` — not separate
  `isCreateOpen`/`editingX`/`viewingX` flags, which don't compose with
  `onModeChange`. Plus `searchQuery`, per-column filters, `currentPage`/
  `pageSize`, `hasActiveFilters`, `clearFilters`.
- **Loading is prop-driven.** There are **zero** route `loading.tsx` files —
  pass `isLoading` to `DataTable` and each `StatCard`; nested tables use
  `LoadingSkeleton`. A page-level spinner flashes the whole shell.
- **Mutations:** `toast.success(...)` on success; **failures go to local error
  state rendered as `<ServerError>` inside the sheet**, which stays open.
  `toast.error` is for non-form actions only — a form error in a toast lands
  far from the field that caused it.
- **Destructive confirm** is `DeleteConfirmDialog`
  (`@/components/ui/delete-confirm-dialog`), driven by a `deletingXId` state.
  Never hand-roll a `Modal` for this.
- **Toolbar controls are deliberately raw**: a hand-rolled `h-40` search
  `<input>` and plain `<select>`s, both needing `aria-label` — not `Input` or a
  Base UI Select. `<DataTable.Toolbar>` / `<DataTable.Pagination>` go in as
  children; server-paginated lists use `manualPagination` + `pageCount` +
  `pageIndex`.
- Call `useOpenCreateIntent(openCreate)` on any list with a create sheet — it
  powers `?create=true` deep links from the sidebar's "New X" actions.

---

## Entity Card pattern

All biochar entity cards (Facility, Credit Batch, Storage Location,
Application) are hand-rolled to this shape:

```tsx
<article
  className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] transition-colors hover:border-[var(--color-border-primary)] cursor-pointer"
  onClick={() => onView(entity)}
>
  <div className="flex flex-1 flex-col gap-16 p-20">
    {/* code badge in the area accent + secondary info */}
    {/* <h3 className="title-heading-3"> title */}
    {/* <div className="grid grid-cols-3 gap-12"> metrics */}
  </div>
  <div className="flex items-center justify-between gap-12 border-t border-[var(--color-border-tertiary)] px-20 py-12">
    <span className="body-caption text-[var(--color-text-tertiary)]">{footer}</span>
    <RowActionsMenu label={`Actions for ${entity.code}`} actions={[…]} />
  </div>
</article>
```

Rules: no border-radius · `border-secondary` default, `border-primary` on hover
· body `p-20`, footer `px-20 py-12` · 3-column metric grids are
`grid grid-cols-3 gap-12` · metric labels `body-caption`, values
`title-heading-3` · code badges use the area accent · actions go through
`RowActionsMenu`.

Other fixed spacings: auth-page card padding `p-32` · label→input `mb-6` ·
header→content `mb-32`.

---

## Forms

Owned entirely by [forms.md](./forms.md) — react-hook-form + Zod resolver,
`FormSection` / `DetailSection`, the `space-y-20` (side sheet) and `space-y-24`
(full page) rhythm, and the `@/schemas/helpers` numeric helpers. Read it before
any form or schema work; nothing about forms is duplicated here.

## Naming, file structure, React rules

Owned by [code-style.md](./code-style.md). Note that `ui/` components are
**named exports over `React.forwardRef`**, not default exports.
