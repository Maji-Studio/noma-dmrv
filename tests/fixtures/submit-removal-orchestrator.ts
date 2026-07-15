import { beforeEach, vi } from "vitest";

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
import { evaluateDurabilitySubmissionGates } from "@/lib/certification/durability-submission-gates";

// ---------------------------------------------------------------------------
// Module mocks — declared before importing the system under test so the mocks
// are in place when its top-level imports resolve.
// ---------------------------------------------------------------------------

vi.mock("@/data-access/certification");
vi.mock("@/data-access/certification-submissions");
vi.mock("@/data-access/certifier-removals");
vi.mock("@/fn/certification/certify-context-core");
vi.mock("@/fn/certification/ensure-evidence-ledgers");
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
    getIsometricClientForOrg: vi.fn(async () => ({} as import("@/lib/isometric").IsometricClient)),
    createDatapoint: vi.fn(),
    createGhgEntry: vi.fn(),
    reconcileDatapoint: vi.fn(),
    reconcileRemoval: vi.fn(),
  };
});
// The Phase 3 measurement-samples flag is a build-time const (false while the
// two sandbox confirms are pending). The issue #320 window test needs the
// durability path live to observe `measured_at` staying production-anchored, so
// expose the flag through a mutable getter (default: the real staged-off state)
// and stub the POST-ing submitter.
const durabilityFlag = vi.hoisted(() => ({ live: false }));
vi.mock("@/fn/certification/durability-measurement-samples", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/fn/certification/durability-measurement-samples")
  >();
  return {
    ...actual,
    get DURABILITY_MEASUREMENT_SAMPLES_LIVE() {
      return durabilityFlag.live;
    },
    submitDurabilityMeasurementSamples: vi.fn(),
  };
});

export function setDurabilityMeasurementSamplesLive(live: boolean): void {
  durabilityFlag.live = live;
}

import * as ledger from "@/data-access/certification";
import * as ledgerClaim from "@/data-access/certification-submissions";
import * as removalsDA from "@/data-access/certifier-removals";
import * as certifyContext from "@/fn/certification/certify-context-core";
import * as durabilitySamples from "@/fn/certification/durability-measurement-samples";
import * as evidenceLedgers from "@/fn/certification/ensure-evidence-ledgers";
import * as isometric from "@/lib/isometric";
import { submitRemoval } from "@/fn/certification/submit-removal";
import { makeClaimSubmissionDraftFake } from "./fake-claim";

export {
  ledger,
  ledgerClaim,
  removalsDA,
  certifyContext,
  durabilitySamples,
  evidenceLedgers,
  isometric,
  submitRemoval,
};

// ---------------------------------------------------------------------------
// Constants used by the fakes + assertions.
// ---------------------------------------------------------------------------

export const USER_ID = "user-test-1";
export const FACILITY_ID = "fac-test-1";
export const REMOVAL_ID = "rem-test-1";
export const CREDIT_BATCH_ID = "cb-test-1";
export const APPLICATION_ID = "app-test-1";
export const PRODUCTION_RUN_ID = "pr-test-1";
export const EXTERNAL_PROJECT_ID = "prj_test_1";
export const TEMPLATE_ID = "rvt_test_1";
export const RTC_PRODUCT_MASS_ID = "rtc-product-mass";

export const ORIGINAL_BIOCHAR_MASS_KG = 1000;
export const CHANGED_BIOCHAR_MASS_KG = 1500;

// ---------------------------------------------------------------------------
// In-memory ledger simulator. Mirrors the (provider, submissionType,
// localEntityType, localEntityId) → versioned-row index that the real
// data-access layer reads through. Kept small on purpose — `submitRemoval`
// only ever exercises the latest-version lookup + insert/update transitions.
// ---------------------------------------------------------------------------

export let storedRows: CertificationSubmissionRow[];
let nextLedgerRowId = 1;

