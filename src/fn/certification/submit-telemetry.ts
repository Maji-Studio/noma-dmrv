"use server";

import { z } from "zod";
import { createHash } from "node:crypto";
import {
  appendSyncEvent,
  getLatestSubmission,
  insertDraftSubmission,
  markSubmissionRejected,
  markSubmissionSubmitted,
  resetSubmissionToDraft,
  setSubmissionTerminalStatus,
  updateSubmissionMetadata,
  type CertificationSubmissionRow,
} from "@/data-access/certification";
import {
  ensureSensorForReactor,
  listSensorsForReactors,
} from "@/data-access/certifier-sensors";
import { listTelemetryReadingsForRuns } from "@/data-access/telemetry-readings";
import { SafeError } from "@/lib/errors";
import {
  isometric,
  IsometricApiError,
  payloadHash,
} from "@/lib/isometric";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import {
  decideSubmissionClaim,
  type DataUploadResumeSnapshot,
} from "@/lib/isometric/utils/submission-claim";
import { decodeMeasurementProperty } from "@/lib/isometric/utils/measurement-property";
import {
  aggregateForDataUpload,
  DEFAULT_DATA_UPLOAD_CHANNELS,
} from "@/lib/isometric/transformers/data-upload";
import {
  DATA_UPLOAD_PARQUET_CONTENT_TYPE,
  writeDataUploadParquet,
} from "@/lib/isometric/parquet/writer";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { loadRemovalSubmissionContext } from "./certify-context";
import { ISOMETRIC_PROVIDER, assertProductionConfirmed } from "./shared";
import type { components } from "@/lib/isometric/generated/certify";

const DATA_UPLOAD_SUBMISSION_TYPE = "dataUpload" as const;
const DATA_UPLOAD_ENTITY_TYPE = "removal" as const;
const DATA_UPLOAD_OPERATION = "removal:data-upload" as const;
const PARQUET_SCHEMA_VERSION = 1 as const;

type FileUploadResponse = { id: string; upload_url: string };
type DataUploadSubmission = components["schemas"]["DataUploadSubmission"];

export interface SubmitTelemetryArgs {
  removalId: string;
  confirmProduction?: boolean;
}

export interface SubmitTelemetryResult {
  removalId: string;
  dataUploadSubmissionId: string;
  status: DataUploadSubmission["status"];
  errorMessage: string | null;
  version: number;
}

export async function submitTelemetryAction(
  args: SubmitTelemetryArgs,
): Promise<ActionResult<SubmitTelemetryResult>> {
  return withAction((userId) => submitTelemetry(userId, args));
}

