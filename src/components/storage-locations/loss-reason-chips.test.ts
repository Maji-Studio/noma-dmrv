import { describe, expect, it } from "vitest";
import { reasonWithPreset } from "./loss-reason-chips";

describe("reasonWithPreset", () => {
  it.each([
    { name: "empty text takes the preset", value: "", picked: "Spillage", expected: "Spillage" },
    { name: "whitespace only takes the preset", value: "   ", picked: "Spillage", expected: "Spillage" },
    { name: "typed detail gets the preset in front", value: "at the hopper", picked: "Spillage", expected: "Spillage: at the hopper" },
    { name: "another preset is swapped, detail kept", value: "Spoilage: wet batch", picked: "Write-off", expected: "Write-off: wet batch" },
    { name: "a bare preset is swapped", value: "Spoilage", picked: "Write-off", expected: "Write-off" },
    { name: "re-picking clears the preset, detail kept", value: "Spillage: at the hopper", picked: "Spillage", expected: "at the hopper" },
    { name: "re-picking a bare preset clears it", value: "Spillage", picked: "Spillage", expected: "" },
  ])("$name", ({ value, picked, expected }) => {
    expect(reasonWithPreset(value, picked)).toBe(expected);
  });
});
