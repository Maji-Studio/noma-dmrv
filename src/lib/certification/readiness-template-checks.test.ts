import { describe, expect, it } from "vitest";
import {
  buildRemovalRequirementsChecklist,
  deriveRemovalReadiness,
  type RemovalReadinessFacts,
} from "./readiness";
import { certCheckLabel } from "./requirement-labels";
import { removalTemplateBlocker } from "./removal-template-blockers";
import type { RemovalBlocker } from "./removal-blockers";

function facts(overrides: Partial<RemovalReadinessFacts> = {}): RemovalReadinessFacts {
  return {
    local: null, lockInFlight: false, hasMapping: true, hasOrgCredentials: true,
    hasRemovalTemplate: true, hasSubmittableRuns: true, unresolvedBlueprintKeys: [],
    unbindableTemplateInputs: [], feedstockTypeMappingGaps: [], requiredTransport: [],
    ...overrides,
  };
}

function templateChecks(input: RemovalReadinessFacts) {
  return buildRemovalRequirementsChecklist(input).filter(
    (check) => check.key === "templateSet" || check.key === "templateLines",
  );
}

function lineBlocker(componentId?: string): RemovalBlocker {
  return {
    code: "lineNeedsReview", message: "Decide this line.", fixTarget: "templateLineReview",
    ...(componentId ? { lineRef: { componentId, displayName: componentId } } : {}),
  };
}

