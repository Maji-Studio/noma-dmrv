import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RemovalCompilationView } from "@/fn/certification";
import type {
  MemberCreditBatch,
  RemovalCertifyContext,
} from "@/fn/certification/certify-context";
import type { RemovalRequirementCheck } from "@/lib/certification/readiness";
import { SubmissionSummary } from "./submission-summary";
import type { FixEntry } from "./use-fix-progress";
import type { ChangedFigure } from "./review-parts";

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
  supportingDocuments: { total: 0, mirrored: 0 },
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
    key: "templateSet",
    label: "Template set",
    requirementLabel: "Template set",
    unmetLabel: "Template not set",
    status: "met",
  },
  {
    key: "templateLines",
    label: "Components decided",
    requirementLabel: "Components decided",
    unmetLabel: "Template components not ready",
    status: "met",
  },
];

const ITEM = {
  id: "check:production:",
  title: "No production run linked",
  explanation: "Each batch must trace to a production run.",
  lines: [],
  batchCode: null,
  fixes: [{ label: "Review production runs", href: "/production-runs?facility=facility-1" }],
};
const OPEN: FixEntry[] = [{ item: ITEM, fixed: false }];

function render(overrides: {
  compilation?: RemovalCompilationView | null;
  compilationError?: Error | null;
  checks?: RemovalRequirementCheck[];
  entries?: FixEntry[];
  changes?: ChangedFigure[];
  advisories?: string[];
  transportVehicleAdvisories?: string[];
  loading?: boolean;
  rejectionMessage?: string | null;
  isProduction?: boolean;
  readinessState?: "ready" | "inProgress";
} = {}) {
  return renderToStaticMarkup(
    <SubmissionSummary
      ctx={{ ...CONTEXT, isProduction: overrides.isProduction ?? false } as RemovalCertifyContext}
      facilityId="facility-1"
      compilation={overrides.compilation === undefined ? COMPILATION : overrides.compilation}
      isCompilationLoading={overrides.loading ?? false}
      compilationError={overrides.compilationError ?? null}
      checks={overrides.checks ?? PASSING_CHECKS}
      readiness={{ state: overrides.readinessState ?? "ready", reasons: [], advisories: overrides.advisories ?? [], transportVehicleAdvisories: overrides.transportVehicleAdvisories ?? [] }}
      rejectionMessage={overrides.rejectionMessage ?? null}
      entries={overrides.entries ?? []}
      changes={overrides.changes ?? []}
      onFix={() => undefined}
      onOpenDetails={() => undefined}
      onRetryCompilation={() => undefined}
    />,
  );
}

const UNMET_CHECKS: RemovalRequirementCheck[] = [
  { key: "production", label: "Linked production data", requirementLabel: "Linked production data", unmetLabel: "No production run linked", status: "unmet" },
];

