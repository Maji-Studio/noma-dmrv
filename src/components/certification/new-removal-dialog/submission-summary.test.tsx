import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RemovalCompilationView } from "@/fn/certification";
import type {
  MemberCreditBatch,
  RemovalCertifyContext,
} from "@/fn/certification/certify-context";
import type { RemovalRequirementCheck } from "@/lib/certification/readiness";
import { SubmissionSummary } from "./submission-summary";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

const BATCH = {
  id: "batch-1",
  code: "CB-26-001",
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  appliedWeightTons: 10,
  appliedDryWeightTons: 8.5,
  durabilityOption: "1000_year",
  sampling: "sampled",
  productionRunCount: 1,
  applicationCount: 1,
} as MemberCreditBatch;

const COMPILATION = {
  review: {
    pendingSourceCount: 0,
    // Midday UTC so the rendered range does not shift a day under a negative
    // local offset.
    reportingWindow: {
      startedOn: "2026-07-01T12:00:00.000Z",
      completedOn: "2026-07-31T12:00:00.000Z",
    },
  },
  blockers: [],
  warnings: [],
  snapshot: {},
  compilationHash: "compilation-hash",
} as unknown as RemovalCompilationView;

const CONTEXT = {
  memberBatches: [BATCH],
  project: { name: "Biochar project" },
  mapping: {
    externalProjectId: "prj_1K9YJ33RKSBX9FFF",
    externalFacilityId: "fcl_1KST05ZW3SBXZCM7",
  },
  isProduction: false,
  submissionWarnings: [],
} as unknown as RemovalCertifyContext;

const PASSING_CHECKS: RemovalRequirementCheck[] = [
  {
    key: "mapping",
    label: "Facility linked to a registry project",
    requirementLabel: "Facility linked to a registry project",
    unmetLabel: "Facility not linked to a registry project",
    status: "met",
  },
  {
    key: "template",
    label: "Removal template resolved",
    requirementLabel: "Removal template resolved",
    unmetLabel: "Removal template has unresolved parts",
    status: "met",
  },
];

function render(overrides: {
  compilation?: RemovalCompilationView;
  ctx?: RemovalCertifyContext;
  checks?: RemovalRequirementCheck[];
  facilityName?: string;
  advisories?: string[];
  transportVehicleAdvisories?: string[];
} = {}) {
  return renderToStaticMarkup(
    <SubmissionSummary
      ctx={overrides.ctx ?? CONTEXT}
      facilityId="facility-1"
      facilityName={overrides.facilityName ?? "Tanzania facility"}
      compilation={overrides.compilation ?? COMPILATION}
      isCompilationLoading={false}
      compilationError={null}
      checks={overrides.checks ?? PASSING_CHECKS}
      readiness={{ state: "ready", reasons: [], advisories: overrides.advisories ?? [], transportVehicleAdvisories: overrides.transportVehicleAdvisories ?? [] }}
      rejectionMessage={null}
    />,
  );
}

