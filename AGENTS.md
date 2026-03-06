# AGENTS.md

Guidance for coding agents working in `noma-dmrv`.

## Purpose

This repository is a biochar carbon credit MRV application built with Next.js 16, React 19, Better Auth, PostgreSQL, and Drizzle ORM. Agents should favor small, correct changes that preserve the existing layered architecture and security model.

## Critical Rules

- Use `pnpm` only. Do not use `npm` or `yarn`.
- Do not bypass authentication or authorization checks. Enforce permissions in `src/data-access/`.
- Do not commit secrets, API keys, credentials, or `.env` files.
- Do not log PII such as names or email addresses. Prefer stable IDs.
- Do not let files grow past roughly 1000 lines. Split large modules before adding more complexity.
- Do not hard-code reusable values or magic numbers. Extract constants near the top of the file or into `src/config/`.
- Do not invent new architectural patterns when an existing entity pattern already fits.
- Do not add manual React memoization by default. This codebase uses the React Compiler.

## Project Snapshot

- App framework: Next.js 16 App Router
- Package manager: `pnpm`
- Auth: Better Auth
- Database: PostgreSQL + Drizzle ORM
- Validation: Zod
- Forms: React Hook Form
- Client data fetching: TanStack React Query
- Tests: Vitest + Playwright
- Default dev port: `3100`

## Essential Commands

### Development

- `pnpm dev` starts the standard Docker-backed local setup
- `pnpm dev:docker:init` starts Docker, resets the DB, ensures admin, then runs the app
- `pnpm dev:manual` runs Next.js directly on port `3100`
- `pnpm build` builds for production
- `pnpm lint` runs ESLint
- `pnpm typecheck` runs TypeScript checks

### Database

- `pnpm db:generate` generates Drizzle migrations from schema changes
- `pnpm db:migrate` runs migrations
- `pnpm db:push` pushes schema changes directly; review before using
- `pnpm db:verify-schema` validates schema consistency
- `pnpm db:seed` seeds the database
- `pnpm db:ensure-admin` ensures the admin user exists
- `pnpm db:reset` resets the database, pushes schema, and ensures admin; destructive
- `pnpm db:studio` opens Drizzle Studio

### Tests

- `pnpm test` runs Vitest
- `pnpm test:e2e` runs Playwright

Prefer targeted verification for the files you changed, then broader checks when risk warrants it.

## Architecture

Follow the existing layered flow:

```text
UI component
  -> hooks/
  -> fn/
  -> data-access/
  -> db/
```

Rules:

- UI components should not query the database directly.
- `src/fn/` server functions orchestrate work and validate input.
- `src/data-access/` owns database queries and auth guards.
- Database schema and connection code live under `src/db/`.
- Reuse existing entity modules before creating new cross-cutting abstractions.

## Repo Structure

Key directories:

- `src/app/` App Router routes
- `src/components/` entity UI and shared components
- `src/data-access/` database access with auth enforcement
- `src/fn/` server actions
- `src/hooks/` React Query hooks
- `src/schemas/` Zod schemas for forms and actions
- `src/db/schema/` Drizzle schema definitions
- `src/lib/` shared utilities and CLI scripts
- `tests/e2e/` Playwright coverage
- `docs/` evergreen documentation
- `docs/archive/` dated or superseded documentation

## Preferred Implementation Patterns

### Entity CRUD Work

Most business entities follow a repeatable pattern:

- `src/schemas/<entity>.ts`
- `src/data-access/<entity>.ts`
- `src/fn/<entity>.ts`
- `src/hooks/use-<entity>.ts`
- `src/components/<entity>/`
- `src/app/(app)/...`
- `tests/e2e/<entity>.spec.ts`

When adding or changing an entity workflow, mirror the closest existing entity instead of designing a new pattern.

### Forms

- Use React Hook Form with Zod resolvers.
- Keep schemas in `src/schemas/`.
- Prefer the shared form components in `src/components/forms/`.
- For server-side form errors, use the existing form error conventions instead of ad hoc state.
- For numeric and nullable inputs, reuse helpers from `src/schemas/helpers` rather than coercing inline.

### React

- Prefer derived state over `useEffect`.
- Prefer React Query or server-driven patterns over manual client fetching.
- Add `useEffect` only for true external synchronization, subscriptions, or imperative browser integration.
- Avoid `useMemo`, `useCallback`, and `React.memo` unless profiling shows a real need.

## Security and Data Handling

- Redact secrets in code, docs, screenshots, and test artifacts.
- If a secret is exposed, stop and flag it immediately rather than working around it silently.
- Use IDs rather than emails or names in logs.
- Treat uploaded files, external inputs, and query params as untrusted; validate them with existing schemas and helpers.

## Documentation Rules

Keep `docs/` clean:

- Put evergreen architecture, setup, workflow, or domain docs in `docs/`.
- Put implementation logs, dated notes, temporary troubleshooting, and superseded content in `docs/archive/`.
- Update an existing doc when it already covers the topic.
- Do not create throwaway documentation files for one-off implementation notes unless the user asks for them.

Useful existing references include:

- `docs/architecture.md`
- `docs/database.md`
- `docs/forms.md`
- `docs/organization.md`
- `docs/troubleshooting.md`
- `docs/security.md`

## Validation Expectations

Before finishing substantial work, run the narrowest checks that meaningfully validate the change. Common options:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- <pattern>`
- `pnpm test:e2e -- <spec>`
- project-specific CLI checks such as `pnpm db:verify-schema`

If you could not run verification, say so explicitly and explain why.

## Change Discipline

- Prefer minimal patches over broad rewrites.
- Preserve unrelated user changes in the worktree.
- If the repo already has a local convention, follow it even if another pattern might also work.
- When touching migrations or schema, verify the corresponding generated artifacts and downstream callers.
- When adding docs, keep them concise and aligned with the existing `docs/` structure.
