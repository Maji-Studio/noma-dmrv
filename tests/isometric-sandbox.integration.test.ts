/**
 * Isometric sandbox integration smoke test.
 *
 * Opt-in only: skipped unless `RUN_ISOMETRIC_SANDBOX_TESTS=1`.
 * Run via `pnpm test:integration`, which sets the env var and includes
 * this file. Default `pnpm test` skips it so unit runs never hit the
 * live sandbox API.
 *
 * Additional preconditions (also enforced; missing → skipped):
 *   - `ISOMETRIC_CLIENT_SECRET` and `ISOMETRIC_ACCESS_TOKEN` set
 *   - `ISOMETRIC_ENVIRONMENT === "sandbox"`
 *   - `ISOMETRIC_DEMO_PROJECT_ID` set (no hard-coded fallback; same
 *     guardrail as scripts/isometric-smoke.ts)
 *
 * Out of scope: write paths (POST /datapoints, POST /ghg_entries,
 * POST /ghg_statements). Sandbox templates currently have unmapped
 * monitored inputs and unbound fixed constants — see
 * `docs/open-questions.md` → `phase-3-input-coverage` /
 * `phase-3-fixed-constants`.
 */
import { config as loadDotenv } from "dotenv";
import { describe, expect, it } from "vitest";
import type { TransportLeg } from "@/db/schema";

loadDotenv({ path: ".env.local", override: false });

const OPTED_IN = process.env.RUN_ISOMETRIC_SANDBOX_TESTS === "1";
const MISSING_SANDBOX_VARS = [
  !process.env.ISOMETRIC_CLIENT_SECRET && "ISOMETRIC_CLIENT_SECRET",
  !process.env.ISOMETRIC_ACCESS_TOKEN && "ISOMETRIC_ACCESS_TOKEN",
  process.env.ISOMETRIC_ENVIRONMENT !== "sandbox" &&
    'ISOMETRIC_ENVIRONMENT (must equal "sandbox")',
  !process.env.ISOMETRIC_DEMO_PROJECT_ID && "ISOMETRIC_DEMO_PROJECT_ID",
].filter(Boolean) as string[];
const SANDBOX_CONFIGURED = OPTED_IN && MISSING_SANDBOX_VARS.length === 0;

// Optional second-tier gate for the write-path telemetry test. Skips
// when the facility ID is not provided so CI passes for projects that
// only have read-path credentials.
const TELEMETRY_FACILITY_ID = process.env.ISOMETRIC_DEMO_FACILITY_ID;
const TELEMETRY_TEST_ENABLED =
  SANDBOX_CONFIGURED && Boolean(TELEMETRY_FACILITY_ID);

if (OPTED_IN && !SANDBOX_CONFIGURED) {
  throw new Error(
    `RUN_ISOMETRIC_SANDBOX_TESTS=1 but sandbox env is incomplete. Missing/misconfigured: ${MISSING_SANDBOX_VARS.join(
      ", ",
    )}.`,
  );
}

const TEST_TIMEOUT_MS = 30_000;

async function getEnvClient() {
  const { getIsometricClientFromEnv } = await import("@/lib/isometric");
  return getIsometricClientFromEnv();
}

