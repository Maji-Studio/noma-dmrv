# CLAUDE.md - Next.js App Template

This file provides guidance to Claude Code when working with this Next.js template.

## DO NOT - Critical Rules

**Read this first! These rules must NEVER be violated:**

- ❌ **NEVER use npm or yarn** - Always use `pnpm`
- ❌ **NEVER skip auth guards** - Always check user permissions in data-access layer
- ❌ **NEVER let a file exceed 1000 lines** - Split into smaller modular files
- ❌ **NEVER hard-code magic numbers** - Use constants at top of file or in `@/config`
- ❌ **NEVER commit `.env` files**
- ❌ **NEVER commit secrets, API keys, or credentials** - Not even in documentation or test files
- ❌ **NEVER log PII (emails, names)** - Use user IDs instead for debugging
- ❌ **NEVER create messy documentation** - Follow documentation standards below

## Security Best Practices

**Critical security lessons learned:**

### API Keys and Secrets
- **NEVER include actual API keys** in code, comments, or documentation (including test reports)
- Always use placeholders like `<REDACTED_API_KEY>` or `***REDACTED***`
- If a key is accidentally committed:
  1. **Rotate the key immediately** (create new, revoke old)
  2. **Scrub git history** using `git-filter-repo`:
     ```bash
     pip3 install git-filter-repo
     git filter-repo --replace-text <(echo 'EXPOSED_KEY==>***REDACTED***')
     git remote add origin <url>
     git push --force --all
     ```
  3. Update environment variables with new keys

### Logging Best Practices
- **Never log PII** (personally identifiable information)
- Log `userId` instead of `email` in error messages
- Example:
  ```typescript
  // ❌ BAD
  console.error("Failed for user:", { email: user.email });

  // ✅ GOOD
  console.error("Failed for user:", { userId: user.id });
  ```

### Code Review Reminders
- Check for exposed secrets before committing
- Review PR diffs carefully for accidental key exposure
- Use tools like CodeRabbit to catch security issues

## Documentation Standards

**Keep `/docs` clean and organized!** Only core, evergreen documentation belongs in the main docs folder.

### Core Documentation (Lives in `/docs`)
- **Product/Project Requirements** - Feature specifications and flows
- **Architecture** - System design and implementation patterns
- **Design System** - UI tokens, typography, component patterns
- **Database** - Schema, migrations, setup
- **Authentication** - Auth system configuration
- **Troubleshooting** - Consolidated common issues and solutions

### Archive Documentation (Belongs in `/docs/archive`)
**Move these to `/docs/archive` immediately:**
- ✅ **Implementation logs** - Step-by-step feature implementation notes
- ✅ **Quick fixes** - Temporary troubleshooting for specific issues
- ✅ **Dated documentation** - Time-specific debugging sessions
- ✅ **Completed feature requests** - Now-implemented features
- ✅ **Superseded docs** - Documentation replaced by core docs

### Creating New Documentation
**Before creating a new doc file, ask:**
1. Is this evergreen documentation that will remain relevant?
   - ✅ YES → Put in `/docs`
   - ❌ NO → Put in `/docs/archive` or skip it
2. Does this duplicate existing documentation?
   - ✅ YES → Update the existing doc instead
   - ❌ NO → Proceed with creating new doc

## Project Overview

This is a **Next.js App Template** - a production-ready starter with authentication, database, and best practices. It uses Next.js 16 with App Router, Better Auth for authentication, PostgreSQL with Drizzle ORM, and includes example CRUD features to demonstrate architecture patterns.

## Essential Commands

### Development
- `pnpm dev` - Start development server (port 3100)
- `pnpm build` - Build for production
- `pnpm start` - Run production server
- `pnpm lint` - Run ESLint checks

### Database Operations
- `pnpm db:generate` - Generate new migrations from schema changes (SAFE)
- `pnpm db:push` - Push schema changes directly (review first)
- `pnpm db:studio` - Open Drizzle Studio for database exploration (SAFE)

## Architecture

### Layered Architecture

```
Component (UI)
    ↓
hooks/ (React Query - client state)
    ↓
fn/ (Server actions - validation & orchestration)
    ↓
data-access/ (Database queries + auth guards)
    ↓
db/ (Database connection & schema)
```

**Key Principles**:
1. Each layer only imports from the layer below it
2. Server functions (`fn/`) ALWAYS use `"use server"` directive
3. All server functions validate input with Zod schemas
4. All data-access functions check authentication
5. Never skip layers - follow the flow

### Project Structure

