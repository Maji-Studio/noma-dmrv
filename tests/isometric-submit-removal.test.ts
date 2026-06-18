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
} from "@/data-access/certification";
import type { InsertDraftSubmissionInput } from "@/data-access/certification-submissions";
import type {
  IsometricComponentBlueprint,
  IsometricGhgEntryTemplate,
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
vi.mock("@/data-access/certification-submissions");
vi.mock("@/data-access/certifier-removals");
vi.mock("@/fn/certification/certify-context-core");
// Phase 3.5: submitRemoval now resolves mirrored Source IDs before
// hashing. The default-empty mock keeps the pre-Phase-3.5 assertions
// (`source_ids: []` on every Datapoint) valid; specific Phase 3.5 tests
// override the mock to inject sources and assert hash supersede.
vi.mock("@/fn/certification/sources", async () => {
  return {
    collectCandidateDocumentIdsForRemoval: vi.fn(async () => []),
    resolveSourceIdsForRemoval: vi.fn(async () => []),
  };
});
// D3 durability gates read each run's reactor sampling method. Default the
// fixture reactor to Method A; the fixture run carries a fully eligible,
// ≥3-replicate sample set so the gates pass.
vi.mock("@/data-access/reactors", () => {
  return {
    getSamplingMethodsByReactorIds: vi.fn(
      async () => new Map([["rct-test-1", "method_a"]]),
    ),
  };
});
vi.mock("@/lib/isometric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/isometric")>();
  return {
    ...actual,
    createDatapoint: vi.fn(),
    createGhgEntry: vi.fn(),
    reconcileDatapoint: vi.fn(),
    reconcileRemoval: vi.fn(),
  };
});

import * as ledger from "@/data-access/certification";
import * as ledgerClaim from "@/data-access/certification-submissions";
import * as removalsDA from "@/data-access/certifier-removals";
import * as certifyContext from "@/fn/certification/certify-context-core";
import * as isometric from "@/lib/isometric";
import { submitRemoval } from "@/fn/certification/submit-removal";
import { makeClaimSubmissionDraftFake } from "./fixtures/fake-claim";

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

function makeTemplate(): IsometricGhgEntryTemplate {
  return {
    id: TEMPLATE_ID,
    name: "Test removal template",
    display_name: "Test removal template",
    // submitRemoval refuses non-REMOVAL templates (credit_type guard).
    credit_type: "REMOVAL",
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

function makeRun(
  biocharMassKg: number,
): ProductionRun & { samples: Sample[]; readingsCount: number } {
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
    readingsCount: 1,
    // Three eligible replicates (H/C_org < 0.5, O/C_org < 0.2) so the D3
    // durability gates pass. organicCarbonPercent stays 80 across replicates so
    // the weighted carbon datapoint magnitude is unchanged.
    samples: [
      {
        id: "smp-test-1",
        productionRunId: PRODUCTION_RUN_ID,
        organicCarbonPercent: 80,
        hToCOrgRatio: 0.4,
        oToCOrgRatio: 0.15,
        ashContentPercent: 5,
        moistureContentPercent: 10,
      } as unknown as Sample,
      {
        id: "smp-test-2",
        productionRunId: PRODUCTION_RUN_ID,
        organicCarbonPercent: 80,
        hToCOrgRatio: 0.41,
        oToCOrgRatio: 0.16,
        ashContentPercent: 5,
        moistureContentPercent: 10,
      } as unknown as Sample,
      {
        id: "smp-test-3",
        productionRunId: PRODUCTION_RUN_ID,
        organicCarbonPercent: 80,
        hToCOrgRatio: 0.39,
        oToCOrgRatio: 0.14,
        ashContentPercent: 5,
        moistureContentPercent: 10,
      } as unknown as Sample,
    ],
  } as unknown as ProductionRun & { samples: Sample[]; readingsCount: number };
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
      feedstock: {
        count: 0,
        entityIds: [],
        legIds: [],
        firstLegEntityId: null,
        aggregationWarning: null,
      },
      biochar: {
        count: 0,
        entityIds: [],
        legIds: [],
        firstLegEntityId: null,
        aggregationWarning: null,
      },
      sample: {
        count: 0,
        entityIds: [],
        legIds: [],
        firstLegEntityId: null,
        aggregationWarning: null,
      },
    },
    requiredTransportCategories: [],
    hasSubmittableRuns: true,
    productionReadinessGap: null,
    runSummary: {
      runCount: 1,
      totalBiocharOutputKg: biocharMassKg,
      appliedDryKg: biocharMassKg,
    },
    latestSubmission: latest,
    linkedGhgStatement: null,
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

  // The claim choreography is one mocked function backed by the in-memory
  // ledger + the real pure decision core; lock/CAS/re-resolution behavior
  // is the module's own concern (DB-backed tests).
  vi.mocked(ledgerClaim.claimSubmissionDraft).mockImplementation(
    makeClaimSubmissionDraftFake({
      latest: () => storedLatest(),
      insert: (input) => {
        const row = newLedgerRow(input);
        storedRows.push(row);
        return row;
      },
      resetToDraft: (rowId) => {
        const row = storedRows.find((r) => r.id === rowId);
        if (!row) throw new Error(`Test ledger missing row ${rowId}`);
        row.status = "draft";
        row.lockedAt = new Date();
        return row;
      },
    }),
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
    const createGhgEntryFake = vi.fn(fakeExternalIds("rmv"));
    vi.mocked(isometric.createDatapoint).mockImplementation(
      createDatapointFake as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      createGhgEntryFake as never,
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
    expect(createGhgEntryFake).toHaveBeenCalledTimes(1);

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
    const removalBody = vi.mocked(isometric.createGhgEntry).mock.calls[0][0];
    expect(removalBody).toMatchObject({
      project_id: EXTERNAL_PROJECT_ID,
      ghg_entry_template_id: TEMPLATE_ID,
      started_on: "2026-01-01",
      completed_on: "2026-01-31",
    });
    expect(removalBody.ghg_entry_template_components ?? []).toHaveLength(1);
    expect(removalBody.ghg_entry_template_components?.[0]).toMatchObject({
      ghg_entry_template_component_id: RTC_PRODUCT_MASS_ID,
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
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      fakeExternalIds("rmv") as never,
    );

    await submitRemoval({ userId: USER_ID, removalId: REMOVAL_ID });

    // Reset the HTTP spies — the second submit must not call them.
    vi.mocked(isometric.createDatapoint).mockClear();
    vi.mocked(isometric.createGhgEntry).mockClear();
    // Also clear the local-persistence spies so we can assert that
    // return-existing skips them outright on the second submit.
    vi.mocked(ledger.markSubmissionSubmitted).mockClear();
    vi.mocked(removalsDA.updateRemovalDates).mockClear();
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
    expect(isometric.createGhgEntry).not.toHaveBeenCalled();
    // return-existing must also skip local persistence — no ledger
    // transition, no removal-date rewrite.
    expect(ledger.markSubmissionSubmitted).not.toHaveBeenCalled();
    expect(removalsDA.updateRemovalDates).not.toHaveBeenCalled();
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
    vi.mocked(isometric.createGhgEntry).mockImplementation(
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
