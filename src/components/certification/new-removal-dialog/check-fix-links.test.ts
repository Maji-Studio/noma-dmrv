import { describe, expect, it } from "vitest";
import { buildRemovalRequirementsChecklist, ENTITY_READINESS_CHECK_DISPLAY_LIMIT, type RemovalReadinessFacts } from "@/lib/certification/readiness";
import { LINE_NO_MAPPING_MESSAGE, LINE_TRANSPORT_REPLACEMENT_MESSAGE } from "@/lib/isometric/emission-line-constants";
import { dateGuidance, fixLinksFor } from "./check-fix-links";

const FACILITY = "facility-1";
const TEMPLATE_SETUP = "/settings/removal-templates?facility=facility-1&setup=template";
const TWO_BATCHES = [{ id: "batch-1", code: "CB-1" }, { id: "batch-2", code: "CB-2" }];

type Check = Parameters<typeof fixLinksFor>[0];
const links = (check: Check, batches: typeof TWO_BATCHES = []) => fixLinksFor(check, FACILITY, batches);

describe("fixLinksFor", () => {
  it("links template blockers to the Set template setup and line blockers to the review", () => {
    expect(links({ key: "templateSet", templateBlockerCodes: ["mixedTemplatePins"] }, TWO_BATCHES)).toEqual([
      expect.objectContaining({ label: "Set template", href: TEMPLATE_SETUP }),
    ]);
    const [line] = links({ key: "templateLines", templateBlockerCodes: ["templateLinesNeedReview"] }, TWO_BATCHES);
    expect(line.label).toBe("Answer in Settings");
    expect(line.href).toBe(TEMPLATE_SETUP);
  });

  it("sends a template check with no blocker code to the facility settings", () => {
    expect(links({ key: "templateSet" })).toEqual([{ label: "Open settings", href: "/settings/facilities?facility=facility-1" }]);
    expect(links({ key: "mapping" })).toEqual([{ label: "Open settings", href: "/settings/facilities?facility=facility-1" }]);
  });

  it.each([
    ["feedstock", "/feedstock-intake", "Review feedstock transport"],
    ["biochar", "/deliveries", "Review biochar transport"],
    ["sample", "/lab-samples", "Review sample transport"],
  ] as const)("links %s transport blockers to their repair list", (category, path, label) => {
    expect(links({ key: "transportUniformity", transportCategory: category })).toEqual([
      { label, href: `${path}?facility=facility-1` },
    ]);
  });

  it("opens Removal templates for a decided or unread template problem", () => {
    for (const code of ["templateNotFullyRead", "forbiddenLine", "lineNeedsSetup", "lineHasNoSource"] as const) {
      const checks = buildRemovalRequirementsChecklist({
        local: null, lockInFlight: false, hasMapping: true, hasOrgCredentials: true, hasRemovalTemplate: true,
        hasSubmittableRuns: true, unresolvedBlueprintKeys: [], unbindableTemplateInputs: [], requiredTransport: [], feedstockTypeMappingGaps: [],
        emissionLineBlockers: [{ code, message: "Check the template.", fixTarget: "templateLineReview" }],
      });
      const unmet = checks.find((check) => check.status === "unmet");
      expect(unmet).toBeDefined();
      const labels = links(unmet!).map((link) => link.label);
      expect(labels).toContain("Open Removal templates");
      expect(labels).not.toContain("Answer in Settings");
    }
  });

  it.each([LINE_NO_MAPPING_MESSAGE, LINE_TRANSPORT_REPLACEMENT_MESSAGE])("links replacement guidance to the Set template setup for 0, 1 and 2 batches: %s", (message) => {
    const facts: RemovalReadinessFacts = {
      local: null, lockInFlight: false, hasMapping: true, hasOrgCredentials: true, hasRemovalTemplate: true,
      hasSubmittableRuns: true, unresolvedBlueprintKeys: [], unbindableTemplateInputs: [], requiredTransport: [], feedstockTypeMappingGaps: [],
      emissionLineBlockers: [{ code: "lineNeedsSetup", message, fixTarget: "templateReplacement" }],
    };
    const unmet = buildRemovalRequirementsChecklist(facts).find((check) => check.status === "unmet")!;
    for (const count of [0, 1, 2]) {
      expect(links(unmet, TWO_BATCHES.slice(0, count))).toEqual([expect.objectContaining({ label: "Set template", href: TEMPLATE_SETUP })]);
    }
  });

  it("routes future-date blockers to every record target they name", () => {
    const hrefs = (fixTarget: NonNullable<Check["fixTarget"]>) => links({ key: "measurementDates", fixTarget }).map((link) => link.href);
    expect(hrefs("productionRuns")).toEqual(["/production-runs?facility=facility-1"]);
    expect(hrefs("applications")).toEqual(["/applications?facility=facility-1"]);
    expect(hrefs("labSamples")).toEqual(["/lab-samples?facility=facility-1"]);
    expect(hrefs("productionRunsAndApplications")).toEqual(["/production-runs?facility=facility-1", "/applications?facility=facility-1"]);
    expect(hrefs("productionRunsAndLabSamples")).toEqual(["/production-runs?facility=facility-1", "/lab-samples?facility=facility-1"]);
    expect(hrefs("applicationsAndLabSamples")).toEqual(["/applications?facility=facility-1", "/lab-samples?facility=facility-1"]);
    expect(links({ key: "measurementDates" })).toEqual([]);
    expect(links({ key: "measurementDates", fixTarget: "productionRunsAndApplications" }).map((link) => link.label)).toEqual([
      "Review production runs",
      "Review applications",
    ]);
  });

  it("keeps the location repair link on the single feedstock transport check", () => {
    const [link] = links({
      key: "transport",
      transportCategory: "feedstock",
      lineageIssues: [{
        kind: "feedstockTransport", instruction: "", detail: "Missing transport distance", fact: "Missing transport distance", fixTarget: "feedstocks",
        record: { id: "feedstock-one", code: "FS-1", href: "/suppliers?location=location-one&mode=edit" },
      }],
    });
    expect(link.href).toBe("/suppliers?location=location-one&mode=edit");
    expect(link.label).toBe("Edit location distances");
  });

  it("links missing proof to the delivery evidence section", () => {
    const [link] = links({
      key: "entityReadiness",
      lineageIssues: [{
        kind: "deliveryProof", instruction: "", detail: "Delivery D-0012 has no proof of delivery.", fact: "Delivery D-0012 has no proof of delivery.", fixTarget: "deliveryEvidence",
        record: { id: "delivery-1", code: "D-0012" },
      }],
    });
    expect(link.href).toContain("delivery=delivery-1&mode=edit&focus=transport-evidence");
    expect(link.label).toBe("Review D-0012 evidence");
  });

  it("caps proof links and names each delivery", () => {
    const lineageIssues = Array.from({ length: ENTITY_READINESS_CHECK_DISPLAY_LIMIT + 1 }, (_, index) => ({
      kind: "deliveryProof" as const, instruction: "", detail: "Missing proof", fact: "Missing proof", fixTarget: "deliveryEvidence" as const,
      record: { id: `delivery-${index}`, code: `D-${index}` },
    }));
    const result = links({ key: "entityReadiness", lineageIssues });
    expect(result).toHaveLength(ENTITY_READINESS_CHECK_DISPLAY_LIMIT);
    expect(result[0].label).toBe("Review D-0 evidence");
    expect(result.map((link) => link.label)).not.toContain(`Review D-${ENTITY_READINESS_CHECK_DISPLAY_LIMIT} evidence`);
  });

  it.each([0, 1, 2])("labels the emissions link for %s batches", (count) => {
    const result = links({ key: "emissions" }, TWO_BATCHES.slice(0, count));
    expect(result[0].label).toBe(count < 2 ? "Review emissions" : "Review emissions on CB-1");
    expect(result[0].href).toBe(count === 0 ? "/credit-batches?facility=facility-1" : "/credit-batches/batch-1?facility=facility-1&tab=emissions");
    if (count === 2) expect(result[1].label).toBe("Review emissions on CB-2");
  });
});

describe("dateGuidance", () => {
  it("words the guidance for one, two and more dates", () => {
    expect(dateGuidance(1)).toBe("Correct this date, or wait until it has passed.");
    expect(dateGuidance(2)).toBe("Correct these dates, or wait until both dates have passed.");
    expect(dateGuidance(3)).toBe("Correct these dates, or wait until all 3 dates have passed.");
  });
});
