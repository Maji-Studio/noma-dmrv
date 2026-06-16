/**
 * Shared fixtures for the Certification workspace E2E specs
 * (`certification-workspace.spec.ts`, `certification-review-flow.spec.ts`).
 *
 * The load-bearing gotcha (see the remodel handoff): the certify loaders
 * (`loadFacilityCertifierMapping`, `buildRemovalContext`) ALWAYS read from
 * Isometric (`listProjects` + `listGhgEntryTemplates`). Without sandbox creds
 * those return `[]`, so a linked facility / resolvable template cannot be
 * produced. These helpers therefore:
 *   - expose `SANDBOX_PROJECT_ID` so specs can `test.skip` when unconfigured;
 *   - seed `certifier_projects` directly via Drizzle (never drive the live link
 *     dialog — that needs the API too);
 *   - resolve a real removal-template id with a tiny raw fetch (the client's
 *     auth is just two headers — replicated here so we never import the
 *     `@/config/env`-coupled client into the Playwright process).
 *
 * `loadEnv` runs HERE (not only in the spec): this module is evaluated during
 * the spec's import phase — before the spec's own top-level `loadEnv` — so
 * reading `process.env` at module scope would otherwise miss `.env.local`.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: false });

import * as crypto from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import { createDbConnection } from "./db";

/** The sandbox project every gated scenario links facilities to. */
export const SANDBOX_PROJECT_ID = process.env.ISOMETRIC_DEMO_PROJECT_ID;

// Mirrors the biochar protocol pin the link dialog writes; only `externalProjectId`
// + `defaultRemovalTemplateId` are load-bearing for the loaders under test.
const PROTOCOL_SLUG = "biochar";
const PROTOCOL_VERSION = "1.2";

// Same base URLs + header auth as `src/lib/isometric/client.ts`, replicated so
// the template fetch carries no `@/config/env` import surface into Playwright.
const ISOMETRIC_BASE_URLS = {
  sandbox: "https://api.sandbox.isometric.com/mrv/v0",
  production: "https://api.isometric.com/mrv/v0",
} as const;
const TEMPLATE_FETCH_TIMEOUT_MS = 20_000;

export interface SeededMapping {
  cleanup: () => Promise<void>;
}

/** The four `certifier_projects` emission-estimate columns a live submit needs. */
export interface FacilityEmissionConfigSeed {
  gensetEnergyYieldKwhPerLitre: number;
  stageSplitBiomassPct: number;
  stageSplitPyrolysisPct: number;
  stageSplitBiocharPct: number;
}

/** Plausible defaults whose stage splits sum to exactly 100 (the submit guard). */
export const DEFAULT_FACILITY_EMISSION_CONFIG: FacilityEmissionConfigSeed = {
  gensetEnergyYieldKwhPerLitre: 3,
  stageSplitBiomassPct: 34,
  stageSplitPyrolysisPct: 33,
  stageSplitBiocharPct: 33,
};

/**
 * Insert a `certifier_projects` row linking `facilityId` to an Isometric
 * project. Returns a `cleanup()` the caller runs in `finally`.
 */
export async function seedCertifierMapping(
  facilityId: string,
  opts: {
    externalProjectId: string;
    defaultRemovalTemplateId?: string | null;
    /**
     * Per-facility emission-estimate columns a LIVE removal submit reads via
     * `resolveFacilityEmissionConfig` (genset yield + the three stage splits,
     * which must sum to 100). Omit for link-only scenarios that never submit —
     * the columns stay null and the wizard still mounts. Provide them for the
     * full create→submit happy path or the submit throws "Set this facility's
     * genset yield and stage splits …".
     */
    emissionConfig?: FacilityEmissionConfigSeed;
  },
): Promise<SeededMapping> {
  const { db, pool } = createDbConnection();
  try {
    await db.insert(schema.certifierProjects).values({
      facilityId,
      provider: "isometric",
      externalProjectId: opts.externalProjectId,
      protocolSlug: PROTOCOL_SLUG,
      protocolVersion: PROTOCOL_VERSION,
      defaultRemovalTemplateId: opts.defaultRemovalTemplateId ?? null,
      ...(opts.emissionConfig ?? {}),
    });
  } finally {
    await pool.end();
  }
  return { cleanup: () => deleteCertifierMapping(facilityId) };
}

