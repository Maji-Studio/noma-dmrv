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
  ["transportUniformity", "Transport legs aggregate cleanly"],
  ["production", "Production lineage complete"],
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
    expect(html).toContain("7 of 7 checks passed");
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

    expect(html).toContain("6 of 7 checks passed · 1 need attention");
    expect(html).toContain("Removal template resolved");
    expect(html).toContain("No default removal template is selected.");
    expect(html).toContain(
      'href="/certification/settings?tab=connection&amp;facility=facility-1"',
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

    expect(html).toContain("6 of 7 checks passed · 1 need attention");
    expect(html).toContain("Production lineage complete");
    expect(html).toContain(
      "No applications fall in this batch&#x27;s crediting period.",
    );
  });
});
