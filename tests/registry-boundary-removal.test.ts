/**
 * Boundary tests for the Removal submit pipeline against the fake registry
 * (reliability-track Phase 3).
 *
 * End-to-end across the recovery seams: the REAL `claimSubmissionDraft`
 * (DB-backed, per ADR 0008), the REAL ledger + sync-event writes, the REAL
 * `performRegistryCreate` choreography, and the REAL client wrappers
 * (`createDatapoint`, `findDatapointBySupplierRef`, …) — with ONLY the
 * Isometric client faked by a registry-shaped counterparty
 * (`tests/fixtures/fake-registry.ts`). The property that protects against
 * double-submitting — *POST succeeds server-side, client sees a network
 * error, the retry reconciles by supplier reference instead of POSTing
 * again* — is asserted against the registry's state, not hand-wired mocks.
 *
 * Mocked besides the client: the removal context loader (pure data — the
 * lineage/template plumbing has its own tests) and the sources resolver
 * (mirroring stays on its own create/reconcile shape by decision; see the
 * plan's out-of-scope list).
 *
 * Coverage (plan Phase 3, boundary tests 1, 2, 4, 5 — test 3 lives in
 * registry-boundary-ghg-statement.test.ts):
 *   1. Datapoint POST drop-after-commit → submit fails → resume reconciles
 *      the orphan, POSTs only the remaining datapoints; exactly one of each.
 *   2. Removal POST drop-after-commit → same property at the removal level
 *      (plus the within-attempt variant where the lookup works immediately).
 *   4. reject-before-commit with a 4xx body → row rejected, failed sync
 *      event carries the registry response body.
 *   5. Hash-supersede across versions → registry holds two removals with
 *      distinct versioned supplier refs.
 *
 * Requires a real Postgres (`.env.test`), like
 * tests/certification-submissions.test.ts.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Module mocks — declared before importing the system under test. The client
// factory must not statically import the fixture (the fixture is imported
// while the client module is being replaced), hence the dynamic import.
// ---------------------------------------------------------------------------

vi.mock("@/lib/isometric/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/isometric/client")>();
  const { createFakeClientModule } = await import("./fixtures/fake-registry");
  return createFakeClientModule(actual);
});
vi.mock("@/fn/certification/certify-context-core");
vi.mock("@/fn/certification/sources", () => ({
  collectCandidateDocumentIdsForRemoval: vi.fn(async () => []),
  resolveSourceIdsForRemoval: vi.fn(async () => []),
}));

import { db } from "@/db";
import {
  certificationSubmissions,
  certifierProjects,
  certifierRemovals,
  certifierSyncEvents,
} from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import type { CertifierProjectRow } from "@/data-access/certification";
import * as certifyContext from "@/fn/certification/certify-context-core";
import * as sources from "@/fn/certification/sources";
import { submitRemoval } from "@/fn/certification/submit-removal";
import { SafeError } from "@/lib/errors";
import {
  buildRemovalSupplierRef,
  IsometricApiError,
  type IsometricComponentBlueprint,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import { MAPPING_REVISION } from "@/lib/isometric/transformers/datapoint";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import type { ProductionRun, Sample } from "@/db/schema";
import {
  installFakeRegistry,
  type FakeIsometricRegistry,
} from "./fixtures/fake-registry";

const USER_ID = "test-user-boundary";
const TEMPLATE_ID = "rvt_boundary_1";
const RTC_ID = "rtc-seq";
const PRODUCTION_RUN_ID = "pr-boundary-1";
const ORIGINAL_BIOCHAR_MASS_KG = 1000;
const CHANGED_BIOCHAR_MASS_KG = 1500;
const STALE_LOCK_OFFSET_MS = LOCK_TTL_MS + 60_000;

const createdFacilityIds: string[] = [];
const createdRemovalIds: string[] = [];

afterAll(async () => {
  if (createdRemovalIds.length > 0) {
    await db
      .delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.localEntityId, createdRemovalIds));
    await db
      .delete(certifierSyncEvents)
      .where(inArray(certifierSyncEvents.entityId, createdRemovalIds));
    await db
      .delete(certifierRemovals)
      .where(inArray(certifierRemovals.id, createdRemovalIds));
  }
  if (createdFacilityIds.length === 0) return;
  await db
    .delete(certifierProjects)
    .where(inArray(certifierProjects.facilityId, createdFacilityIds));
  await db.delete(facilities).where(inArray(facilities.id, createdFacilityIds));
});

// ---------------------------------------------------------------------------
// DB fixture — the real rows the claim module locks and the ledger writes
// against: a facility, its certifier mapping, and the removal.
// ---------------------------------------------------------------------------

interface Fixture {
  facilityId: string;
  removalId: string;
  externalProjectId: string;
}

async function createFixture(): Promise<Fixture> {
  const runId = crypto.randomUUID().slice(0, 8);
  const externalProjectId = `prj_boundary_${runId}`;
  const [facility] = await db
    .insert(facilities)
    .values({ name: `Boundary Facility ${runId}`, code: `FAC-BD-${runId}` })
    .returning({ id: facilities.id });
  createdFacilityIds.push(facility.id);
  await db.insert(certifierProjects).values({
    facilityId: facility.id,
    provider: "isometric",
    externalProjectId,
    defaultRemovalTemplateId: TEMPLATE_ID,
  });
  const [removal] = await db
    .insert(certifierRemovals)
    .values({ facilityId: facility.id, provider: "isometric" })
    .returning({ id: certifierRemovals.id });
  createdRemovalIds.push(removal.id);
  return { facilityId: facility.id, removalId: removal.id, externalProjectId };
}

// ---------------------------------------------------------------------------
// Context fixture — a two-monitored-input template (carbon_content +
// product_mass on one component) so a mid-attempt datapoint failure leaves a
// *remaining* datapoint for the resume to POST. Adapted from
// tests/isometric-submit-removal.test.ts.
// ---------------------------------------------------------------------------

function makeTemplate(): IsometricGhgEntryTemplate {
  return {
    id: TEMPLATE_ID,
    name: "Boundary removal template",
    display_name: "Boundary removal template",
    credit_type: "REMOVAL",
    groups: [
      {
        id: "grp-1",
        key: "co2-stored",
        name: "CO2 stored",
        components: [
          {
            id: RTC_ID,
            blueprint_key: "carbon_rich_substance_sequestration",
            display_name: "Sequestered biochar",
            inputs: [
              {
                type: "monitored",
                input_key: "carbon_content",
                datapoint_id: null,
                display_name: "Carbon content",
                quantity_kind: "dimensionless",
              },
              {
                type: "monitored",
                input_key: "product_mass",
                datapoint_id: null,
                display_name: "Product mass",
                quantity_kind: "mass",
              },
            ],
          },
        ],
      },
    ],
  } as unknown as IsometricGhgEntryTemplate;
}

function makeBlueprints(): IsometricComponentBlueprint[] {
  return [
    {
      key: "carbon_rich_substance_sequestration",
      display_name: "Carbon-rich substance sequestration",
      description: "",
      inputs: [
        {
          input_key: "carbon_content",
          quantity_kind: "dimensionless",
          compatible_unit: "dimensionless",
          data_shape: "SCALAR",
          description: "",
        },
        {
          input_key: "product_mass",
          quantity_kind: "mass",
          compatible_unit: "kg",
          data_shape: "SCALAR",
          description: "",
        },
      ],
    } as unknown as IsometricComponentBlueprint,
  ];
}

function makeMapping(fixture: Fixture): CertifierProjectRow {
  return {
    id: "cert-proj-boundary",
    facilityId: fixture.facilityId,
    provider: "isometric",
    externalProjectId: fixture.externalProjectId,
    protocolSlug: "biochar",
    protocolVersion: "1.2",
    defaultRemovalTemplateId: TEMPLATE_ID,
    webhookSecret: null,
    metadata: null,
    gensetEnergyYieldKwhPerLitre: 3.375,
    stageSplitBiomassPct: 32.2,
    stageSplitPyrolysisPct: 58.5,
    stageSplitBiocharPct: 9.3,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CertifierProjectRow;
}

function makeRun(biocharMassKg: number): ProductionRun & { samples: Sample[] } {
  return {
    id: PRODUCTION_RUN_ID,
    code: "PR-BD-001",
    facilityId: "fac-irrelevant",
    reactorId: "rct-irrelevant",
    biocharDryMassKg: biocharMassKg,
    feedstockMassDryKg: 4000,
    dieselOperationLiters: 0,
    dieselGensetLiters: 0,
    preprocessingFuelLiters: 0,
    electricityKwh: 0,
    startTime: new Date("2026-01-01T00:00:00Z"),
    endTime: new Date("2026-01-31T23:59:59Z"),
    samples: [
      {
        id: "smp-bd-1",
        productionRunId: PRODUCTION_RUN_ID,
        organicCarbonPercent: 80,
        hToCOrgRatio: 0.4,
        oToCOrgRatio: 0.2,
        ashContentPercent: 5,
        moistureContentPercent: 10,
      } as unknown as Sample,
    ],
  } as unknown as ProductionRun & { samples: Sample[] };
}

function makeContext(
  fixture: Fixture,
  biocharMassKg = ORIGINAL_BIOCHAR_MASS_KG,
): certifyContext.RemovalSubmissionContext {
  const emptyCoverage = {
    count: 0,
    entityIds: [],
    legIds: [],
    firstLegEntityId: null,
    aggregationWarning: null,
  };
  return {
    facilityId: fixture.facilityId,
    removalId: fixture.removalId,
    mapping: makeMapping(fixture),
    project: { id: fixture.externalProjectId, name: "Boundary project" } as never,
    defaultTemplate: makeTemplate(),
    missingDefaultTemplateId: null,
    blueprintsForTemplate: makeBlueprints(),
    unresolvedBlueprintKeys: [],
    memberBatches: [{ id: crypto.randomUUID(), code: "CB-BD-001" }],
    transportCoverage: {
      feedstock: emptyCoverage,
      biochar: emptyCoverage,
      sample: emptyCoverage,
    },
    requiredTransportCategories: [],
    hasSubmittableRuns: true,
    runSummary: {
      runCount: 1,
      totalBiocharOutputKg: biocharMassKg,
      appliedDryKg: biocharMassKg,
    },
    latestSubmission: null,
    linkedGhgStatement: null,
    isProduction: false,
    lineages: [
      {
        facility: { id: fixture.facilityId, code: "F", name: "F" },
        application: {
          id: "app-bd-1",
          code: "APP-BD-001",
          biocharAppliedDryTons: biocharMassKg / 1000,
        } as never,
        delivery: { id: "del-bd-1" } as never,
        order: null,
        biocharProduct: { id: "bp-bd-1" } as never,
        productionRun: { id: PRODUCTION_RUN_ID } as never,
        reactor: null,
        feedstocks: [],
        warnings: [],
      } as never,
    ],
    runs: [makeRun(biocharMassKg)],
    attributionByRunId: new Map([[PRODUCTION_RUN_ID, 1]]),
    transportLegs: { feedstock: [], biochar: [], sample: [] },
  };
}

function setContext(fixture: Fixture, biocharMassKg?: number): void {
  vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
    makeContext(fixture, biocharMassKg),
  );
}

// ---------------------------------------------------------------------------
// DB helpers.
// ---------------------------------------------------------------------------

async function listRows(removalId: string) {
  return db
    .select()
    .from(certificationSubmissions)
    .where(eq(certificationSubmissions.localEntityId, removalId))
    .orderBy(certificationSubmissions.version);
}

async function listSyncEvents(removalId: string) {
  return db
    .select()
    .from(certifierSyncEvents)
    .where(eq(certifierSyncEvents.entityId, removalId))
    .orderBy(certifierSyncEvents.attemptedAt);
}

// A failed attempt leaves the draft row locked; the next claim treats it as
// in-flight until the TTL passes. Tests jump the clock by back-dating the
// lock, like the claim module's own DB suite.
async function staleifyLock(rowId: string): Promise<void> {
  await db
    .update(certificationSubmissions)
    .set({ lockedAt: new Date(Date.now() - STALE_LOCK_OFFSET_MS) })
    .where(eq(certificationSubmissions.id, rowId));
}

function datapointRef(removalId: string, inputKey: string, version: number) {
  return buildRemovalSupplierRef({
    removalId,
    role: "datapoint",
    version,
    inputKey: `${RTC_ID}-${inputKey}`,
  });
}

let registry: FakeIsometricRegistry;

beforeEach(() => {
  registry = installFakeRegistry();
  // restoreMocks resets factory-installed implementations after each test.
  vi.mocked(sources.collectCandidateDocumentIdsForRemoval).mockResolvedValue(
    [],
  );
  vi.mocked(sources.resolveSourceIdsForRemoval).mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("submitRemoval boundary — datapoint orphan (test 1)", () => {
  it("resume reconciles the dropped datapoint by supplier ref and POSTs only the remaining ones", async () => {
    const fixture = await createFixture();
    setContext(fixture);
    // First datapoint POST commits server-side but the client sees a network
    // error; the in-attempt lookup is also down, so the attempt fails and
    // leaves a locked draft + a registry orphan.
    registry.failNext("POST /datapoints", "drop-after-commit");
    registry.failNext("GET /datapoints", "reject-before-commit", {
      status: 503,
    });

    await expect(
      submitRemoval({ userId: USER_ID, removalId: fixture.removalId }),
    ).rejects.toBeInstanceOf(IsometricApiError);

    // The registry committed the first datapoint despite the client-visible
    // failure — the orphan the resume must NOT re-POST.
    expect(registry.datapoints).toHaveLength(1);
    expect(registry.datapoints[0].supplier_reference_id).toBe(
      datapointRef(fixture.removalId, "carbon_content", 1),
    );
    expect(registry.ghgEntries).toHaveLength(0);

    let rows = await listRows(fixture.removalId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("draft");
    expect(rows[0].lockedAt).not.toBeNull();

    await staleifyLock(rows[0].id);
    setContext(fixture);

    const result = await submitRemoval({
      userId: USER_ID,
      removalId: fixture.removalId,
    });

    // Exactly one of each — the double-submit guard asserted end-to-end.
    expect(registry.datapoints).toHaveLength(2);
    expect(
      registry.datapoints.map((d) => d.supplier_reference_id).sort(),
    ).toEqual(
      [
        datapointRef(fixture.removalId, "carbon_content", 1),
        datapointRef(fixture.removalId, "product_mass", 1),
      ].sort(),
    );
    expect(registry.ghgEntries).toHaveLength(1);

    // The orphan was claimed by lookup, not re-POSTed: two datapoint POSTs
    // total (one per input across BOTH attempts), one removal POST.
    expect(registry.requestCount("POST", "/datapoints")).toBe(2);
    expect(registry.requestCount("POST", "/ghg_entries")).toBe(1);

    rows = await listRows(fixture.removalId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: 1,
      status: "submitted",
      externalId: registry.ghgEntries[0].id,
    });
    expect(result).toMatchObject({
      removalId: fixture.removalId,
      externalId: registry.ghgEntries[0].id,
      version: 1,
    });

    const operations = (await listSyncEvents(fixture.removalId)).map(
      (event) => `${event.operation}:${event.status}`,
    );
    expect(operations).toContain(
      "datapoint:create:carbon_content:reconciled:succeeded",
    );
    expect(operations).toContain("datapoint:create:product_mass:succeeded");
    expect(operations).toContain("removal:create:succeeded");
    expect(operations).toContain("removal:create:resumed:succeeded");
  });
});

describe("submitRemoval boundary — removal orphan (test 2)", () => {
  it("resume reconciles the dropped removal by supplier ref instead of POSTing again", async () => {
    const fixture = await createFixture();
    setContext(fixture);
    registry.failNext("POST /ghg_entries", "drop-after-commit");
    registry.failNext("GET /ghg_entries", "reject-before-commit", {
      status: 503,
    });

    await expect(
      submitRemoval({ userId: USER_ID, removalId: fixture.removalId }),
    ).rejects.toBeInstanceOf(IsometricApiError);

    // Both datapoints and the removal are committed server-side; only the
    // client's view failed.
    expect(registry.datapoints).toHaveLength(2);
    expect(registry.ghgEntries).toHaveLength(1);
    const orphanRemovalId = registry.ghgEntries[0].id;

    const [draft] = await listRows(fixture.removalId);
    expect(draft.status).toBe("draft");
    await staleifyLock(draft.id);
    setContext(fixture);

    const result = await submitRemoval({
      userId: USER_ID,
      removalId: fixture.removalId,
    });

    // Still exactly one removal; no second POST anywhere.
    expect(registry.ghgEntries).toHaveLength(1);
    expect(registry.datapoints).toHaveLength(2);
    expect(registry.requestCount("POST", "/ghg_entries")).toBe(1);
    expect(registry.requestCount("POST", "/datapoints")).toBe(2);
    expect(result.externalId).toBe(orphanRemovalId);

    const rows = await listRows(fixture.removalId);
    expect(rows[0]).toMatchObject({
      status: "submitted",
      externalId: orphanRemovalId,
    });

    const operations = (await listSyncEvents(fixture.removalId)).map(
      (event) => `${event.operation}:${event.status}`,
    );
    expect(operations).toContain("removal:create:reconciled:succeeded");
    expect(operations).toContain("removal:create:resumed:succeeded");
  });

  it("refuses to resume when the stored fixed-input snapshot is malformed (fail loud, no POSTs)", async () => {
    const fixture = await createFixture();
    setContext(fixture);
    registry.failNext("POST /ghg_entries", "drop-after-commit");
    registry.failNext("GET /ghg_entries", "reject-before-commit", {
      status: 503,
    });

    await expect(
      submitRemoval({ userId: USER_ID, removalId: fixture.removalId }),
    ).rejects.toBeInstanceOf(IsometricApiError);
    const postsAfterFirstAttempt =
      registry.requestCount("POST", "/datapoints") +
      registry.requestCount("POST", "/ghg_entries");

    // The stored snapshot drifted (e.g. written by an earlier deploy): a
    // kind:"fixed" entry lost its pre-bound datapoint id. The resume must
    // refuse rather than emit a GHG entry referencing a wrong/absent
    // datapoint — readRemovalFixedInputs' fail-loud contract.
    const [draft] = await listRows(fixture.removalId);
    const snapshot = draft.payloadSnapshot as {
      semantic: { inputs: unknown[] };
    };
    snapshot.semantic.inputs = [
      ...snapshot.semantic.inputs,
      { rtcId: RTC_ID, inputKey: "drifted_fixed", kind: "fixed" },
    ];
    await db
      .update(certificationSubmissions)
      .set({
        payloadSnapshot: snapshot as Record<string, unknown>,
        lockedAt: new Date(Date.now() - STALE_LOCK_OFFSET_MS),
      })
      .where(eq(certificationSubmissions.id, draft.id));
    setContext(fixture);

    await expect(
      submitRemoval({ userId: USER_ID, removalId: fixture.removalId }),
    ).rejects.toThrowError(
      new SafeError(
        "Stale submission cannot be resumed because its fixed-input snapshot does not match the current schema.",
      ),
    );

    // Nothing was POSTed by the refused resume.
    expect(
      registry.requestCount("POST", "/datapoints") +
        registry.requestCount("POST", "/ghg_entries"),
    ).toBe(postsAfterFirstAttempt);
  });

  it("recovers within the SAME attempt when the post-failure lookup works", async () => {
    const fixture = await createFixture();
    setContext(fixture);
    // Drop after commit, but leave the lookup healthy: performRegistryCreate
    // reconciles immediately and the submission succeeds first try.
    registry.failNext("POST /ghg_entries", "drop-after-commit");

    const result = await submitRemoval({
      userId: USER_ID,
      removalId: fixture.removalId,
    });

    expect(registry.ghgEntries).toHaveLength(1);
    expect(registry.requestCount("POST", "/ghg_entries")).toBe(1);
    expect(result.externalId).toBe(registry.ghgEntries[0].id);

    const rows = await listRows(fixture.removalId);
    expect(rows[0]).toMatchObject({
      version: 1,
      status: "submitted",
      externalId: registry.ghgEntries[0].id,
    });

    const operations = (await listSyncEvents(fixture.removalId)).map(
      (event) => `${event.operation}:${event.status}`,
    );
    expect(operations).toContain("removal:create:reconciled:succeeded");
  });
});

describe("submitRemoval boundary — rejected create (test 4)", () => {
  it("rejects the row and records the registry's 4xx body on the failed sync event", async () => {
    const fixture = await createFixture();
    setContext(fixture);
    const registryBody = {
      errors: [{ detail: "quantity must be positive (injected)" }],
    };
    registry.failNext("POST /ghg_entries", "reject-before-commit", {
      status: 422,
      body: registryBody,
    });

    await expect(
      submitRemoval({ userId: USER_ID, removalId: fixture.removalId }),
    ).rejects.toThrowError(SafeError);

    // The registry never created the removal, and the lookup confirmed it.
    expect(registry.ghgEntries).toHaveLength(0);
    expect(registry.requestCount("GET", "/ghg_entries")).toBe(1);

    const rows = await listRows(fixture.removalId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("rejected");
    expect(rows[0].externalId).toBeNull();
    expect(rows[0].metadata).toMatchObject({
      lastError: expect.stringContaining("422"),
    });

    const failed = (await listSyncEvents(fixture.removalId)).find(
      (event) =>
        event.operation === "removal:create" && event.status === "failed",
    );
    expect(failed).toBeDefined();
    // The Phase 2 behavior change asserted at the boundary: the failure
    // event preserves the registry's response body alongside the mapping
    // revision that produced the payload.
    expect(failed!.responsePayload).toEqual({
      mapping_revision: MAPPING_REVISION,
      body: registryBody,
    });
    expect(failed!.errorMessage).toContain("422");
    expect(failed!.requestPayload).toMatchObject({
      project_id: fixture.externalProjectId,
    });
  });
});

describe("submitRemoval boundary — hash supersede (test 5)", () => {
  it("a payload change mints v2 with version-distinct supplier refs and supersedes v1", async () => {
    const fixture = await createFixture();
    setContext(fixture, ORIGINAL_BIOCHAR_MASS_KG);

    const first = await submitRemoval({
      userId: USER_ID,
      removalId: fixture.removalId,
    });
    expect(first.version).toBe(1);

    setContext(fixture, CHANGED_BIOCHAR_MASS_KG);
    const second = await submitRemoval({
      userId: USER_ID,
      removalId: fixture.removalId,
    });
    expect(second.version).toBe(2);
    expect(second.externalId).not.toBe(first.externalId);

    // The registry holds BOTH removals — supersede is a local-ledger
    // concept; the supplier ref carries the version so v2 claims a fresh
    // registry resource instead of colliding with v1.
    expect(registry.ghgEntries).toHaveLength(2);
    expect(
      registry.ghgEntries.map((entry) => entry.supplier_reference_id).sort(),
    ).toEqual(
      [
        buildRemovalSupplierRef({
          removalId: fixture.removalId,
          role: "removal",
          version: 1,
        }),
        buildRemovalSupplierRef({
          removalId: fixture.removalId,
          role: "removal",
          version: 2,
        }),
      ].sort(),
    );
    expect(registry.datapoints).toHaveLength(4);
    expect(
      new Set(registry.datapoints.map((d) => d.supplier_reference_id)).size,
    ).toBe(4);

    const rows = await listRows(fixture.removalId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ version: 1, status: "superseded" });
    expect(rows[0].supersededAt).not.toBeNull();
    expect(rows[1]).toMatchObject({
      version: 2,
      status: "submitted",
      externalId: second.externalId,
    });
  });
});
