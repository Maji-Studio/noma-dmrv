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
  ["measurementDates", "Production run and application dates have passed"],
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
          detail: "No default removal template is selected.",
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
    expect(html).toContain("No default removal template is selected.");
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

  it("routes single-kind future-date blockers to their record list", () => {
    const runHtml = renderToStaticMarkup(
      <SubmissionChecks
        checks={withUnmet("measurementDates", {
          fixTarget: "productionRuns",
          detail:
            "Production run PR-26-001 ends on 2028-01-02. " +
            "Change the end time or wait until then.",
        })}
        facilityId="facility-1"
      />,
    );
    const applicationHtml = renderToStaticMarkup(
      <SubmissionChecks
        checks={withUnmet("measurementDates", {
          fixTarget: "applications",
          detail:
            "Application AP-26-001 is dated 2028-01-08. " +
            "Change the application date or wait until then.",
        })}
        facilityId="facility-1"
      />,
    );

    expect(runHtml).toContain('href="/production-runs?facility=facility-1"');
    expect(applicationHtml).toContain(
      'href="/applications?facility=facility-1"',
    );
    expect(applicationHtml).not.toContain('href="/production-runs');
    expect(runHtml).toContain(">Open production runs</a>");
    expect(applicationHtml).toContain(">Open applications</a>");
    expect(runHtml).toContain(
      "Production run and application dates have passed",
    );
  });

  it("does not point mixed future-date blockers at only one record list", () => {
    const html = renderToStaticMarkup(
      <SubmissionChecks
        checks={withUnmet("measurementDates", {
          detail:
            "Production run PR-26-001 ends on 2028-01-02. · " +
            "Application AP-26-001 is dated 2028-01-08.",
        })}
        facilityId="facility-1"
      />,
    );

    expect(html).toContain("PR-26-001");
    expect(html).toContain("AP-26-001");
    expect(html).not.toContain('href="/production-runs');
    expect(html).not.toContain('href="/applications');
  });

  it("leaves automatic submit-time advisories out of the count and the list", () => {
    const html = renderToStaticMarkup(
      <SubmissionChecks
        checks={[
          ...withUnmet("template", {
            detail: "No default removal template is selected.",
          }),
          {
            key: "evidence",
            label: "Supporting evidence linked",
            requirementLabel: "Supporting evidence linked",
            status: "warning",
            detail: "2 files upload on submit",
          },
        ]}
        facilityId="facility-1"
      />,
    );

    expect(html).toContain("8 checks passed");
    expect(html).not.toContain("Supporting evidence linked");
    expect(html).not.toContain("2 files upload on submit");
  });
});