export async function deleteCertifierMapping(facilityId: string): Promise<void> {
  const { db, pool } = createDbConnection();
  try {
    await db
      .delete(schema.certifierProjects)
      .where(
        and(
          eq(schema.certifierProjects.facilityId, facilityId),
          eq(schema.certifierProjects.provider, "isometric"),
        ),
      );
  } finally {
    await pool.end();
  }
}

// Shape of the slice of the raw `ghg_entry_templates` list response we read to
// detect fixed-input binding (the list returns the full nested tree).
interface RawRemovalTemplate {
  id?: string;
  groups?: Array<{
    components?: Array<{
      inputs?: Array<{ type?: string; datapoint_id?: string | null }>;
    }>;
  }>;
}

function templateHasUnboundFixedInput(t: RawRemovalTemplate): boolean {
  return (t.groups ?? []).some((g) =>
    (g.components ?? []).some((c) =>
      (c.inputs ?? []).some((i) => i.type === "fixed" && !i.datapoint_id),
    ),
  );
}

/**
 * Resolve the id of a SUBMITTABLE removal template on the sandbox project — one
 * whose every `type: "fixed"` input is bound to a datapoint. Returns `null` on
 * any failure (no creds, network, non-2xx) or when no fully-bound template
 * exists, so the caller can `test.skip` rather than fail.
 *
 * Why not just the first template: the wizard's readiness gate only checks that
 * the template's component blueprints resolve, NOT that its fixed inputs are
 * bound — but `submitRemoval` (`resolveTemplateInputs`) throws on an unbound
 * fixed input. The sandbox project carries several templates, including an
 * unbound "Protocol default"; picking the first would pass the wizard's
 * Requirements step yet fail the live submit. So we scan for one whose fixed
 * inputs are all bound. (The `ghg_entry_templates` list returns the full nested
 * component/input tree, so no per-template fetch is needed.)
 */
export async function fetchSubmittableSandboxRemovalTemplateId(
  projectId: string,
): Promise<string | null> {
  const clientSecret = process.env.ISOMETRIC_CLIENT_SECRET;
  const accessToken = process.env.ISOMETRIC_ACCESS_TOKEN;
  if (!clientSecret || !accessToken) return null;

  const envName =
    process.env.ISOMETRIC_ENVIRONMENT === "production"
      ? "production"
      : "sandbox";
  const url = `${ISOMETRIC_BASE_URLS[envName]}/projects/${encodeURIComponent(
    projectId,
  )}/ghg_entry_templates`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Client-Secret": clientSecret,
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(TEMPLATE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { nodes?: RawRemovalTemplate[] };
    for (const node of json.nodes ?? []) {
      if (node.id && !templateHasUnboundFixedInput(node)) return node.id;
    }
    return null;
  } catch {
    return null;
  }
}

/** Existing seeded chain entities the grouped-removal seed reuses (read-only). */
export interface ChainSeedRefs {
  facilityId: string;
  reactorId: string;
  formulationId: string;
  feedstockId: string;
  feedstockStorageLocationId: string;
  biocharStorageLocationId: string;
  customerId: string;
  customerLocationId: string;
  vehicleId: string;
}

export interface SeededGroupedRemoval {
  removalId: string;
  creditBatch: { id: string; code: string };
  cleanup: () => Promise<void>;
}

const APPLIED_DRY_TONS = 0.095;
const BIOCHAR_OUTPUT_KG = 150;
const CREDIT_BATCH_H_TO_CORG_RATIO = 0.4;

/**
 * Seed the minimal traceability chain a Removal needs to resolve a production
 * run, then group it into a `certifier_removals` Removal. Mirrors the proven
 * shape in `full-workflow.spec.ts` but reuses the `seededData` entities so it
 * only adds the run → biochar product → order → delivery → application → credit
 * batch tail (plus the feedstock link the chain walk expects).
 *
 * After this, `buildRemovalContext` resolves one production run → the guided
 * Review step renders the `runSummary` table (gated on `runCount > 0`).
 */
