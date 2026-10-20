import { zodResolver } from "@hookform/resolvers/zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { deliveryFormSchema, updateDeliverySchema } from "./deliveries";
import { createEventInstantSchema } from "./event-instant";
import { optionalDateOnly, requiredDateOnly } from "./helpers";
import { productionRunFormSchema, updateProductionRunSchema } from "./production-runs";
import { SAMPLING_TIME_REQUIRED_MESSAGE, sampleFormSchema, updateSampleSchema } from "./samples";

/**
 * A Date-or-string field is a Zod union. When every branch fails, the React
 * Hook Form resolver shows the first branch's first issue, not the union's
 * message, so these go through the resolver the forms use (#684).
 */
async function formMessage(schema: z.ZodType, value: unknown): Promise<string | undefined> {
  const resolve = zodResolver(z.object({ field: schema }) as never);
  const result = await resolve({ field: value } as never, undefined, { fields: {}, shouldUseNativeValidation: false } as never);
  return (result.errors as { field?: { message?: string } }).field?.message;
}

const ZOD_FALLBACK = /^Invalid input/;
const EMPTY_VALUES = ["", undefined, null] as const;
const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("sampling time", () => {
  it.each(EMPTY_VALUES)("asks for the sampling time in the form and the error summary when the value is %j", async (value) => {
    expect(await formMessage(sampleFormSchema.shape.samplingTime, value)).toBe(SAMPLING_TIME_REQUIRED_MESSAGE);
  });

  it("asks for the offset on a time without one", async () => {
    expect(await formMessage(sampleFormSchema.shape.samplingTime, "2026-10-12T09:30")).toMatch(/^Enter the sampling time with a time zone offset/);
  });

  it("shows the same message on a whole-form Save", async () => {
    const resolve = zodResolver(sampleFormSchema);
    const result = await resolve({ creditBatchId: ID, samplingTime: "", totalCarbonPercent: 80, organicCarbonPercent: 75, durabilityOption: "200_year" } as never, undefined, { fields: {}, shouldUseNativeValidation: false } as never);
    expect(result.errors.samplingTime?.message).toBe(SAMPLING_TIME_REQUIRED_MESSAGE);
  });

  it("keeps the server action message in our words", () => {
    for (const samplingTime of ["", null, "not a time"]) {
      const issues = updateSampleSchema.safeParse({ sampleId: ID, expectedVersion: 1, samplingTime }).error?.issues ?? [];
      expect(issues.map(issue => issue.message), String(samplingTime)).not.toContainEqual(expect.stringMatching(ZOD_FALLBACK));
      expect(issues.length).toBeGreaterThan(0);
    }
  });
});

describe("production run dates and times", () => {
  it.each(EMPTY_VALUES)("asks for the start date when the value is %j", async (value) => {
    expect(await formMessage(productionRunFormSchema.shape.startDate, value)).toBe("Enter the start date.");
  });

  it.each(EMPTY_VALUES)("asks for the start time when the value is %j", async (value) => {
    expect(await formMessage(productionRunFormSchema.shape.startTime, value)).toBe("Enter a start time.");
  });

  it("names a date or time it cannot read", async () => {
    expect(await formMessage(productionRunFormSchema.shape.startDate, "2026-02-31")).toBe("Enter a valid date.");
    expect(await formMessage(productionRunFormSchema.shape.startTime, "not a time")).toBe("Enter a valid start time.");
    expect(await formMessage(productionRunFormSchema.shape.endTime, null)).not.toMatch(ZOD_FALLBACK);
    expect(await formMessage(updateProductionRunSchema.shape.startTime, "not a time")).toBe("Enter a valid start time.");
    expect(await formMessage(updateProductionRunSchema.shape.endTime, "not a time")).toBe("Enter a valid end time.");
    for (const value of ["", null]) {
      expect(await formMessage(updateProductionRunSchema.shape.startTime, value), String(value)).not.toMatch(ZOD_FALLBACK);
    }
  });

  it("keeps the shared date-only helpers in our words", async () => {
    for (const value of [...EMPTY_VALUES, "2026-02-31"]) {
      expect(await formMessage(requiredDateOnly, value), String(value)).not.toMatch(ZOD_FALLBACK);
    }
    expect(await formMessage(optionalDateOnly, null)).not.toMatch(ZOD_FALLBACK);
  });

  it("still reads a Date and a date string the same way", () => {
    const at = new Date(2026, 9, 12);
    expect(requiredDateOnly.parse(at)).toEqual(at);
    expect(requiredDateOnly.parse("2026-10-12")).toEqual(at);
    expect(optionalDateOnly.parse("")).toBeUndefined();
    expect(updateProductionRunSchema.shape.endTime.parse(null)).toBeNull();
  });
});

describe("delivery date and event times", () => {
  it.each(EMPTY_VALUES)("asks for the delivery date when the value is %j", async (value) => {
    expect(await formMessage(deliveryFormSchema.shape.deliveryDate, value)).toBe("Delivery date is required");
  });

  it("refuses a delivery date without an offset in our words", async () => {
    expect(await formMessage(deliveryFormSchema.shape.deliveryDate, "2026-10-12T09:30")).not.toMatch(ZOD_FALLBACK);
    expect(await formMessage(updateDeliverySchema.shape.deliveryDate, "2026-10-12T09:30")).not.toMatch(ZOD_FALLBACK);
  });

  it.each(EMPTY_VALUES)("asks for the event time when the value is %j", async (value) => {
    expect(await formMessage(createEventInstantSchema("Enter the incident time."), value)).toBe("Enter the incident time.");
  });
});
