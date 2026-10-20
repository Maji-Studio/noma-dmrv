import { describe, expect, it } from "vitest";
import {
  buildRemovalRequirementsChecklist,
  deriveRemovalReadiness,
  type RemovalReadinessFacts,
} from "./readiness";
import { certCheckLabel } from "./requirement-labels";
import { removalTemplateBlocker } from "./removal-template-blockers";
import type { RemovalBlocker } from "./removal-blockers";
import { batchLinesToDecide, deriveBatchHealth, type BatchHealthFacts } from "./batch-health";

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

function batchFacts(overrides: Partial<BatchHealthFacts> = {}): BatchHealthFacts {
  return {
    carbonMissingInputs: [], facilityEmissionsBlockers: [], feedstockTypeMappingGaps: [],
    entityReadinessGaps: [], hasSubmittableRuns: true, facilitySetupComplete: true,
    requiredTransport: [], ...overrides,
  };
}

describe("batch lines to decide", () => {
  it("carries the undecided line count on the Decide lines check only, as its label does", () => {
    const health = deriveBatchHealth(batchFacts({
      templateBlockers: [
        removalTemplateBlocker("templateNotFound"),
        removalTemplateBlocker("templateNotFullyRead"),
        removalTemplateBlocker("templateLinesNeedReview"),
      ],
      undecidedLineIds: ["one", "two", "two"],
      emissionLines: [],
    }));
    const counted = health.checks.filter((check) => check.linesToDecide !== undefined);
    expect(counted).toHaveLength(1);
    expect(counted[0]).toMatchObject({ key: "templateLines", status: "unmet", fixTarget: "templateLineReview", linesToDecide: 2 });
    expect(certCheckLabel(counted[0])).toBe("2 lines to decide");
    expect(batchLinesToDecide(health)).toBe(2);
    for (const status of ["met", "skipped"] as const) {
      expect(batchLinesToDecide({ ...health, checks: [{ ...counted[0], status }] })).toBe(0);
    }
  });

  it("has no count when the template was not read in full", () => {
    const health = deriveBatchHealth(batchFacts({
      templateBlockers: [removalTemplateBlocker("templateNotFullyRead")],
      emissionLines: [],
    }));
    const check = health.checks.find((item) => item.key === "templateLines")!;
    expect(certCheckLabel(check)).toBe("Template not fully read");
    expect(check).not.toHaveProperty("linesToDecide");
    expect(batchLinesToDecide(health)).toBe(0);
  });

  it("returns zero for a pin-only blocker", () => {
    const health = deriveBatchHealth(batchFacts({
      templateBlockers: [removalTemplateBlocker("unpinnedTemplate")],
    }));
    expect(batchLinesToDecide(health)).toBe(0);
    expect(health.checks.every((check) => !("linesToDecide" in check))).toBe(true);
  });

  it.each([undefined, null])("returns zero for missing health: %s", (health) => {
    expect(batchLinesToDecide(health)).toBe(0);
  });
});

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
        templateLinesNeedReview: "Template lines not ready", templateNotFullyRead: "Template not fully read", forbiddenLine: "Template lines not ready",
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
    { blockers: [lineBlocker()], label: "Template lines not ready" },
    { blockers: [lineBlocker("one"), lineBlocker("one")], label: "1 line to decide" },
    { blockers: [lineBlocker("one"), lineBlocker("two"), lineBlocker("one")], label: "2 lines to decide" },
  ])("uses $label for per-line facts without inflating repeated lines", ({ blockers, label }) => {
    const input = facts({ emissionLineBlockers: blockers, undecidedLineIds: blockers.flatMap((blocker) => blocker.lineRef ? [blocker.lineRef.componentId] : []) });
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
    expect(certCheckLabel(emissions!)).toBe("Emissions entries without a file");
    expect(deriveRemovalReadiness(input)).toMatchObject({ state: "blocked", reasons: [entry.message] });
    expect(certCheckLabel(templateChecks(facts({ emissionLineBlockers: [entry, lineBlocker("one")], undecidedLineIds: ["one"] }))[1]))
      .toBe("1 line to decide");
  });

  it.each([
    { reason: "unmapped", label: "Template lines not ready" },
    { reason: "unassigned", label: "1 line to decide" },
  ] as const)("puts $reason line coverage on Lines decided with the template set", ({ reason, label }) => {
    const input = facts({ undecidedLineIds: reason === "unassigned" ? ["line"] : [], unbindableTemplateInputs: [{
      state: "needsSetup", groupKey: "pyrolysis", componentId: "line", componentDisplayName: "Line",
      blueprintKey: "unknown", inputKey: "unknown", reason,
    }] });
    const [set, lines] = templateChecks(input);
    expect(set.status).toBe("met");
    expect(lines).toMatchObject({ status: "unmet", templateBlockerCodes: reason === "unassigned" ? ["templateLinesNeedReview"] : [] });
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

it("uses only template line blocker messages before coverage wording", () => {
  const blocker = removalTemplateBlocker("templateLinesNeedReview");
  const input = facts({
    templateBlockers: [blocker], undecidedLineIds: ["one"],
    unbindableTemplateInputs: [{ state: "needsReview", groupKey: "pyrolysis", componentId: "one", componentDisplayName: "One",
      blueprintKey: "grid_electricity_use", inputKey: "electricity_use", reason: "unassigned" }],
    emissionLineBlockers: [lineBlocker("one")],
  });
  expect(templateChecks(input)[1]).toMatchObject({ detail: blocker.message, unmetLabel: "1 line to decide" });
});

it.each(["lineNeedsSetup", "lineHasNoSource", "forbiddenLine"] as const)("keeps the real %s code without suggesting an undecided line", (code) => {
  const input = facts({ emissionLineBlockers: [{ code, message: "A decided line cannot be filled.", fixTarget: "templateLineReview" }] });
  expect(templateChecks(input)[1]).toMatchObject({
    status: "unmet", templateBlockerCodes: [code], templateFixTargets: ["templateLines"], unmetLabel: "Template lines not ready",
  });
  expect(deriveRemovalReadiness(input).state).toBe("blocked");
});

it.each(["project-scope", "unrecognized-component", "ambiguous"] as const)("routes %s coverage without inventing blocker codes", (reason) => {
  const input = facts({ undecidedLineIds: reason === "ambiguous" ? ["one"] : [], unbindableTemplateInputs: [{
    state: "needsSetup", groupKey: "pyrolysis", componentId: "one", componentDisplayName: "One",
    blueprintKey: "unknown", inputKey: "unknown", reason,
  }] });
  expect(templateChecks(input)[1]).toMatchObject({
    templateBlockerCodes: reason === "ambiguous" ? ["templateLinesNeedReview"] : [],
    templateFixTargets: reason === "ambiguous" ? ["templateLineReview"] : ["templateLines"],
  });
});
