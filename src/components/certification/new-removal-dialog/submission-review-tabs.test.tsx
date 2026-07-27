import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RemovalCompilationView } from "@/fn/certification";
import type { MemberCreditBatch } from "@/fn/certification/certify-context";
import type { RemovalRequirementCheck } from "@/lib/certification/readiness";
import { SubmissionReviewTabs } from "./submission-review-tabs";

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

const CHECKS = [
  {
    key: "mapping",
    label: "Facility linked to a registry project",
    requirementLabel: "Facility linked to a registry project",
    status: "met",
  },
] as RemovalRequirementCheck[];

const READY_COMPILATION: RemovalCompilationView = {
  review: {
    template: {
      id: "rvt-1",
      displayName: "Biochar removal",
      mappingRevision: "mapping-rev-1",
    },
    bindings: [
      {
        componentId: "rtc-1",
        componentBlueprintKey: "transport",
        inputKey: "mass_distance",
        binding: "monitored",
        wireMagnitude: 42,
        wireUnit: "t.km",
        wireType: "REPORTED",
      },
      {
        componentId: "rtc-2",
        componentBlueprintKey: "fixed",
        inputKey: "factor",
        binding: "fixed",
        fixedDatapointId: "dtp-fixed-1",
      },
    ],
    measurementSamples: [
      {
        operationKey: "sample-1",
        label: "Durability sample",
        measuredAt: "2026-01-31T23:59:59.000Z",
        values: [{ value: { magnitude: 0.91 } }],
      },
    ],
    directSequestrationDatapoints: [
      {
        componentId: "rtc-seq",
        inputKey: "s_fraction",
        magnitude: 0.91,
        unit: "dimensionless",
        type: "REPORTED",
      },
    ],
    sourceIds: ["src-actual-1"],
    intendedPostTargets: [
      "/datapoints",
      "/measurement-samples",
      "/ghg-entries",
    ],
    memberCreditBatches: [{ id: "batch-1", code: "CB-26-001" }],
    productionRuns: [{ id: "run-1", code: "PR-1" }],
    reportingWindow: {
      startedOn: "2026-01-01T00:00:00.000Z",
      completedOn: "2026-04-05T00:00:00.000Z",
    },
  },
  blockers: [],
  warnings: ["Captured startup diesel is not represented."],
  compilationHash:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  snapshot: {
    materialization: "claim-time",
    mappingRevision: "mapping-rev-1",
    semanticPayload: {},
  },
};

function renderTabs({
  compilation = READY_COMPILATION,
  isCompilationLoading = false,
  compilationError = null,
}: {
  compilation?: RemovalCompilationView | null;
  isCompilationLoading?: boolean;
  compilationError?: Error | null;
} = {}): string {
  return renderToStaticMarkup(
    <SubmissionReviewTabs
      memberBatches={[BATCH]}
      facilityId="facility-1"
      compilation={compilation}
      isCompilationLoading={isCompilationLoading}
      compilationError={compilationError}
      onRetryCompilation={vi.fn()}
      checks={CHECKS}
      isProduction={false}
    />,
  );
}

describe("SubmissionReviewTabs", () => {
  it("selects Review by default and exposes labelled tabs and panels", () => {
    const html = renderTabs();
    const tabTags = html.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];
    const panelTags = html.match(/<div[^>]*role="tabpanel"[^>]*>/g) ?? [];

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Submission review"');
    expect(tabTags).toHaveLength(2);
    expect(tabTags[0]).toContain('aria-selected="true"');
    expect(tabTags[0]).toContain('aria-controls=');
    expect(tabTags[1]).toContain('aria-selected="false"');
    expect(panelTags).toHaveLength(2);
    expect(panelTags[0]).toContain('aria-labelledby=');
    expect(panelTags[0]).not.toContain("hidden");
    expect(panelTags[1]).toContain('aria-labelledby=');
    expect(panelTags[1]).toContain("hidden");
    expect(html).toMatch(/>Review<\/button>/);
    expect(html).toMatch(/>Technical details<\/button>/);
  });

  it("keeps the default review concise while surfacing readiness warnings", () => {
    const html = renderTabs();

    expect(html).toContain("Submission overview");
    expect(html).toContain("Compilation ready");
    expect(html).toContain("Captured but not represented");
    expect(html).toContain("Captured startup diesel is not represented.");
    expect(html).toContain("Submission checks · 1 of 1 checks passed");
    expect(html).toContain("Sandbox · Isometric registry");
  });

  it("preserves the complete compiled diagnostic review in Technical details", () => {
    const html = renderTabs();

    for (const expected of [
      "Compiled Isometric submission",
      "rvt-1",
      "mapping-rev-1",
      "Outbound plan",
      "/datapoints",
      "/measurement-samples",
      "/ghg-entries",
      "Artifact hash",
      "materialized once",
      "src-actual-1",
      "CB-26-001",
      "batch-1",
      "PR-1",
      "run-1",
      "Resolved component/input bindings",
      "mass_distance",
      "dtp-fixed-1",
      "Measurement samples",
      "2026-01-31T23:59:59.000Z",
      "&quot;magnitude&quot;:0.91",
      "Direct sequestration datapoints (s_fraction)",
      "Recompile",
    ]) {
      expect(html).toContain(expected);
    }
  });

  it("shows each compact compilation state and routes unavailable or blocked operators to diagnostics", () => {
    const loadingHtml = renderTabs({
      compilation: null,
      isCompilationLoading: true,
    });
    const unavailableHtml = renderTabs({
      compilation: null,
      compilationError: new Error("Unavailable"),
    });
    const blocker = "Map the monitored transport input.";
    const blockedHtml = renderTabs({
      compilation: {
        ...READY_COMPILATION,
        blockers: [blocker],
        snapshot: null,
        compilationHash: null,
      },
    });

    expect(loadingHtml).toContain("Compilation in progress");
    expect(unavailableHtml).toContain("Compilation unavailable");
    expect(unavailableHtml).toContain("Open technical details");
    expect(unavailableHtml).toContain("Retry compilation");
    expect(blockedHtml).toContain("Compilation blocked");
    expect(blockedHtml).toContain("Open technical details");
    expect(blockedHtml.match(new RegExp(blocker, "g"))).toHaveLength(2);
  });
});