describe("SubmissionSummary", () => {
  it("does not render automatic evidence work as a warning", () => {
    const html = render({ advisories: ["3 files are sent automatically when you submit"] });
    expect(html).not.toContain("3 files are sent automatically when you submit");
    expect(html).toBe(render());
  });

  it("links a dropped recorded fact as a warning, not a blocker", () => {
    const message = "Genset diesel is recorded, but the active Removal template has no automatic source for it.";
    const html = render({
      compilation: {
        ...COMPILATION,
        submissionAdvisories: [{ code: "droppedRecordedFact", fixTarget: "templateLineReview", message }],
        warnings: [message],
      } as unknown as RemovalCompilationView,
    });
    expect(html).toContain("Submission notes");
    expect(html.split(message)).toHaveLength(2);
    expect(html).toContain("Review template lines");
    expect(html).toContain("/certification/settings?section=removal-templates&amp;facility=facility-1");
    expect(html).not.toContain('role="alert"');
  });

  it("links a blocker to its one repair destination and leaves an aggregate one unlinked", () => {
    const html = render({
      compilation: {
        ...COMPILATION,
        blockers: ["Choose a Removal template for this credit batch.", "Complete these fields before submitting the Removal:\nRecord Sample moisture"],
        removalBlockers: [
          { code: "unpinnedTemplate", message: "Choose a Removal template for this credit batch.", fixTarget: "creditBatchTemplate" },
          { code: "entityReadiness", message: "Complete these fields before submitting the Removal:\nRecord Sample moisture", fixTarget: null },
        ],
        snapshot: null,
        compilationHash: null,
      } as unknown as RemovalCompilationView,
    });
    expect(html).toContain("Choose a Removal template for this credit batch.");
    expect(html).toContain("Switch template");
    expect(html).toContain("Record Sample moisture");
    expect(html.split("Switch template")).toHaveLength(2);
    expect(html).not.toContain("#batch-details");
    expect(html).not.toContain("Review template lines");
  });

  it("sends a per-record blocker to the records list, not a create intent, with one member batch", () => {
    const html = render({
      compilation: {
        ...COMPILATION,
        blockers: ["Complete these fields before submitting the Removal:\nRecord Sample moisture"],
        removalBlockers: [
          { code: "entityReadiness", message: "Complete these fields before submitting the Removal:\nRecord Sample moisture", fixTarget: "labSamples" },
          { code: "legacy", message: "Delivery DL-1 has no proof of delivery.", fixTarget: "deliveryEvidence" },
        ],
        snapshot: null,
        compilationHash: null,
      } as unknown as RemovalCompilationView,
    });
    expect(html).toContain('href="/samples?facility=facility-1"');
    expect(html).not.toContain("batch=batch-1&amp;");
    expect(html).toContain('href="/deliveries?facility=facility-1"');
  });

  it("shows vehicle advisories without adding a blocker", () => {
    const html = render({ transportVehicleAdvisories: ["Feedstock transport uses more than one vehicle type."] });
    expect(html).toContain("Feedstock transport uses more than one vehicle type.");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("What to fix");
  });

  it("states the tonnage exactly once, as the subject of the panel", () => {
    const html = render();

    expect(html).toContain("You are sending");
    expect(html.split("8.5 t")).toHaveLength(2);
    expect(html).toContain("Biochar, dry mass");
    expect(html).toContain(
      "Isometric calculates stored and net CO₂e after submission.",
    );
    expect(html).toContain("Biochar project (Sandbox)");
    expect(html).toContain("Tanzania facility");
    expect(html).toContain(
      "https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/overview",
    );
    expect(html).toContain(
      "https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/facilities/fcl_1KST05ZW3SBXZCM7",
    );
    expect(html).toContain(
      "https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/storage-sites?tab=sites",
    );
    expect(html).toContain("Storage sites");
    expect(html).toContain("View in Isometric");
    expect(html).toContain("Jul 1 to Jul 31, 2026");
    expect(html).toContain("CB-26-001");
    expect(html).toContain("1000-year (R₀ reflectance)");
  });

  it("renders no checks list when every check passes", () => {
    const html = render();

    expect(html).toContain("Ready to submit");
    expect(html).toContain("2 checks passed.");
    expect(html).not.toContain("Nothing left to fix.");
    expect(html).not.toContain("What to fix");
    expect(html).not.toContain("Removal template resolved");
  });

  it("does not render an empty verdict detail when no checks were evaluated", () => {
    const html = render({ checks: [] });

    expect(html).toContain("Ready to submit");
    expect(html).not.toContain(
      '<span class="body-small text-[var(--color-text-secondary)]"></span>',
    );
  });

  it("opens the checks list on the items that need attention", () => {
    const html = render({
      checks: [
        PASSING_CHECKS[0],
        {
          ...PASSING_CHECKS[1],
          status: "unmet",
          detail: "No default Removal template is selected.",
        },
      ],
    });

    expect(html).toContain("1 issue blocks submission");
    expect(html).toContain("Review the issue below.");
    expect(html).toContain("What to fix");
    expect(html).toContain("1 check passed");
    expect(html).toContain("No default Removal template is selected.");
    // The passing check stays out of the list.
    expect(html).not.toContain("Facility linked to a registry project");
  });

  it("keeps the sandbox note inside the destination row", () => {
    const html = render();

    expect(html).not.toContain("Sandbox · Isometric registry");
  });

  it("keeps destination and facility visible without broken registry links", () => {
    const html = render({
      ctx: {
        ...CONTEXT,
        mapping: null,
      } as unknown as RemovalCertifyContext,
    });

    expect(html).toContain("Biochar project (Sandbox)");
    expect(html).toContain("Tanzania facility");
    expect(html).not.toContain("Storage sites");
    expect(html).not.toContain("registry.sandbox.isometric.com");
  });

  it("keeps the facility unlinked when only the project is mapped", () => {
    const html = render({
      ctx: {
        ...CONTEXT,
        mapping: {
          ...CONTEXT.mapping,
          externalFacilityId: null,
        },
      } as unknown as RemovalCertifyContext,
    });

    expect(html).toContain(
      "https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/overview",
    );
    expect(html).toContain("Tanzania facility");
    expect(html).not.toContain("/facilities/");
  });

  it("renders the production banner only in production", () => {
    const html = render({
      ctx: {
        ...CONTEXT,
        isProduction: true,
      } as unknown as RemovalCertifyContext,
    });

    expect(html).toContain("Production · Isometric registry");
    expect(html).toContain("Biochar project (Production)");
  });
});
