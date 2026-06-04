/**
 * Shared fixtures for the Certification workspace E2E specs
 * (`certification-workspace.spec.ts`, `certification-review-flow.spec.ts`).
 *
 * The load-bearing gotcha (see the remodel handoff): the certify loaders
 * (`loadFacilityCertifierMapping`, `buildRemovalContext`) ALWAYS read from
 * Isometric (`listProjects` + `listRemovalTemplates`). Without sandbox creds
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
import { eq } from "drizzle-orm";
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

/**
 * Insert a `certifier_projects` row linking `facilityId` to an Isometric
 * project. Returns a `cleanup()` the caller runs in `finally`.
 */
export async function seedCertifierMapping(
  facilityId: string,
  opts: { externalProjectId: string; defaultRemovalTemplateId?: string | null },
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
      .where(eq(schema.certifierProjects.facilityId, facilityId));
  } finally {
    await pool.end();
  }
}

/**
 * Resolve the id of the first removal template on the sandbox project, with a
 * raw authenticated fetch. Returns `null` on any failure (no creds, network,
 * non-2xx, empty project) so the caller can `test.skip` rather than fail — the
 * `runSummary` table only renders once `buildRemovalContext` resolves a real
 * template, so without one there is nothing to assert.
 */
export async function fetchSandboxRemovalTemplateId(
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
  )}/removal_templates?first=1`;

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
    const json = (await res.json()) as { nodes?: Array<{ id?: string }> };
    return json.nodes?.[0]?.id ?? null;
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
