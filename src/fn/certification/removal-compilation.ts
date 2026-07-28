"use server";

import { env } from "@/config/env";
import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import { requireOrgFacility } from "@/data-access/utils";
import { SafeError } from "@/lib/errors";
import {
  payloadHash,
} from "@/lib/isometric";
import {
  isSequestrationBlueprintKey,
} from "@/lib/isometric/transformers/measurement-sample";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { loadRemovalSubmissionContext } from "./certify-context-core";
import { DURABILITY_MEASUREMENT_SAMPLES_ENABLED } from "./durability-measurement-samples";
import {
  compileRemovalSubmission,
  type CompiledRemovalSubmission,
  type RemovalSubmissionReview,
} from "./removal-submission-build";
import { reviewPayloadHash } from "@/lib/certification/removal-review-hash";

export interface RemovalCompilationView {
  review: RemovalSubmissionReview;
  blockers: string[];
  warnings: string[];
  snapshot: CompiledRemovalSubmission["snapshot"];
  compilationHash: string | null;
}

export async function loadRemovalCompilation(
  facilityId: string,
  removalId: string,
): Promise<ActionResult<RemovalCompilationView>> {
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    const removal = await getCertifierRemovalById(orgCtx, removalId);
    if (!removal || removal.facilityId !== facilityId) {
      throw new SafeError("Removal does not belong to requested facility");
    }

    const ctx = await loadRemovalSubmissionContext(orgCtx, removalId);
    if (!ctx.mapping || !ctx.defaultTemplate) {
      throw new SafeError(
        "Compilation unavailable until the facility has a project and default Removal template.",
      );
    }
    if (!ctx.hasOrgCredentials) {
      throw new SafeError(
        "Compilation unavailable until organization Isometric credentials are configured.",
      );
    }

    const hasDurabilityComponents = ctx.defaultTemplate.groups.some((group) =>
      group.components.some((component) =>
        isSequestrationBlueprintKey(component.blueprint_key),
      ),
    );
    const compiled = await compileRemovalSubmission({
      orgCtx,
      removalId,
      ctx,
      defaultTemplate: ctx.defaultTemplate,
      blueprintsByKey: new Map(
        ctx.blueprintsForTemplate.map((blueprint) => [
          blueprint.key,
          blueprint,
        ]),
      ),
      externalProjectId: ctx.mapping.externalProjectId,
      allowPeriodInputStub: env.ISOMETRIC_ENVIRONMENT === "sandbox",
      hasDurabilityComponents,
      allowPendingSources: true,
    });
    const blockers = [...compiled.blockers];
    if (
      hasDurabilityComponents &&
      !DURABILITY_MEASUREMENT_SAMPLES_ENABLED
    ) {
      blockers.push(
        "Durability measurement-sample POSTs run against the Isometric sandbox only. This environment targets the live registry, so this Removal cannot be submitted here.",
      );
    }

    return {
      review: compiled.review,
      blockers,
      warnings: compiled.warnings,
      snapshot: blockers.length === 0 ? compiled.snapshot : null,
      compilationHash:
        blockers.length === 0 && compiled.snapshot
          ? reviewPayloadHash(compiled.snapshot.semanticPayload)
          : null,
    };
  });
}
