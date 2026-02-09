# Organization Guide

How to organize components, features, and code in this Next.js template.

## File Naming

**All files use kebab-case:**
```
✅ item-form.tsx, use-items.ts, create-dialog.tsx
❌ ItemForm.tsx, item_form.tsx, itemForm.tsx
```

**Exports use standard JavaScript conventions:**
- Components: `PascalCase` → `export function ItemForm()`
- Hooks: `camelCase` → `export function useItems()`
- Functions: `camelCase` → `export function formatDate()`
- Constants: `UPPER_SNAKE_CASE` → `export const MAX_ITEMS = 20`

**Avoid abbreviations** unless widely understood (e.g., `button.tsx` not `btn.tsx`)

## Component Organization Patterns

### Simple Pattern (Most Features)

**Use when:**
- < 500 lines total
- < 3 components
- No dialogs/modals

**Structure:**
```
components/[feature]/
├── index.ts                 # Barrel export
├── [feature]-list.tsx
├── [feature]-card.tsx
└── [feature]-form.tsx
```

**Example (items/):**
```typescript
// components/items/index.ts
export { ItemCard } from "./item-card";
export { ItemForm } from "./item-form";
export { ItemList } from "./item-list";

// Usage
import { ItemList, ItemCard } from "@/components/items";
```

### Complex Pattern (Growing Features)

**Use when:**
- 500+ lines total
- 3+ components
- 2+ custom hooks
- Multiple dialogs/modals

**Structure:**
```
components/[feature]/
├── [feature-view].tsx       # Main export
└── [feature]/               # Implementation folder
    ├── components/          # Reusable feature components
    │   ├── index.ts
    │   └── *.tsx
    ├── dialogs/             # Dialogs and modals
    │   ├── index.ts
    │   └── *.tsx
    ├── hooks/               # Feature-specific hooks
    │   ├── index.ts
    │   └── use-*.ts
    ├── utils.ts             # Feature utilities
    └── constants.ts         # Feature constants
```

**Example:**
```typescript
// components/items/items-view.tsx
import { ItemCard, ItemFilters } from "./items/components";
import { CreateDialog } from "./items/dialogs";
import { useItemFilters } from "./items/hooks";

export function ItemsView({ projectId }: Props) {
  const { filters } = useItemFilters();
  // Implementation
}

// components/items/index.ts
export { ItemsView } from "./items-view";
```

## Dialogs and Modals

Place in `dialogs/` folder when feature-specific.

**Naming:**
- `-dialog.tsx` → Forms and confirmations (create, edit, delete)
- `-modal.tsx` → Content-heavy overlays (details, settings)

```
dialogs/
├── create-item-dialog.tsx       # Create form
├── edit-item-dialog.tsx         # Edit form
├── delete-item-dialog.tsx       # Delete confirmation
└── item-details-modal.tsx       # Full details view
```

## Global vs Feature-Specific

**Decision tree:**
```
Is this used in 2+ features?
├─ YES → Global location
│   ├─ Hook → src/hooks/
│   ├─ Utility → src/lib/
│   ├─ Component → src/components/ui/
│   └─ Type → src/types/
└─ NO → Feature-specific location
    ├─ Hook → components/[feature]/[feature]/hooks/
    ├─ Utility → components/[feature]/[feature]/utils.ts
    ├─ Component → components/[feature]/[feature]/components/
    └─ Constants → components/[feature]/[feature]/constants.ts
```

**Rule of thumb:** Start feature-specific. Promote to global after third use in a different feature.

## Barrel Exports

Use `index.ts` for clean imports:

```typescript
// components/items/index.ts
export { ItemCard } from "./item-card";
export { ItemForm } from "./item-form";
export { ItemList } from "./item-list";
```

**Benefits:**
```typescript
// Without barrel export
import { ItemCard } from "@/components/items/item-card";
import { ItemForm } from "@/components/items/item-form";

// With barrel export
import { ItemCard, ItemForm } from "@/components/items";
```

**Avoiding circular dependencies:**

Within the same folder, use **direct imports** (not barrel):
```typescript
// ❌ BAD: Circular dependency
// item-card.tsx
import { formatItem } from "./";  // Don't import from barrel in same folder

// ✅ GOOD: Direct import
import { formatItem } from "./utils";  // Direct import
```

## Integration with Layered Architecture

Component organization fits into the overall architecture:

```
components/                    UI Layer
    ↓
hooks/ (React Query)          Client State Layer
    ↓
fn/ (Server actions)          Server Actions Layer
    ↓
data-access/                  Data Access Layer
    ↓
db/                           Database Layer
```

**Key distinction:**
- **Component hooks** (`components/[feature]/hooks/`) → UI state, filters, selections
- **React Query hooks** (`hooks/use-[feature].ts`) → Server data fetching

**Example:**
```typescript
// Component hook - UI state
// components/items/items/hooks/use-item-filters.ts
export function useItemFilters() {
  const [filters, setFilters] = useState({});
  return { filters, setFilters };
}

// React Query hook - Server data
// hooks/use-items.ts
export function useItems(projectId: string) {
  return useQuery({
    queryKey: ["items", projectId],
    queryFn: () => getItems(projectId),
  });
}
```

## When to Refactor

**Start simple.** Only refactor when you hit these thresholds:

- ✅ 500+ lines of code
- ✅ 3+ related components
- ✅ 2+ custom hooks
- ✅ Multiple dialogs/modals

**Don't over-engineer:**
- Don't create subfolders "just in case"
- Don't abstract until you need it
- Three similar lines is better than premature abstraction

## Migration Example

**Before (simple):**
```
items/
├── index.ts
├── item-list.tsx
├── item-card.tsx
└── item-form.tsx
```

**After hitting thresholds (complex):**
```
items/
├── items-view.tsx                    # New main export
└── items/
    ├── components/
    │   ├── index.ts
    │   ├── item-card.tsx             # Moved
    │   ├── item-filters.tsx          # New
    │   └── item-bulk-actions.tsx     # New
    ├── dialogs/
    │   ├── index.ts
    │   ├── create-item-dialog.tsx    # New
    │   └── edit-item-dialog.tsx      # New
    └── hooks/
        ├── index.ts
        ├── use-item-filters.ts       # New
        └── use-bulk-selection.ts     # New
```

**Steps:**
1. Create `items/items/` subfolder
2. Create `items/items/components/`, `items/items/dialogs/`, `items/items/hooks/` subfolders
3. Move existing components to `items/items/components/`
4. Create new components in appropriate subfolders
5. Create `items-view.tsx` as main export
6. Update `items/index.ts` to export only `ItemsView`
7. Update imports throughout the app

## Current Template Examples

**Simple features:**
- `src/components/items/` - Item CRUD (~300 lines, 3 components)
- `src/components/auth/` - Auth forms (4 independent forms)
- `src/components/forms/` - Form utilities (5 reusable components)

**When items would become complex:**
If we added: filtering UI, bulk operations, multiple dialogs, filter state management, bulk selection logic → then refactor to complex pattern.

## Summary

- **Files**: kebab-case (`item-form.tsx`)
- **Exports**: PascalCase components, camelCase functions
- **Simple** (default): Flat folder with barrel export
- **Complex** (500+ lines, 3+ components): Subfolder with organized structure
- **Dialogs**: `-dialog.tsx` for forms, `-modal.tsx` for content
- **Global vs Feature**: Promote after third use in different feature
- **Barrel exports**: Use for clean imports, avoid circular deps
- **Refactor**: Only when hitting thresholds, don't over-engineer
