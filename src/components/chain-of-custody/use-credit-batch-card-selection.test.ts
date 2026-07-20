import { describe, expect, it, vi } from "vitest";
import {
  creditBatchStorageKey,
  readRememberedCreditBatchId,
  resolveCreditBatchSelection,
  writeRememberedCreditBatchId,
} from "./use-credit-batch-card-selection";

const BATCHES = [{ id: "newest" }, { id: "older" }];

describe("resolveCreditBatchSelection", () => {
  it("keeps a valid facility batch from the URL authoritative", () => {
    expect(
      resolveCreditBatchSelection({
        batches: BATCHES,
        urlBatchId: "older",
        applicationId: null,
        rememberedBatchId: "newest",
      }),
    ).toEqual({ batchId: "older", source: "url" });
  });

  it("does not add a batch to a standalone application deep link", () => {
    expect(
      resolveCreditBatchSelection({
        batches: BATCHES,
        urlBatchId: null,
        applicationId: "application-1",
        rememberedBatchId: "older",
      }),
    ).toEqual({ batchId: null, source: "application" });
  });

  it("uses a valid facility-scoped remembered batch", () => {
    expect(
      resolveCreditBatchSelection({
        batches: BATCHES,
        urlBatchId: null,
        applicationId: null,
        rememberedBatchId: "older",
      }),
    ).toEqual({ batchId: "older", source: "remembered" });
  });

  it("replaces a stale remembered batch with the newest-first list head", () => {
    expect(
      resolveCreditBatchSelection({
        batches: BATCHES,
        urlBatchId: null,
        applicationId: null,
        rememberedBatchId: "foreign-batch",
      }),
    ).toEqual({ batchId: "newest", source: "first" });
  });

  it("returns no selection when the facility has no batches", () => {
    expect(
      resolveCreditBatchSelection({
        batches: [],
        urlBatchId: "stale-batch",
        applicationId: null,
        rememberedBatchId: "stale-batch",
      }),
    ).toEqual({ batchId: null, source: "none" });
  });
});

describe("credit batch selection storage", () => {
  it("namespaces remembered values by facility", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    writeRememberedCreditBatchId("facility-a", "batch-a", storage);
    writeRememberedCreditBatchId("facility-b", "batch-b", storage);

    expect(readRememberedCreditBatchId("facility-a", storage)).toBe("batch-a");
    expect(readRememberedCreditBatchId("facility-b", storage)).toBe("batch-b");
    expect(creditBatchStorageKey("facility-a")).not.toBe(
      creditBatchStorageKey("facility-b"),
    );
  });

  it("handles blocked storage reads and writes", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      removeItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };

    expect(readRememberedCreditBatchId("facility-a", storage)).toBeNull();
    expect(() =>
      writeRememberedCreditBatchId("facility-a", "batch-a", storage),
    ).not.toThrow();
    expect(() =>
      writeRememberedCreditBatchId("facility-a", null, storage),
    ).not.toThrow();
  });
});