// Runs the full DataUploadSubmission pipeline inside one short-lived
// server action — ADR 0006 §5 requires this because the signed
// upload URL has a 5-minute TTL. Resume paths are journaled into
// payloadSnapshot step-by-step so a within-action crash can resolve
// without minting a duplicate Isometric resource (§3, §4).
export async function submitTelemetry(
  userId: string,
  args: SubmitTelemetryArgs,
): Promise<SubmitTelemetryResult> {
  assertProductionConfirmed(args.confirmProduction);

  const ctx = await loadRemovalSubmissionContext(userId, args.removalId);
  if (!ctx.mapping) {
    throw new SafeError("Link a facility to an Isometric project first.");
  }
  const externalFacilityId = ctx.mapping.externalFacilityId;
  if (!externalFacilityId) {
    throw new SafeError(
      "Paste this facility's Isometric facility ID (fcl_...) into the facility mapping before submitting telemetry. Isometric does not expose a POST /facilities endpoint - create the facility in the Certify UI first.",
    );
  }
  if (ctx.runs.length === 0) {
    throw new SafeError("This removal has no production runs to publish.");
  }

  // ADR 0006 - pure clock window on production_run_readings.timestamp;
  // derived from the runs the removal aggregates.
  const windowStart = minDate(ctx.runs.map((r) => r.startTime));
  const windowEnd = maxDate(ctx.runs.map((r) => r.endTime));

  // Ensure a sensor mapping exists per (reactor x channel).
  const reactorIds = unique(ctx.runs.map((r) => r.reactorId));
  for (const reactorId of reactorIds) {
    for (const channel of DEFAULT_DATA_UPLOAD_CHANNELS) {
      await ensureSensorForReactor(userId, {
        reactorId,
        measurementProperty: decodeMeasurementProperty(
          channel.measurementProperty,
        ),
        units: channel.field === "temperatureC" ? "degC" : "bar",
        externalFacilityId,
      });
    }
  }
  const sensorRows = await listSensorsForReactors(userId, reactorIds);

  const readings = await listTelemetryReadingsForRuns(userId, {
    productionRunIds: ctx.runs.map((r) => r.id),
    since: windowStart,
    until: windowEnd,
  });

  const aggregated = aggregateForDataUpload({
    readings: readings.map((row) => ({
      reactorId: row.reactorId,
      timestamp: row.timestamp,
      temperatureC: row.temperatureC,
      pressureBar: row.pressureBar,
      gasFlowRate: row.gasFlowRate,
    })),
    sensorRefs: sensorRows.map((row) => ({
      reactorId: row.reactorId,
      measurementProperty: row.measurementProperty,
      sensorReference: row.sensorReference,
    })),
  });
  if (aggregated.length === 0) {
    throw new SafeError(
      "No reactor readings fall inside this removal's reporting window. Capture telemetry via the Production Run readings panel first.",
    );
  }

  // ADR 0006 - hash covers source-data inputs, not Parquet bytes.
  const semanticPayload = {
    facilityId: ctx.facilityId,
    externalFacilityId,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    bucketSeconds: 60,
    sensorRefs: sensorRows
      .map((row) => ({
        reactorId: row.reactorId,
        measurementProperty: row.measurementProperty,
        sensorReference: row.sensorReference,
      }))
      .sort((a, b) => a.sensorReference.localeCompare(b.sensorReference)),
    sourceReadingIds: readings.map((r) => r.productionRunId).sort(),
    aggregatedRowCount: aggregated.length,
  };
  const semanticHash = payloadHash(semanticPayload);

  const latest = await getLatestSubmission(userId, {
    provider: ISOMETRIC_PROVIDER,
    submissionType: DATA_UPLOAD_SUBMISSION_TYPE,
    localEntityType: DATA_UPLOAD_ENTITY_TYPE,
    localEntityId: args.removalId,
  });
  const dataUploadResume = latest ? readResumeSnapshot(latest) : undefined;
  const claim = decideSubmissionClaim({
    latest,
    payloadHash: semanticHash,
    now: Date.now(),
    lockTtlMs: LOCK_TTL_MS,
    policy: { onSubmittedHashChanged: "supersede" },
    dataUploadResume,
  });

  switch (claim.kind) {
    case "blocked-in-flight":
      throw new SafeError(
        "A telemetry submission for this removal is already in progress.",
      );
    case "blocked-rejected-with-external":
      throw new SafeError(
        "This telemetry submission was rejected by Isometric. Open the registry to resolve before retrying.",
      );
    case "invalid-changed-hash":
      throw new SafeError("Unexpected submission state for this removal.");
    case "return-existing": {
      const status = await refreshStatus(userId, latest!, claim.externalId);
      return {
        removalId: args.removalId,
        dataUploadSubmissionId: claim.externalId,
        status: status.status,
        errorMessage: status.error_message ?? null,
        version: claim.version,
      };
    }
    case "resume-poll-existing": {
      const status = await refreshStatus(
        userId,
        latest!,
        claim.dataUploadSubmissionId,
      );
      if (status.status === "completed") {
        await markSubmissionSubmitted(userId, claim.resumeRowId, {
          externalId: claim.dataUploadSubmissionId,
        });
        await setSubmissionTerminalStatus(userId, claim.resumeRowId, {
          status: "accepted",
          metadataPatch: { remoteStatus: "completed" },
        });
      } else if (status.status === "failed") {
        await markSubmissionRejected(userId, claim.resumeRowId, {
          errorMessage: status.error_message ?? "Isometric processing failed",
        });
      }
      return {
        removalId: args.removalId,
        dataUploadSubmissionId: claim.dataUploadSubmissionId,
        status: status.status,
        errorMessage: status.error_message ?? null,
        version: claim.resumeVersion,
      };
    }
    case "resume-re-put": {
      const row = await resetSubmissionToDraft(userId, claim.resumeRowId);
      const parquetBytes = writeDataUploadParquet(aggregated);
      await putParquetToSignedUrl({
        uploadUrl: requireUploadUrl(row),
        bytes: parquetBytes,
      });
      const submissionId = await postDataUploadSubmission({
        externalFacilityId,
        fileUploadId: claim.fileUploadId,
      });
      await journalStep(userId, row.id, {
        dataUploadSubmissionId: submissionId.id,
        parquetBytesSha256: sha256(parquetBytes),
        parquetBytesLength: parquetBytes.byteLength,
      });
      await markSubmissionSubmitted(userId, row.id, {
        externalId: submissionId.id,
      });
      await appendSyncEventBestEffort(userId, {
        operation: `${DATA_UPLOAD_OPERATION}:resume-re-put`,
        status: "succeeded",
        entityId: args.removalId,
        responsePayload: { id: submissionId.id, status: submissionId.status },
      });
      return {
        removalId: args.removalId,
        dataUploadSubmissionId: submissionId.id,
        status: submissionId.status,
        errorMessage: null,
        version: row.version,
      };
    }
    case "resume":
    case "create-new-version": {
      const row =
        claim.kind === "resume"
          ? await resetSubmissionToDraft(userId, claim.resumeRowId)
          : await insertDraftSubmission(userId, {
              provider: ISOMETRIC_PROVIDER,
              submissionType: DATA_UPLOAD_SUBMISSION_TYPE,
              localEntityType: DATA_UPLOAD_ENTITY_TYPE,
              localEntityId: args.removalId,
              version: claim.nextVersion,
              payloadSnapshot: {
                semantic: semanticPayload,
                parquetSchemaVersion: PARQUET_SCHEMA_VERSION,
              },
              payloadHash: semanticHash,
            });

      try {
        const parquetBytes = writeDataUploadParquet(aggregated);

        // Step 1.
        const fileUpload = await isometric.post<FileUploadResponse>(
          "/file-uploads",
          {
            content_length: parquetBytes.byteLength,
            content_type: DATA_UPLOAD_PARQUET_CONTENT_TYPE,
            file_name: `${args.removalId}.parquet`,
          },
        );
        const uploadUrlExpiresAt = parseSignedUrlExpiry(fileUpload.upload_url);
        await journalStep(userId, row.id, {
          fileUploadId: fileUpload.id,
          uploadUrl: fileUpload.upload_url,
          uploadUrlExpiresAt: uploadUrlExpiresAt?.toISOString() ?? null,
        });

        // Step 2.
        await putParquetToSignedUrl({
          uploadUrl: fileUpload.upload_url,
          bytes: parquetBytes,
        });
        await journalStep(userId, row.id, {
          parquetBytesSha256: sha256(parquetBytes),
          parquetBytesLength: parquetBytes.byteLength,
        });

        // Step 3.
        const submission = await postDataUploadSubmission({
          externalFacilityId,
          fileUploadId: fileUpload.id,
        });
        await journalStep(userId, row.id, {
          dataUploadSubmissionId: submission.id,
        });
        await markSubmissionSubmitted(userId, row.id, {
          externalId: submission.id,
          supersedePreviousId:
            claim.kind === "create-new-version"
              ? claim.supersedePreviousId
              : null,
        });
        await appendSyncEventBestEffort(userId, {
          operation: DATA_UPLOAD_OPERATION,
          status: "succeeded",
          entityId: args.removalId,
          requestPayload: { semantic: semanticPayload },
          responsePayload: {
            id: submission.id,
            status: submission.status,
            file_upload_id: fileUpload.id,
          },
        });
        return {
          removalId: args.removalId,
          dataUploadSubmissionId: submission.id,
          status: submission.status,
          errorMessage: null,
          version: row.version,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await appendSyncEventBestEffort(userId, {
          operation: DATA_UPLOAD_OPERATION,
          status: "failed",
          entityId: args.removalId,
          errorMessage: message,
        });
        await markSubmissionRejected(userId, row.id, { errorMessage: message });
        throw new SafeError(`Telemetry submission failed: ${message}`);
      }
    }
  }
}

// =====================================================================
// Helpers
// =====================================================================

const journalSchema = z
  .object({
    fileUploadId: z.string().nullish(),
    uploadUrl: z.string().nullish(),
    uploadUrlExpiresAt: z.string().nullish(),
    dataUploadSubmissionId: z.string().nullish(),
    parquetBytesSha256: z.string().nullish(),
    parquetBytesLength: z.number().nullish(),
  })
  .partial();

function readResumeSnapshot(
  row: CertificationSubmissionRow,
): DataUploadResumeSnapshot | undefined {
  const snapshot = row.payloadSnapshot as Record<string, unknown> | null;
  if (!snapshot) return undefined;
  const journaled = (snapshot.journaled ?? {}) as Record<string, unknown>;
  const parsed = journalSchema.safeParse(journaled);
  if (!parsed.success) return undefined;
  const j = parsed.data;
  const expiresAt = j.uploadUrlExpiresAt
    ? new Date(j.uploadUrlExpiresAt)
    : null;
  return {
    dataUploadSubmissionId: j.dataUploadSubmissionId ?? null,
    fileUploadId: j.fileUploadId ?? null,
    uploadUrlExpiresAt:
      expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt : null,
  };
}

async function journalStep(
  userId: string,
  submissionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await updateSubmissionMetadata(userId, submissionId, {
    journaled: patch,
  });
}

async function refreshStatus(
  userId: string,
  row: CertificationSubmissionRow,
  dataUploadSubmissionId: string,
): Promise<DataUploadSubmission> {
  const status = await isometric.get<DataUploadSubmission>(
    `/data-upload-submissions/${encodeURIComponent(dataUploadSubmissionId)}`,
  );
  await updateSubmissionMetadata(userId, row.id, {
    remoteStatus: status.status,
    lastError: status.error_message ?? null,
  });
  return status;
}

async function postDataUploadSubmission(args: {
  externalFacilityId: string;
  fileUploadId: string;
}): Promise<DataUploadSubmission> {
  return isometric.post<DataUploadSubmission>("/data-upload-submissions", {
    facility_id: args.externalFacilityId,
    file_upload_id: args.fileUploadId,
    submission_type: "biochar_pyrolysis_reactor_facility_time_series",
  });
}

async function putParquetToSignedUrl(args: {
  uploadUrl: string;
  bytes: Uint8Array;
}): Promise<void> {
  // The runtime accepts Uint8Array; lib.dom's `BodyInit` (TS ES2017) does
  // not enumerate it. Wrap in a Blob — the smallest cross-version
  // canonical form that satisfies BodyInit.
  const body = new Blob([args.bytes as BlobPart], {
    type: DATA_UPLOAD_PARQUET_CONTENT_TYPE,
  });
  const res = await fetch(args.uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": DATA_UPLOAD_PARQUET_CONTENT_TYPE,
      "content-length": String(args.bytes.byteLength),
    },
    body,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new IsometricApiError(
      `PUT signed upload URL -> ${res.status}`,
      res.status,
      body.slice(0, 1000),
      "http",
    );
  }
}

