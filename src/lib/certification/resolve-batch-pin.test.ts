import { describe, expect, it } from "vitest";
import { resolveBatchPin } from "./resolve-batch-pin";

describe("batch pin resolution", () => {
  it.each([
    [[], { code: "unpinnedTemplate" }],
    [[null], { code: "unpinnedTemplate" }],
    [["A", null], { code: "unpinnedTemplate" }],
    [["A", "B", null], { code: "unpinnedTemplate" }],
    [["A", "B"], { code: "mixedTemplatePins" }],
    [["A", "A"], { pin: "A" }],
  ] as const)("classifies %j", (pins, expected) => {
    expect(resolveBatchPin(pins.map((removalTemplateId) => ({ removalTemplateId })))).toEqual(expected);
  });
});
