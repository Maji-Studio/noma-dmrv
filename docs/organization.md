# Organization Guide

Where a new file goes: component folder shape, the feature-specific vs global
promotion rule, and documentation hygiene. Read it before creating a file or a
`/docs` page. Naming and export conventions are owned by
[code-style.md](./code-style.md); the layer stack and React Query conventions by
[architecture.md](./architecture.md); the per-entity build checklist by
[TEMPLATE_USAGE.md](../TEMPLATE_USAGE.md). This doc defers to all three.

## Component Folders Are Flat

A feature folder is a flat list of files plus a barrel `index.ts`. This holds
**at every size** — `src/components/credit-batches/` has 13 files (form, detail,
list, card, panel, colocated tests) and is still flat.

```text
src/components/[feature]/
├── index.ts
├── [feature]-list.tsx
├── [feature]-form.tsx
└── [feature]-card.tsx
```

There is no `components/` / `dialogs/` / `hooks/` subfolder split, and no
line-count threshold that triggers one. Do not introduce one; it would be the
only instance in the repo. The single sanctioned nested directory is a
**component that is itself a directory** (`src/components/ui/button/`,
`src/components/chain-of-custody/sankey/`) — used when one component needs
several private files, not to group a feature's components by kind.

Import through the barrel from outside the folder, directly from inside it —
self-importing the barrel creates a cycle:

```ts
import { FeedstockForm } from "@/components/feedstocks"; // outside
import { WetMassWarning } from "./wet-mass-warning";     // inside
```

Feature-specific overlays live beside the feature as `*-dialog.tsx` (forms and
confirmations) or `*-sheet.tsx` (side-sheet/detail surfaces). There is no
`*-modal.tsx` convention — `Modal` is a shared primitive in
`src/components/ui/modal/`, not a per-feature file. Global primitives stay in
`src/components/ui/`.

## Global Vs Feature-Specific

Start feature-specific. Promote only after repeated use across features.

| Need | Feature-specific | Global |
|---|---|---|
| UI state hook | beside the feature | `src/hooks/` only if shared |
| Server data hook | N/A | `src/hooks/use-<feature>.ts` |
| Utility | beside the feature | `src/lib/` |
| Form schema | N/A | `src/schemas/<feature>.ts` |
| UI primitive | N/A | `src/components/ui/` |
| Type | near owner module | `src/types/` only if widely shared |

Keep the two hook kinds distinct: **UI-state** hooks (search, filters, local
selection) sit with the feature, while **server-data** hooks belong in
`src/hooks/` and are the only ones that touch React Query.

## Documentation Hygiene

- Only **evergreen** notes belong in `/docs`. Dated plans → `docs/plans/`;
  implementation logs, superseded docs and debugging notes → `docs/archive/`.
- QA runs commit **only their markdown reports** under `docs/qa/artifacts/`;
  screenshots, videos, raw driver output, and scripts stay local
  (enforced by `.gitignore`).
- **Before creating a doc, ask:** is it evergreen, and does it duplicate an
  existing one? If it duplicates, update the existing doc — a second copy is how
  the two drift apart and start contradicting each other.
- Every doc opens with a one-paragraph "what this covers / when to read it".
- One topic, one owner. If a doc needs a fact another doc owns, link to it
  rather than restating it.
- Track deferred work as an entry in [open-questions.md](./open-questions.md),
  never as a code `TODO`. Resolve it by **removing the entry** and recording the
  decision in the owning evergreen doc or an [ADR](./adr/).
