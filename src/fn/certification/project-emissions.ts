"use server";

import { getCertifierProjectByFacility } from "@/data-access/certification";
import {
  deleteProjectEmission,
  getProjectEmissionById,
  insertProjectEmission,
  listProjectEmissionsForFacility,
  updateProjectEmission,
  type CertifierProjectEmissionRow,
} from "@/data-access/project-emissions";
import { requireAdminAction } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import {
  IsometricApiError,
  listComponents,
  listDatapoints,
  type Datapoint,
  type IsometricComponent,
} from "@/lib/isometric";
import {
  claimedComponentIdsFromStatuses,
  findOrphanComponents,
  matchEmissionToComponent,
  type MatchStatus,
  type OrphanComponent,
  type ProjectEmissionRowShape,
} from "@/lib/isometric/utils/project-emission-match";
import {
  createProjectEmissionSchema,
  deleteProjectEmissionSchema,
  updateProjectEmissionSchema,
  type CreateProjectEmissionInput,
  type DeleteProjectEmissionInput,
  type UpdateProjectEmissionInput,
} from "@/schemas/project-emissions";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";

// Posture B (ADR 0005): noma is the LCA journal. None of these actions POST
// to Isometric — Project Components are published by the operator directly
// in the Isometric registry UI, and the read-only drift panel on
// `/certification/` reconciles state.

export async function loadProjectEmissionsForFacility(
  facilityId: string,
): Promise<ActionResult<CertifierProjectEmissionRow[]>> {
  return withAction(async (userId) =>
    listProjectEmissionsForFacility(userId, facilityId),
  );
}

export async function loadProjectEmissionById(
  id: string,
): Promise<ActionResult<CertifierProjectEmissionRow>> {
  return withAction(async (userId) => {
    const row = await getProjectEmissionById(userId, id);
    if (!row) throw new SafeError("Project emission row not found.");
    return row;
  });
}

// Admin-only: these LCA-journal mutations feed the per-Project-scope emission
// datapoints reconciled against Isometric. The admin-area UI guard alone is
// not sufficient — any authenticated caller could invoke the server actions
// directly. Mirrors saveFacilityEmissionConfig.
export async function createProjectEmission(
  input: CreateProjectEmissionInput,
): Promise<ActionResult<CertifierProjectEmissionRow>> {
  return withAction(async (userId) => {
    await requireAdminAction();
    const parsed = createProjectEmissionSchema.parse(input);
    return insertProjectEmission(userId, parsed);
  });
}

export async function editProjectEmission(
  input: UpdateProjectEmissionInput,
): Promise<ActionResult<CertifierProjectEmissionRow>> {
  return withAction(async (userId) => {
    await requireAdminAction();
    const parsed = updateProjectEmissionSchema.parse(input);
    return updateProjectEmission(userId, parsed);
  });
}

export async function removeProjectEmission(
  input: DeleteProjectEmissionInput,
): Promise<ActionResult<{ id: string }>> {
  return withAction(async (userId) => {
    await requireAdminAction();
    const parsed = deleteProjectEmissionSchema.parse(input);
    await deleteProjectEmission(userId, parsed.id);
    return { id: parsed.id };
  });
}

// =====================================================================
// Drift loader — reconciles noma's LCA-journal rows against the live
// Isometric Project Components for the facility's linked project. Posture
// B: read-only. Powers the drift panel on `/certification/` and (in the
// same data shape) the `--source=db` mode of
// `scripts/isometric-coverage-check.ts`.
// =====================================================================

export interface ProjectEmissionDriftRow {
  row: CertifierProjectEmissionRow;
  status: MatchStatus;
}

export interface ProjectEmissionDriftState {
  rows: ProjectEmissionDriftRow[];
  orphans: OrphanComponent[];
  // Null when the facility has no linked Isometric project — UI surfaces
  // an empty/configure-mapping state rather than treating it as drift.
  externalProjectId: string | null;
  // Null when Isometric creds are missing (sandbox-tests-disabled local
  // dev, an unmapped CI run, etc.). UI shows a "creds not configured"
  // hint rather than reporting drift the user can't act on.
  isometricConfigured: boolean;
}

export async function loadProjectEmissionDrift(
  facilityId: string,
): Promise<ActionResult<ProjectEmissionDriftState>> {
  return withAction(async (userId) => {
    const [project, rows] = await Promise.all([
      getCertifierProjectByFacility(userId, facilityId),
      // SafeError thrown by data-access becomes the ActionResult.error;
      // an empty-array fallthrough on no project is handled below.
      listProjectEmissionsForFacility(userId, facilityId),
    ]);

    if (!project) {
      return {
        rows: rows.map((row) => ({
          row,
          status: {
            kind: "missing-isometric",
            reason: "Facility is not linked to an Isometric project.",
          } as MatchStatus,
        })),
        orphans: [],
        externalProjectId: null,
        isometricConfigured: true,
      };
    }

    let components: IsometricComponent[];
    let datapoints: Datapoint[];
    try {
      [components, datapoints] = await Promise.all([
        listComponents({ projectId: project.externalProjectId, scope: "PROJECT" }),
        listDatapoints({
          projectId: project.externalProjectId,
          usedInScope: "PROJECT",
        }),
      ]);
    } catch (err) {
      if (err instanceof IsometricApiError && err.code === "not_configured") {
        return {
          rows: rows.map((row) => ({
            row,
            status: {
              kind: "missing-isometric",
              reason: "Isometric credentials are not configured.",
            } as MatchStatus,
          })),
          orphans: [],
          externalProjectId: project.externalProjectId,
          isometricConfigured: false,
        };
      }
      // Re-throw as SafeError so the actual Isometric status/message reaches
      // the drift panel instead of being scrubbed to "An unexpected error
      // occurred" by withAction's production-error filter. The panel then
      // shows a real status code + retry affordance.
      if (err instanceof IsometricApiError) {
        throw new SafeError(
          `Isometric API failed while loading drift (status ${err.status ?? "unknown"}): ${err.message}`,
        );
      }
      throw err;
    }

    const datapointsById = new Map<string, Datapoint>(
      datapoints.map((dp) => [dp.id, dp]),
    );
    const shapes: ProjectEmissionRowShape[] = rows.map((row) => ({
      id: row.id,
      category: row.category,
      magnitude: row.magnitude,
      unit: row.unit,
    }));
    const driftRows: ProjectEmissionDriftRow[] = rows.map((row, idx) => ({
      row,
      status: matchEmissionToComponent(shapes[idx]!, components, datapointsById),
    }));
    // Reuse the per-row statuses we just computed; passing rows again would
    // re-match every row inside findOrphanComponents (2× the work).
    const claimedIds = claimedComponentIdsFromStatuses(
      driftRows.map((d) => d.status),
    );
    const orphans = findOrphanComponents(claimedIds, components, datapointsById);

    return {
      rows: driftRows,
      orphans,
      externalProjectId: project.externalProjectId,
      isometricConfigured: true,
    };
  });
}

// Re-export so UI components can import MatchStatus / OrphanComponent
// straight from `@/fn/certification` without reaching into the matcher.
export type {
  MatchStatus,
  OrphanComponent,
} from "@/lib/isometric/utils/project-emission-match";
