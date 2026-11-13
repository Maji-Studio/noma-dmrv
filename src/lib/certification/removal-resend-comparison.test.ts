import { expect, it } from "vitest";
import { buildRemovalResendComparison } from "./removal-resend-comparison";

const input = (inputKey: string, value: number, unit = "kg") => ({ rtcId: "component", inputKey, kind: "monitored", value, unit });
const previous = { status: "superseded", version: 1, externalId: "rmv_old",
  metadata: { registryMissingExternalId: "rmv_old", registryMissingConfirmedAt: "2026-11-13T00:00:00Z" },
  payloadSnapshot: { semantic: { inputs: [input("mass", 10), input("removed", 3)] } } };
it("pairs previous and current numbers by component/input, preserving units and absent lines", () => {
  expect(buildRemovalResendComparison(previous, { inputs: [input("new", 4), input("mass", 2, "t")] })).toEqual({ previousVersion: 1, lines: [
    { componentId: "component", inputKey: "mass", previous: { value: 10, unit: "kg" }, current: { value: 2, unit: "t" } },
    { componentId: "component", inputKey: "removed", previous: { value: 3, unit: "kg" }, current: null },
    { componentId: "component", inputKey: "new", previous: null, current: { value: 4, unit: "kg" } },
  ] });
});
it("reports unavailable snapshots without inventing zero values", () => {
  expect(buildRemovalResendComparison({ ...previous, payloadSnapshot: {} }, { inputs: [] })).toEqual({ previousVersion: 1, lines: null });
  expect(buildRemovalResendComparison(previous, null)?.lines).toBeNull();
  expect(buildRemovalResendComparison({ ...previous, metadata: {} }, { inputs: [] })).toBeNull();
});
