"use server";

import { z } from "zod";
import { createHash } from "node:crypto";
import {
  appendSubmissionJournal,
  markSubmissionRejected,
  markSubmissionSubmitted,
  setSubmissionTerminalStatus,
  updateSubmissionMetadata,
  type CertificationSubmissionRow,
} from "@/data-access/certification";
// Telemetry-boundary imports (see certification-submissions.ts): this file
// is the single permitted importer of the relocated claim primitives until
// the journaled-step recovery (ADR 0006) migrates onto claimSubmissionDraft.
import {
  getLatestSubmission,
  insertDraftSubmissionWithMappingLock,
  resetSubmissionToDraftWithMappingLock,
  type MappingClaimGuard,
} from "@/data-access/certification-submissions";
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
  assertUploadHostAllowed,
  fetchSignedUploadWithTimeout,
} from "@/lib/isometric/utils/signed-upload";
import {
  aggregateForDataUpload,
  DEFAULT_BUCKET_SECONDS,
  DEFAULT_DATA_UPLOAD_CHANNELS,
} from "@/lib/isometric/transformers/data-upload";
import {
  DATA_UPLOAD_PARQUET_CONTENT_TYPE,
  writeDataUploadParquet,
} from "@/lib/isometric/parquet/writer";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { loadRemovalSubmissionContext } from "./certify-context-core";
import {
  appendSyncEventBestEffort,
  ISOMETRIC_PROVIDER,
  assertProductionConfirmed,
  submitRateLimit,
} from "./shared";
import type { components } from "@/lib/isometric/generated/certify";

const DATA_UPLOAD_SUBMISSION_TYPE = "dataUpload" as const;
const DATA_UPLOAD_ENTITY_TYPE = "removal" as const;
const DATA_UPLOAD_OPERATION = "removal:data-upload" as const;
const PARQUET_SCHEMA_VERSION = 1 as const;
const UPLOAD_ERROR_TRUNCATION_LIMIT = 1000;

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
  return withAction((userId) => submitTelemetry(userId, args), {
    rateLimit: submitRateLimit("cert:submit-telemetry"),
  });
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

  // Mirrors submitRemoval / GHG-statement: every draft insert and stale-draft
  // resume runs under the mapping lock so a concurrent repoint/unlink cannot
  // orphan this submission's remote facility, and two callers cannot both
  // resume the same expired draft and double-POST. Telemetry pins
  // externalProjectId + externalFacilityId; it has no removal-template
  // dependency, so that guard field stays undefined.
  const mappingGuard: MappingClaimGuard = {
    facilityId: ctx.facilityId,
    provider: ISOMETRIC_PROVIDER,
    expectedExternalProjectId: ctx.mapping.externalProjectId,
    expectedExternalFacilityId: externalFacilityId,
  };

  // ADR 0006 - pure clock window on production_run_readings.timestamp;
  // derived from the runs the removal aggregates.
  const windowStart = new Date(
    Math.min(...ctx.runs.map((r) => r.startTime.getTime())),
  );
  const windowEnd = new Date(
    Math.max(...ctx.runs.map((r) => r.endTime.getTime())),
  );

  // Ensure a sensor mapping exists per (reactor x channel).
  const reactorIds = [...new Set(ctx.runs.map((r) => r.reactorId))];
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

  // ADR 0006 §2 - hash covers source-data inputs, not Parquet bytes. The
  // digest fingerprints every reading's identity AND values (run, reactor,
  // timestamp, channel readings), so editing a reading in place — same runs,
  // same window, same bucket count — still flips the hash and supersedes the
  // prior submission. Hashing only run ids/counts (the previous bug) left
  // in-place value edits invisible, returning a stale submission. Pre-digested
  // to one hex string so the snapshot stays lean regardless of reading count.
  const sourceReadingsDigest = payloadHash(
    readings
      .map((r) => ({
        runId: r.productionRunId,
        reactorId: r.reactorId,
        t: r.timestamp.toISOString(),
        tempC: r.temperatureC,
        pBar: r.pressureBar,
        gas: r.gasFlowRate,
      }))
      .sort(
        (a, b) =>
          a.runId.localeCompare(b.runId) ||
          a.t.localeCompare(b.t) ||
          a.reactorId.localeCompare(b.reactorId),
      ),
  );
  const semanticPayload = {
    facilityId: ctx.facilityId,
    externalFacilityId,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    // Must track the aggregator's bucketing (called above without an explicit
    // bucketSeconds, so it uses this default). A literal here would silently
    // drift from the actual aggregation if the default ever changes.
    bucketSeconds: DEFAULT_BUCKET_SECONDS,
    sensorRefs: sensorRows
      .map((row) => ({
        reactorId: row.reactorId,
        measurementProperty: row.measurementProperty,
        sensorReference: row.sensorReference,
      }))
      .sort((a, b) => a.sensorReference.localeCompare(b.sensorReference)),
    // Distinct run ids kept for human-auditable snapshots; the digest below
    // is what actually guards reading-level content changes.
    sourceProductionRunIds: [
      ...new Set(readings.map((r) => r.productionRunId)),
    ].sort(),
    sourceReadingsDigest,
    aggregatedRowCount: aggregated.length,
  };
  const semanticHash = payloadHash(semanticPayload);

  // Facility-scoped to the removal's own facility (issue #277). ctx.facilityId
  // is server-derived from this same args.removalId, so the scope is
  // lineage-consistency (fail-closed if the removal anchor is dangling), not a
  // cross-facility authorization check — that would need an independent caller
  // facility, deferred to #372. Left wired so the guard activates once one exists.
  const latest = await getLatestSubmission(
    userId,
    {
      provider: ISOMETRIC_PROVIDER,
      submissionType: DATA_UPLOAD_SUBMISSION_TYPE,
      localEntityType: DATA_UPLOAD_ENTITY_TYPE,
      localEntityId: args.removalId,
    },
    ctx.facilityId,
  );
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
      const row = await resetSubmissionToDraftWithMappingLock(
        userId,
        claim.resumeRowId,
        mappingGuard,
        LOCK_TTL_MS,
      );
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
        provider: ISOMETRIC_PROVIDER,
        entityType: DATA_UPLOAD_ENTITY_TYPE,
        entityId: args.removalId,
        operation: `${DATA_UPLOAD_OPERATION}:resume-re-put`,
        status: "succeeded",
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
          ? await resetSubmissionToDraftWithMappingLock(
              userId,
              claim.resumeRowId,
              mappingGuard,
              LOCK_TTL_MS,
            )
          : await insertDraftSubmissionWithMappingLock(
              userId,
              {
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
              },
              mappingGuard,
            );

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
          provider: ISOMETRIC_PROVIDER,
          entityType: DATA_UPLOAD_ENTITY_TYPE,
          entityId: args.removalId,
          operation: DATA_UPLOAD_OPERATION,
          status: "succeeded",
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
          provider: ISOMETRIC_PROVIDER,
          entityType: DATA_UPLOAD_ENTITY_TYPE,
          entityId: args.removalId,
          operation: DATA_UPLOAD_OPERATION,
          status: "failed",
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

