import { describe, expect, it } from "vitest";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { CREDIT_BATCH_LINE_ERROR, CREDIT_BATCH_LINE_PENDING } from "./credit-batch-line-copy";
import { describeRecordCreditBatchLine, type RecordCreditBatchKind } from "./record-credit-batch-line-copy";

const KINDS: RecordCreditBatchKind[] = ["feedstock", "delivery", "application", "biochar-product"];
const ONE = { id: "b1", code: "CB-26-001" };
const TWO = { id: "b2", code: "CB-26-002" };

describe("held out", () => {
  it("says Not applicable with the mix bin reason", () => {
    const copy = describeRecordCreditBatchLine("application", { state: "heldOut" });
    expect(copy.lead).toBe(`Credit batch: ${MISSING_VALUE.notApplicable}`);
    expect(copy.info).toBe("This application's biochar was drawn from a mix bin, so it is held out of credit batches.");
    expect(copy.batches).toEqual([]);
  });
});

describe.each(KINDS)("describeRecordCreditBatchLine (%s)", (kind) => {
  it("says Not yet computed with an explanation for a new record", () => {
    const copy = describeRecordCreditBatchLine(kind, { state: "new" });
    expect(copy.lead).toBe(`Credit batch: ${MISSING_VALUE.notYetComputed}`);
    expect(copy.batches).toEqual([]);
    expect(copy.info).toMatch(/^Credit batches (are determined by|follow) the production runs/);
  });

  it("says None with a reason for a saved record without a batch", () => {
    const copy = describeRecordCreditBatchLine(kind, { state: "loaded", batches: [] });
    expect(copy.lead).toBe(`Credit batch: ${MISSING_VALUE.none}`);
    expect(copy.info).toContain("is in a credit batch yet");
  });

  it("names one batch", () => {
    const copy = describeRecordCreditBatchLine(kind, { state: "loaded", batches: [ONE] });
    expect(copy.lead).toBe("Credit batch: ");
    expect(copy.batches).toEqual([ONE]);
    expect(copy.info).toBeTruthy();
  });

  it("names several batches in the plural", () => {
    const copy = describeRecordCreditBatchLine(kind, { state: "loaded", batches: [ONE, TWO] });
    expect(copy.lead).toBe("Credit batches: ");
    expect(copy.batches).toHaveLength(2);
  });

  it("offers Retry on error and shows the shared pending line", () => {
    expect(describeRecordCreditBatchLine(kind, { state: "error" })).toMatchObject({ lead: CREDIT_BATCH_LINE_ERROR, retry: true });
    expect(describeRecordCreditBatchLine(kind, { state: "pending" })).toMatchObject({ lead: CREDIT_BATCH_LINE_PENDING, busy: true });
  });

  it("uses no dashes", () => {
    const texts = [{ state: "new" }, { state: "loaded", batches: [] }].map((v) => describeRecordCreditBatchLine(kind, v as never).info ?? "");
    for (const t of texts) expect(t).not.toMatch(/[–—]/);
  });
});
