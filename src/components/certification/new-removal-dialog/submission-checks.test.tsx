import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ENTITY_READINESS_CHECK_DISPLAY_LIMIT, type RemovalRequirementCheck } from "@/lib/certification/readiness";
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
  it("links template pin blockers to each batch's Switch template and line blockers to the review", () => {
    const html = renderToStaticMarkup(<SubmissionChecks
      checks={withUnmet("template", { templateBlockerCodes: ["mixedTemplatePins", "templateLinesNeedReview"] })}
      facilityId="facility-1"
      creditBatches={[{ id: "batch-1", code: "CB-1" }, { id: "batch-2", code: "CB-2" }]}
    />);
    expect(html).toContain('href="/credit-batches/batch-1?facility=facility-1&amp;focus=removal-template"');
    expect(html).toContain(">Switch template on CB-2</a>");
    expect(html).toContain('href="/certification/settings?section=removal-templates&amp;facility=facility-1"');
    expect(html).toContain(">Review template lines</a>");
    expect(html).not.toContain(">Open settings</a>");
  });

  it.each([
    ["feedstock", "/feedstocks", "Review feedstock transport"],
    ["biochar", "/deliveries", "Review biochar transport"],
    ["sample", "/samples", "Review sample transport"],
  ] as const)("links %s transport blockers to their repair list", (category, path, label) => {
    const html = renderToStaticMarkup(<SubmissionChecks
      checks={withUnmet("transportUniformity", { transportCategory: category })}
      facilityId="facility-1"
    />);
    expect(html).toContain(`href="${path}?facility=facility-1"`);
    expect(html).toContain(`>${label}</a>`);
  });

  it("renders every category and repair link when transport keys repeat", () => {
    const categories = ["feedstock", "biochar", "sample"] as const;
    const checks = categories.flatMap((category) =>
      (["transport", "transportUniformity"] as const).map((key) => ({
        key,
        label: "Transport check",
        requirementLabel: "Transport check",
        status: "unmet" as const,
        transportCategory: category,
        detail: `${category} ${key} needs attention`,
      })),
    );
    const html = renderToStaticMarkup(
      <SubmissionChecks checks={checks} facilityId="facility-1" />,
    );
    for (const check of checks) expect(html).toContain(check.detail);
    for (const path of ["/feedstocks", "/deliveries", "/samples"]) {
      expect(html.match(new RegExp(`href="${path}\\?facility=facility-1"`, "g"))).toHaveLength(2);
    }
  });

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
    expect(html).toMatch(/<h3[^>]*>\s*What to fix\s*<\/h3>/);
    expect(html).not.toContain("<button");
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
    const sampleHtml = renderToStaticMarkup(
      <SubmissionChecks
        checks={withUnmet("measurementDates", { fixTarget: "labSamples" })}
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
    const runAndSampleHtml = renderToStaticMarkup(
      <SubmissionChecks
        checks={withUnmet("measurementDates", {
          fixTarget: "productionRunsAndLabSamples",
        })}
        facilityId="facility-1"
      />,
    );
    const applicationAndSampleHtml = renderToStaticMarkup(
      <SubmissionChecks
        checks={withUnmet("measurementDates", {
          fixTarget: "applicationsAndLabSamples",
        })}
        facilityId="facility-1"
      />,
    );

    expect(runHtml).toContain('href="/production-runs?facility=facility-1"');
    expect(applicationHtml).toContain(
      'href="/applications?facility=facility-1"',
    );
    expect(applicationHtml).not.toContain('href="/production-runs');
    expect(sampleHtml).toContain('href="/samples?facility=facility-1"');
    expect(runAndSampleHtml).toContain(
      'href="/production-runs?facility=facility-1"',
    );
    expect(runAndSampleHtml).toContain('href="/samples?facility=facility-1"');
    expect(applicationAndSampleHtml).toContain(
      'href="/applications?facility=facility-1"',
    );
    expect(applicationAndSampleHtml).toContain(
      'href="/samples?facility=facility-1"',
    );

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
            label: "Registry value sources linked",
            requirementLabel: "Registry value sources linked",
            status: "warning",
            detail: "2 files will upload on submit",
          },
        ]}
        facilityId="facility-1"
      />,
    );

    expect(html).toContain("8 checks passed");
    expect(html).not.toContain("Registry value sources linked");
    expect(html).not.toContain("2 files will upload on submit");
  });
  it("keeps the location repair link on the single feedstock transport check", () => {
    const html = renderToStaticMarkup(<SubmissionChecks
      checks={withUnmet("transport", { transportCategory: "feedstock", lineageIssues: [{
        detail: "Missing transport distance", fixTarget: "feedstocks",
        record: { id: "feedstock-one", code: "FS-1", href: "/suppliers?location=location-one&mode=edit" },
      }] })} facilityId="facility-1"
    />);
    expect(html).toContain('href="/suppliers?location=location-one&amp;mode=edit"');
    expect(html).toContain("Edit location distances");
  });

  it("links missing proof to the delivery evidence section", () => {
    const html = renderToStaticMarkup(<SubmissionChecks
      checks={withUnmet("entityReadiness", { lineageIssues: [{
        detail: "Delivery D-0012 has no proof of delivery.", fixTarget: "deliveryEvidence",
        record: { id: "delivery-1", code: "D-0012" },
      }] })} facilityId="facility-1"
    />);
    expect(html).toContain("delivery=delivery-1&amp;mode=edit&amp;focus=transport-evidence");
    expect(html).toContain("Review D-0012 evidence");
  });

  it("caps proof links and names each delivery", () => {
    const lineageIssues = Array.from({ length: ENTITY_READINESS_CHECK_DISPLAY_LIMIT + 1 }, (_, index) => ({
      detail: "Missing proof", fixTarget: "deliveryEvidence" as const,
      record: { id: `delivery-${index}`, code: `D-${index}` },
    }));
    const html = renderToStaticMarkup(<SubmissionChecks
      checks={withUnmet("entityReadiness", { lineageIssues })} facilityId="facility-1"
    />);
    expect(html.match(/focus=transport-evidence/g)).toHaveLength(ENTITY_READINESS_CHECK_DISPLAY_LIMIT);
    expect(html).toContain("Review D-0 evidence");
    expect(html).not.toContain(`Review D-${ENTITY_READINESS_CHECK_DISPLAY_LIMIT} evidence`);
  });
});
