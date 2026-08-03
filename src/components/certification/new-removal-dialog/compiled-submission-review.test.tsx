import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompiledSubmissionReview } from "./compiled-submission-review";

describe("CompiledSubmissionReview", () => {
  it("shows the complete outbound semantic review without claiming a v0 immutable snapshot", () => {
    const html = renderToStaticMarkup(
      <CompiledSubmissionReview
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        compilation={{
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
                componentDisplayName: "Feedstock transport",
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
            memberCreditBatches: [{ id: "batch-1", code: "CB-1" }],
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
        }}
      />,
    );

    for (const expected of [
      "Biochar removal",
      "Feedstock transport: Mass and distance",
      "42 t.km",
      "Set in template",
      "2026-01-31T23:59:59.000Z",
      "1 registry value source attached",
      "Durability measurements",
      "CB-1",
      "PR-1",
      "Captured startup diesel is not represented.",
      "registry records are saved when you submit",
    ]) {
      expect(html).toContain(expected);
    }
    for (const internalValue of [
      "mapping-rev-1",
      "mass_distance",
      "dtp-fixed-1",
      "src-actual-1",
      "rtc-1",
      "Submission reference",
    ]) {
      expect(html).not.toContain(internalValue);
    }
    expect(html).not.toContain("version 0");
    expect(html).not.toContain("local estimate");
  });
});
