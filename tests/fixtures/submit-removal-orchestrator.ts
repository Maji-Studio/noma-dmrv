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
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/transformers/measurement-sample";
import {
  SUBMISSION_ATTEMPT_OUTCOMES,
  SUBMISSION_METADATA_KEYS,
} from "@/lib/certification/submission-metadata";

const INTERRUPTION_METADATA_KEYS = new Set<string>([
  SUBMISSION_METADATA_KEYS.lastError,
  SUBMISSION_METADATA_KEYS.lastAttemptOutcome,
  SUBMISSION_METADATA_KEYS.externalMutation,
]);
const RETRY_CLEARED_METADATA_KEYS = new Set<string>([
  SUBMISSION_METADATA_KEYS.lastError,
  SUBMISSION_METADATA_KEYS.lastAttemptOutcome,
]);

// ---------------------------------------------------------------------------
// Module mocks — declared before importing the system under test so the mocks
// are in place when its top-level imports resolve.
// ---------------------------------------------------------------------------

vi.mock("@/data-access/certification");
vi.mock("@/data-access/certification-submissions");
vi.mock("@/data-access/certifier-removals");
vi.mock("@/data-access/certifier-production-batches");
vi.mock("@/fn/certification/certify-context-core");
vi.mock("@/fn/certification/ensure-evidence-ledgers");
// Removal submission fails closed unless every candidate document has a
// validated mirrored Source ID. Tests that exercise missing/partial mirrors
// override these healthy defaults.
vi.mock("@/fn/certification/sources", async () => {
  return {
    collectCandidateDocumentIdsForRemoval: vi.fn(async () => ["doc-test-1"]),
    resolveSourceIdsForRemoval: vi.fn(async () => ["src-test-1"]),
    collectCandidateSourceDocumentsForRemoval: vi.fn(async () => [
      {
        documentId: "doc-test-1",
        binding: {
          nomaRole: "inventory",
          nomaRoleLabel: "Inventory",
          lineage: {
            entityType: "application",
            entityId: "app-test-1",
            entityLabel: "Application APP-TEST-001",
          },
          intendedTarget: {
            kind: "sequestration",
            groupKey: "co2-stored",
            inputKey: "product_mass",
          },
          mappingRevision: "source-binding-test-revision",
        },
      },
    ]),
    resolveSourceBindingCandidates: vi.fn(async (_ctx, args) =>
      args.candidates.map((candidate: {
        documentId: string;
        binding: unknown;
      }) => ({
        ...candidate,
        sourceId: `src-${candidate.documentId}`,
      })),
    ),
    mirrorCandidateSourcesForSubmission: vi.fn(),
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
// The production-batch step (#630) resolves its client from the client module
// directly, not the barrel above, so the HTTP boundary is faked here too.
const isometricClientFake = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  paginate: vi.fn(),
  paginateAll: vi.fn(),
}));
vi.mock("@/lib/isometric/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/isometric/client")>();
  return {
    ...actual,
    getIsometricClientForOrg: vi.fn(async () => isometricClientFake),
  };
});
// The Phase 3 measurement-samples flag is a build-time const (false while the
// two sandbox confirms are pending). Tests that exercise the durability path
// expose it through a mutable getter and stub the POST-ing submitter.
const durabilityFlag = vi.hoisted(() => ({ live: false }));
vi.mock("@/fn/certification/durability-measurement-samples", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/fn/certification/durability-measurement-samples")
  >();
  return {
    ...actual,
    get DURABILITY_MEASUREMENT_SAMPLES_ENABLED() {
      return durabilityFlag.live;
    },
    submitDurabilityMeasurementSamples: vi.fn(),
  };
});

export function setDurabilityMeasurementSamplesEnabled(live: boolean): void {
  durabilityFlag.live = live;
}

import * as ledger from "@/data-access/certification";
import * as ledgerClaim from "@/data-access/certification-submissions";
import * as removalsDA from "@/data-access/certifier-removals";
import * as productionBatchesDA from "@/data-access/certifier-production-batches";
import * as certifyContext from "@/fn/certification/certify-context-core";
import * as durabilitySamples from "@/fn/certification/durability-measurement-samples";
import * as evidenceLedgers from "@/fn/certification/ensure-evidence-ledgers";
import * as sources from "@/fn/certification/sources";
import * as isometric from "@/lib/isometric";
import { submitRemoval } from "@/fn/certification/submit-removal";
import { makeClaimSubmissionDraftFake } from "./fake-claim";