function requireUploadUrl(row: CertificationSubmissionRow): string {
  const journal = readResumeSnapshot(row);
  const snapshot = row.payloadSnapshot as Record<string, unknown> | null;
  const journaled = (snapshot?.journaled ?? {}) as Record<string, unknown>;
  const uploadUrl =
    typeof journaled.uploadUrl === "string" ? journaled.uploadUrl : null;
  if (!uploadUrl || !journal?.fileUploadId) {
    throw new SafeError(
      "Resume-re-PUT decided but the journaled upload URL is missing - restart the submission.",
    );
  }
  return uploadUrl;
}

function parseSignedUrlExpiry(url: string): Date | null {
  try {
    const parsed = new URL(url);
    const expiresSecondsRaw =
      parsed.searchParams.get("X-Goog-Expires") ??
      parsed.searchParams.get("X-Amz-Expires");
    const signedAtRaw =
      parsed.searchParams.get("X-Goog-Date") ??
      parsed.searchParams.get("X-Amz-Date");
    const expiresSeconds = expiresSecondsRaw
      ? Number(expiresSecondsRaw)
      : null;
    if (!expiresSeconds || !Number.isFinite(expiresSeconds)) return null;
    const signedAt = signedAtRaw ? parseAmzDate(signedAtRaw) : new Date();
    if (!signedAt) return null;
    return new Date(signedAt.getTime() + expiresSeconds * 1000);
  } catch {
    return null;
  }
}

