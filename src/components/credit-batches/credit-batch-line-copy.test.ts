import { describe, expect, it } from "vitest";
import {
  errorLineCopy,
  noneYetLineCopy,
  notYetDeterminedLineCopy,
  pendingLineCopy,
} from "./credit-batch-line-copy";

describe("shared credit batch line copy", () => {
  it("says a check is running and names no batch", () => {
    expect(pendingLineCopy()).toMatchObject({ lead: "Checking credit batch...", busy: true, batches: [], retry: false });
  });

  it("a failed check warns, offers Retry and is not 'None yet'", () => {
    const copy = errorLineCopy();
    expect(copy).toMatchObject({ tone: "warning", retry: true, batches: [] });
    expect(copy.lead).not.toContain("None yet");
  });

  it("None yet is a neutral answer with an optional explanation", () => {
    expect(noneYetLineCopy("Because.")).toMatchObject({ lead: "Credit batch: None yet", tone: "neutral", info: "Because.", retry: false });
    expect(noneYetLineCopy().info).toBeNull();
  });

  it("Not yet determined does not imply a search found nothing", () => {
    const copy = notYetDeterminedLineCopy("Needs a facility.");
    expect(copy.lead).toBe("Credit batch: Not yet determined");
    expect(copy.info).toBe("Needs a facility.");
    expect(copy.lead).not.toMatch(/none|no credit batch/i);
  });
});
