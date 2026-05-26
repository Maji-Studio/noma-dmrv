# Database

PostgreSQL database with Drizzle ORM for type-safe queries and project-scoped data access.

---

## ⚠️ Critical Safety Warning

Follow these rules when working with migrations:

- ✅ **SAFE**: `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:studio`
- ⚠️ **DESTRUCTIVE**: `pnpm db:push` — local development only, never for staging or production

**Migration Rule**: Generate → Review SQL → Test staging → Apply to production

---

## Local Development Setup

### Quick Start

**Prerequisites**: Docker Desktop installed and running.

The project includes Docker Compose for local PostgreSQL. Simply run:

```bash
pnpm dev
```

This automatically:
1. Starts PostgreSQL container (if not running)
2. Waits for database to be ready
3. Pushes schema changes to database
4. Seeds minimal test data (on first run only)
5. Starts Next.js development server

### Manual Control

If you prefer to manage Docker separately:

```bash
# Start PostgreSQL
pnpm docker:up

# Start Next.js only (assumes Docker is running)
pnpm dev:manual
```

### Common Operations

```bash
# Stop database (keeps data)
pnpm docker:down

# Reset database data only (keeps Docker running)
pnpm db:reset

# Stop Docker and remove all data (full reset)
pnpm docker:clean

# View database in browser
pnpm db:studio

# Add demo/sample data
pnpm db:seed
```

### Seed Data

`pnpm db:reset` bootstraps the database schema and ensures the admin user exists.

`pnpm db:seed` adds the richer demo dataset used for local development, staging, and QA:
- Multiple facilities
- Suppliers and customers
- Storage locations, reactors, and logistics entities
- Example traceability-chain records

**Setting passwords**: Better Auth manages passwords separately. To use the admin account created by reset:
1. Visit http://localhost:3100
2. Click "Forgot Password"
3. Enter the admin email address
4. Set your password via the email link

**Recommended flow**:
1. `pnpm db:reset`
2. `pnpm db:seed`

**Idempotency**: The demo seed script checks for existing demo data and skips duplicate insertion.

### Configuration

Database connection is configured via environment variables in `.env.local`:

