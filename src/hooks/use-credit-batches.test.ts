import { describe, expect, it } from "vitest";
import type { CreditBatchCo2eStoredPreview } from "@/data-access/credit-batches";
import { resolveCreditBatchCo2ePreviews } from "./use-credit-batches";

const preview = {
  provider: "isometric",
  co2eStoredTonnes: 1.25,
  componentKey: null,
  moduleVersion: "1.0",
  formulaVersion: null,
  applicationResults: [],
  missingInputs: [],
  warnings: [],
} satisfies CreditBatchCo2eStoredPreview;

describe("resolveCreditBatchCo2ePreviews", () => {
  it("withholds partial chunk data when any preview chunk fails", () => {
    const error = new Error("preview unavailable");

    const result = resolveCreditBatchCo2ePreviews([
      { data: { "batch-1": preview }, error: null },
      { data: undefined, error },
    ]);

    expect(result).toEqual({ data: undefined, error });
  });

  it("merges preview chunks only when every chunk succeeds", () => {
    const result = resolveCreditBatchCo2ePreviews([
      { data: { "batch-1": preview }, error: null },
      { data: { "batch-2": preview }, error: null },
    ]);

    expect(Object.keys(result.data ?? {})).toEqual(["batch-1", "batch-2"]);
    expect(result.error).toBeNull();
  });
});
