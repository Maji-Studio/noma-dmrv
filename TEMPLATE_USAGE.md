# Template Usage Guide

This guide shows you how to customize and extend this Next.js template for your own projects.

## Getting Started with Customization

### 1. Initial Setup

**Prerequisites**: Docker Desktop installed and running.

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Copy environment variables:
   ```bash
   cp .env.example .env.local
   ```

3. Configure `.env.local` with your values (see Environment Variables section in README)

4. Start development:
   ```bash
   pnpm dev
   ```

   This automatically:
   - Starts PostgreSQL via Docker
   - Creates database schema
   - Seeds test data (1 admin, 1 user, 1 project, 2 items)
   - Starts Next.js on port 3100

5. Set passwords for seeded users:
   - Visit http://localhost:3100
   - Click "Forgot Password"
   - Enter email (from `ADMIN_EMAIL` or `user@example.com`)
   - Set password via email link

### 2. Rename the Project

1. Update `package.json`:
   ```json
   {
     "name": "your-project-name",
     "description": "Your project description"
   }
   ```

2. Update `README.md` with your project details

3. Update environment variables in `.env.local`

### 3. Customize the Design System

The template includes a custom design system in `docs/design-system.md`. To customize:

1. Edit `src/app/globals.css` to change design tokens (colors, spacing, typography)
2. Update CSS variables for your brand colors
3. Modify typography classes as needed

## Adding New Features

### Creating a New Database Table

Follow the example of the `items` table:

1. **Create schema file** (`src/db/schema/your-feature.ts`):
   ```typescript
   import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

   export const yourFeature = pgTable("your_feature", {
     id: uuid("id").primaryKey().defaultRandom(),
     // Add your columns here
     createdAt: timestamp("created_at").notNull().defaultNow(),
   });

   export type YourFeature = typeof yourFeature.$inferSelect;
   export type NewYourFeature = typeof yourFeature.$inferInsert;
   ```

2. **Export from schema index** (`src/db/schema/index.ts`):
   ```typescript
   export * from "./your-feature";
   ```

3. **Generate migration**:
   ```bash
   pnpm db:generate
   pnpm db:push
   ```

### Implementing CRUD Operations

Follow the layered architecture pattern used in the `items` feature:

#### 1. Data Access Layer (`src/data-access/your-feature.ts`)

```typescript
import { db } from "@/db";
import { yourFeature } from "@/db/schema";
import { requireAuth } from "@/lib/auth/server";

export async function getYourFeatures(userId: string) {
  // Always check auth first
  await requireAuth();

  return db.select().from(yourFeature);
}

export async function createYourFeature(userId: string, data: any) {
  await requireAuth();

  const [item] = await db
    .insert(yourFeature)
    .values(data)
    .returning();

  return item;
}
```

#### 2. Server Actions (`src/fn/your-feature.ts`)

```typescript
"use server";

import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import { getUser } from "@/lib/auth/server";
import { createYourFeature } from "@/data-access/your-feature";

const createSchema = z.object({
  // Define your validation schema
});

export async function createYourFeatureFn(
  data: z.infer<typeof createSchema>
): Promise<ActionResult<YourFeature>> {
  try {
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createSchema.parse(data);
    const item = await createYourFeature(user.id, validated);

    return { success: true, data: item };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create",
    };
  }
}
```

#### 3. React Query Hooks (`src/hooks/use-your-feature.ts`)

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createYourFeatureFn, getYourFeatures } from "@/fn/your-feature";

export function useYourFeatures() {
  return useQuery({
    queryKey: ["your-features"],
    queryFn: () => getYourFeatures(),
  });
}

export function useCreateYourFeature() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createYourFeatureFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["your-features"] });
    },
  });
}
```

#### 4. Components (`src/components/your-feature/`)

Create components following the example in `src/components/items/`:
- `YourFeatureList.tsx` - Main list component
- `YourFeatureCard.tsx` - Individual item display
- `YourFeatureForm.tsx` - Create/edit form (see "Creating Forms" below)
- `index.ts` - Barrel export

#### 5. Routes (`src/app/(app)/your-feature/page.tsx`)

```typescript
import { YourFeatureList } from "@/components/your-feature";