```bash
# Default local setup (works with Docker Compose)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/noma_dmrv_dev

# Optional overrides
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=noma_dmrv_dev
POSTGRES_PORT=5432

# Optional pool tuning for the main app pool (values shown are the code
# defaults; DB_POOL_MAX is a per-environment decision — keep it low on
# serverless). These env vars are read only by the main pool created in
# `src/db/index.ts`. CLI/maintenance scripts (`src/lib/cli/*`) and the
# `src/db/seed-data.ts` seeder build their own short-lived pools via
# `getPgPoolConfig(...)` and do not honor DB_POOL_* — they use pg's
# built-in defaults instead.
DB_POOL_MAX=1
DB_POOL_IDLE_TIMEOUT_MS=10000
DB_POOL_CONNECTION_TIMEOUT_MS=10000
```

### Troubleshooting

**Port already in use**: If port 5432 is occupied, override it:
```bash
# .env.local
POSTGRES_PORT=5433
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/noma_dmrv_dev
```

**Container won't start**: Check Docker Desktop is running and has enough resources.

**Database connection fails**: Wait a few seconds after `docker:up` before running migrations. The `dev` script handles this automatically.

---

## Overview

| Component | Technology |
|-----------|-----------|
| **Database** | PostgreSQL |
| **ORM** | Drizzle ORM v0.45.1 |
| **Connection** | `pg` Pool (connection pooling) |
| **Current Tables** | 45+ tables (auth, facilities, production, logistics, credits) |
| **Security** | Application-level auth guards + per-project membership |
| **Migrations** | Incremental migrations from start |

**Connection setup:**
```typescript
// src/db/index.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
```

---

## Isometric Sampling Method (Reactor-Level)

The system stores sampling method at the **reactor** level and enforces Method B guardrails using historical data scoped to that reactor.

### Where it is stored

- `reactors.sampling_method`: `method_a | method_b` (default: `method_a`)

### Reactor-level eligibility rules for `method_b`

- A reactor can only be set to `method_b` after at least **30 prior samples** exist for that reactor.
- For credit batches linked to reactors using `method_b`, sampled runs in the reporting period must satisfy **>= 1 sampled run per 10 runs**.

### Enforcement layers

1. UI: disable/hide Method B when ineligible for the selected reactor.
2. Server/API: validate eligibility before write.
3. Database triggers: final guardrail against bypass writes.

### Why reactor-level today

`production_run_id` represents a single run and cannot evaluate cumulative thresholds across runs.  
Reactor-level is currently used as the process proxy until a dedicated `production_process_id` model is introduced.

---

## Certification (Isometric Certify)

Provider-agnostic persistence for outbound certifier integrations.
Source: `src/db/schema/certification.ts`.

| Table | Purpose |
|---|---|
| `certifier_projects` | Maps a facility to an external certifier project + default removal template. |
| `certifier_ghg_statements` | Period-anchored GHG Statement artifacts; roll up multiple Removals for a reporting period (ADR 0004). |
| `certifier_removals` | The Isometric Removal — the submission unit; N credit batches → 1 removal; nullable `ghg_statement_id` FK. |
| `certifier_sources` | Provider-agnostic external source mappings (e.g. feedstock-type IDs). |
| `certification_submissions` | Versioned submission ledger with `lockedAt` + `payloadHash` + `version`. The lock + idempotency primitive for every outbound POST. |
| `certifier_document_uploads` | Links local `documents` rows to provider-uploaded document IDs. |
| `certifier_sync_events` | Append-only audit log of every outbound HTTP attempt (request, response, status). Never used as state — debugging/UI only. |

Row-level descriptions live in `docs/schema-overview.md`; the
integration design (idempotency rules, layered architecture, phase
status) is documented in `docs/isometric/integration-plan.md`.

---

## Migration History

This template starts with a clean schema for multi-project applications.

**Initial migration includes:**
1. Better Auth tables (users, session, account, verification)
2. Project tables (projects, project_members)
3. Example CRUD tables (items)

**Notable migrations:**
- `0002`: Added `formulation_ingredients` table and `ingredient_type` enum; dropped `compost_ratio` from `formulations` (replaced by multi-ingredient model)
- `0003`: Simplified delivery status enum from `scheduled`/`processing`/`delivered` to `upcoming`/`delivered`; migrated existing rows
- `0004` (staging): Schema refinements — moved truck weighing fields from `applications` to `deliveries`; added `credit_batch_production_runs` M:M junction table; renamed `feedstock_deliveries.weight_kg` → `wet_mass_kg` and added `storage_location_id` FK; split `production_runs.feedstock_mass_used_kg` into `feedstock_wet_mass_kg` / `feedstock_moisture_percent` / `feedstock_mass_dry_kg`; made `customer_locations` GPS nullable; removed `suppliers.annual_revenue_usd` and `chain_of_custody_ref`
- `0005`: Dropped `credit_batch_production_runs` junction table — credit batches now trace to production runs indirectly via the application → delivery → product → run FK chain
- `0006`: Upgraded all GPS columns from `real` (4-byte) to `double precision` (8-byte) across all tables; added `timezone` column to `facilities`
- `0007`: Added `biochar_moisture_percent` and `biochar_dry_mass_kg` to `production_runs` with check constraints
- `0008`: Created `supplier_locations` table; added `country`, `state_region`, `city` to `customer_locations`; made `customer_locations.name` nullable

**Migration approach:** Incremental migrations tracked in `/drizzle/` directory.

---

## Import Patterns

```typescript
// Database client
import { db } from "@/db";

// Schema tables
import { users, projects, items } from "@/db/schema";

// Data access layer (recommended)
import { getProject, createProject } from "@/data-access/projects";
import { requireProjectMember } from "@/data-access/projects";

// Auth guards
import { requireAuth } from "@/lib/auth/server";
```

---

## Current Schema

The schema consists of 5 core tables for auth and multi-project functionality.

### Auth Tables (Better Auth)

#### `users`
**Purpose**: User accounts
**Schema definition**: `src/db/schema/auth.ts`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Unique user ID |
| `email` | TEXT | NOT NULL, UNIQUE | User email address |
| `email_verified` | BOOLEAN | NOT NULL | Email verification status |
| `name` | TEXT | NOT NULL | Full name |
| `created_at` | TIMESTAMP WITH TIME ZONE | NOT NULL | Creation timestamp |
| `updated_at` | TIMESTAMP WITH TIME ZONE | NOT NULL | Last update timestamp |

**Additional Better Auth tables**: `session`, `account`, `verification` - See Better Auth documentation for details.

---

### Project Tables

#### `projects`
**Purpose**: User projects with scoped access
**Schema definition**: `src/db/schema/projects.ts`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Unique project ID |
| `name` | TEXT | NOT NULL | Project name |
| `created_by_user_id` | TEXT | NOT NULL, FK → users | User who created project |
| `created_at` | TIMESTAMP WITH TIME ZONE | NOT NULL | Creation timestamp |
| `updated_at` | TIMESTAMP WITH TIME ZONE | NOT NULL | Last update timestamp |

#### `project_members`
**Purpose**: Per-project membership and roles
**Schema definition**: `src/db/schema/projects.ts`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Membership ID |
| `project_id` | TEXT | NOT NULL, FK → projects | Project |
| `user_id` | TEXT | NOT NULL, FK → users | User |
| `role` | TEXT | NOT NULL | Role: admin, member |
| `created_at` | TIMESTAMP WITH TIME ZONE | NOT NULL | Creation timestamp |

**Notes:**
- Project admin can manage members and settings
- Project member can view and edit project content

---

### Example CRUD Table

#### `items`
**Purpose**: Example CRUD entity (customize for your use case)
**Schema definition**: `src/db/schema/items.ts`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Unique item ID |
| `project_id` | TEXT | NOT NULL, FK → projects | Project this item belongs to |
| `name` | TEXT | NOT NULL | Item name |
| `description` | TEXT | | Optional description |
| `created_by_user_id` | TEXT | NOT NULL, FK → users | User who created item |
| `created_at` | TIMESTAMP WITH TIME ZONE | NOT NULL | Creation timestamp |
| `updated_at` | TIMESTAMP WITH TIME ZONE | NOT NULL | Last update timestamp |

**Notes:**
- This is an example table demonstrating the layered architecture
- Replace with your own domain entities
- All queries are project-scoped for multi-tenancy

---

## Project-Scoped Queries

All queries must be scoped to a project to ensure data isolation.

**Pattern: Always filter by project_id**

```typescript
// ❌ BAD: No project scoping
const items = await db.select().from(items);

// ✅ GOOD: Project-scoped query
const items = await db
  .select()
  .from(items)
  .where(eq(items.projectId, projectId));
```

**Validate project membership first:**
```typescript
// src/data-access/projects.ts
export async function requireProjectMember(
  projectId: string,
  userId: string
): Promise<void> {
  // Throws on unauthorized access
}
```

**Data access layer pattern:**
```typescript
// src/data-access/items.ts
export async function getProjectItems(
  userId: string,
  projectId: string
) {
  // 1. Check membership
  await requireProjectMember(projectId, userId);

  // 2. Query data (project-scoped)
  const projectItems = await db
    .select()
    .from(items)
    .where(eq(items.projectId, projectId))
    .orderBy(desc(items.createdAt));

  return projectItems;
}
```

**Multi-project isolation best practices:**
- Never query across projects in a single request
- Use project_id in all WHERE clauses
- Validate membership before any data access
- Include project_id in indexes for performance

---

## Data Access Layer Pattern

Three-layer architecture separates concerns:

```mermaid
graph TD
    A[Component] -->|calls| B[fn/ - Server Functions]
    B -->|validates input| B
    B -->|calls| C[data-access/ - DB Queries]
    C -->|checks auth| C
    C -->|queries| D[db/ - Connection + Schema]

    style B fill:#FF9800
    style C fill:#4CAF50
    style D fill:#2196F3
```

**Layer responsibilities:**

| Layer | Purpose | Example |
|-------|---------|---------|
| `components/` | UI rendering | `<SourceList />` |
| `fn/` | Validation + business logic | `createSource(projectId, title, content)` |
| `data-access/` | Auth guards + DB queries | `insertSource(userId, projectId, data)` |
| `db/` | Connection + schema | `db`, `sources`, `projects` |

**Example flow** (creating an item):

```typescript
// 1. Client Component
const handleCreate = async () => {
  const result = await createItem(projectId, name, description);
};

// 2. Server Function (fn/items.ts)
"use server";
export async function createItem(
  projectId: string,
  name: string,
  description?: string
) {
  // Validation
  const parsed = itemSchema.safeParse({ name, description });
  if (!parsed.success) {
    return { success: false, error: "Invalid input" };
  }

  // Call data access layer
  const user = await getUser();
  return await insertItem(user.id, projectId, parsed.data);
}

// 3. Data Access Layer (data-access/items.ts)
"use server";
export async function insertItem(
  userId: string,
  projectId: string,
  data: { name: string; description?: string }
) {
  // Auth check (must be project member)
  await requireProjectMember(projectId, userId);

  // Database operation
  const [newItem] = await db
    .insert(items)
    .values({
      projectId,
      name: data.name,
      description: data.description,
      createdByUserId: userId,
    })
    .returning();

  return { success: true, data: newItem };
}
```

---

## Security Model

The system uses **application-level auth guards** with per-project membership checks.

**Basic auth guard** (`src/lib/auth/server.ts`):
```typescript
import { getUser } from "@/lib/auth/server";

export async function requireAuth() {
  const user = await getUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}
```

**Project membership guard:**
```typescript
export async function requireProjectMember(
  projectId: string,
  userId: string
): Promise<void> {
  // Throws "Forbidden: Not a project member" when missing membership
}
```

**Usage pattern:**
```typescript
// In data access layer
export async function updateProjectName(
  userId: string,
  projectId: string,
  newName: string
) {
  // Require admin role
  await requireProjectMember(projectId, userId);

  // Proceed with update
  await db
    .update(projects)
    .set({ name: newName })
    .where(eq(projects.id, projectId));

  return;
}
```

---

## Migration Workflow

### Safe Migration Process

| Command | Safety | Purpose |
|---------|--------|---------|
| `pnpm db:generate` | ✅ **Safe** | Generate SQL migration files from schema |
| `pnpm db:migrate` | ✅ **Safe** | Run generated migrations |
| `pnpm db:studio` | ✅ **Safe** | Visual database browser (read-only UI) |
| `pnpm db:push` | ⚠️ **DESTRUCTIVE** | Push schema directly (dev only, skip reviewed migration files) |

### Migration Sequence for New Project

The template includes a complete initial migration with all core tables.

**Initial migration includes:**
1. Better Auth tables (users, session, account, verification)
2. Project tables (projects, project_members)
3. Example CRUD tables (items)

### Pre-Migration Checks

**IMPORTANT**: Some migrations require data validation before applying schema changes.

**Example: Unique Constraint on Project Memberships**

The `project_members` table has a unique constraint on `(project_id, user_id)`. Before applying this constraint:

```bash
# Check for duplicate memberships
pnpm db:check-duplicates

# If duplicates found, clean them up (interactive confirmation)
pnpm db:cleanup-duplicates

# Or skip confirmation for automated pipelines
pnpm db:cleanup-duplicates --force
```

The cleanup script keeps the oldest entry for each (projectId, userId) pair.

### Step-by-Step Workflow

1. **Define schema** in TypeScript (`src/db/schema/*.ts`)
   ```typescript
   import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

   export const items = pgTable("items", {
     id: text("id").primaryKey(),
     projectId: text("project_id").notNull().references(() => projects.id),
     name: text("name").notNull(),
     description: text("description"),
     createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
     createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
     updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
   });
   ```

2. **Generate migration**
   ```bash
   pnpm db:generate
   ```
   Creates SQL file in `/drizzle/` directory.

3. **Review SQL** (CRITICAL STEP)
   ```bash
   cat drizzle/0001_new_migration.sql
   ```
   Check for:
   - ✅ Correct table/column names
   - ✅ Appropriate constraints and foreign keys
   - ✅ Indexes for performance
   - ✅ No data loss (ALTER TABLE operations)

4. **Test on staging**
   - Apply migration to staging database first
   - Verify schema is correct
   - Test application functionality

5. **Apply to production**
   ```bash
   pnpm db:migrate
   ```

**Rollback strategy**: Keep manual rollback SQL ready before applying destructive migrations.

### Staging migration failure runbook

If a staging migration fails, treat it as a deployment stop, not a Git revert.

1. **Stop promotion**
   - Do not continue to production until staging is healthy again.
   - Do not auto-revert the PR just because the migration job failed.

2. **Check the actual database state**
   - Determine whether the migration applied nothing, applied partially, or completed with unexpected side effects.
   - A code revert does not undo database changes that have already been applied.

3. **Choose recovery intentionally**
   - **No changes applied**: fix the migration and rerun it.
   - **Safe additive changes applied**: prefer fix-forward with a follow-up migration or patch.
   - **Partial/destructive changes applied**: use a prepared manual rollback or a documented recovery procedure.

4. **Verify before unblocking**
   - Re-run the migration path on staging.
   - Run schema verification.
   - Smoke test the affected application workflows.

Preferred policy:

- Fail the workflow fast.
- Block production promotion.
- Inspect staging database state first.
- Recover with fix-forward or manual rollback, depending on what actually ran.

Safer migration design:

- Prefer multi-step, backward-compatible migrations.
- Add new columns/tables first.
- Backfill in a controlled step.
- Switch application reads/writes.
- Drop old columns later in a separate migration.

### Configuration

**File:** `drizzle.config.ts`
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

---

## Type Safety Patterns

Drizzle provides **zero-cost type safety** through TypeScript inference.

### Type Inference

```typescript
// SELECT type (what comes out of database)
export type Source = typeof sources.$inferSelect;
// { id: string; projectId: string; title: string; content: string; ... }

// INSERT type (what goes into database)
export type NewSource = typeof sources.$inferInsert;
// { projectId: string; title: string; content: string; createdByUserId: string; ... }

// Use in functions
async function getSource(id: string): Promise<Source | null> {
  const result = await db
    .select()
    .from(sources)
    .where(eq(sources.id, id))
    .limit(1);

  return result[0] ?? null;
}
```

### Zod Validation

Combine Drizzle with Zod for runtime validation:

```typescript
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// Auto-generated Zod schemas from Drizzle schema
export const insertSourceSchema = createInsertSchema(sources);
export const selectSourceSchema = createSelectSchema(sources);

// Refine for specific validation
export const createSourceSchema = insertSourceSchema.pick({
  title: true,
  content: true,
}).refine(
  (data) => data.title.trim().length > 0,
  { message: "Title cannot be empty" }
);

// Use in server functions
const parsed = createSourceSchema.safeParse(data);
if (!parsed.success) {
  return { success: false, error: parsed.error.issues[0].message };
}
```

### ActionResult Pattern

Standardized result type for server functions:

```typescript
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// Usage
async function createProject(
  name: string
): Promise<ActionResult<Project>> {
  try {
    const [project] = await db
      .insert(projects)
      .values({ name })
      .returning();

    return { success: true, data: project };
  } catch (error) {
    return { success: false, error: "Failed to create project" };
  }
}
```

---

## Common Operations

### Insert Record

```typescript
const [newItem] = await db
  .insert(items)
  .values({
    projectId: "proj_123",
    name: "New Item",
    description: "Item description",
    createdByUserId: userId,
  })
  .returning();
```

### Select Single Record

```typescript
import { eq } from "drizzle-orm";

const result = await db
  .select()
  .from(items)
  .where(eq(items.id, itemId))
  .limit(1);

return result[0] ?? null;
```

### Select All (Project-Scoped)

```typescript
import { eq, desc } from "drizzle-orm";

const projectItems = await db
  .select()
  .from(items)
  .where(eq(items.projectId, projectId))
  .orderBy(desc(items.createdAt));
```

### Update Record

```typescript
await db
  .update(items)
  .set({
    name: "Updated Name",
    updatedAt: new Date(),
  })
  .where(eq(items.id, itemId));
```

### Delete Record

```typescript
// Hard delete
await db
  .delete(items)
  .where(eq(items.id, itemId));
```

### Paginated Queries

```typescript
import { desc } from "drizzle-orm";

const PAGE_SIZE = 20;

const paginatedItems = await db
  .select()
  .from(items)
  .where(eq(items.projectId, projectId))
  .orderBy(desc(items.createdAt))
  .limit(PAGE_SIZE)
  .offset(page * PAGE_SIZE);
```

---

## Auto-Generated Entity Codes

Every biochar entity has a unique human-readable `code` column. Codes follow the format `{PREFIX}-{YYYY}-{NNN}` (e.g., `FAC-2026-001`). Codes are always auto-generated server-side — there is no code field in any form or schema. The code field is not exposed to users.

**Source:** `src/data-access/code-generator.ts`

### Prefix Registry

| Prefix | Entity             | Example        |
|--------|--------------------|----------------|
| `FAC`  | Facility           | FAC-2026-001   |
| `R`    | Reactor            | R-2026-003     |
| `SL`   | Storage Location   | SL-2026-001    |
| `SUP`  | Supplier           | SUP-2026-002   |
| `FT`   | Feedstock Type     | FT-2026-001    |
| `FD`   | Feedstock Delivery | FD-2026-005    |
| `FS`   | Feedstock          | FS-2026-001    |
| `PR`   | Production Run     | PR-2026-012    |
| `SAM`  | Sample             | SAM-2026-007   |
| `BCF`  | Formulation        | BCF-2026-001   |
| `PS`   | Production Sample  | PS-2026-001    |
| `BP`   | Biochar Product    | BP-2026-004    |
| `CUS`  | Customer           | CUS-2026-001   |
| `OR`   | Order              | OR-2026-003    |
| `DL`   | Delivery           | DL-2026-002    |
| `DRV`  | Driver             | DRV-2026-001   |
| `VEH`  | Vehicle            | VEH-2026-001   |
| `AP`   | Application        | AP-2026-006    |
| `CB`   | Credit Batch       | CB-2026-001    |

### How It Works

1. `generateNextCode(prefix, table, codeColumn)` queries for the highest existing code matching the prefix + current year, then returns the next sequential number (zero-padded to 3 digits).
2. `withAutoCode(prefix, table, codeColumn, undefined, insertFn)` wraps the insert. The `userCode` parameter is always `undefined` — all codes are auto-generated. It retries up to 3 times on duplicate key collisions (handles concurrent inserts). Duplicate detection uses `isCodeUniqueViolation()` which matches the specific Postgres constraint name for the code column.

### Usage in Server Actions

All entity server actions in `src/fn/` use `withAutoCode`:

```typescript
import { withAutoCode } from "@/data-access/code-generator";

const facility = await withAutoCode(
  "FAC",
  facilitiesTable,
  facilitiesTable.code,
  undefined,            // codes are always auto-generated
  (code) => createFacilityData(user.id, { ...validated, code })
);
```

### Adding a New Entity

When creating a new entity with auto-generated codes:

1. Choose a unique prefix (2-3 uppercase letters)
2. Add a `code` column with a unique constraint to the DB schema
3. Use `withAutoCode` in the server action's create function (pass `undefined` for `userCode`)
4. Do NOT add a code field to the form schema — codes are auto-generated
5. Add the prefix to this table

---

## Environment Variables

**Required database variable:**
```bash
DATABASE_URL=postgresql://user:password@host:5432/database
```

**Location:** `.env.local` (NEVER commit to git)

**Example:**
```bash
DATABASE_URL=postgresql://postgres:password@localhost:5432/my_app
```

**Validation:** Environment variables are validated via Zod in `src/config/env.ts`.

---

## Development Tools

### Drizzle Studio

Visual database browser:
```bash
pnpm db:studio
```

Opens interactive UI at `https://local.drizzle.studio` where you can:
- Browse tables and data
- Run queries
- View relationships
- Inspect schema

**Note**: Studio is read-only by default for safety.

### Database Introspection

This template does not expose a dedicated `pnpm db:introspect` script.
If you need introspection, run Drizzle Kit directly:
```bash
pnpm drizzle-kit pull
```

### Query Logging

Enable SQL logging for debugging:
```typescript
// src/db/index.ts
export const db = drizzle(pool, {
  schema,
  logger: true, // Logs all SQL queries
});
```

---

## Adding New Tables

Follow this pattern when adding new features:

### 1. Create Schema File

**File:** `src/db/schema/your-feature.ts`
```typescript
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { users } from "./auth";

export const yourFeature = pgTable("your_feature", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Type inference
export type YourFeature = typeof yourFeature.$inferSelect;
export type InsertYourFeature = typeof yourFeature.$inferInsert;
```

### 2. Export from Schema Index

**File:** `src/db/schema/index.ts`
```typescript
export * from "./auth";
export * from "./projects";
export * from "./items";
export * from "./your-feature"; // Add this
```

### 3. Create Data Access Layer

**File:** `src/data-access/your-feature.ts`
```typescript
"use server";

import { db } from "@/db";
import { yourFeature } from "@/db/schema";
import { requireProjectMember } from "@/data-access/projects";
import { eq } from "drizzle-orm";
import type { ActionResult } from "@/types/actions";

export async function createYourFeature(
  userId: string,
  projectId: string,
  name: string
): Promise<ActionResult<YourFeature>> {
  // Check project membership
  await requireProjectMember(projectId, userId);

  // Insert record
  const [item] = await db
    .insert(yourFeature)
    .values({ projectId, name, createdByUserId: userId })
    .returning();

  return { success: true, data: item };
}
```

### 4. Generate and Apply Migration

```bash
# Generate SQL
pnpm db:generate

# Review SQL in /drizzle/
cat drizzle/0001_new_feature.sql

# Apply reviewed migration
pnpm db:migrate
```

### 5. Test

- Test as project member (should see project data)
- Test as non-member (should be denied)
- Verify project scoping works correctly

---

## Best Practices

### General Database Practices

1. **Always use the data access layer** - Never import `db` directly in components or server functions
2. **Never commit `.env.local`** - Contains database credentials
3. **Review all generated SQL** - Before running `pnpm db:migrate` in a shared environment
4. **Always scope queries by project** - Include `projectId` in WHERE clauses
5. **Validate project membership first** - Use `requireProjectMember()` before data access
6. **Use type inference** - Let Drizzle generate types from schema
7. **Combine with Zod** - Add runtime validation to type safety
8. **Use connection pooling** - Already configured via `pg` Pool
9. **Index frequently-queried columns** - Especially `project_id`, foreign keys
10. **Keep migrations in version control** - Track schema changes in `/drizzle/`
11. **Use staging environment** - Test migrations before production

### Performance Optimization

1. **Add indexes for common queries**
   ```sql
   -- Project-scoped queries
   CREATE INDEX items_project_id_idx ON items(project_id);

   -- Foreign keys
   CREATE INDEX items_created_by_user_id_idx ON items(created_by_user_id);
   ```

2. **Use `.limit()` and `.offset()` for pagination** - Don't load all records

3. **Select only needed columns** - Use `.select({ id, name })` instead of `.select()`

4. **Batch operations when possible** - Use `.values([...])` for multiple inserts

### Security Best Practices

1. **Never trust client input** - Always validate with Zod schemas
2. **Check project membership before ALL data access** - No exceptions
3. **Use parameterized queries** - Drizzle handles this automatically
4. **Rotate secrets regularly** - Database credentials, auth secrets

### Migration Best Practices

1. **Incremental migrations** - Track all changes over time
2. **Test on staging first** - Never apply untested migrations to production
3. **Backup before destructive changes** - Always have a rollback plan
4. **Document breaking changes** - Note if migrations require app updates

---

## Related Documentation

- [Architecture](./architecture.md) - Overall application architecture
- [Authentication](./auth.md) - Better Auth setup and patterns
- [Design System](./design-system.md) - UI design tokens and components
- [TEMPLATE_USAGE.md](../TEMPLATE_USAGE.md) - How to customize this template
