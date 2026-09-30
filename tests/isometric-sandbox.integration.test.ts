/**
 * Isometric sandbox write paths: live, opt-in, and never part of the daily
 * health run.
 *
 * Read-only sandbox checks live in
 * tests/isometric-sandbox-health.integration.test.ts, which is all that
 * `pnpm test:isometric-health` runs. This file runs only via
 * `pnpm test:integration` (or an explicit path), so a write-capable test added
 * here can never reach the daily health workflow.
 *
 * Opt-in and fail-closed env gating live in ./helpers/isometric-sandbox-env.ts.
 * The telemetry pipeline additionally needs `ISOMETRIC_DEMO_FACILITY_ID`.
 */
import { describe, expect, it } from "vitest";
import { SANDBOX_CONFIGURED, getSandboxClient } from "./helpers/isometric-sandbox-env";

// Optional second-tier gate for the write-path telemetry test. Skips
// when the facility ID is not provided so CI passes for projects that
// only have read-path credentials.
const TELEMETRY_FACILITY_ID = process.env.ISOMETRIC_DEMO_FACILITY_ID;
const TELEMETRY_TEST_ENABLED =
  SANDBOX_CONFIGURED && Boolean(TELEMETRY_FACILITY_ID);

// Phase 5 Slice A — end-to-end DataUploadSubmission pipeline
// (ADR 0006). Reuses the smoke probe's exact byte path through the
// real `lib/isometric` and `transformers/data-upload` modules:
//   1. ensure two sensors (temperature + pressure) for a fresh reactor id
//   2. aggregate synthetic readings into 60-second buckets
//   3. POST /file-uploads -> PUT bytes -> POST /data-upload-submissions
//   4. poll GET /data-upload-submissions/{id} until terminal
// The reactor id is per-run so reactor-scoped sensor uniqueness on
// Isometric's side never clashes across runs of this test.
describe.skipIf(!TELEMETRY_TEST_ENABLED)(
  "Isometric sandbox write path - telemetry pipeline (ADR 0006)",
  () => {
    const POLL_INTERVAL_MS = 5_000;
    const POLL_MAX_ATTEMPTS = 12;
    const SUBMISSION_TIMEOUT_MS = 90_000;

    it(
      "publishes a Parquet DataUploadSubmission and polls to a terminal status",
      async () => {
        const client = await getSandboxClient();
        const {
          createSensor,
          findSensorByReference,
          buildSensorReference,
        } = await import("@/lib/isometric/sensors");
        const { aggregateForDataUpload, DEFAULT_DATA_UPLOAD_CHANNELS } =
          await import("@/lib/isometric/transformers/data-upload");
        const { writeDataUploadParquet } = await import(
          "@/lib/isometric/parquet/writer"
        );
        const { decodeMeasurementProperty } = await import(
          "@/lib/isometric/utils/measurement-property"
        );
        const facilityId = TELEMETRY_FACILITY_ID as string;

        // Fresh reactor id per run -> the (reactor, property) sensor
        // reference is stable across reruns AND avoids cross-contamination
        // with previously-created sensors on the sandbox.
        const reactorId = crypto.randomUUID();
        const sensors = [] as Array<{
          measurementProperty: string;
          reference: string;
        }>;
        for (const channel of DEFAULT_DATA_UPLOAD_CHANNELS) {
          const prop = decodeMeasurementProperty(channel.measurementProperty);
          const reference = buildSensorReference({
            reactorId,
            measurementProperty: prop,
          });
          const existing = await findSensorByReference(client, reference);
          if (!existing) {
            await createSensor(client, {
              facility_id: facilityId,
              measurement_property: prop,
              reference,
              units: channel.field === "temperatureC" ? "degC" : "bar",
            });
          }
          sensors.push({
            measurementProperty: channel.measurementProperty,
            reference,
          });
        }

        // Synthesize 5 minutes of 1-minute-cadence readings - 5 buckets
        // per channel after aggregation. Clock-aligned at the start.
        const baseMs =
          Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000;
        const readings = Array.from({ length: 5 }, (_, i) => ({
          reactorId,
          timestamp: new Date(baseMs + i * 60_000),
          temperatureC: 455 + i,
          pressureBar: 1.05 + i * 0.01,
          gasFlowRate: null,
        }));

        const aggregated = aggregateForDataUpload({
          readings,
          sensorRefs: sensors.map((s) => ({
            reactorId,
            measurementProperty: s.measurementProperty,
            sensorReference: s.reference,
          })),
        });
        expect(aggregated.length).toBe(readings.length * sensors.length);

        const parquetBytes = writeDataUploadParquet(aggregated);
        expect(parquetBytes.byteLength).toBeGreaterThan(0);

        const fileUpload = await client.post<{
          id: string;
          upload_url: string;
        }>("/file-uploads", {
          content_length: parquetBytes.byteLength,
          content_type: "application/vnd.apache.parquet",
          file_name: `integration-${reactorId}.parquet`,
        });
        expect(fileUpload.id).toMatch(/^tfu_/);

        const putBody = new Blob([parquetBytes as BlobPart], {
          type: "application/vnd.apache.parquet",
        });
        const putRes = await fetch(fileUpload.upload_url, {
          method: "PUT",
          headers: {
            "content-type": "application/vnd.apache.parquet",
            "content-length": String(parquetBytes.byteLength),
          },
          body: putBody,
        });
        expect(putRes.ok).toBe(true);

        const submission = await client.post<{
          id: string;
          status: string;
        }>("/data-upload-submissions", {
          facility_id: facilityId,
          file_upload_id: fileUpload.id,
          submission_type: "biochar_pyrolysis_reactor_facility_time_series",
        });
        expect(submission.id).toMatch(/^dus_/);

        let terminal: { status: string; error_message?: string | null } = {
          status: submission.status,
        };
        for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          terminal = await client.get<{
            status: string;
            error_message?: string | null;
          }>(`/data-upload-submissions/${encodeURIComponent(submission.id)}`);
          if (terminal.status !== "pending") break;
        }
        // The contract under test is the byte path itself: either
        // `completed` (success) or `failed` with a structured message
        // (Isometric rejected the payload, which is still verifier-
        // visible state). `pending` after the timeout fails the test.
        expect(["completed", "failed"]).toContain(terminal.status);
        if (terminal.status === "failed") {
          expect(typeof terminal.error_message).toBe("string");
        }
      },
      SUBMISSION_TIMEOUT_MS,
    );
  },
);

describe.skipIf(TELEMETRY_TEST_ENABLED || !SANDBOX_CONFIGURED)(
  "Isometric sandbox write path - telemetry pipeline (skipped - set ISOMETRIC_DEMO_FACILITY_ID)",
  () => {
    it("skipped because ISOMETRIC_DEMO_FACILITY_ID is not set", () => {
      expect(TELEMETRY_TEST_ENABLED).toBe(false);
    });
  },
);

describe.skipIf(SANDBOX_CONFIGURED)(
  "Isometric sandbox write paths (skipped — opt in via RUN_ISOMETRIC_SANDBOX_TESTS=1 + sandbox env)",
  () => {
    it("skipped because RUN_ISOMETRIC_SANDBOX_TESTS or sandbox env vars are not set", () => {
      // Placeholder so the file always reports something useful when
      // sandbox env is absent. Vitest still emits the describe name.
      expect(SANDBOX_CONFIGURED).toBe(false);
    });
  },
);
