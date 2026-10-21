import { describe, expect, it } from "vitest";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { CREDIT_BATCH_LINE_ERROR, CREDIT_BATCH_LINE_PENDING } from "./credit-batch-line-copy";
import {
  describeRecordCreditBatchLine,
  FEEDSTOCK_NEW_LEAD,
  type PreviewedRecordKind,
  type RecordCreditBatchKind,
} from "./record-credit-batch-line-copy";
import type { RecordCreditBatchPreview } from "@/types/record-credit-batches";

const KINDS: RecordCreditBatchKind[] = ["feedstock", "delivery", "application", "biochar-product"];
const PREVIEWED: PreviewedRecordKind[] = ["delivery", "application", "biochar-product"];
const ONE = { id: "b1", code: "CB-26-001", startDate: "2026-10-01", endDate: "2026-10-31" };
const TWO = { id: "b2", code: "CB-26-002", startDate: "2026-11-01", endDate: "2026-11-30" };
const SEPTEMBER = { id: "b3", code: "CB-26-003", startDate: "2026-09-01", endDate: "2026-09-30" };
const PREVIEW: RecordCreditBatchPreview = { batches: [], heldOut: false, exact: true, sourceRunCount: 2, unbatchedRunCount: 0 };
const preview = (over: Partial<RecordCreditBatchPreview>) =>
  ({ state: "preview" as const, preview: { ...PREVIEW, ...over } });

describe("held out", () => {
  it("says Not applicable with the mix bin reason", () => {
    const copy = describeRecordCreditBatchLine("application", { state: "heldOut" });
    expect(copy.lead).toBe(`Credit batch: ${MISSING_VALUE.notApplicable}`);
    expect(copy.info).toBe("This application's biochar was drawn from a mix bin, so it is held out of credit batches.");
    expect(copy.batches).toEqual([]);
  });
});

describe("new feedstock", () => {
  it("says when its batch is set, with nothing behind an (i)", () => {
    const copy = describeRecordCreditBatchLine("feedstock", { state: "new" });
    expect(copy.lead).toBe("Credit batch: Set when a production run uses this feedstock");
    expect(copy.lead).toBe(FEEDSTOCK_NEW_LEAD);
    expect(copy.info).toBeNull();
    expect(copy.batches).toEqual([]);
  });
});

describe.each([
  ["delivery", "Choose a source bin to see the credit batch."],
  ["application", "Choose a delivery to see the credit batch."],
  ["biochar-product", "Choose a biochar bin to see the credit batch."],
] as const)("new %s", (kind, lead) => {
  it("names what decides the batch, and no batch code", () => {
    const copy = describeRecordCreditBatchLine(kind, { state: "new" });
    expect(copy.lead).toBe(lead);
    expect(copy.batches).toEqual([]);
    expect(copy.info).toMatch(/^Credit batches follow the production runs/);
  });
});

describe.each(PREVIEWED)("preview (%s)", (kind) => {
  it("names the one batch saving gives, with its window", () => {
    const copy = describeRecordCreditBatchLine(kind, preview({ batches: [SEPTEMBER] }));
    expect(copy.lead).toBe("Joins credit batch ");
    expect(copy.batches).toEqual([SEPTEMBER]);
    expect(copy.tail).toBe(" (Sep 1 to Sep 30, 2026)");
    expect(copy.info).toMatch(/^Credit batches follow the production runs/);
  });

  it("names several batches in the plural, windows behind +N", () => {
    const copy = describeRecordCreditBatchLine(kind, preview({ batches: [ONE, TWO] }));
    expect(copy.lead).toBe("Joins credit batches ");
    expect(copy.batches).toEqual([ONE, TWO]);
    expect(copy.tail).toBe("");
  });

  it("says None when no run behind the draw is in a batch, and when that changes", () => {
    const copy = describeRecordCreditBatchLine(kind, preview({ unbatchedRunCount: 2 }));
    expect(copy.lead).toBe(`Credit batch: ${MISSING_VALUE.none}`);
    expect(copy.batches).toEqual([]);
    expect(copy.info).toContain("is in a credit batch yet.");
    expect(copy.info).toContain("joins one when a credit batch takes in those runs.");
  });

  it("says so behind the (i) when part of the draw is in no batch", () => {
    const copy = describeRecordCreditBatchLine(kind, preview({ batches: [ONE], unbatchedRunCount: 1 }));
    expect(copy.lead).toBe("Joins credit batch ");
    expect(copy.info).toContain("Some of the biochar comes from production runs that are in no credit batch yet.");
  });

  it("says Could join when the source spans batches and the mass is not in yet", () => {
    const copy = describeRecordCreditBatchLine(kind, preview({ batches: [ONE, TWO], exact: false }));
    expect(copy.lead).toBe("Could join credit batches ");
    expect(copy.batches).toEqual([ONE, TWO]);
    expect(copy.info).toContain("more than one credit batch");
    expect(copy.info).toMatch(/Enter the .+ to see which this .+ joins\.$/);
  });

  it("says Could join for one batch beside runs in none", () => {
    const copy = describeRecordCreditBatchLine(kind, preview({ batches: [ONE], exact: false, unbatchedRunCount: 1 }));
    expect(copy.lead).toBe("Could join credit batch ");
    expect(copy.info).toContain("from this credit batch and from production runs that are in none yet");
  });

  it("is definite before the mass when every run in the source is in one batch", () => {
    expect(describeRecordCreditBatchLine(kind, preview({ batches: [ONE], exact: false })).lead).toBe("Joins credit batch ");
    expect(describeRecordCreditBatchLine(kind, preview({ exact: false, unbatchedRunCount: 2 })).lead).toBe(`Credit batch: ${MISSING_VALUE.none}`);
  });

  it("says None when the source holds nothing to draw", () => {
    const copy = describeRecordCreditBatchLine(kind, preview({ sourceRunCount: 0, exact: false }));
    expect(copy.lead).toBe(`Credit batch: ${MISSING_VALUE.none}`);
    expect(copy.info).toContain("so there is no credit batch to join.");
  });

  it("uses no dashes in any preview state", () => {
    const views = [
      preview({ batches: [ONE] }), preview({ unbatchedRunCount: 1 }), preview({ batches: [ONE], unbatchedRunCount: 1 }),
      preview({ batches: [ONE, TWO], exact: false }), preview({ batches: [ONE], exact: false, unbatchedRunCount: 1 }),
      preview({ sourceRunCount: 0 }), preview({ heldOut: true }), { state: "new" as const },
    ];
    for (const view of views) {
      const copy = describeRecordCreditBatchLine(kind, view);
      expect(`${copy.lead}${copy.tail}${copy.info ?? ""}`).not.toMatch(/[–—]/);
    }
  });
});

describe("preview of a mix-bin application", () => {
  it("says Not applicable with the reason", () => {
    const copy = describeRecordCreditBatchLine("application", preview({ heldOut: true }));
    expect(copy.lead).toBe(`Credit batch: ${MISSING_VALUE.notApplicable}`);
    expect(copy.info).toBe("This delivery's biochar was drawn from a mix bin, so this application is held out of credit batches.");
  });
});

describe.each(KINDS)("describeRecordCreditBatchLine (%s)", (kind) => {
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
    const texts = [{ state: "new" }, { state: "loaded", batches: [] }].map((v) => {
      const copy = describeRecordCreditBatchLine(kind, v as never);
      return `${copy.lead}${copy.info ?? ""}`;
    });
    for (const t of texts) expect(t).not.toMatch(/[–—]/);
  });
});
