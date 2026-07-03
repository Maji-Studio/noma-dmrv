/**
 * Non-blocking submission advisories (`buildSubmissionWarnings`).
 *
 * Issue #320 added the month-straddle advisory: §8.6.2 anchors the removal's
 * period end on the latest biochar application, so production in one UTC month
 * and application in a later one stretches the reporting window across months
 * — operations emissions "must be attributed to the Reporting Period in which
 * they occur", hence the warning (advisory only; splitting is the operator's
 * call). The startup-diesel advisory (ADR 0015) keeps its own tests here too.
 */
import { describe, expect, it } from "vitest";
import { buildSubmissionWarnings } from "@/fn/certification/submission-warnings";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";

function makeRun(overrides: {
  startTime: Date;
  dieselOperationLiters?: number;
  preprocessingFuelLiters?: number;
}): ProductionRunWithSamples {
  return {
    id: "pr-warn-1",
    startTime: overrides.startTime,
    endTime: new Date(overrides.startTime.getTime() + 24 * 60 * 60 * 1000),
    dieselOperationLiters: overrides.dieselOperationLiters ?? 0,
    preprocessingFuelLiters: overrides.preprocessingFuelLiters ?? 0,
    samples: [],
  } as unknown as ProductionRunWithSamples;
}

function makeLineage(applicationDate: Date): {
  application: { applicationDate: Date };
} {
  return { application: { applicationDate } };
}

// A template with no `fuel_usage_by_volume` component (the live ADR 0015
// operator template shape) — the diesel advisory keys off this.
function makeTemplate(): IsometricGhgEntryTemplate {
  return {
    id: "rvt_warn_1",
    credit_type: "REMOVAL",
    groups: [
      {
        id: "grp-1",
        key: "co2-stored",
        components: [
          {
            id: "rtc-1",
            blueprint_key: "carbon_rich_substance_sequestration",
            inputs: [],
          },
        ],
      },
    ],
  } as unknown as IsometricGhgEntryTemplate;
}

describe("buildSubmissionWarnings — month straddle (issue #320)", () => {
  it("emits no straddle warning when production start and latest application share a UTC month", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: makeTemplate(),
      runs: [makeRun({ startTime: new Date("2026-01-05T00:00:00Z") })],
      lineages: [makeLineage(new Date("2026-01-28T00:00:00Z"))],
    });
    expect(warnings).toEqual([]);
  });

  it("warns when the latest application falls in a later UTC month than production start", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: makeTemplate(),
      runs: [makeRun({ startTime: new Date("2026-01-05T00:00:00Z") })],
      lineages: [
        makeLineage(new Date("2026-01-20T00:00:00Z")),
        makeLineage(new Date("2026-04-05T00:00:00Z")),
      ],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("spans multiple months");
    expect(warnings[0]).toContain("2026-01");
    expect(warnings[0]).toContain("2026-04");
    expect(warnings[0]).toContain("§8.6.2");
  });

  it("anchors the straddle check on the EARLIEST run start and the LATEST application", () => {
    // Runs start Jan + Feb; applications Feb + Feb → straddle (Jan vs Feb),
    // even though the later run and both applications share February.
    const warnings = buildSubmissionWarnings({
      defaultTemplate: makeTemplate(),
      runs: [
        makeRun({ startTime: new Date("2026-02-01T00:00:00Z") }),
        makeRun({ startTime: new Date("2026-01-30T00:00:00Z") }),
      ],
      lineages: [
        makeLineage(new Date("2026-02-10T00:00:00Z")),
        makeLineage(new Date("2026-02-02T00:00:00Z")),
      ],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("production started 2026-01");
    expect(warnings[0]).toContain("latest application 2026-02");
  });

  it("emits nothing without runs or lineages (nothing to compare)", () => {
    expect(
      buildSubmissionWarnings({
        defaultTemplate: makeTemplate(),
        runs: [],
        lineages: [makeLineage(new Date("2026-04-05T00:00:00Z"))],
      }),
    ).toEqual([]);
    expect(
      buildSubmissionWarnings({
        defaultTemplate: makeTemplate(),
        runs: [makeRun({ startTime: new Date("2026-01-05T00:00:00Z") })],
        lineages: [],
      }),
    ).toEqual([]);
  });

  it("fires independently of the template (a straddle is a property of the dates alone)", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: null,
      runs: [makeRun({ startTime: new Date("2026-01-05T00:00:00Z") })],
      lineages: [makeLineage(new Date("2026-02-05T00:00:00Z"))],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("spans multiple months");
  });
});

describe("buildSubmissionWarnings — startup diesel (ADR 0015)", () => {
  it("still surfaces the unmapped-diesel advisory alongside a straddle warning", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: makeTemplate(),
      runs: [
        makeRun({
          startTime: new Date("2026-01-05T00:00:00Z"),
          dieselOperationLiters: 12,
        }),
      ],
      lineages: [makeLineage(new Date("2026-02-05T00:00:00Z"))],
    });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("Startup/plant diesel");
    expect(warnings[1]).toContain("spans multiple months");
  });

  it("emits only the diesel advisory when the window stays within one month", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: makeTemplate(),
      runs: [
        makeRun({
          startTime: new Date("2026-01-05T00:00:00Z"),
          preprocessingFuelLiters: 3,
        }),
      ],
      lineages: [makeLineage(new Date("2026-01-25T00:00:00Z"))],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Startup/plant diesel");
  });
});