function parseAmzDate(raw: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const ts = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );
  return Number.isFinite(ts) ? new Date(ts) : null;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function minDate(dates: Date[]): Date {
  let min = dates[0]!.getTime();
  for (const d of dates) if (d.getTime() < min) min = d.getTime();
  return new Date(min);
}

function maxDate(dates: Date[]): Date {
  let max = dates[0]!.getTime();
  for (const d of dates) if (d.getTime() > max) max = d.getTime();
  return new Date(max);
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

async function appendSyncEventBestEffort(
  userId: string,
  args: {
    operation: string;
    status: "succeeded" | "failed";
    entityId: string;
    requestPayload?: unknown;
    responsePayload?: unknown;
    errorMessage?: string;
  },
): Promise<void> {
  try {
    await appendSyncEvent(userId, {
      provider: ISOMETRIC_PROVIDER,
      entityType: DATA_UPLOAD_ENTITY_TYPE,
      entityId: args.entityId,
      operation: args.operation,
      status: args.status,
      requestPayload: args.requestPayload,
      responsePayload: args.responsePayload,
      errorMessage: args.errorMessage,
    });
  } catch (err) {
    console.warn("Failed to record telemetry sync event", {
      operation: args.operation,
      entityId: args.entityId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function loadTelemetrySubmissionState(
  removalId: string,
): Promise<
  ActionResult<{
    submission: CertificationSubmissionRow;
    latestStatus: DataUploadSubmission | null;
  } | null>
> {
  return withAction(async (userId) => {
    const latest = await getLatestSubmission(userId, {
      provider: ISOMETRIC_PROVIDER,
      submissionType: DATA_UPLOAD_SUBMISSION_TYPE,
      localEntityType: DATA_UPLOAD_ENTITY_TYPE,
      localEntityId: removalId,
    });
    if (!latest) return null;
    const externalId = latest.externalId;
    const remote = externalId
      ? await isometric
          .get<DataUploadSubmission>(
            `/data-upload-submissions/${encodeURIComponent(externalId)}`,
          )
          .catch(() => null)
      : null;
    return { submission: latest, latestStatus: remote };
  });
}
