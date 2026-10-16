import { expect, it } from "vitest";
import { legacyBlocker, removalLineBlockerMessage, templateRemovalBlocker } from "./removal-blockers";
import { REMOVAL_TEMPLATE_BLOCKERS, removalTemplateBlockerDestination, type RemovalTemplateBlockerCode } from "./removal-template-blockers";

it("retains every template message and delegates every fix destination to the existing map", () => {
  for (const code of Object.keys(REMOVAL_TEMPLATE_BLOCKERS) as RemovalTemplateBlockerCode[]) {
    expect(templateRemovalBlocker(code)).toEqual({ code, message: REMOVAL_TEMPLATE_BLOCKERS[code], fixTarget: removalTemplateBlockerDestination(code) });
  }
});
it("wraps legacy reasons without guessing a destination", () => {
  expect(legacyBlocker("Existing reason")).toEqual({ code: "legacy", message: "Existing reason", fixTarget: null });
  expect(legacyBlocker("Existing reason", "deliveryEvidence").fixTarget).toBe("deliveryEvidence");
});

it.each(["lineHasNoSource", "lineNeedsSetup", "forbiddenLine"] as const)("names only the affected line for %s and falls back without a reference", (code) => {
  const blocker = { code, message: "Existing guidance.", fixTarget: null };
  expect(removalLineBlockerMessage(blocker)).toBe("Existing guidance.");
  expect(removalLineBlockerMessage({ ...blocker, lineRef: { componentId: "line", displayName: "Metered electricity" } })).toBe("Metered electricity: Existing guidance.");
});
it.each(["lineNeedsReview", "templateNotFullyRead"] as const)("keeps %s template-wide even with a line reference", (code) => {
  const message = code === "lineNeedsReview" ? REMOVAL_TEMPLATE_BLOCKERS.templateLinesNeedReview : REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead;
  expect(removalLineBlockerMessage({ code, message, fixTarget: null, lineRef: { componentId: "line", displayName: "Metered electricity" } })).toBe(message);
});
