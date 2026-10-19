import { describe, expect, it } from "vitest";
import { SAMPLING_TIME_REQUIRED_MESSAGE, sampleFormSchema, updateSampleSchema } from "./samples";

const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const form = { creditBatchId: ID, totalCarbonPercent: 80, organicCarbonPercent: 75, durabilityOption: "200_year" };
const update = { sampleId: ID, expectedVersion: 1 };

describe.each([["form", sampleFormSchema, form], ["update", updateSampleSchema, update]] as const)("%s samplingTime", (_label, schema, base) => {
  it("keeps a native Date for server actions", () => {
    const at = new Date("2026-03-29T01:30:00Z");
    expect(schema.parse({ ...base, samplingTime: at }).samplingTime).toEqual(at);
  });

  it("reads a string only as an instant with an explicit offset", () => {
    expect(schema.parse({ ...base, samplingTime: "2026-10-12T09:30:00.000Z" }).samplingTime).toEqual(new Date("2026-10-12T09:30:00Z"));
    expect(schema.parse({ ...base, samplingTime: "2026-10-12T12:30:00+03:00" }).samplingTime).toEqual(new Date("2026-10-12T09:30:00Z"));
    for (const value of ["2026-10-12T09:30", "2026-10-12T09:30:00", "2026-10-12", "2026-10-12T09:30Z", "not a time"]) {
      expect(schema.safeParse({ ...base, samplingTime: value }).success, value).toBe(false);
    }
  });

  it("asks for the time when the picker is empty", () => {
    expect(schema.safeParse({ ...base, samplingTime: "" }).error?.issues).toEqual([
      expect.objectContaining({ path: ["samplingTime"], message: SAMPLING_TIME_REQUIRED_MESSAGE }),
    ]);
  });
});

it("still requires a sampling time on the form and leaves it alone on an update", () => {
  expect(sampleFormSchema.safeParse(form).error?.issues).toEqual([
    expect.objectContaining({ path: ["samplingTime"], message: SAMPLING_TIME_REQUIRED_MESSAGE }),
  ]);
  expect(updateSampleSchema.parse(update).samplingTime).toBeUndefined();
});
