"use server";

import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { loadCandidateDocumentsForRemovalSchema } from "@/schemas/certification-sources";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import {
  loadCandidateDocumentsForRemovalForUser,
  mirrorDocumentToSourceForUser,
} from "./sources";

export interface PrepareRemovalSourcesResult {
  total: number;
  ready: number;
  newlyPrepared: number;
}

function preparationFailureMessage(
  failures: Array<{ fileName: string; message: string }>,
): string {
  const detail = failures
    .map(({ fileName, message }) => `${fileName}: ${message}`)
    .join("\n");
  return `Could not prepare all supporting sources:\n${detail}`;
}

/**
 * Prepare every missing Source as one workflow operation.
 *
 * Successful mirrors survive a later file failure. Retrying the operation is
 * safe because the underlying per-document mirror is idempotent and skips
 * already-persisted Source mappings.
 */
export async function prepareRemovalSourcesForUser(
  orgCtx: OrgContext,
  removalId: string,
): Promise<PrepareRemovalSourcesResult> {
  requireOrgRole(orgCtx, "admin");

  const candidates = await loadCandidateDocumentsForRemovalForUser(
    orgCtx,
    removalId,
  );
  if (!candidates.hasMapping) {
    throw new SafeError(
      "This facility isn't linked to an Isometric project. Link it in facility settings before preparing supporting sources.",
    );
  }

  const missing = candidates.candidates.filter((candidate) => !candidate.mirror);
  const failures: Array<{ fileName: string; message: string }> = [];
  let newlyPrepared = 0;

  for (const candidate of missing) {
    try {
      await mirrorDocumentToSourceForUser(
        orgCtx,
        {
          removalId,
          documentId: candidate.document.id,
        },
        { enforceRemovalLifecycle: true },
      );
      newlyPrepared += 1;
    } catch (error) {
      failures.push({
        fileName: candidate.document.fileName,
        message:
          error instanceof Error
            ? error.message
            : "The registry Source could not be prepared.",
      });
    }
  }

  if (failures.length > 0) {
    throw new SafeError(preparationFailureMessage(failures));
  }

  return {
    total: candidates.candidates.length,
    ready: candidates.candidates.length,
    newlyPrepared,
  };
}

export async function prepareRemovalSources(
  input: unknown,
): Promise<ActionResult<PrepareRemovalSourcesResult>> {
  return withAction(async (orgCtx) => {
    const parsed = loadCandidateDocumentsForRemovalSchema.parse(input);
    return prepareRemovalSourcesForUser(orgCtx, parsed.removalId);
  });
}
