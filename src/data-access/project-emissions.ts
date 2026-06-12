// Project emissions data access layer (ADR 0005, Posture B).
//
// noma owns the LCA-transcription audit trail (`certifier_project_emissions`)
// — the operator publishes the corresponding `PROJECT`-scope Components in
// the Isometric UI; noma does NOT POST. The drift panel on `/certification/`
// reconciles by comparing rows from this table against
// `listComponents({ projectId, scope: 'PROJECT' })`.
//
// **Single-tenant authz posture.** Like `certifier-removals.ts` and
// `certifier-ghg-statements.ts`, every accessor here guards only with
// `requireAuth` — an authenticated user can read or mutate any facility's
// project-emission rows by id. Acceptable single-tenant; flagged on
// pre-deploy gate #3 in `docs/isometric/integration-plan.md`. When the
// facility-membership model lands, swap `requireAuth` for
// `requireFacilityAccess(userId, fac)` at every chokepoint below.

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { isPgUniqueViolation } from "@/db/errors";
import {
  certifierProjectEmissions,
  certifierSyncEvents,
  certificationSubmissions,
} from "@/db/schema/certification";
import { SafeError } from "@/lib/errors";

// Audit-ledger entity-type tag for project-emission rows. The ledger tables
// use a free-string `entity_type` (no FK), so deletes here must sweep
// dangling rows by natural key. Posture B currently does not write any
// `project_emission` ledger rows (read-only against Isometric), so today
// the sweep is forward-looking — but it makes the delete safe to call once
// a future write path is added without re-auditing every call site.
const PROJECT_EMISSION_ENTITY_TYPE = "project_emission";
import type {
  CreateProjectEmissionInput,
  UpdateProjectEmissionInput,
} from "@/schemas/project-emissions";
import { requireAuth } from "./utils";

export type CertifierProjectEmissionRow =
  typeof certifierProjectEmissions.$inferSelect;

const ISOMETRIC = "isometric" as const;

// Postgres unique_violation code — mapped here (vs propagating as a raw
// driver error) so the operator sees actionable guidance instead of "An
// unexpected error occurred" from the withAction wrapper.
const PROJECT_EMISSION_UNIQUE_CONSTRAINT =
  "certifier_project_emissions_facility_period_category_unique";

function isUniqueViolation(err: unknown): boolean {
  return isPgUniqueViolation(err, PROJECT_EMISSION_UNIQUE_CONSTRAINT);
}

const PROJECT_EMISSION_CONFLICT_MESSAGE =
  "A row already exists for this facility, category, and LCA window end. Edit the existing row instead of creating a duplicate.";

export async function listProjectEmissionsForFacility(
  userId: string,
  facilityId: string,
): Promise<CertifierProjectEmissionRow[]> {
  requireAuth(userId);
  return db
    .select()
    .from(certifierProjectEmissions)
    .where(
      and(
        eq(certifierProjectEmissions.provider, ISOMETRIC),
        eq(certifierProjectEmissions.facilityId, facilityId),
      ),
    )
    .orderBy(
      desc(certifierProjectEmissions.lcaWindowEndOn),
      desc(certifierProjectEmissions.createdAt),
    );
}