export async function seedGroupedRemovalWithChain(
  refs: ChainSeedRefs,
  testRunId: string,
): Promise<SeededGroupedRemoval> {
  const { db, pool } = createDbConnection();
  const id = {
    productionRun: crypto.randomUUID(),
    productionRunFeedstock: crypto.randomUUID(),
    biocharProduct: crypto.randomUUID(),
    order: crypto.randomUUID(),
    delivery: crypto.randomUUID(),
    application: crypto.randomUUID(),
    creditBatch: crypto.randomUUID(),
    creditBatchApplication: crypto.randomUUID(),
    removal: crypto.randomUUID(),
  };
  const creditBatchCode = `E2E-CB-${testRunId}`;
  const today = new Date().toISOString().slice(0, 10);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.productionRuns).values({
        id: id.productionRun,
        code: `E2E-PRD-${testRunId}`,
        facilityId: refs.facilityId,
        date: today,
        reactorId: refs.reactorId,
        status: "complete",
        startTime: new Date(),
        endTime: new Date(),
        biocharOutputKg: BIOCHAR_OUTPUT_KG,
        biocharStorageLocationId: refs.biocharStorageLocationId,
        feedstockStorageLocationId: refs.feedstockStorageLocationId,
      });
      await tx.insert(schema.productionRunFeedstocks).values({
        id: id.productionRunFeedstock,
        productionRunId: id.productionRun,
        feedstockId: refs.feedstockId,
        massUsedKg: 400,
      });
      await tx.insert(schema.biocharProducts).values({
        id: id.biocharProduct,
        code: `E2E-BP-RVW-${testRunId}`,
        facilityId: refs.facilityId,
        formulationId: refs.formulationId,
        linkedProductionRunId: id.productionRun,
        storageLocationId: refs.biocharStorageLocationId,
        productionDate: new Date(),
        status: "ready",
        massKg: BIOCHAR_OUTPUT_KG,
      });
      await tx.insert(schema.orders).values({
        id: id.order,
        code: `E2E-ORD-${testRunId}`,
        facilityId: refs.facilityId,
        orderDate: new Date(),
        customerId: refs.customerId,
        customerLocationId: refs.customerLocationId,
        biocharProductId: id.biocharProduct,
        quantityKg: 100,
        packaging: "bagged",
      });
      await tx.insert(schema.deliveries).values({
        id: id.delivery,
        code: `E2E-DEL-${testRunId}`,
        facilityId: refs.facilityId,
        deliveryDate: new Date(),
        orderId: id.order,
        biocharProductId: id.biocharProduct,
        storageLocationId: refs.biocharStorageLocationId,
        deliveredWetMassKg: 105,
        massDryKg: 100,
        moistureContentPercent: 5,
        status: "delivered",
        vehicleId: refs.vehicleId,
      });
      await tx.insert(schema.applications).values({
        id: id.application,
        code: `E2E-APP-${testRunId}`,
        deliveryId: id.delivery,
        applicationDate: new Date(),
        biocharAppliedTons: 0.1,
        biocharAppliedDryTons: APPLIED_DRY_TONS,
        fieldSizeHa: 0.5,
        fieldIdentifier: `Field-${testRunId}`,
        cropType: "Coffee",
        gpsLatitude: -3.4,
        gpsLongitude: 37.0,
        soilTemperatureSource: "baseline",
        soilTemperatureC: 25,
      });
      // Group: a Removal ledger row + the credit batch pointing at it.
      await tx.insert(schema.certifierRemovals).values({
        id: id.removal,
        facilityId: refs.facilityId,
        provider: "isometric",
      });
      await tx.insert(schema.creditBatches).values({
        id: id.creditBatch,
        code: creditBatchCode,
        facilityId: refs.facilityId,
        startDate: today,
        endDate: today,
        status: "draft",
        durabilityOption: "200_year",
        hToCorgRatio: CREDIT_BATCH_H_TO_CORG_RATIO,
        removalId: id.removal,
      });
      await tx.insert(schema.creditBatchApplications).values({
        id: id.creditBatchApplication,
        creditBatchId: id.creditBatch,
        applicationId: id.application,
      });
    });
  } finally {
    await pool.end();
  }

  return {
    removalId: id.removal,
    creditBatch: { id: id.creditBatch, code: creditBatchCode },
    cleanup: async () => {
      const conn = createDbConnection();
      try {
        await conn.db.transaction(async (tx) => {
          // Reverse FK order; certifier_removals must go before the facility
          // teardown (it FKs the facility and cleanupChainData does not sweep it).
          await tx
            .delete(schema.creditBatchApplications)
            .where(
              eq(schema.creditBatchApplications.id, id.creditBatchApplication),
            );
          await tx
            .delete(schema.creditBatches)
            .where(eq(schema.creditBatches.id, id.creditBatch));
          await tx
            .delete(schema.certifierRemovals)
            .where(eq(schema.certifierRemovals.id, id.removal));
          await tx
            .delete(schema.applications)
            .where(eq(schema.applications.id, id.application));
          await tx
            .delete(schema.deliveries)
            .where(eq(schema.deliveries.id, id.delivery));
          await tx.delete(schema.orders).where(eq(schema.orders.id, id.order));
          await tx
            .delete(schema.biocharProducts)
            .where(eq(schema.biocharProducts.id, id.biocharProduct));
          await tx
            .delete(schema.productionRunFeedstocks)
            .where(
              eq(
                schema.productionRunFeedstocks.id,
                id.productionRunFeedstock,
              ),
            );
          await tx
            .delete(schema.productionRuns)
            .where(eq(schema.productionRuns.id, id.productionRun));
        });
      } finally {
        await conn.pool.end();
      }
    },
  };
}