```
├── src/
│   ├── app/               # Next.js App Router
│   │   ├── (auth)/        # Auth routes
│   │   ├── (app)/         # Protected app routes
│   │   │   └── [projectId]/ # Project-scoped routes
│   │   ├── admin/         # Admin panel
│   │   └── api/           # API routes
│   ├── components/        # React components
│   ├── config/            # Configuration
│   ├── data-access/       # Database queries + auth guards
│   ├── db/                # Database & schema
│   ├── fn/                # Server actions
│   ├── hooks/             # React Query hooks
│   ├── lib/               # Utilities
│   └── types/             # TypeScript types
```

## Code Quality Rules

### File Naming
- **All files use kebab-case**: `item-form.tsx`, `use-items.ts`, `create-project-dialog.tsx`
- **Component exports use PascalCase**: `export function ItemForm() { ... }`
- **Hook/function exports use camelCase**: `export function useItems() { ... }`
- **Avoid abbreviations** unless widely understood (e.g., `btn` → `button`)
- See `docs/organization.md` for complete organization patterns

### File Organization
- **File Size Limit**: Never exceed 1000 lines - split into smaller files
- **Barrel Exports**: Use `index.ts` for clean imports
- **Simple features** (< 500 lines, < 3 components): Flat folder structure
- **Complex features** (500+ lines, 3+ components, multiple dialogs): Subfolder structure with `components/`, `dialogs/`, `hooks/`

### Code Style
- **TypeScript Strict Mode**: Enabled - avoid `any` types
- **Magic Numbers**: Always use constants
- **Design Tokens**: Always use design system tokens, never hardcoded values
- **Responsive Design**: Mobile-first with design system breakpoints

### React Patterns

**⚠️ This project uses the React Compiler - leverage automatic optimizations!**

- **React Compiler**: Automatically memoizes components and values - don't add manual `useMemo`/`useCallback` unless profiling shows it's needed
- **Avoid useEffect**: Prefer React Query, server actions, and derived state over useEffect

  ```typescript
  // ❌ BAD - Using useEffect for data fetching
  useEffect(() => {
    fetch('/api/items').then(setItems)
  }, [])

  // ✅ GOOD - Use React Query for data fetching
  const { data: items } = useItems(projectId)

  // ❌ BAD - Using useEffect for derived state
  useEffect(() => {
    setFullName(firstName + ' ' + lastName)
  }, [firstName, lastName])

  // ✅ GOOD - Calculate derived state directly
  const fullName = firstName + ' ' + lastName
  ```

- **When useEffect IS appropriate**:
  - Synchronizing with external systems (non-React libraries, browser APIs)
  - Setting up subscriptions or event listeners
  - Imperative DOM manipulation (very rare with React 19)

- **React Compiler Benefits**:
  - Auto-memoization of components (no need for `React.memo`)
  - Auto-memoization of values (no need for `useMemo`)
  - Auto-memoization of callbacks (no need for `useCallback`)
  - Only add manual optimizations if performance profiling shows they're necessary

### React Hook Form Integration

**All forms use React Hook Form with Zod validation:**

```typescript
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { myFormSchema, type MyFormData } from "@/schemas/my-feature";
import { FormField, FormInput, ServerError } from "@/components/forms";

const {
  register,
  handleSubmit,
  formState: { errors, isSubmitting },
} = useForm<MyFormData>({
  resolver: zodResolver(myFormSchema),
  defaultValues: { title: "", description: "" },
});
```

**Key Points:**
- Schemas live in `src/schemas/` directory
- Use `FormField`, `FormInput`, `FormTextarea` components
- Use `ServerError` for server-side errors (use `setError('root.serverError', {...})`)
- Use `FormError` for field-level errors (handled by FormField)
- Client-side validation happens before server calls
- For numeric inputs: `{...register("age", { setValueAs: v => v === "" ? undefined : Number(v) })}`
- See `docs/forms.md` for complete guide

### Accessibility
- Touch targets: Minimum 44x44px
- Color contrast: Minimum 4.5:1 for text
- Keyboard navigation: All interactive elements accessible
- ARIA labels: Present where visual context insufficient

## Example Feature (Items CRUD)

The template includes a complete CRUD example in `/[projectId]/items`:

**Files to reference:**
- `src/db/schema/items.ts` - Database schema
- `src/data-access/items.ts` - Data layer with auth guards
- `src/fn/items.ts` - Server actions
- `src/hooks/use-items.ts` - React Query hooks
- `src/components/items/` - UI components
- `src/app/(app)/[projectId]/items/page.tsx` - Route

**Use this as a reference when creating new features.**

## Key Patterns

### ActionResult Pattern

All server functions return:

```typescript
type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
```

### Authentication Guards

**NEVER skip authentication checks!**

```typescript
// ❌ WRONG
export function createItem(data: any) {
  // No auth check
}

// ✅ CORRECT
export async function createItem(userId: string, data: any) {
  await requireAuth(); // Always check first
  // Safe to proceed
}
```

### React Query Integration