export async function getProjectEmissionById(
  userId: string,
  id: string,
): Promise<CertifierProjectEmissionRow | null> {
  requireAuth(userId);
  const [row] = await db
    .select()
    .from(certifierProjectEmissions)
    .where(
      and(
        eq(certifierProjectEmissions.id, id),
        eq(certifierProjectEmissions.provider, ISOMETRIC),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function insertProjectEmission(
  userId: string,
  input: CreateProjectEmissionInput,
): Promise<CertifierProjectEmissionRow> {
  requireAuth(userId);
  try {
    // Set createdAt/updatedAt from JS rather than letting the DB default to
    // now() — Postgres `timestamp` stores microseconds while JS Date is
    // millisecond-precision, so a µs-precision insert value cannot round-trip
    // through the client. The optimistic-concurrency check in
    // updateProjectEmission compares updatedAt by exact equality; using JS
    // Date on insert keeps the first edit after creation from falsely
    // reporting "edited by someone else."
    const now = new Date();
    const [row] = await db
      .insert(certifierProjectEmissions)
      .values({
        facilityId: input.facilityId,
        provider: ISOMETRIC,
        category: input.category,
        lcaWindowStartOn: input.lcaWindowStartOn,
        lcaWindowEndOn: input.lcaWindowEndOn,
        magnitude: input.magnitude,
        unit: input.unit,
        allocationStrategyRecommendation:
          input.allocationStrategyRecommendation ?? "CUSTOM_TIME_PERIOD",
        sourceDocumentId: input.sourceDocumentId ?? null,
        notes: input.notes ?? null,
        recordedBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) {
      throw new SafeError("Failed to insert project emission row.");
    }
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new SafeError(PROJECT_EMISSION_CONFLICT_MESSAGE);
    }
    throw err;
  }
}

export async function updateProjectEmission(
  userId: string,
  input: UpdateProjectEmissionInput,
): Promise<CertifierProjectEmissionRow> {
  requireAuth(userId);
  try {
    // Optimistic concurrency: callers pass `expectedUpdatedAt` from the row
    // they loaded. When two operators edit the same row in parallel, the
    // second update finds zero matching rows and we tell the user to refresh
    // instead of silently overwriting the first edit. Falls back to id-only
    // matching when no precondition is supplied (legacy callers).
    const conditions = [
      eq(certifierProjectEmissions.id, input.id),
      eq(certifierProjectEmissions.provider, ISOMETRIC),
    ];
    if (input.expectedUpdatedAt) {
      conditions.push(
        eq(certifierProjectEmissions.updatedAt, input.expectedUpdatedAt),
      );
    }
    const [row] = await db
      .update(certifierProjectEmissions)
      .set({
        facilityId: input.facilityId,
        category: input.category,
        lcaWindowStartOn: input.lcaWindowStartOn,
        lcaWindowEndOn: input.lcaWindowEndOn,
        magnitude: input.magnitude,
        unit: input.unit,
        allocationStrategyRecommendation:
          input.allocationStrategyRecommendation,
        sourceDocumentId: input.sourceDocumentId ?? null,
        notes: input.notes ?? null,
        // The transcription `recordedBy` updates on every edit — the audit row
        // reflects whoever last touched it, not the originator. Add a separate
        // `originally_recorded_by` column if the originator becomes important.
        recordedBy: userId,
        recordedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    if (!row) {
      // Differentiate "row gone" from "row changed under us" so the operator
      // gets an actionable message instead of "not found."
      if (input.expectedUpdatedAt) {
        const [current] = await db
          .select({ id: certifierProjectEmissions.id })
          .from(certifierProjectEmissions)
          .where(
            and(
              eq(certifierProjectEmissions.id, input.id),
              eq(certifierProjectEmissions.provider, ISOMETRIC),
            ),
          )
          .limit(1);
        if (current) {
          throw new SafeError(
            "This row was edited by someone else while you were editing. Refresh the page and reapply your change.",
          );
        }
      }
      throw new SafeError("Project emission row not found.");
    }
    return row;
  } catch (err) {
    if (err instanceof SafeError) throw err;
    if (isUniqueViolation(err)) {
      throw new SafeError(PROJECT_EMISSION_CONFLICT_MESSAGE);
    }
    throw err;
  }
}

export async function deleteProjectEmission(
  userId: string,
  id: string,
): Promise<void> {
  requireAuth(userId);
  // Sweep child audit-ledger rows in the same transaction so the delete
  // never leaves dangling references behind. The ledger tables use
  // free-string entity-type tags (no FK), so this responsibility lives
  // here rather than in the schema.
  await db.transaction(async (tx) => {
    await tx
      .delete(certifierSyncEvents)
      .where(
        and(
          eq(certifierSyncEvents.provider, ISOMETRIC),
          eq(certifierSyncEvents.entityType, PROJECT_EMISSION_ENTITY_TYPE),
          eq(certifierSyncEvents.entityId, id),
        ),
      );
    await tx
      .delete(certificationSubmissions)
      .where(
        and(
          eq(certificationSubmissions.provider, ISOMETRIC),
          eq(
            certificationSubmissions.localEntityType,
            PROJECT_EMISSION_ENTITY_TYPE,
          ),
          eq(certificationSubmissions.localEntityId, id),
        ),
      );
    await tx
      .delete(certifierProjectEmissions)
      .where(
        and(
          eq(certifierProjectEmissions.id, id),
          eq(certifierProjectEmissions.provider, ISOMETRIC),
        ),
      );
  });
}
