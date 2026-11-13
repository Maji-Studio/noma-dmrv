import { describe, expect, it } from "vitest";
import { buildResendChangeRows, NOT_IN_THIS_VERSION, NOT_SENT_BEFORE } from "./resend-comparison-model";

const name = (id: string) => (id === "rtc_1" ? "Diesel" : undefined);

describe("buildResendChangeRows", () => {
  it("returns null when the earlier numbers could not be read", () => {
    expect(buildResendChangeRows({ previousVersion: 1, lines: null }, name)).toBeNull();
  });

  it("drops unchanged lines and names added and removed ones in words, never zero", () => {
    const rows = buildResendChangeRows({
      previousVersion: 1,
      lines: [
        { componentId: "rtc_1", inputKey: "amount", previous: { value: 10, unit: "litre" }, current: { value: 12, unit: "litre" } },
        { componentId: "rtc_1", inputKey: "same", previous: { value: 5, unit: "litre" }, current: { value: 5, unit: "litre" } },
        { componentId: "rtc_2", inputKey: "heat_use", previous: null, current: { value: 3, unit: "litre" } },
        { componentId: "rtc_3", inputKey: "gone", previous: { value: 4, unit: "litre" }, current: null },
      ],
    }, name);
    expect(rows?.map((row) => [row.label, row.before, row.after])).toEqual([
      ["Diesel, amount", "10 litre", "12 litre"],
      ["Heat use", NOT_SENT_BEFORE, "3 litre"],
      ["Gone", "4 litre", NOT_IN_THIS_VERSION],
    ]);
    expect(rows?.map((row) => row.addedOrRemoved)).toEqual([false, true, true]);
  });

  it("ignores a difference smaller than the figure shows and labels several inputs of one component", () => {
    const rows = buildResendChangeRows({
      previousVersion: 1,
      lines: [
        { componentId: "rtc_1", inputKey: "amount", previous: { value: 10.0001, unit: "litre" }, current: { value: 10.0002, unit: "litre" } },
        { componentId: "rtc_1", inputKey: "distance", previous: { value: 1, unit: "km" }, current: { value: 2, unit: "km" } },
        { componentId: "rtc_1", inputKey: "mass", previous: { value: 1, unit: "t" }, current: { value: 3, unit: "t" } },
      ],
    }, name);
    expect(rows?.map((row) => row.label)).toEqual(["Diesel, distance", "Diesel, mass"]);
  });
});