/**
 * Tear down the removal the New-Removal wizard creates at "Confirm"
 * (deferred-create groups the batch into a fresh `certifier_removals` row and,
 * on a live submit, writes a `certification_submissions` row). The seed's own
 * `cleanup()` only knows the batch + chain, so the spec calls this BEFORE that
 * cleanup: it nulls the batch→removal FK, drops any submission rows, then the
 * removal. A no-op when "Confirm" never ran (the batch is still ungrouped).
 */
export async function teardownWizardRemovalForBatch(
  creditBatchId: string,
): Promise<void> {
  const { db, pool } = createDbConnection();
  try {
    const [row] = await db
      .select({ removalId: schema.creditBatches.removalId })
      .from(schema.creditBatches)
      .where(eq(schema.creditBatches.id, creditBatchId));
    const removalId = row?.removalId;
    if (!removalId) return;

    await db
      .update(schema.creditBatches)
      .set({ removalId: null })
      .where(eq(schema.creditBatches.id, creditBatchId));
    await db
      .delete(schema.certificationSubmissions)
      .where(eq(schema.certificationSubmissions.localEntityId, removalId));
    await db
      .delete(schema.certifierRemovals)
      .where(eq(schema.certifierRemovals.id, removalId));
  } finally {
    await pool.end();
  }
}

// ── Ungrouped "ready" batch (full create→submit happy path) ──────────────────
//
// A batch is selectable in the New-Removal wizard only when `deriveBatchHealth`
// → "ready", which the grouped helper above deliberately does NOT reach. The
// extra inputs a "ready" batch needs over the grouped seed:
//
//   • the production run carries `biocharDryMassKg` (the grouped seed sets only
//     `biocharOutputKg`) — `aggregateProductionRuns` weights carbon by it;
//   • a `samples` row carrying `organicCarbonPercent` + `hToCOrgRatio` — the
//     CO₂e-stored preview's `weightedOrganicCarbonPercent`/`weightedHToCorgRatio`
//     come from samples, NOT the credit batch's own `hToCorgRatio` column
//     (lab-grade `samples`, not `production_samples` — see
//     `getProductionRunsWithSamples`);
//   • uniform `distance_based` transport legs for feedstock / biochar / sample,
//     so whichever categories the facility's default template requires are
//     present AND aggregate cleanly (extra legs for unrequired categories are
//     harmless — coverage is only checked for required ones).
//
// The batch is left UNGROUPED (`removalId` null) so the wizard's deferred-create
// owns the grouping. Pair with a `seedCertifierMapping` that carries
// `emissionConfig` (a live submit reads it) + a real default removal template.