export default function YourFeaturePage() {
  return <YourFeatureList />;
}
```

### Creating Forms

All forms use React Hook Form with Zod validation. Follow this pattern:

#### 1. Create Schema (`src/schemas/your-feature.ts`)

```typescript
import { z } from "zod";

// Form schema (client-side validation)
export const yourFeatureFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(255),
  description: z.string().max(1000).optional().or(z.literal("")),
});

// Server action schema (may extend form schema)
export const createYourFeatureSchema = yourFeatureFormSchema.extend({
  projectId: z.string().uuid(),
});

export type YourFeatureFormData = z.infer<typeof yourFeatureFormSchema>;
```

#### 2. Create Form Component

```typescript
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { yourFeatureFormSchema, type YourFeatureFormData } from "@/schemas/your-feature";
import { FormField, FormInput, FormTextarea, ServerError } from "@/components/forms";

export function YourFeatureForm({ onSubmit }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<YourFeatureFormData>({
    resolver: zodResolver(yourFeatureFormSchema),
    defaultValues: {
      title: "",
      description: "",
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-m">
      <FormField id="title" label="Title" error={errors.title?.message}>
        <FormInput
          id="title"
          type="text"
          placeholder="Enter title"
          disabled={isSubmitting}
          error={!!errors.title}
          {...register("title")}
        />
      </FormField>

      <FormField
        id="description"
        label="Description (optional)"
        error={errors.description?.message}
      >
        <FormTextarea
          id="description"
          placeholder="Enter description"
          disabled={isSubmitting}
          error={!!errors.description}
          {...register("description")}
        />
      </FormField>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
```

**Key Points:**
- Schemas provide client-side validation before server calls
- Form components (`FormField`, `FormInput`, `FormTextarea`) handle design system styling
- `isSubmitting` comes from `formState` automatically
- Errors display automatically with field-level messages
- See `docs/forms.md` for complete guide and advanced patterns

## Common Patterns

### Authentication Guards

Always use authentication guards in data-access layer:

```typescript
import { requireAuth } from "@/lib/auth/server";
import { requireProjectMember } from "@/data-access/projects";

// Require any authenticated user
await requireAuth();

// Require project membership
await requireProjectMember(projectId, userId);
```

### Server Actions Pattern

All server actions follow this pattern:

1. Mark with `"use server"` directive
2. Validate input with Zod
3. Check authentication
4. Call data-access layer
5. Return `ActionResult<T>`

### React Query Keys

Use consistent query key structure:

```typescript
["resource-name", ...specifics]
["items", projectId]
["item", itemId]
```

## Removing Example Features

To remove the example `items` feature:

1. Delete files:
   ```bash
   rm -rf src/components/items
   rm -rf src/data-access/items.ts
   rm -rf src/fn/items.ts
   rm -rf src/hooks/use-items.ts
   rm -rf src/db/schema/items.ts
   rm -rf src/app/(app)/[projectId]/items
   rm -rf src/app/(app)/[projectId]/dashboard
   ```

2. Remove from schema index:
   ```typescript
   // Remove this line from src/db/schema/index.ts
   export * from "./items";
   ```

3. Generate new migration:
   ```bash
   pnpm db:generate
   ```

## Best Practices

1. **Never skip authentication checks** in data-access layer
2. **Always validate input** with Zod in server actions
3. **Use ActionResult type** for consistent error handling
4. **Follow the layered architecture** - don't skip layers
5. **Invalidate queries** after mutations for UI consistency
6. **Use design system tokens** instead of hardcoded values
7. **Keep files under 1000 lines** - split large files

## Next Steps

1. Review the existing `items` feature as a reference
2. Read `docs/architecture.md` for detailed architecture patterns
3. Check `.claude/CLAUDE.md` for AI-assisted development guidelines
4. Explore `docs/design-system.md` for UI customization

## Getting Help

- Check existing code in `src/components/items/` for examples
- Review server actions in `src/fn/items.ts` for patterns
- Look at data-access layer in `src/data-access/items.ts` for auth guards
- Consult the design system docs for styling guidance
