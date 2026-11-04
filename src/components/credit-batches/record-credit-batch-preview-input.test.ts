import { describe, expect, it } from "vitest";
import type { RecordCreditBatchPreviewInput } from "@/schemas/record-credit-batches";
import { applicationCreditBatchPreview as build, outputDrawCreditBatchPreview } from "./record-credit-batch-preview-input";

type ApplicationPreview = Extract<RecordCreditBatchPreviewInput, { kind: "application" }>;
const applicationCreditBatchPreview = (...args: Parameters<typeof build>) => build(...args) as ApplicationPreview | null;

const BIN = { storageLocationId: "bin-1", facilityId: "fac-1", occurredAt: "2026-10-21T08:00:00.000Z" };

describe("outputDrawCreditBatchPreview", () => {
  it("is null until a bin, a facility and a readable time are known", () => {
    expect(outputDrawCreditBatchPreview("delivery", { ...BIN, storageLocationId: "" }, null)).toBeNull();
    expect(outputDrawCreditBatchPreview("delivery", { ...BIN, facilityId: null }, null)).toBeNull();
    expect(outputDrawCreditBatchPreview("delivery", { ...BIN, occurredAt: "not a date" }, null)).toBeNull();
  });

  it("asks for the bin's batches before the draw is planned", () => {
    expect(outputDrawCreditBatchPreview("biochar-product", BIN, null)).toEqual({ kind: "biochar-product", bin: BIN, draw: null });
  });

  it("sends the stock preview's own draw once mass and readings are in", () => {
    const sources = [{ layerId: "layer-1", moisturePercent: 12 }];
    expect(outputDrawCreditBatchPreview("delivery", BIN, {
      ...BIN, kind: "delivery", wetMassKg: 50, sources,
    })).toEqual({ kind: "delivery", bin: BIN, draw: { wetMassKg: 50, moisturePercent: null, sources } });
  });
});

describe("applicationCreditBatchPreview", () => {
  it("is null until a delivery is chosen", () => {
    expect(applicationCreditBatchPreview("", 20)).toBeNull();
  });

  it("sends a positive amount, and no amount otherwise", () => {
    expect(applicationCreditBatchPreview("del-1", 20)).toEqual({ kind: "application", deliveryId: "del-1", appliedWetMassKg: 20, applicationId: null });
    for (const amount of [undefined, null, 0, -1, Number.NaN, "20", 1.0001, 1e12]) {
      expect(applicationCreditBatchPreview("del-1", amount)?.appliedWetMassKg).toBeNull();
    }
  });

  it("names the application being edited", () => {
    expect(applicationCreditBatchPreview("del-2", 5, "app-1")?.applicationId).toBe("app-1");
  });
});
