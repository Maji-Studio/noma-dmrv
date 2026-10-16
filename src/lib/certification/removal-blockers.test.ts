import { expect, it } from "vitest";
import { legacyBlocker, templateRemovalBlocker } from "./removal-blockers";
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
