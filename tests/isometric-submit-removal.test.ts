/**
 * Happy-path orchestrator test for `submitRemoval`.
 *
 * Exercises the full Phase 3 submit pipeline end-to-end with the data-access
 * + Isometric HTTP boundaries faked but the orchestrator's transformers,
 * idempotency ledger logic, and payload construction running for real. The
 * other isometric-* tests cover the individual pieces (transformers,
 * payload-hash, submission-claim, certify-context); this one proves they
 * wire together correctly under `submitRemoval`.
 *
 * Coverage:
 *   1. First submit  → ledger draft → datapoint POST → removal POST →
 *                       ledger 'submitted' with externalId.
 *   2. Re-submit, no source change → `return-existing`, no new POSTs.
 *   3. Re-submit after a source change → supersede prior row, POST v=2.
 *
 * Out of scope (left to dedicated tests): partial-failure reconciliation,
 * the resume-from-locked-draft path, fixed-constant resolution, and the
 * sandbox/production gating switch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CertificationSubmissionRow,
  CertifierProjectRow,
  InsertDraftSubmissionInput,
} from "@/data-access/certification";
import type {
  IsometricComponentBlueprint,
  IsometricRemovalTemplate,
} from "@/lib/isometric";
import type {
  ProductionRun,
  Sample,
} from "@/db/schema";

// ---------------------------------------------------------------------------
// Module mocks — declared before importing the system under test so the mocks
// are in place when its top-level imports resolve.
// ---------------------------------------------------------------------------

vi.mock("@/data-access/certification");
vi.mock("@/data-access/certifier-removals");
vi.mock("@/fn/certification/certify-context");
vi.mock("@/lib/isometric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/isometric")>();
  return {
    ...actual,
    createDatapoint: vi.fn(),
    createRemoval: vi.fn(),
    reconcileDatapoint: vi.fn(),
    reconcileRemoval: vi.fn(),
  };
});

import * as ledger from "@/data-access/certification";
import * as removalsDA from "@/data-access/certifier-removals";
import * as certifyContext from "@/fn/certification/certify-context";
import * as isometric from "@/lib/isometric";
import { submitRemoval } from "@/fn/certification/submit-removal";

// ---------------------------------------------------------------------------
// Constants used by the fakes + assertions.
// ---------------------------------------------------------------------------

const USER_ID = "user-test-1";
const FACILITY_ID = "fac-test-1";
const REMOVAL_ID = "rem-test-1";
const CREDIT_BATCH_ID = "cb-test-1";
const APPLICATION_ID = "app-test-1";
const PRODUCTION_RUN_ID = "pr-test-1";
const EXTERNAL_PROJECT_ID = "prj_test_1";
const TEMPLATE_ID = "rvt_test_1";
const RTC_PRODUCT_MASS_ID = "rtc-product-mass";

const ORIGINAL_BIOCHAR_MASS_KG = 1000;
const CHANGED_BIOCHAR_MASS_KG = 1500;

// ---------------------------------------------------------------------------
// In-memory ledger simulator. Mirrors the (provider, submissionType,
// localEntityType, localEntityId) → versioned-row index that the real
// data-access layer reads through. Kept small on purpose — `submitRemoval`
// only ever exercises the latest-version lookup + insert/update transitions.
// ---------------------------------------------------------------------------

let storedRows: CertificationSubmissionRow[];
let nextLedgerRowId = 1;

function newLedgerRow(
  input: InsertDraftSubmissionInput,
): CertificationSubmissionRow {
  return {
    id: `sub-${nextLedgerRowId++}`,
    provider: input.provider,
    submissionType: input.submissionType,
    localEntityType: input.localEntityType,
    localEntityId: input.localEntityId,
    version: input.version,
    status: "draft",
    externalId: null,
    payloadSnapshot: input.payloadSnapshot as Record<string, unknown>,
    payloadHash: input.payloadHash,
    metadata: (input.metadata ?? null) as Record<string, unknown> | null,
    submittedAt: null,
    lockedAt: new Date(),
    supersededAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CertificationSubmissionRow;
}

// ---------------------------------------------------------------------------
// Domain fixtures — a one-component template and a single production run.
// Choosing `product_mass` keeps the test independent of transport legs and
// the per-stage energy split (which need their own fixtures).
// ---------------------------------------------------------------------------

function makeTemplate(): IsometricRemovalTemplate {
  return {
    id: TEMPLATE_ID,
    name: "Test removal template",
    display_name: "Test removal template",
    groups: [
      {
        id: "grp-1",
        key: "co2-stored",
        name: "CO2 stored",
        components: [
          {
            id: RTC_PRODUCT_MASS_ID,
            blueprint_key: "carbon_rich_substance_sequestration",
            display_name: "Sequestered biochar",
            inputs: [
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
  } as unknown as IsometricRemovalTemplate;
}

function makeBlueprints(): IsometricComponentBlueprint[] {
  return [
    {
      key: "carbon_rich_substance_sequestration",
      display_name: "Carbon-rich substance sequestration",
      description: "",
      inputs: [
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

function makeMapping(): CertifierProjectRow {
  return {
    id: "cert-proj-1",
    facilityId: FACILITY_ID,
    provider: "isometric",
    externalProjectId: EXTERNAL_PROJECT_ID,
    protocolSlug: "biochar",
    protocolVersion: "1.2",
    defaultRemovalTemplateId: TEMPLATE_ID,
    webhookSecret: null,
    metadata: null,
    // Phase 3.7 emission-estimate config — required by
    // `resolveFacilityEmissionConfig`. Per-stage energy is not consumed by
    // this template (no electricity / genset inputs) but the values must be
    // valid so the validator doesn't bail.
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
    code: "PR-TEST-001",
    facilityId: FACILITY_ID,
    reactorId: "rct-test-1",
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
        id: "smp-test-1",
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
  biocharMassKg = ORIGINAL_BIOCHAR_MASS_KG,
): certifyContext.RemovalSubmissionContext {
  const latest = storedLatest();
  return {
    facilityId: FACILITY_ID,
    removalId: REMOVAL_ID,
    mapping: makeMapping(),
    project: { id: EXTERNAL_PROJECT_ID, name: "Test project" } as never,
    defaultTemplate: makeTemplate(),
    missingDefaultTemplateId: null,
    blueprintsForTemplate: makeBlueprints(),
    unresolvedBlueprintKeys: [],
    memberBatches: [{ id: CREDIT_BATCH_ID, code: "CB-TEST-001" }],
    transportCoverage: {
      feedstock: { count: 0, entityIds: [], aggregationWarning: null },
      biochar: { count: 0, entityIds: [], aggregationWarning: null },
      sample: { count: 0, entityIds: [], aggregationWarning: null },
    },
    requiredTransportCategories: [],
    latestSubmission: latest,
    isProduction: false,
    lineages: [
      {
        facility: { id: FACILITY_ID, code: "F", name: "F" },
        application: {
          id: APPLICATION_ID,
          code: "APP-TEST-001",
          biocharAppliedDryTons: biocharMassKg / 1000,
        } as never,
        delivery: { id: "del-1" } as never,
        order: null,
        biocharProduct: { id: "bp-1" } as never,
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

// Helper: latest row for THIS removal's submission key. The orchestrator's
// idempotency branching reads exactly this row.
function storedLatest(): CertificationSubmissionRow | null {
  const matching = storedRows.filter(
    (row) =>
      row.provider === "isometric" &&
      row.submissionType === "removal" &&
      row.localEntityType === "removal" &&
      row.localEntityId === REMOVAL_ID,
  );
  if (matching.length === 0) return null;
  return matching.sort((a, b) => b.version - a.version)[0];
}

// ---------------------------------------------------------------------------
// Wire the fakes onto the mocked modules.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  storedRows = [];
  nextLedgerRowId = 1;

  vi.mocked(ledger.getLatestSubmission).mockImplementation(async () =>
    storedLatest(),
  );
  vi.mocked(ledger.insertDraftSubmissionWithMappingLock).mockImplementation(
    async (_userId, input) => {
      const row = newLedgerRow(input);
      storedRows.push(row);
      return row;
    },
  );
  vi.mocked(ledger.resetSubmissionToDraftWithMappingLock).mockImplementation(
    async (_userId, rowId) => {
      const row = storedRows.find((r) => r.id === rowId);
      if (!row) throw new Error(`Test ledger missing row ${rowId}`);
      row.status = "draft";
      row.lockedAt = new Date();
      return row;
    },
  );
  vi.mocked(ledger.markSubmissionSubmitted).mockImplementation(
    async (_userId, id, args) => {
      const row = storedRows.find((r) => r.id === id);
      if (row) {
        row.status = "submitted";
        row.externalId = args.externalId;
        row.submittedAt = new Date();
        row.lockedAt = null;
      }
      if (args.supersedePreviousId) {
        const prev = storedRows.find((r) => r.id === args.supersedePreviousId);
        if (prev) {
          prev.status = "superseded";
          prev.supersededAt = new Date();
        }
      }
    },
  );
  vi.mocked(ledger.markSubmissionRejected).mockImplementation(
    async (_userId, id) => {
      const row = storedRows.find((r) => r.id === id);
      if (row) {
        row.status = "rejected";
        row.lockedAt = null;
      }
    },
  );
  vi.mocked(ledger.appendSyncEvent).mockResolvedValue(undefined as never);
  vi.mocked(removalsDA.updateRemovalDates).mockResolvedValue(
    undefined as never,
  );

  vi.mocked(isometric.reconcileDatapoint).mockResolvedValue({ found: false });
  vi.mocked(isometric.reconcileRemoval).mockResolvedValue({ found: false });
});

// Returns a unique fake external id per HTTP call so the orchestrator's
// per-call recording can be inspected by id.
function fakeExternalIds(prefix: string): () => Promise<{ id: string }> {
  let n = 0;
  return async () => ({ id: `${prefix}_${++n}` });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("submitRemoval — happy path", () => {
  it("inserts a v=1 draft, POSTs one datapoint + the removal, then marks the ledger submitted", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    const createDatapointFake = vi.fn(fakeExternalIds("dp"));
    const createRemovalFake = vi.fn(fakeExternalIds("rmv"));
    vi.mocked(isometric.createDatapoint).mockImplementation(
      createDatapointFake as never,
    );
    vi.mocked(isometric.createRemoval).mockImplementation(
      createRemovalFake as never,
    );

    const result = await submitRemoval({ userId: USER_ID, removalId: REMOVAL_ID });

    // Ledger transitioned draft → submitted; externalId matches the fake.
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]).toMatchObject({
      version: 1,
      status: "submitted",
      externalId: "rmv_1",
    });
    expect(result).toMatchObject({
      removalId: REMOVAL_ID,
      externalId: "rmv_1",
      version: 1,
    });

    // One datapoint POST (the only monitored input) + one removal POST.
    expect(createDatapointFake).toHaveBeenCalledTimes(1);
    expect(createRemovalFake).toHaveBeenCalledTimes(1);

    // Datapoint payload reflects the aggregated product mass + the input's
    // unit/quantity-kind mapping. Per `INPUT_MAPPING` for
    // co2-stored/carbon_rich_substance_sequestration/product_mass. Read
    // through the mocked module so vitest preserves the upstream call type.
    const datapointBody = vi.mocked(isometric.createDatapoint).mock.calls[0][0];
    expect(datapointBody).toMatchObject({
      project_id: EXTERNAL_PROJECT_ID,
      type: "REPORTED",
      quantity: { magnitude: ORIGINAL_BIOCHAR_MASS_KG, unit: "kg" },
    });
    expect(datapointBody.supplier_reference_id).toMatch(/^nm-/);

    // Removal payload wires the datapoint id back onto the component.
    const removalBody = vi.mocked(isometric.createRemoval).mock.calls[0][0];
    expect(removalBody).toMatchObject({
      project_id: EXTERNAL_PROJECT_ID,
      removal_template_id: TEMPLATE_ID,
      started_on: "2026-01-01",
      completed_on: "2026-01-31",
    });
    expect(removalBody.removal_template_components ?? []).toHaveLength(1);
    expect(removalBody.removal_template_components?.[0]).toMatchObject({
      removal_template_component_id: RTC_PRODUCT_MASS_ID,
      inputs: [
        {
          __typename: "CreateComponentScalarInput",
          datapoint_id: "dp_1",
          input_key: "product_mass",
        },
      ],
    });

    // Reporting window was persisted onto the removal row.
    expect(removalsDA.updateRemovalDates).toHaveBeenCalledWith(
      USER_ID,
      REMOVAL_ID,
      { startedOn: "2026-01-01", completedOn: "2026-01-31" },
    );
  });

  it("re-submitting with identical source data returns the existing externalId and POSTs nothing new", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
    vi.mocked(isometric.createRemoval).mockImplementation(
      fakeExternalIds("rmv") as never,
    );

    await submitRemoval({ userId: USER_ID, removalId: REMOVAL_ID });

    // Reset the HTTP spies — the second submit must not call them.
    vi.mocked(isometric.createDatapoint).mockClear();
    vi.mocked(isometric.createRemoval).mockClear();
    // The fresh context now carries the latest submitted row from the first
    // call, which is what `decideSubmissionClaim` reads to recognise the
    // already-submitted state.
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );

    const second = await submitRemoval({
      userId: USER_ID,
      removalId: REMOVAL_ID,
    });

    expect(second.externalId).toBe("rmv_1");
    expect(second.version).toBe(1);
    expect(isometric.createDatapoint).not.toHaveBeenCalled();
    expect(isometric.createRemoval).not.toHaveBeenCalled();
    // No new ledger row.
    expect(storedRows).toHaveLength(1);
  });

  it("supersedes to v=2 when the aggregated source data changes between submits", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(ORIGINAL_BIOCHAR_MASS_KG),
    );
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
    vi.mocked(isometric.createRemoval).mockImplementation(
      fakeExternalIds("rmv") as never,
    );

    await submitRemoval({ userId: USER_ID, removalId: REMOVAL_ID });
    const firstRowId = storedRows[0].id;

    // Second submit sees a changed run mass → a different payload hash →
    // `create-new-version` with `supersedePreviousId` set.
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(CHANGED_BIOCHAR_MASS_KG),
    );

    const second = await submitRemoval({
      userId: USER_ID,
      removalId: REMOVAL_ID,
    });

    expect(second.version).toBe(2);
    expect(second.externalId).toBe("rmv_2");

    expect(storedRows).toHaveLength(2);
    const v1 = storedRows.find((r) => r.id === firstRowId)!;
    const v2 = storedRows.find((r) => r.id !== firstRowId)!;
    expect(v1.status).toBe("superseded");
    expect(v1.supersededAt).not.toBeNull();
    expect(v2).toMatchObject({
      version: 2,
      status: "submitted",
      externalId: "rmv_2",
    });

    // The v=2 datapoint payload reflects the new mass.
    const datapointCalls = vi.mocked(isometric.createDatapoint).mock.calls;
    expect(datapointCalls).toHaveLength(2);
    expect(datapointCalls[1][0].quantity).toEqual({
      magnitude: CHANGED_BIOCHAR_MASS_KG,
      unit: "kg",
    });
  });
});
