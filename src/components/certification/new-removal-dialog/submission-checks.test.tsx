import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RemovalRequirementCheck } from "@/lib/certification/readiness";
import { SubmissionChecks } from "./submission-checks";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

const CHECKS = [
  ["mapping", "Facility linked to a registry project"],
  ["credentials", "Organization registry credentials"],
  ["template", "Removal template resolved"],
  ["transport", "Transport legs recorded"],
  ["transportUniformity", "Transport legs aggregate cleanly"],
  ["production", "Production lineage complete"],
  ["measurementDates", "Production and application dates"],
  ["entityReadiness", "Certifier fields on linked records"],
  ["durability", "Sampling & durability eligibility"],
].map(([key, requirementLabel]) => ({
  key,
  label: requirementLabel,
  requirementLabel,
  status: "met",
})) as RemovalRequirementCheck[];

function withUnmet(
  key: RemovalRequirementCheck["key"],
  overrides: Partial<RemovalRequirementCheck> = {},
): RemovalRequirementCheck[] {
  return CHECKS.map((check) =>
    check.key === key
      ? ({ ...check, status: "unmet", ...overrides } as RemovalRequirementCheck)
      : check,
  );
}

describe("SubmissionChecks", () => {
  it("lists only what the operator must fix, with passed checks reduced to a count", () => {
    const html = renderToStaticMarkup(
      <SubmissionChecks
        checks={withUnmet("template", {
          detail: "No default Removal template is selected.",
        })}
        facilityId="facility-1"
      />,
    );

    expect(html).toContain("What to fix");
    expect(html).toContain("8 checks passed");
    expect(html).toMatch(
      /<button[^>]*>[\s\S]*What to fix[\s\S]*<\/button>/,
    );
    expect(html).toContain("Removal template resolved");
    expect(html).toContain("No default Removal template is selected.");
    expect(html).toContain(
      'href="/certification/settings?section=certifier&amp;facility=facility-1"',
    );
    // Passing checks are noise on a screen titled "need attention".
    expect(html).not.toContain("Facility linked to a registry project");
  });

  it("shows the unmet detail for blocked production lineage", () => {
    const html = renderToStaticMarkup(
      <SubmissionChecks
        checks={withUnmet("production", {
          detail: "No applications fall in this batch's crediting period.",
        })}
        facilityId="facility-1"
      />,
    );

    expect(html).toContain("Production lineage complete");
    expect(html).toContain(
      "No applications fall in this batch&#x27;s crediting period.",
    );
  });

  it("routes future-date blockers to every record target they name", () => {
    const runHtml = renderToStaticMarkup(
      <SubmissionChecks
        checks={withUnmet("measurementDates", { fixTarget: "productionRuns" })}
        facilityId="facility-1"
      />,
    );
    const applicationHtml = renderToStaticMarkup(
      <SubmissionChecks
        checks={withUnmet("measurementDates", { fixTarget: "applications" })}
        facilityId="facility-1"
      />,
    );
    const bothHtml = renderToStaticMarkup(
      <SubmissionChecks
        checks={withUnmet("measurementDates", {
          fixTarget: "productionRunsAndApplications",
          detail:
            "Production run PR-26-001 ends on 2028-01-02. · " +
            "Application AP-26-001 is dated 2028-01-08.",
        })}
        facilityId="facility-1"
      />,
    );

    expect(runHtml).toContain('href="/production-runs?facility=facility-1"');
    expect(applicationHtml).toContain(
      'href="/applications?facility=facility-1"',
    );
    expect(applicationHtml).not.toContain('href="/production-runs');

    expect(bothHtml).toContain('href="/production-runs?facility=facility-1"');
    expect(bothHtml).toContain('href="/applications?facility=facility-1"');
    // Each named record gets its own bullet instead of one run-on sentence.
    expect(bothHtml).toContain("PR-26-001");
    expect(bothHtml).toContain("AP-26-001");
    expect(bothHtml).toMatch(/<li[^>]*>[\s\S]*PR-26-001/);
    expect(bothHtml).toContain("Future dates");
    expect(bothHtml).toContain(
      "Correct these dates, or wait until both dates have passed.",
    );
    expect(bothHtml).toContain(">Review production runs</a>");
    expect(bothHtml).toContain(">Review applications</a>");
    expect(bothHtml).not.toContain("Change the end time or wait");
    expect(bothHtml).not.toContain("Change the application date or wait");
  });

  it("leaves automatic submit-time advisories out of the count and the list", () => {
    const html = renderToStaticMarkup(
      <SubmissionChecks
        checks={[
          ...withUnmet("template", {
            detail: "No default Removal template is selected.",
          }),
          {
            key: "evidence",
            label: "Supporting evidence linked",
            requirementLabel: "Supporting evidence linked",
            status: "warning",
            detail: "2 files will upload on submit",
          },
        ]}
        facilityId="facility-1"
      />,
    );

    expect(html).toContain("8 checks passed");
    expect(html).not.toContain("Supporting evidence linked");
    expect(html).not.toContain("2 files will upload on submit");
  });
});