const READY_BIOCHAR_OUTPUT_KG = 150;
const READY_BIOCHAR_DRY_MASS_KG = 147; // ≤ output (DB check constraint)
const READY_FEEDSTOCK_WET_MASS_KG = 420;
const READY_FEEDSTOCK_DRY_MASS_KG = 400;
const READY_FEEDSTOCK_MOISTURE_PCT = 4.76;
const READY_BIOCHAR_MOISTURE_PCT = 2;
const READY_DIESEL_OPERATION_L = 0;
const READY_PREPROCESSING_FUEL_L = 0;
const READY_DIESEL_GENSET_L = 0;
const READY_ELECTRICITY_KWH = 0;
const SAMPLE_TOTAL_CARBON_PCT = 80;
const SAMPLE_ORGANIC_CARBON_PCT = 78;
const SAMPLE_H_TO_CORG_RATIO = 0.4;
const TRANSPORT_LEG_DISTANCE_KM = 50;
const TRANSPORT_LEG_LOAD_MASS_KG = 100;
const TRANSPORT_LEG_EMISSION_FACTOR = 0.1;
const READY_TRUCK_ARRIVAL_KG = 12_500;
const READY_TRUCK_DEPARTURE_KG = 12_100;
const READY_DELIVERY_TRUCK_ARRIVAL_KG = 9_100;
const READY_DELIVERY_TRUCK_DEPARTURE_KG = 9_000;
const READY_APPLICATION_EVIDENCE_URL = "https://example.com/e2e-geotagged-application.jpg";
const READY_APPLICATION_EVIDENCE_ROLES = [
  "stockpile",
  "spreading",
  "incorporation",
] as const;

export interface SeededReadyBatch {
  creditBatchId: string;
  code: string;
  cleanup: () => Promise<void>;
}

/**
 * Seed an UNGROUPED credit batch whose chain reaches `deriveBatchHealth →
 * "ready"` (selectable in the New-Removal wizard). Modeled on
 * `seedGroupedRemovalWithChain` but never creates a removal, and adds the
 * carbon sample + run dry mass + transport legs the readiness gate requires.
 */