// Persists per-step recovery IDs to `payloadSnapshot.journaled` — the exact
// location `readResumeSnapshot` reads on the next attempt (ADR 0006 §3). Must
// NOT write to `metadata`: that column is invisible to the resume reader, so a
// crash between the remote POST and local finalization would lose the journaled
// id and mint a duplicate. `appendSubmissionJournal` deep-merges, so each step
// adds its keys without clobbering earlier ones.
async function journalStep(
  userId: string,
  submissionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await appendSubmissionJournal(userId, submissionId, patch);
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
  // SSRF guard: Isometric returns a GCS-presigned URL; constrain the host,
  // refuse non-HTTPS/redirects, and bound the request so a rerouted or hung
  // upload can't exfiltrate bytes or pin the Fluid Compute instance. Same
  // policy the Sources mirror uses (shared in signed-upload.ts).
  assertUploadHostAllowed(args.uploadUrl);
  // The runtime accepts Uint8Array; lib.dom's `BodyInit` (TS ES2017) does
  // not enumerate it. Wrap in a Blob — the smallest cross-version
  // canonical form that satisfies BodyInit.
  const body = new Blob([args.bytes as BlobPart], {
    type: DATA_UPLOAD_PARQUET_CONTENT_TYPE,
  });
  const res = await fetchSignedUploadWithTimeout(args.uploadUrl, {
    method: "PUT",
    redirect: "error",
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
      body.slice(0, UPLOAD_ERROR_TRUNCATION_LIMIT),
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
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  const expiresSecondsRaw =
    parsed.searchParams.get("X-Goog-Expires") ??
    parsed.searchParams.get("X-Amz-Expires");
  const signedAtRaw =
    parsed.searchParams.get("X-Goog-Date") ??
    parsed.searchParams.get("X-Amz-Date");
  const expiresSeconds = expiresSecondsRaw ? Number(expiresSecondsRaw) : null;
  if (!expiresSeconds || !Number.isFinite(expiresSeconds)) return null;
  const signedAt = signedAtRaw ? parseAmzDate(signedAtRaw) : new Date();
  if (!signedAt) return null;
  return new Date(signedAt.getTime() + expiresSeconds * 1000);
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