describe("Removal template requirement split", () => {
  it("shows both affirmative labels when the template is ready", () => {
    const input = facts();
    const checks = templateChecks(input);
    expect(checks.map((check) => [check.key, check.status, certCheckLabel(check)])).toEqual([
      ["templateSet", "met", "Template set"],
      ["templateLines", "met", "Lines decided"],
    ]);
    expect(deriveRemovalReadiness(input).state).toBe("ready");
  });

  it.each(["hasMapping", "hasOrgCredentials"] as const)("skips both checks without %s", (key) => {
    const input = facts({
      [key]: false,
      templateBlockers: [removalTemplateBlocker("unpinnedTemplate"), removalTemplateBlocker("templateLinesNeedReview")],
    });
    expect(templateChecks(input).map((check) => check.status)).toEqual(["skipped", "skipped"]);
    expect(templateChecks(input).every((check) => check.detail === undefined && check.templateBlockerCodes === undefined)).toBe(true);
    expect(deriveRemovalReadiness(input).state).toBe("blocked");
  });

  it.each([
    "unpinnedTemplate", "templateNotFound", "notRemovalTemplate", "mixedTemplatePins", "missingFixedDatapoint",
  ] as const)("puts %s on Template set and skips lines", (code) => {
    const input = facts({ templateBlockers: [removalTemplateBlocker(code)] });
    const [set, lines] = templateChecks(input);
    expect(set).toMatchObject({ key: "templateSet", status: "unmet", templateBlockerCodes: [code] });
    expect(certCheckLabel(set)).toBe(code === "unpinnedTemplate" ? "No Removal template chosen" : "Template cannot be used");
    expect(lines.status).toBe("skipped");
    expect(lines.templateBlockerCodes).toBeUndefined();
    expect(deriveRemovalReadiness(input).state).toBe("blocked");
  });

  it.each(["templateLinesNeedReview", "templateNotFullyRead", "forbiddenLine"] as const)(
    "puts %s on Lines decided with the pin met", (code) => {
      const blocker = removalTemplateBlocker(code);
      const input = facts({ templateBlockers: [blocker] });
      const [set, lines] = templateChecks(input);
      expect(set.status).toBe("met");
      expect(set.templateBlockerCodes).toBeUndefined();
      expect(lines).toMatchObject({
        key: "templateLines", status: "unmet", detail: blocker.message, templateBlockerCodes: [code],
      });
      expect(certCheckLabel(lines)).toBe({
        templateLinesNeedReview: "Lines to decide", templateNotFullyRead: "Template not fully read", forbiddenLine: "Template lines not ready",
      }[code]);
      expect(deriveRemovalReadiness(input)).toMatchObject({ state: "blocked", reasons: [blocker.message] });
    },
  );

  it("keeps each check's codes separate even when the line check is skipped", () => {
    const input = facts({ templateBlockers: [
      removalTemplateBlocker("unpinnedTemplate"),
      removalTemplateBlocker("templateLinesNeedReview"),
      removalTemplateBlocker("templateNotFullyRead"),
    ] });
    const [set, lines] = templateChecks(input);
    expect(set.templateBlockerCodes).toEqual(["unpinnedTemplate"]);
    expect(certCheckLabel(set)).toBe("No Removal template chosen");
    // A skipped check shows no link, so it carries no codes.
    expect(lines).toMatchObject({ status: "skipped" });
    expect(lines.templateBlockerCodes).toBeUndefined();
    expect(lines.detail).toBeUndefined();
  });

  it.each([
    { hasRemovalTemplate: false },
    { unresolvedBlueprintKeys: ["unknown"] },
  ] satisfies Partial<RemovalReadinessFacts>[])("puts legacy pin and binding facts on Template set: %j", (overrides) => {
    const input = facts(overrides);
    const [set, lines] = templateChecks(input);
    expect(set.status).toBe("unmet");
    expect(set.detail).toBeTruthy();
    expect(lines.status).toBe("skipped");
    expect(deriveRemovalReadiness(input).state).toBe("blocked");
  });

  it.each([
    { blockers: [lineBlocker()], label: "Lines to decide" },
    { blockers: [lineBlocker("one"), lineBlocker("one")], label: "1 line to decide" },
    { blockers: [lineBlocker("one"), lineBlocker("two"), lineBlocker("one")], label: "2 lines to decide" },
  ])("uses $label for per-line facts without inflating repeated lines", ({ blockers, label }) => {
    const input = facts({ emissionLineBlockers: blockers });
    const [set, lines] = templateChecks(input);
    expect(set.status).toBe("met");
    expect(lines.status).toBe("unmet");
    expect(certCheckLabel(lines)).toBe(label);
    expect(lines.detail).toBe("Decide this line.");
    expect(deriveRemovalReadiness(input).state).toBe("blocked");
  });

  it("keeps emission entry blockers blocking under Emissions, not as line decisions", () => {
    const entry: RemovalBlocker = {
      code: "entryMissingEvidence", message: "Add a file.", fixTarget: "emissions",
      lineRef: { componentId: "entry", displayName: "Entry" },
    };
    const input = facts({ emissionLineBlockers: [entry] });
    const [set, lines] = templateChecks(input);
    expect(set.status).toBe("met");
    expect(lines.status).toBe("met");
    const emissions = buildRemovalRequirementsChecklist(input).find((check) => check.key === "emissions");
    expect(emissions).toMatchObject({ status: "unmet", detail: entry.message });
    expect(certCheckLabel(emissions!)).toBe("Emission entries without a file");
    expect(deriveRemovalReadiness(input)).toMatchObject({ state: "blocked", reasons: [entry.message] });
    expect(certCheckLabel(templateChecks(facts({ emissionLineBlockers: [entry, lineBlocker("one")] }))[1]))
      .toBe("1 line to decide");
  });

  it.each([
    { reason: "unmapped", label: "Template lines not ready" },
    { reason: "unassigned", label: "1 line to decide" },
  ] as const)("puts $reason line coverage on Lines decided with the template set", ({ reason, label }) => {
    const input = facts({ unbindableTemplateInputs: [{
      state: "needsSetup", groupKey: "pyrolysis", componentId: "line", componentDisplayName: "Line",
      blueprintKey: "unknown", inputKey: "unknown", reason,
    }] });
    const [set, lines] = templateChecks(input);
    expect(set.status).toBe("met");
    expect(lines).toMatchObject({ status: "unmet", templateBlockerCodes: ["templateLinesNeedReview"] });
    expect(certCheckLabel(lines)).toBe(label);
    expect(deriveRemovalReadiness(input).state).toBe("blocked");
  });

  it("does not count lines when the template was not read in full", () => {
    const notRead: RemovalBlocker = { ...removalTemplateBlocker("templateNotFullyRead"), fixTarget: "templateLineReview",
      lineRef: { componentId: "one", displayName: "One" } };
    const lines = templateChecks(facts({ emissionLineBlockers: [notRead, { ...notRead, lineRef: { componentId: "two", displayName: "Two" } }] }))[1];
    expect(certCheckLabel(lines)).toBe("Template not fully read");
  });
});
