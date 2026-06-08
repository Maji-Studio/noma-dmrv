# Organization Guide

How to organize components, features, and shared code in noma-dmrv.

## File Naming

All files use kebab-case:

```text
feedstock-form.tsx
use-feedstocks.ts
create-dialog.tsx
```

Exports use standard JavaScript conventions:

- Components: `PascalCase` (`export function FeedstockForm()`)
- Hooks and functions: `camelCase` (`export function useFeedstocks()`)
- Constants: `UPPER_SNAKE_CASE` (`export const MAX_PREVIEW_ROWS = 5`)

Avoid abbreviations unless they are domain-standard.

## Component Organization

### Simple Feature Folders

Use this when a feature is under roughly 500 lines, has fewer than three major components, and has no nested dialog/modal set.

```text
src/components/[feature]/
├── index.ts
├── [feature]-list.tsx
├── [feature]-card.tsx
└── [feature]-form.tsx
```

Current examples:

- `src/components/credit-batches/`
- `src/components/feedstocks/`
- `src/components/transport-legs/`

Barrel exports are fine at the folder boundary:

```ts
// src/components/feedstocks/index.ts
export { FeedstockForm } from "./feedstock-form";
export { FeedstockList } from "./feedstock-list";
```

Use the barrel from outside the folder:

```ts
import { FeedstockForm, FeedstockList } from "@/components/feedstocks";
```

Inside the same folder, use direct imports to avoid circular dependencies:

```ts
import { WetMassWarning } from "./wet-mass-warning";
```

### Growing Feature Folders

Split a feature when it crosses one or more of these thresholds:

- 500+ lines in the folder.
- 3+ related components.
- 2+ custom UI-state hooks.
- Multiple dialogs, sheets, or modals.

Use a main export plus an implementation folder:

```text
src/components/[feature]/
├── [feature]-view.tsx
└── [feature]/
    ├── components/
    ├── dialogs/
    ├── hooks/
    ├── constants.ts
    └── utils.ts
```

Start simple. Split only when the current shape makes the feature harder to scan or test.

## Dialogs, Modals, And Sheets

Place feature-specific overlays near the feature:

```text
dialogs/
├── create-feedstock-dialog.tsx
├── edit-feedstock-dialog.tsx
└── delete-feedstock-dialog.tsx
```

Naming:

- `*-dialog.tsx`: forms and confirmations.
- `*-modal.tsx`: content-heavy overlays.
- `*-sheet.tsx`: side-sheet/detail surfaces.

Global primitives stay in `src/components/ui/`.

## Global Vs Feature-Specific

Start feature-specific. Promote after repeated use across features.

| Need | Feature-specific location | Global location |
|---|---|---|
| UI state hook | `src/components/[feature]/hooks/` | `src/hooks/` only if shared across features |
| Server data hook | `src/hooks/use-[feature].ts` | `src/hooks/` |
| Utility | `src/components/[feature]/utils.ts` | `src/lib/` |
| Form schema | N/A | `src/schemas/[feature].ts` |
| UI primitive | N/A | `src/components/ui/` |
| Type | near owner module | `src/types/` only if widely shared |

## Layering

Component organization follows the repo architecture:

```text
components/      UI
  -> hooks/      React Query
  -> fn/         server actions
  -> data-access/ queries + auth guards
  -> db/         Drizzle schema + connection
```

Distinguish UI-state hooks from server-data hooks:

```ts
// Feature UI state: keep near the feature.
export function useFeedstockFilters() {
  // search, table filters, local selections
}
```

```ts
// Server data: src/hooks/use-feedstocks.ts
export function useFeedstocks(facilityId: string | null) {
  return useQuery({
    queryKey: ["feedstocks", facilityId],
    queryFn: () => listFeedstocksAction(facilityId),
    enabled: !!facilityId,
  });
}
```

## Feature Checklist

When adding or changing a domain feature, keep related files aligned:

1. `src/schemas/[feature].ts` for form/action schemas and `z.infer` types.
2. `src/db/schema/[domain].ts` for persistent shape.
3. `src/data-access/[feature].ts` for guarded queries and mutations.
4. `src/fn/[feature].ts` for `"use server"` actions and orchestration.
5. `src/hooks/use-[feature].ts` for React Query reads/mutations.
6. `src/components/[feature]/` for forms, lists, and details.
7. `tests/` or `tests/e2e/` coverage scaled to risk.

Use current entity patterns such as facilities, feedstocks, and credit batches as references. Do not copy removed starter-template project/item patterns from git history.

## Documentation Hygiene

- Keep evergreen design and architecture notes in `/docs`.
- Move dated plans, audit notes, and implementation logs to `docs/archive/`.
- Track deferred work in `docs/open-questions.md`, not code comments.
- Update the relevant feature doc when a decision becomes settled.