- **Query Keys**: `["resource", projectId, ...specifics]`
- **Mutations**: Invalidate related queries after success
- **Stale Time**: 30s for current data, 5m for historical

## Adding New Features

Follow this checklist when creating new features:

1. **Zod Schemas** (`src/schemas/your-feature.ts`)
   - Create form schemas with validation messages
   - Create server action schemas (may extend form schemas)
   - Export type inference: `export type MyFormData = z.infer<typeof myFormSchema>`

2. **Database Schema** (`src/db/schema/your-feature.ts`)
   - Define table with Drizzle
   - Export types
   - Add to `schema/index.ts`
   - Run `pnpm db:generate`

3. **Data Access** (`src/data-access/your-feature.ts`)
   - ALWAYS include auth guards
   - Use `requireAuth()` or `requireProjectMember()`
   - Export functions for CRUD operations

4. **Server Actions** (`src/fn/your-feature.ts`)
   - Mark with `"use server"`
   - Import schemas from `@/schemas`
   - Validate input with Zod schemas
   - Return `ActionResult<T>`

5. **React Query Hooks** (`src/hooks/use-your-feature.ts`)
   - Query hooks for data fetching
   - Mutation hooks with query invalidation

6. **Components** (`src/components/your-feature/`)
   - List, Card, Form components (use React Hook Form)
   - Use design system tokens
   - Barrel export from `index.ts`

7. **Routes** (`src/app/(app)/your-feature/page.tsx`)
   - Create page component
   - Use async params for Next.js 16

See `TEMPLATE_USAGE.md` for detailed examples.

## Design System Compliance

All UI MUST follow the design system in `docs/design-system.md`:

- **Typography**: Use classes (`.title-heading-1`, `.body-large`)
- **Spacing**: Use utilities (`gap-m`, `pt-l`) or CSS variables
- **Colors**: Use tokens (`var(--color-text-primary)`)
- **Components**: Prefer Base UI for accessibility

## Authentication System

- **Admin-invite only** by default (`ALLOW_SELF_SIGNUP=false`)
- Admin defined by `ADMIN_EMAIL` environment variable
- Email-based invitations via Resend
- Password resets via email tokens
- Session cookies via Better Auth (auto-set with `nextCookies` plugin)
- Middleware uses `getSessionCookie()` for auth checks (see `src/middleware.ts`)

## Environment Variables

All env vars validated via Zod in `src/config/env.ts`:

**Required:**
- `DATABASE_URL` - PostgreSQL connection
- `NEXT_PUBLIC_APP_URL` - App URL (used by Better Auth and other services)
- `BETTER_AUTH_SECRET` - 32+ character secret
- `RESEND_API_KEY` - Email API key
- `RESEND_FROM_EMAIL` - Sender email
- `ADMIN_EMAIL` - Admin email address
- `ALLOW_SELF_SIGNUP` - `false` for invite-only

**CRITICAL:** Never document secret VALUES, only variable NAMES.

## Isometric Requirements Docs

For Biochar + Soil Storage requirements work, always consult:
- `docs/isometric/README.md` (scope and usage)
- `docs/isometric/versions.json` (single source of pinned protocol/module versions)
- `docs/isometric/requirements-shortlist.md` (source-linked requirement summaries)
- `docs/isometric/schema-mapping.md` (current schema coverage and gaps)
- `docs/isometric/update-playbook.md` (refresh workflow)

Treat all local summaries as non-authoritative interpretations and verify against linked Isometric Registry URLs when implementing logic or making claims.

## Important Documentation Files

- **Modern Patterns** - `docs/modern-patterns.md` (current library patterns vs outdated LLM knowledge, includes Next.js 16 caching)
- **Template Usage** - `TEMPLATE_USAGE.md` (how to extend this template)
- **Architecture** - `docs/architecture.md` (system design, caching strategy, and implementation patterns)
- **Organization** - `docs/organization.md` (folder structure and organization patterns)
- **Design System** - `docs/design-system.md` (UI tokens and component patterns)
- **Database** - `docs/database.md` (Drizzle ORM setup and migrations)
- **Authentication** - `docs/auth.md` (Better Auth configuration and flows)
- **Forms** - `docs/forms.md` (React Hook Form integration guide)
- **Security** - `docs/security.md` (security best practices and guidelines)
- **Mail Setup** - `docs/mail-setup.md` (email configuration with Resend)
- **Isometric Requirements KB** - `docs/isometric/README.md` (Biochar + Soil Storage requirements, version pins, mapping)
- **Troubleshooting** - `docs/troubleshooting.md` (common issues and fixes)

## This is a Template

Remember: This is a starting point for new projects. The example features (items, dashboard) are meant to be:
- **Referenced** - Use as examples for your own features
- **Customized** - Adapt to your project needs
- **Removed** - Delete if not needed

Focus on teaching patterns, not preserving specific features.