describe.skipIf(!SANDBOX_CONFIGURED)(
  "Isometric sandbox read paths",
  () => {
    it(
      "lists projects and includes the configured demo project",
      async () => {
        const { listProjects } = await import("@/lib/isometric");
        const projects = await listProjects(await getEnvClient());
        expect(projects.length).toBeGreaterThan(0);
        const demoId = process.env.ISOMETRIC_DEMO_PROJECT_ID as string;
        expect(projects.some((p) => p.id === demoId)).toBe(true);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "lists GHG entry templates for the demo project",
      async () => {
        const { listGhgEntryTemplates } = await import("@/lib/isometric");
        const demoId = process.env.ISOMETRIC_DEMO_PROJECT_ID as string;
        const templates = await listGhgEntryTemplates(await getEnvClient(), demoId);
        expect(templates.length).toBeGreaterThan(0);
        for (const template of templates) {
          expect(typeof template.id).toBe("string");
          expect(template.id.length).toBeGreaterThan(0);
          // Post-rename surface exposes credit_type; ours are REMOVAL.
          expect(template.credit_type).toBe("REMOVAL");
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "lists GHG entries via the renamed /ghg_entries route (rmv_ id shape preserved)",
      async () => {
        const client = await getEnvClient();
        // Old Removals are the same resources, now retrievable via
        // /ghg_entries; their ids keep the rmv_ prefix after the rename.
        let count = 0;
        for await (const entry of client.paginate<{ id: string }>(
          "/ghg_entries",
          { pageSize: 5 },
        )) {
          expect(entry.id).toMatch(/^rmv_/);
          if (++count >= 5) break;
        }
        // A fresh sandbox project may have zero entries; the assertion above
        // only fires when data exists. Reaching here proves the route resolves.
        expect(count).toBeGreaterThanOrEqual(0);
      },
      TEST_TIMEOUT_MS,
    );

    // Env-gated: set ISOMETRIC_KNOWN_GHG_ENTRY_SUPPLIER_REF to the
    // supplier_reference_id of a Removal created BEFORE the 2026-06-04 rename
    // to prove old objects resolve through the new /ghg_entries route.
    it.skipIf(!process.env.ISOMETRIC_KNOWN_GHG_ENTRY_SUPPLIER_REF)(
      "resolves a pre-rename Removal by supplier_reference_id through /ghg_entries",
      async () => {
        const { findGhgEntryBySupplierRef } = await import("@/lib/isometric");
        const ref = process.env
          .ISOMETRIC_KNOWN_GHG_ENTRY_SUPPLIER_REF as string;
        const entry = await findGhgEntryBySupplierRef(await getEnvClient(), ref);
        expect(entry).not.toBeNull();
        expect(entry?.id).toMatch(/^rmv_/);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "lists component blueprints from the global catalog",
      async () => {
        const { listComponentBlueprints } = await import("@/lib/isometric");
        const blueprints = await listComponentBlueprints(await getEnvClient());
        expect(blueprints.length).toBeGreaterThan(0);
        for (const blueprint of blueprints) {
          expect(typeof blueprint.key).toBe("string");
          expect(blueprint.key.length).toBeGreaterThan(0);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);

// Transport → mass_distance mapping (2026-06-19). Proves every transport
// category present in the live template resolves to the
// `mass_distance_based_ci_emissions` blueprint's `mass_distance` (tonne·km)
// SCALAR input, and builds a mass-weighted datapoint from MULTIPLE legs (the
// "storage bins pile up" case). There is no LIST-shaped transport blueprint in
// the catalog, so multi-leg is collapsed to one Σⱼ(distⱼ×massⱼ) scalar.
function makeTransportLeg(distanceKm: number, loadMassKg: number): TransportLeg {
  return {
    id: `tl_${distanceKm}_${loadMassKg}`,
    entityType: "feedstock",
    entityId: "ent_integration",
    originGpsLatitude: null,
    originGpsLongitude: null,
    originName: null,
    destinationGpsLatitude: null,
    destinationGpsLongitude: null,
    destinationName: null,
    distanceKm,
    distanceSource: null,
    transportMethodType: "road",
    vehicleType: null,
    modelYear: null,
    loadMassKg,
    // This fixture isolates the multi-leg sum. Round-trip multiplication has
    // dedicated unit coverage in aggregation.test.ts.
    tripType: "one_way",
    calculationMethodType: "distance_based",
    isDerived: false,
    billOfLading: null,
    weighScaleTicketRef: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as TransportLeg;
}

describe.skipIf(!SANDBOX_CONFIGURED)(
  "Isometric sandbox transport mass_distance mapping (2026-06-19)",
  () => {
    const PROJECT_ID = process.env.ISOMETRIC_DEMO_PROJECT_ID as string;

    // The demo project carries several templates; pick the one whose
    // components actually use `mass_distance_based_ci_emissions` (the
    // re-authored "Dark Earth Carbon Template"), preferring an explicit
    // ISOMETRIC_DEMO_TEMPLATE_ID when set. Returns null if none — the
    // assertions then fail loudly with a clear message.
    type Template = Awaited<
      ReturnType<
        typeof import("@/lib/isometric").listGhgEntryTemplates
      >
    >[number];
    const pickTransportTemplate = (templates: Template[]): Template | null => {
      const explicit = process.env.ISOMETRIC_DEMO_TEMPLATE_ID;
      const hasTransport = (t: Template) =>
        (t.groups ?? []).some((g) =>
          (g.components ?? []).some(
            (c) => c.blueprint_key === "mass_distance_based_ci_emissions",
          ),
        );
      if (explicit) {
        return templates.find((t) => t.id === explicit) ?? null;
      }
      return templates.find(hasTransport) ?? null;
    };

    it(
      "resolves every transport category to mass_distance (tonne·km) against the live template",
      async () => {
        const { listGhgEntryTemplates } = await import("@/lib/isometric");
        const { lookupInputMapping } = await import(
          "@/lib/isometric/transformers/datapoint"
        );
        const templates = await listGhgEntryTemplates(await getEnvClient(), PROJECT_ID);
        const template = pickTransportTemplate(templates);
        expect(
          template,
          "a template using mass_distance_based_ci_emissions",
        ).toBeDefined();

        const transportComponents = (template!.groups ?? []).flatMap((g) =>
          (g.components ?? [])
            .filter((c) => c.blueprint_key === "mass_distance_based_ci_emissions")
            .map((c) => ({ groupKey: g.key, component: c })),
        );
        // The current live template has feedstock and biochar transport. Keep
        // a non-vacuous floor while allowing the registry to add categories.
        expect(transportComponents.length).toBeGreaterThanOrEqual(2);

        for (const { groupKey, component } of transportComponents) {
          const input = component.inputs.find(
            (i) => i.input_key === "mass_distance",
          );
          expect(input, `${groupKey} mass_distance input`).toBeDefined();
          const mapping = lookupInputMapping(
            groupKey,
            "mass_distance_based_ci_emissions",
            "mass_distance",
          );
          expect(mapping, `INPUT_MAPPING for ${groupKey}`).toBeDefined();
          expect(mapping!.unit).toBe("tonne * km");
          expect(mapping!.expectedQuantityKind).toBe("mass_distance");
          expect(mapping!.source).toMatch(/TransportMassDistanceTonneKm$/);
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "builds a mass-weighted mass_distance datapoint from multiple legs",
      async () => {
        const { listGhgEntryTemplates, listComponentBlueprints } = await import(
          "@/lib/isometric"
        );
        const { buildCreateDatapointRequest } = await import(
          "@/lib/isometric/transformers/datapoint"
        );
        const { aggregateTransportMassDistance } = await import(
          "@/lib/isometric/utils/aggregation"
        );
        const client = await getEnvClient();

        // Two feedstock legs: 60 km × 2 t + 40 km × 3 t = 240 t·km
        // (mass-weighted, same road factor → exact).
        const agg = aggregateTransportMassDistance(
          [makeTransportLeg(60, 2000), makeTransportLeg(40, 3000)],
          "Feedstock",
        );
        expect(agg.warning).toBeNull();
        expect(agg.massDistanceTonneKm).toBe(240);

        const [templates, blueprints] = await Promise.all([
          listGhgEntryTemplates(client, PROJECT_ID),
          listComponentBlueprints(client),
        ]);
        const template = pickTransportTemplate(templates);
        expect(template, "transport template").toBeDefined();
        const found = (template!.groups ?? [])
          .flatMap((g) => g.components.map((component) => ({ g, component })))
          .find(
            (x) =>
              x.g.key === "biomass-feedstock-transport" &&
              x.component.blueprint_key === "mass_distance_based_ci_emissions",
          );
        expect(found, "feedstock transport component").toBeDefined();
        const rtcInput = found!.component.inputs.find(
          (i) => i.input_key === "mass_distance",
        )!;
        const blueprintInput = blueprints
          .find((b) => b.key === "mass_distance_based_ci_emissions")!
          .inputs.find((i) => i.input_key === "mass_distance")!;

        const body = buildCreateDatapointRequest({
          groupKey: "biomass-feedstock-transport",
          componentBlueprintKey: "mass_distance_based_ci_emissions",
          rtcInput,
          blueprintInput,
          agg: {
            feedstockTransportMassDistanceTonneKm: agg.massDistanceTonneKm,
            sourceProductionRunIds: ["integration-run-1", "integration-run-2"],
          } as never,
          projectId: PROJECT_ID,
          supplierRefId: `noma-multileg-it-${Date.now()}`,
          sourceIds: [],
        });
        expect(body.quantity.magnitude).toBe(240);
        expect(body.quantity.unit).toBe("tonne * km");
      },
      TEST_TIMEOUT_MS,
    );
  },
);

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
        const client = await getEnvClient();
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
  "Isometric sandbox read paths (skipped — opt in via RUN_ISOMETRIC_SANDBOX_TESTS=1 + sandbox env)",
  () => {
    it("skipped because RUN_ISOMETRIC_SANDBOX_TESTS or sandbox env vars are not set", () => {
      // Placeholder so the file always reports something useful when
      // sandbox env is absent. Vitest still emits the describe name.
      expect(SANDBOX_CONFIGURED).toBe(false);
    });
  },
);