export {
  isometricClientFake,
  ledger,
  ledgerClaim,
  removalsDA,
  productionBatchesDA,
  certifyContext,
  durabilitySamples,
  evidenceLedgers,
  sources,
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

export const EXTERNAL_FACILITY_ID = "fcl_test_1";
export const EXTERNAL_FEEDSTOCK_TYPE_ID = "ftt_test_1";
export const EXTERNAL_PRODUCTION_BATCH_ID = "ptb_test_1";

export const ORIGINAL_BIOCHAR_MASS_KG = 1000;
export const CHANGED_BIOCHAR_MASS_KG = 1500;

export function makeInventorySourceDocument(documentId: string) {
  return {
    documentId,
    binding: {
      nomaRole: "inventory" as const,
      nomaRoleLabel: "Inventory",
      lineage: {
        entityType: "application",
        entityId: APPLICATION_ID,
        entityLabel: "Application APP-TEST-001",
      },
      intendedTarget: {
        kind: "sequestration" as const,
        groupKey: "co2-stored" as const,
        inputKey: "product_mass" as const,
      },
      mappingRevision: "source-binding-test-revision",
    },
  };
}

export function makeResolvedInventorySource(
  documentId: string,
  sourceId: string,
) {
  return {
    ...makeInventorySourceDocument(documentId),
    sourceId,
  };
}

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

// A template that routes durability through the unverified 200-year
// measurement-samples path. submitRemoval keeps it fail-closed until the
// remaining H/C unit and binding contract is confirmed.
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

export function make1000YearSequestrationTemplate(): IsometricGhgEntryTemplate {
  const base = makeSequestrationTemplate();
  return {
    ...base,
    name: "1000-year durability template",
    display_name: "1000-year durability template",
    groups: base.groups.map((group) => ({
      ...group,
      components: group.components.map((component) => ({
        ...component,
        blueprint_key: CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
        display_name: "1000-year sequestration",
        inputs: [
          {
            type: "monitored",
            input_key: "total_carbon_contents",
            quantity_kind: "mass_fraction_dry_basis",
            datapoint_id: null,
          },
          {
            type: "monitored",
            input_key: "inorganic_carbon_contents",
            quantity_kind: "mass_fraction_dry_basis",
            datapoint_id: null,
          },
          {
            type: "monitored",
            input_key: "product_mass",
            quantity_kind: "mass",
            datapoint_id: null,
          },
          {
            type: "monitored",
            input_key: "s_fraction",
            quantity_kind: "dimensionless",
            datapoint_id: null,
          },
        ],
      })),
    })),
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
): ProductionRun & { samples: Sample[] } {
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
    // Three eligible replicates (H/C_org < 0.5, O/C_org < 0.2) so the D3
    // durability gates pass. organicCarbonPercent stays 80 across replicates so
    // the weighted carbon datapoint magnitude is unchanged.
    samples: [
      {
        id: "smp-test-1",
        sampleCode: "SMP-TEST-1",
        samplingTime: new Date("2026-01-10T08:00:00.000Z"),
        productionRunId: PRODUCTION_RUN_ID,
        totalCarbonPercent: 81,
        organicCarbonPercent: 80,
        inorganicCarbonPercent: 1,
        sReflectanceFraction: 0.91,
        hToCOrgRatio: 0.4,
        oToCOrgRatio: 0.15,
        ashContentPercent: 5,
        moistureContentPercent: 10,
      } as unknown as Sample,
      {
        id: "smp-test-2",
        sampleCode: "SMP-TEST-2",
        samplingTime: new Date("2026-01-11T09:00:00.000Z"),
        productionRunId: PRODUCTION_RUN_ID,
        totalCarbonPercent: 81,
        organicCarbonPercent: 80,
        inorganicCarbonPercent: 1,
        sReflectanceFraction: 0.92,
        hToCOrgRatio: 0.41,
        oToCOrgRatio: 0.16,
        ashContentPercent: 5,
        moistureContentPercent: 10,
      } as unknown as Sample,
      {
        id: "smp-test-3",
        sampleCode: "SMP-TEST-3",
        samplingTime: new Date("2026-01-12T10:00:00.000Z"),
        productionRunId: PRODUCTION_RUN_ID,
        totalCarbonPercent: 81,
        organicCarbonPercent: 80,
        inorganicCarbonPercent: 1,
        sReflectanceFraction: 0.93,
        hToCOrgRatio: 0.39,
        oToCOrgRatio: 0.14,
        ashContentPercent: 5,
        moistureContentPercent: 10,
      } as unknown as Sample,
    ],
  } as unknown as ProductionRun & { samples: Sample[] };
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
      facilityTimezone: "UTC",
      sampling: "sampled",
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
      sampling: batch.sampling,
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
    memberBatches: [{
      id: CREDIT_BATCH_ID,
      code: "CB-TEST-001",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      appliedWeightTons: 1,
      appliedDryWeightTons: 1,
      durabilityOption: "1000_year",
      sampling: "sampled",
      productionRunCount: 1,
      applicationCount: 1,
    }],
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
    futureDatedMeasurements: [],
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
        "Facility reference soil temperature (annual average; 7 °C floor): Test dataset (annual mean)",
      warnings: [],
    },
    ...overrides,
    entityReadinessGaps: overrides.entityReadinessGaps ?? [],
    supportingDocuments: overrides.supportingDocuments ?? {
      total: 1,
      mirrored: 1,
    },
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
        row.metadata = Object.fromEntries(
          Object.entries(row.metadata ?? {}).filter(
            ([key]) => !RETRY_CLEARED_METADATA_KEYS.has(key),
          ),
        );
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
        row.metadata = Object.fromEntries(
          Object.entries(row.metadata ?? {}).filter(
            ([key]) => !INTERRUPTION_METADATA_KEYS.has(key),
          ),
        );
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
    async (_userId, id, args) => {
      const row = storedRows.find((r) => r.id === id);
      const ownsLock =
        !args.expectedLockedAt ||
        row?.lockedAt?.getTime() === args.expectedLockedAt.getTime();
      if (row?.status === "draft" && ownsLock) {
        row.status = "rejected";
        row.lockedAt = null;
        row.metadata = {
          ...(row.metadata ?? {}),
          lastError: args.errorMessage,
        };
      }
    },
  );
  vi.mocked(ledgerClaim.markSubmissionInterrupted).mockImplementation(
    async (_userId, id, args) => {
      const row = storedRows.find((r) => r.id === id);
      const ownsLock =
        row?.lockedAt?.getTime() === args.expectedLockedAt.getTime();
      if (row?.status === "draft" && ownsLock) {
        row.metadata = {
          ...(row.metadata ?? {}),
          [SUBMISSION_METADATA_KEYS.lastError]: args.errorMessage,
          [SUBMISSION_METADATA_KEYS.lastAttemptOutcome]:
            SUBMISSION_ATTEMPT_OUTCOMES.interrupted,
          [SUBMISSION_METADATA_KEYS.externalMutation]: args.externalMutation,
        };
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
  vi.mocked(sources.collectCandidateDocumentIdsForRemoval).mockResolvedValue([
    "doc-test-1",
  ]);
  vi.mocked(sources.resolveSourceIdsForRemoval).mockResolvedValue([
    "src-test-1",
  ]);
  vi.mocked(
    sources.collectCandidateSourceDocumentsForRemoval,
  ).mockResolvedValue([makeInventorySourceDocument("doc-test-1")]);
  vi.mocked(sources.resolveSourceBindingCandidates).mockResolvedValue([
    makeResolvedInventorySource("doc-test-1", "src-test-1"),
  ]);
  vi.mocked(
    sources.mirrorCandidateSourcesForSubmission,
  ).mockResolvedValue(undefined);
  // §8.6.2 fresh-read re-assert (production-claim-gate): after the draft
  // claim, submitRemoval re-reads the removal scope (claims + lineage
  // fingerprint) through resolveScopeForRemoval. Default: unclaimed,
  // lineage matching makeContext; the TOCTOU tests override per-test.
  vi.mocked(certifyContext.resolveScopeForRemoval).mockResolvedValue(
    makeFreshScope({ claimedByRemovalId: null }),
  );

  vi.mocked(isometric.reconcileDatapoint).mockResolvedValue({ found: false });
  vi.mocked(isometric.reconcileRemoval).mockResolvedValue({ found: false });

  // Production-batch registration (#630): unregistered by default, so a
  // durability submit POSTs once and journals the returned `ptb_…`.
  vi.mocked(
    productionBatchesDA.getProductionBatchRegistryInputs,
  ).mockResolvedValue([
    {
      creditBatchId: CREDIT_BATCH_ID,
      creditBatchCode: "CB-TEST-001",
      // Same window as makeBatchesWithSamples for this credit batch: nothing
      // derives one from the other today, and matching them keeps a future
      // wiring change from passing on a coincidence.
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-31T23:59:59.000Z",
      externalProjectId: EXTERNAL_PROJECT_ID,
      externalFacilityId: EXTERNAL_FACILITY_ID,
      isometricFeedstockTypeId: EXTERNAL_FEEDSTOCK_TYPE_ID,
      totalDryMassKg: ORIGINAL_BIOCHAR_MASS_KG,
      runsMissingDryMass: 0,
      runsMissingEndTime: 0,
    },
  ]);
  vi.mocked(
    productionBatchesDA.getProductionBatchRegistrations,
  ).mockResolvedValue([]);
  vi.mocked(
    productionBatchesDA.upsertProductionBatchRegistration,
  ).mockImplementation(
    async (_ctx, input) =>
      ({
        ...input,
        id: "cpb-test-1",
        organizationId: "org_test_fixtures",
        provider: "isometric",
        createdAt: new Date(),
        updatedAt: new Date(),
      }) as never,
  );
  isometricClientFake.paginate.mockImplementation(async function* () {});
  isometricClientFake.paginateAll.mockResolvedValue([]);
  isometricClientFake.post.mockImplementation(
    async (_path: string, body: { supplier_reference_id: string }) => ({
      id: EXTERNAL_PRODUCTION_BATCH_ID,
      ...body,
    }),
  );
});

// Returns a unique fake external id per HTTP call so the orchestrator's
// per-call recording can be inspected by id.
export function fakeExternalIds(prefix: string): () => Promise<{ id: string }> {
  let n = 0;
  return async () => ({ id: `${prefix}_${++n}` });
}
