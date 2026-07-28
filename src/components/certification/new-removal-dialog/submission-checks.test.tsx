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

describe("SubmissionChecks", () => {
  it("collapses the compact readiness list behind a concise result summary", () => {
    const html = renderToStaticMarkup(
      <SubmissionChecks checks={CHECKS} facilityId="facility-1" />,
    );

    expect(html).toContain("Submission checks");
    expect(html).toContain("9 of 9 checks passed");
    expect(html).toMatch(/<button[^>]*>[\s\S]*Submission checks[\s\S]*<\/button>/);
    expect(html).not.toContain("Removal template resolved");
  });

  it("opens automatically and shows the compact rows when attention is needed", () => {
    const blockedChecks = CHECKS.map((check) =>
      check.key === "template"
        ? {
            ...check,
            status: "unmet" as const,
            detail: "No default removal template is selected.",
          }
        : check,
    );
    const html = renderToStaticMarkup(
      <SubmissionChecks checks={blockedChecks} facilityId="facility-1" />,
    );

    expect(html).toContain("8 of 9 checks passed · 1 need attention");
    expect(html).toContain("Removal template resolved");
    expect(html).toContain("No default removal template is selected.");
    expect(html).toContain(
      'href="/certification/settings?section=certifier&amp;facility=facility-1"',
    );
  });

  it("opens automatically when resumed production lineage is blocked", () => {
    const blockedChecks = CHECKS.map((check) =>
      check.key === "production"
        ? {
            ...check,
            status: "unmet" as const,
            detail: "No applications fall in this batch's crediting period.",
          }
        : check,
    );
    const html = renderToStaticMarkup(
      <SubmissionChecks checks={blockedChecks} facilityId="facility-1" />,
    );

    expect(html).toContain("8 of 9 checks passed · 1 need attention");
    expect(html).toContain("Production lineage complete");
    expect(html).toContain(
      "No applications fall in this batch&#x27;s crediting period.",
    );
  });

  it("routes future-date blockers only to their typed record target", () => {
    const futureRunChecks = CHECKS.map((check) =>
      check.key === "measurementDates"
        ? {
            ...check,
            status: "unmet" as const,
            fixTarget: "productionRuns" as const,
          }
        : check,
    );
    const futureApplicationChecks = CHECKS.map((check) =>
      check.key === "measurementDates"
        ? {
            ...check,
            status: "unmet" as const,
            fixTarget: "applications" as const,
          }
        : check,
    );

    const runHtml = renderToStaticMarkup(
      <SubmissionChecks checks={futureRunChecks} facilityId="facility-1" />,
    );
    const applicationHtml = renderToStaticMarkup(
      <SubmissionChecks
        checks={futureApplicationChecks}
        facilityId="facility-1"
      />,
    );

    expect(runHtml).toContain(
      'href="/production-runs?facility=facility-1"',
    );
    expect(applicationHtml).toContain(
      'href="/applications?facility=facility-1"',
    );
    expect(applicationHtml).not.toContain('href="/production-runs');
  });

  it("opens automatically and surfaces evidence advisories", () => {
    const checksWithWarning: RemovalRequirementCheck[] = [
      ...CHECKS,
      {
        key: "evidence",
        label: "Supporting evidence linked",
        requirementLabel: "Supporting evidence linked",
        status: "warning",
        detail: "2 files will be mirrored automatically on submit",
      },
    ];
    const html = renderToStaticMarkup(
      <SubmissionChecks checks={checksWithWarning} facilityId="facility-1" />,
    );

    expect(html).toContain("9 of 10 checks passed · 1 need attention");
    expect(html).toContain("2 files will be mirrored automatically on submit");
  });
});