describe("SubmissionSummary, ready", () => {
  it("leads with the CO2e estimate in one bordered block whose last row opens the details", () => {
    const html = render({ compilation: { ...COMPILATION, estimatedStoredCo2eTonnes: 23.64 } as unknown as RemovalCompilationView });
    expect(html.indexOf("Estimated CO₂e stored")).toBeLessThan(html.indexOf("Biochar dry mass"));
    expect(html).toContain("23.6 t CO₂e");
    expect(html).not.toContain("≈");
    expect(html).toContain("CB-26-001");
    expect(html).toContain("8.5 t");
    expect(html.indexOf("Biochar dry mass")).toBeLessThan(html.indexOf("See what this Removal sends"));
    expect(html).not.toContain("Fix these to submit");
  });

  it("says Not yet computed until the review has an estimate", () => {
    expect(render()).toContain("Not yet computed");
  });

  it("has no footer facts, destination row or environment banner: the header owns the destination", () => {
    const html = render({ isProduction: true });
    expect(html).not.toContain("Destination");
    expect(html).not.toContain("Facility");
    expect(html).not.toContain("Production Isometric");
  });

  it("groups the notes under one heading and keeps automatic evidence work out of them", () => {
    const message = "Genset diesel is recorded, but the active Removal template takes no automatic datapoints for it. Check which template component should take it in Removal templates.";
    const html = render({
      advisories: ["3 files are sent automatically when you submit"],
      transportVehicleAdvisories: ["Review the vehicle on delivery DL-1."],
      compilation: {
        ...COMPILATION,
        submissionAdvisories: [{ code: "droppedRecordedFact", fixTarget: "templateLines", message }],
        warnings: [message],
      } as unknown as RemovalCompilationView,
    });
    expect(html.split("Check before submitting")).toHaveLength(2);
    expect(html).not.toContain("3 files are sent automatically");
    expect(html).toContain("Review the vehicle on delivery DL-1.");
    expect(html.split(message)).toHaveLength(2);
    expect(html).toContain("Open Removal templates");
    expect(html).not.toContain('role="alert"');
  });

  it("shows no notes heading when there is nothing to note", () => {
    expect(render()).not.toContain("Check before submitting");
  });

  it("opens on what changed for a returned Removal, with both figures as two blocks and an arrow", () => {
    const html = render({
      changes: [{ key: "c1", component: "Diesel", batchCode: "CB-26-001", before: "120 L", after: "150 L" }],
    });
    expect(html).toContain("1 figure changed since you submitted");
    expect(html.indexOf("1 figure changed")).toBeLessThan(html.indexOf("Estimated CO₂e stored"));
    expect(html).toContain("When submitted");
    expect(html).toContain("120 L");
    expect(html).toContain("150 L");
  });

  it("names the changed component and credit batch when the data carries no figures", () => {
    const html = render({ changes: [{ key: "c1", component: "Diesel", batchCode: "CB-26-001" }, { key: "c2", component: "Electricity", batchCode: "CB-26-001" }] });
    expect(html).toContain("2 figures changed since you submitted");
    expect(html).toContain("Diesel");
    expect(html).not.toContain("When submitted");
  });

  it("says All N fixed once, after the last fix, and not while any is open", () => {
    const fixed: FixEntry[] = [
      { item: ITEM, fixed: true },
      { item: { ...ITEM, id: "check:mapping:", title: "Facility not linked" }, fixed: true },
    ];
    const html = render({ entries: fixed });
    expect(html.split("All 2 fixed. Ready to submit.")).toHaveLength(2);
    expect(render({ entries: [fixed[0], { ...fixed[1], fixed: false }], checks: UNMET_CHECKS })).not.toContain("All 2 fixed");
  });

  it("shows a spinner line while the review is prepared", () => {
    expect(render({ loading: true, compilation: null })).toContain("Preparing the submission");
  });
});

describe("SubmissionSummary, blocked", () => {
  it("titles the fixes 'Fix these to submit', with a ring per fix, the (i) and the link under the title", () => {
    const html = render({ checks: UNMET_CHECKS, entries: [...OPEN, { item: { ...ITEM, id: "b", title: "Template components", explanation: null, fixes: [] }, fixed: false }] });
    expect(html).toContain("Fix these to submit");
    expect(html).toContain("No production run linked");
    expect(html).toContain("About No production run linked");
    expect(html).toContain("Review production runs");
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("Estimated CO₂e stored</span>");
  });

  it("uses the singular heading for one open fix", () => {
    expect(render({ checks: UNMET_CHECKS, entries: OPEN })).toContain("Fix this to submit");
  });

  it("keeps a fixed item in place as done while another is open", () => {
    const html = render({
      checks: UNMET_CHECKS,
      entries: [{ item: { ...ITEM, id: "a", title: "Facility not linked" }, fixed: true }, ...OPEN],
    });
    expect(html).toContain('data-review-item="fixed"');
    expect(html).toContain("(fixed)");
    expect(html).toContain("Fix this to submit");
  });

  it("offers Try again when the submission details could not be prepared", () => {
    const html = render({ compilation: null, compilationError: new Error("boom") });
    expect(html).toContain("The submission details could not be prepared.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Try again.");
    expect(html).not.toContain("Retry review");
  });

  it("states a refusal no fix carries, such as a rejection in Isometric", () => {
    const html = render({ rejectionMessage: "This Removal was rejected in Isometric." });
    expect(html).toContain("This Removal was rejected in Isometric.");
    expect(html).toContain('role="alert"');
  });

  it("states the rejection or the running submission above the fixes while fixes are open", () => {
    const rejected = render({ rejectionMessage: "This Removal was rejected in Isometric.", checks: UNMET_CHECKS, entries: OPEN });
    expect(rejected).toContain("This Removal was rejected in Isometric.");
    expect(rejected.indexOf("This Removal was rejected")).toBeLessThan(rejected.indexOf("Fix this to submit"));
    const running = render({ readinessState: "inProgress", checks: UNMET_CHECKS, entries: OPEN });
    expect(running).toContain("Submission in progress");
    expect(running).toContain("Fix this to submit");
  });

  it("leaves the generic checks verdict to the fix list", () => {
    const html = render({ checks: UNMET_CHECKS, entries: OPEN });
    expect(html).not.toContain("issue blocks submission");
    expect(html).not.toContain('role="alert"');
  });

  it("does not repeat Not yet computed under a failed compile", () => {
    const html = render({ compilation: null, compilationError: new Error("boom") });
    expect(html).not.toContain("Not yet computed");
  });
});
