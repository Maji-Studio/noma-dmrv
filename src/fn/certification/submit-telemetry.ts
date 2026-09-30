"use server";

import type { CertificationSubmissionRow } from "@/data-access/certification";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import { getIsometricClientForOrg } from "@/lib/isometric";
import {
  loadTelemetrySubmissionStateSchema,
  submitTelemetrySchema,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { ISOMETRIC_PROVIDER, submitRateLimit } from "./shared";
import {
  DATA_UPLOAD_ENTITY_TYPE,
  DATA_UPLOAD_SUBMISSION_TYPE,
  submitTelemetry,
  type DataUploadSubmission,
  type SubmitTelemetryArgs,
  type SubmitTelemetryResult,
} from "./submit-telemetry-core";

export type {
  SubmitTelemetryArgs,
  SubmitTelemetryResult,
} from "./submit-telemetry-core";

// The pipeline itself (and its Admin guard) lives in the directive-free core;
// this action only resolves the caller's context from the session.
export async function submitTelemetryAction(
  args: SubmitTelemetryArgs,
): Promise<ActionResult<SubmitTelemetryResult>> {
  return withAction(
    (orgCtx) => submitTelemetry(orgCtx, submitTelemetrySchema.parse(args)),
    {
      rateLimit: submitRateLimit("cert:submit-telemetry"),
    },
  );
}

export async function loadTelemetrySubmissionState(
  removalId: string,
): Promise<
  ActionResult<{
    submission: CertificationSubmissionRow;
    latestStatus: DataUploadSubmission | null;
  } | null>
> {
  return withAction(async (orgCtx) => {
    const parsed = loadTelemetrySubmissionStateSchema.parse({ removalId });
    const client = await getIsometricClientForOrg(orgCtx.organizationId);
    const latest = await getLatestSubmission(orgCtx, {
      provider: ISOMETRIC_PROVIDER,
      submissionType: DATA_UPLOAD_SUBMISSION_TYPE,
      localEntityType: DATA_UPLOAD_ENTITY_TYPE,
      localEntityId: parsed.removalId,
    });
    if (!latest) return null;
    const externalId = latest.externalId;
    const remote = externalId
      ? await client
          .get<DataUploadSubmission>(
            `/data-upload-submissions/${encodeURIComponent(externalId)}`,
          )
          .catch(() => null)
      : null;
    return { submission: latest, latestStatus: remote };
  });
}