export function newLedgerRow(
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

export function makeTemplate(): IsometricGhgEntryTemplate {
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

// A template that routes durability through the new measurement-samples path —
// declares a `biochar_sequestration_200_year_*` component. submitRemoval blocks
// it while DURABILITY_MEASUREMENT_SAMPLES_LIVE is off (Phase 3 staged gate).
export function makeSequestrationTemplate(): IsometricGhgEntryTemplate {
  return {
    id: TEMPLATE_ID,
    name: "Durability template",
    display_name: "Durability template",
    credit_type: "REMOVAL",
    groups: [
      {
        id: "grp-seq",
        key: "co2-stored",
        name: "Durable storage",
        components: [
          {
            id: "rtc-seq",
            blueprint_key: "biochar_sequestration_200_year_c_org",
            display_name: "200-year sequestration",
            inputs: [
              {
                type: "monitored",
                input_key: "h_c_molar_ratios",
                datapoint_id: null,
                display_name: "H/C molar ratios",
                quantity_kind: "dimensionless_ratio",
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
    // Vestigial emission-estimate config: issue #319 removed the litres→kWh
    // genset conversion (diesel submits by volume, EF template-side), so the
    // submission path no longer reads this column. Kept in the fixture because
    // it still exists on CertifierProjectRow.
    gensetEnergyYieldKwhPerLitre: 3.375,
    defaultSoilTemperatureC: 24.2,
    defaultSoilTemperatureSource: "Test dataset (annual mean)",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CertifierProjectRow;
}

export function makeRun(
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

// One credit batch pooling the removal's runs' samples (ADR 0016: the credit
// batch is the protocol production batch and the sampling unit).
export function makeBatchesWithSamples(
  runs: Array<ProductionRun & { samples: Sample[] }>,
): certifyContext.RemovalSubmissionContext["batchesWithSamples"] {
  return [
    {
      creditBatchId: CREDIT_BATCH_ID,
      creditBatchCode: "CB-TEST-001",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      productionProcessId: null,
      samplingMethod: "method_a",
      declaredHToCorgRatio: null,
      durabilityOption: "200_year" as const,
      runs: runs.map((r) => ({
        id: r.id,
        code: r.code,
        biocharDryMassKg: r.biocharDryMassKg,
      })),
      samples: runs.flatMap((r) => r.samples),
    },
  ];
}

// Mirror what `buildRemovalContext` precomputes onto the context — the same
// pure gate engine at the credit-batch grain — so submitRemoval's fail-closed
// enforcement reads a faithfully-computed `durabilityGateBlockers` (the field
// it now blocks on, rather than recomputing inline).
export function durabilityBlockersFor(
  batches: certifyContext.RemovalSubmissionContext["batchesWithSamples"],
): string[] {
  return evaluateDurabilitySubmissionGates(
    batches.map((batch) => ({
      creditBatchId: batch.creditBatchId,
      creditBatchCode: batch.creditBatchCode,
      startDate: batch.startDate,
      endDate: batch.endDate,
      productionProcessId: batch.productionProcessId,
      samplingMethod: batch.samplingMethod,
      replicates: batch.samples.map((s) => ({
        hToCOrgRatio: s.hToCOrgRatio,
        oToCOrgRatio: s.oToCOrgRatio,
      })),
      replicateProvenance: batch.samples.map((s) => ({
        sampleCode: s.sampleCode,
        productionRunId: s.productionRunId ?? null,
        samplingDay: null,
      })),
    })),
  ).blockers;
}

export function makeContext(
  biocharMassKg = ORIGINAL_BIOCHAR_MASS_KG,
  overrides: Partial<certifyContext.RemovalSubmissionContext> = {},
): certifyContext.RemovalSubmissionContext {
  const latest = storedLatest();
  const runs = [makeRun(biocharMassKg)];
  const batchesWithSamples = makeBatchesWithSamples(runs);
  return {
    facilityId: FACILITY_ID,
    hasOrgCredentials: true,
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
    durabilityGateBlockers: durabilityBlockersFor(batchesWithSamples),
    submissionWarnings: [],
    runSummary: {
      runCount: 1,
      totalBiocharOutputKg: biocharMassKg,
      appliedDryKg: biocharMassKg,
    },
    latestSubmission: latest,
    linkedGhgStatement: null,
    isProduction: false,
    lineages: [makeLineage({ biocharMassKg })],
    runs,
    batchesWithSamples,
    attributionByRunId: new Map([[PRODUCTION_RUN_ID, 1]]),
    // §8.6.2 production-bucket claim state (issue #349) — default: unclaimed,
    // lineage matching the fixture's single run/application.
    memberBatchClaims: [
      {
        creditBatchId: CREDIT_BATCH_ID,
        code: "CB-TEST-001",
        claimedByRemovalId: null,
        productionRunIds: [PRODUCTION_RUN_ID],
        applicationIds: [APPLICATION_ID],
      },
    ],
    transportLegs: { feedstock: [], biochar: [], sample: [] },
    facilityReferenceSoilTemperature: {
      declaredSoilTemperatureC: 24.2,
      effectiveSoilTemperatureC: 24.2,
      source: "Test dataset (annual mean)",
      temperatureFloored: false,
      method:
        "Facility reference soil temperature (annual average; 7 °C floor) — Test dataset (annual mean)",
      warnings: [],
    },
    ...overrides,
    entityReadinessGaps: overrides.entityReadinessGaps ?? [],
  };
}

// One chain-of-custody lineage. The application date is deliberately AFTER the
// run window (Jan 2026) — §8.6.2 anchors the removal's `completed_on` on it
// (issue #320), so the fixture pins the production-end → application-date swap.
export function makeLineage(args: {
  applicationId?: string;
  code?: string;
  applicationDate?: Date;
  biocharMassKg?: number;
}): certifyContext.RemovalSubmissionContext["lineages"][number] {
  const biocharMassKg = args.biocharMassKg ?? ORIGINAL_BIOCHAR_MASS_KG;
  return {
    facility: { id: FACILITY_ID, code: "F", name: "F" },
    application: {
      id: args.applicationId ?? APPLICATION_ID,
      code: args.code ?? "APP-TEST-001",
      applicationDate: args.applicationDate ?? new Date("2026-04-05T00:00:00Z"),
      biocharAppliedDryTons: biocharMassKg / 1000,
    } as never,
    delivery: { id: "del-1" } as never,
    order: null,
    biocharProduct: { id: "bp-1" } as never,
    productionRun: { id: PRODUCTION_RUN_ID } as never,
    reactor: null,
    feedstocks: [],
    warnings: [],
  } as never;
}

// The fresh scope the post-claim re-assert (production-claim-gate) reads via
// resolveScopeForRemoval — claims + lineage fingerprint per member batch.
export function makeFreshScope(overrides: {
  claimedByRemovalId: string | null;
  productionRunIds?: string[];
  applicationIds?: string[];
}): Awaited<ReturnType<typeof certifyContext.resolveScopeForRemoval>> {
  return {
    facilityId: FACILITY_ID,
    removalId: REMOVAL_ID,
    removal: null,
    memberBatches: [
      {
        id: CREDIT_BATCH_ID,
        code: "CB-TEST-001",
        productionRunIds: overrides.productionRunIds ?? [PRODUCTION_RUN_ID],
        applicationIds: overrides.applicationIds ?? [APPLICATION_ID],
        durabilityOption: "200_year",
        productionEmissionsClaimedByRemovalId: overrides.claimedByRemovalId,
      },
    ],
  } as never;
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
  // Real staged-off state; the issue #320 window test flips it per-test.
  durabilityFlag.live = false;

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
  vi.mocked(ledger.retireStaleSubmissionDraft).mockImplementation(
    async (_userId, id) => {
      const row = storedRows.find((r) => r.id === id);
      if (row && row.status === "draft") {
        row.status = "superseded";
        row.supersededAt = new Date();
        row.lockedAt = null;
      }
    },
  );
  vi.mocked(ledger.appendSyncEvent).mockResolvedValue(undefined as never);
  vi.mocked(removalsDA.updateRemovalDates).mockResolvedValue(
    undefined as never,
  );
  vi.mocked(evidenceLedgers.ensureEvidenceLedgersFromContext).mockResolvedValue(
    undefined,
  );
  // §8.6.2 fresh-read re-assert (production-claim-gate): after the draft
  // claim, submitRemoval re-reads the removal scope (claims + lineage
  // fingerprint) through resolveScopeForRemoval. Default: unclaimed,
  // lineage matching makeContext; the TOCTOU tests override per-test.
  vi.mocked(certifyContext.resolveScopeForRemoval).mockResolvedValue(
    makeFreshScope({ claimedByRemovalId: null }),
  );

  vi.mocked(isometric.reconcileDatapoint).mockResolvedValue({ found: false });
  vi.mocked(isometric.reconcileRemoval).mockResolvedValue({ found: false });
});

// Returns a unique fake external id per HTTP call so the orchestrator's
// per-call recording can be inspected by id.
export function fakeExternalIds(prefix: string): () => Promise<{ id: string }> {
  let n = 0;
  return async () => ({ id: `${prefix}_${++n}` });
}