export async function seedUngroupedReadyBatchWithChain(
  refs: ChainSeedRefs,
  testRunId: string,
): Promise<SeededReadyBatch> {
  const { db, pool } = createDbConnection();
  let originalFeedstockMasses:
    | {
        truckMassOnArrivalKg: number | null;
        truckMassOnDepartureKg: number | null;
      }
    | undefined;
  const id = {
    productionRun: crypto.randomUUID(),
    productionRunFeedstock: crypto.randomUUID(),
    productionRunReading: crypto.randomUUID(),
    sample: crypto.randomUUID(),
    biocharProduct: crypto.randomUUID(),
    order: crypto.randomUUID(),
    delivery: crypto.randomUUID(),
    application: crypto.randomUUID(),
    applicationDocuments: READY_APPLICATION_EVIDENCE_ROLES.map(() =>
      crypto.randomUUID(),
    ),
    creditBatch: crypto.randomUUID(),
    creditBatchApplication: crypto.randomUUID(),
    feedstockTransportLeg: crypto.randomUUID(),
    biocharTransportLeg: crypto.randomUUID(),
    sampleTransportLeg: crypto.randomUUID(),
  };
  const creditBatchCode = `E2E-RDY-${testRunId}`;
  const today = new Date().toISOString().slice(0, 10);

  // One uniform distance-based leg per category, keyed to the chain entity the
  // submission walk collects (feedstock id / biochar product id / sample id).
  const leg = (
    legId: string,
    entityType: "feedstock" | "biochar" | "sample",
    entityId: string,
  ) => ({
    id: legId,
    entityType,
    entityId,
    distanceKm: TRANSPORT_LEG_DISTANCE_KM,
    transportMethodType: "road" as const,
    calculationMethodType: "distance_based" as const,
    vehicleType: "Class 8 truck",
    loadMassKg: TRANSPORT_LEG_LOAD_MASS_KG,
    emissionFactorUsed: TRANSPORT_LEG_EMISSION_FACTOR,
  });

  try {
    [originalFeedstockMasses] = await db
      .select({
        truckMassOnArrivalKg: schema.feedstocks.truckMassOnArrivalKg,
        truckMassOnDepartureKg: schema.feedstocks.truckMassOnDepartureKg,
      })
      .from(schema.feedstocks)
      .where(eq(schema.feedstocks.id, refs.feedstockId));

    await db.transaction(async (tx) => {
      await tx.insert(schema.productionRuns).values({
        id: id.productionRun,
        code: `E2E-PRD-RDY-${testRunId}`,
        facilityId: refs.facilityId,
        date: today,
        reactorId: refs.reactorId,
        status: "complete",
        startTime: new Date(),
        endTime: new Date(),
        biocharOutputKg: READY_BIOCHAR_OUTPUT_KG,
        biocharMoisturePercent: READY_BIOCHAR_MOISTURE_PCT,
        biocharDryMassKg: READY_BIOCHAR_DRY_MASS_KG,
        feedstockWetMassKg: READY_FEEDSTOCK_WET_MASS_KG,
        feedstockMoisturePercent: READY_FEEDSTOCK_MOISTURE_PCT,
        feedstockMassDryKg: READY_FEEDSTOCK_DRY_MASS_KG,
        dieselOperationLiters: READY_DIESEL_OPERATION_L,
        preprocessingFuelLiters: READY_PREPROCESSING_FUEL_L,
        dieselGensetLiters: READY_DIESEL_GENSET_L,
        electricityKwh: READY_ELECTRICITY_KWH,
        biocharStorageLocationId: refs.biocharStorageLocationId,
        feedstockStorageLocationId: refs.feedstockStorageLocationId,
      });
      await tx.insert(schema.productionRunReadings).values({
        id: id.productionRunReading,
        productionRunId: id.productionRun,
        timestamp: new Date(),
        temperatureC: 550,
        pressureBar: 0,
        gasFlowRate: 0,
      });
      await tx
        .update(schema.feedstocks)
        .set({
          truckMassOnArrivalKg: READY_TRUCK_ARRIVAL_KG,
          truckMassOnDepartureKg: READY_TRUCK_DEPARTURE_KG,
        })
        .where(eq(schema.feedstocks.id, refs.feedstockId));
      await tx.insert(schema.productionRunFeedstocks).values({
        id: id.productionRunFeedstock,
        productionRunId: id.productionRun,
        feedstockId: refs.feedstockId,
        massUsedKg: 400,
      });
      // Lab-grade sample carrying the carbon content + H:Corg the CO₂e preview
      // aggregates over (not the credit batch's own hToCorgRatio column).
      await tx.insert(schema.samples).values({
        id: id.sample,
        productionRunId: id.productionRun,
        sampleCode: `E2E-SMP-${testRunId}`,
        samplingTime: new Date(),
        totalCarbonPercent: SAMPLE_TOTAL_CARBON_PCT,
        organicCarbonPercent: SAMPLE_ORGANIC_CARBON_PCT,
        hToCOrgRatio: SAMPLE_H_TO_CORG_RATIO,
      });
      await tx.insert(schema.biocharProducts).values({
        id: id.biocharProduct,
        code: `E2E-BP-RDY-${testRunId}`,
        facilityId: refs.facilityId,
        formulationId: refs.formulationId,
        linkedProductionRunId: id.productionRun,
        storageLocationId: refs.biocharStorageLocationId,
        productionDate: new Date(),
        status: "ready",
        massKg: READY_BIOCHAR_OUTPUT_KG,
      });
      await tx.insert(schema.orders).values({
        id: id.order,
        code: `E2E-ORD-RDY-${testRunId}`,
        facilityId: refs.facilityId,
        orderDate: new Date(),
        customerId: refs.customerId,
        customerLocationId: refs.customerLocationId,
        biocharProductId: id.biocharProduct,
        quantityKg: 100,
        packaging: "bagged",
      });
      await tx.insert(schema.deliveries).values({
        id: id.delivery,
        code: `E2E-DEL-RDY-${testRunId}`,
        facilityId: refs.facilityId,
        deliveryDate: new Date(),
        orderId: id.order,
        biocharProductId: id.biocharProduct,
        storageLocationId: refs.biocharStorageLocationId,
        deliveredWetMassKg: 105,
        massDryKg: 100,
        moistureContentPercent: 5,
        truckMassOnArrivalKg: READY_DELIVERY_TRUCK_ARRIVAL_KG,
        truckMassOnDepartureKg: READY_DELIVERY_TRUCK_DEPARTURE_KG,
        status: "delivered",
        vehicleId: refs.vehicleId,
      });
      await tx.insert(schema.applications).values({
        id: id.application,
        code: `E2E-APP-RDY-${testRunId}`,
        deliveryId: id.delivery,
        applicationDate: new Date(),
        biocharAppliedTons: 0.1,
        biocharAppliedDryTons: APPLIED_DRY_TONS,
        fieldSizeHa: 0.5,
        fieldIdentifier: `Field-RDY-${testRunId}`,
        cropType: "Coffee",
        gpsLatitude: -3.4,
        gpsLongitude: 37.0,
        soilTemperatureSource: "baseline",
        soilTemperatureC: 25,
      });
      const applicationEvidenceDocuments: (typeof schema.documents.$inferInsert)[] =
        READY_APPLICATION_EVIDENCE_ROLES.map((role, index) => ({
          id: id.applicationDocuments[index],
          entityType: "application",
          entityId: id.application,
          documentType: "photo" as const,
          fileUrl: READY_APPLICATION_EVIDENCE_URL,
          fileName: `e2e-geotagged-application-${role}-${testRunId}.jpg`,
          uploadStatus: "uploaded" as const,
          metadata: { geotagStatus: "present", evidenceRole: role },
        }));
      await tx.insert(schema.documents).values(applicationEvidenceDocuments);
      await tx.insert(schema.transportLegs).values([
        leg(id.feedstockTransportLeg, "feedstock", refs.feedstockId),
        leg(id.biocharTransportLeg, "biochar", id.biocharProduct),
        leg(id.sampleTransportLeg, "sample", id.sample),
      ]);
      // Ungrouped: no certifier_removals row, no removalId on the batch.
      await tx.insert(schema.creditBatches).values({
        id: id.creditBatch,
        code: creditBatchCode,
        facilityId: refs.facilityId,
        startDate: today,
        endDate: today,
        status: "draft",
        durabilityOption: "200_year",
        hToCorgRatio: CREDIT_BATCH_H_TO_CORG_RATIO,
      });
      await tx.insert(schema.creditBatchApplications).values({
        id: id.creditBatchApplication,
        creditBatchId: id.creditBatch,
        applicationId: id.application,
      });
    });
  } finally {
    await pool.end();
  }

  return {
    creditBatchId: id.creditBatch,
    code: creditBatchCode,
    cleanup: async () => {
      const conn = createDbConnection();
      try {
        await conn.db.transaction(async (tx) => {
          await tx
            .delete(schema.creditBatchApplications)
            .where(
              eq(schema.creditBatchApplications.id, id.creditBatchApplication),
            );
          await tx
            .delete(schema.creditBatches)
            .where(eq(schema.creditBatches.id, id.creditBatch));
          await tx
            .delete(schema.transportLegs)
            .where(
              inArray(schema.transportLegs.id, [
                id.feedstockTransportLeg,
                id.biocharTransportLeg,
                id.sampleTransportLeg,
              ]),
            );
          await tx
            .delete(schema.documents)
            .where(inArray(schema.documents.id, id.applicationDocuments));
          await tx
            .delete(schema.applications)
            .where(eq(schema.applications.id, id.application));
          await tx
            .delete(schema.deliveries)
            .where(eq(schema.deliveries.id, id.delivery));
          await tx.delete(schema.orders).where(eq(schema.orders.id, id.order));
          await tx
            .delete(schema.biocharProducts)
            .where(eq(schema.biocharProducts.id, id.biocharProduct));
          await tx
            .delete(schema.samples)
            .where(eq(schema.samples.id, id.sample));
          await tx
            .delete(schema.productionRunReadings)
            .where(
              eq(schema.productionRunReadings.id, id.productionRunReading),
            );
          await tx
            .delete(schema.productionRunFeedstocks)
            .where(
              eq(schema.productionRunFeedstocks.id, id.productionRunFeedstock),
            );
          await tx
            .update(schema.feedstocks)
            .set({
              truckMassOnArrivalKg:
                originalFeedstockMasses?.truckMassOnArrivalKg ?? null,
              truckMassOnDepartureKg:
                originalFeedstockMasses?.truckMassOnDepartureKg ?? null,
            })
            .where(eq(schema.feedstocks.id, refs.feedstockId));
          await tx
            .delete(schema.productionRuns)
            .where(eq(schema.productionRuns.id, id.productionRun));
        });
      } finally {
        await conn.pool.end();
      }
    },
  };
}
