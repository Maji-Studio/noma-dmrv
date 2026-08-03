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
  mapping: null,
  isProduction: false,
  submissionWarnings: [],
} as unknown as RemovalCertifyContext;

const PASSING_CHECKS: RemovalRequirementCheck[] = [
  {
    key: "mapping",
    label: "Facility linked to a registry project",
    requirementLabel: "Facility linked to a registry project",
    status: "met",
  },
  {
    key: "template",
    label: "Removal template resolved",
    requirementLabel: "Removal template resolved",
    status: "met",
  },
];

function render(overrides: {
  ctx?: RemovalCertifyContext;
  checks?: RemovalRequirementCheck[];
} = {}) {
  return renderToStaticMarkup(
    <SubmissionSummary
      ctx={overrides.ctx ?? CONTEXT}
      facilityId="facility-1"
      compilation={COMPILATION}
      isCompilationLoading={false}
      compilationError={null}
      checks={overrides.checks ?? PASSING_CHECKS}
      readiness={{ state: "ready", reasons: [], advisories: [] }}
      rejectionMessage={null}
    />,
  );
}

describe("SubmissionSummary", () => {
  it("states the tonnage exactly once, as the subject of the panel", () => {
    const html = render();

    expect(html).toContain("You are sending");
    expect(html.split("8.5 t")).toHaveLength(2);
    expect(html).toContain("Biochar, dry mass");
    expect(html).toContain(
      "Isometric calculates stored and net CO₂e after submission.",
    );
    expect(html).toContain("Biochar project (Sandbox)");
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
