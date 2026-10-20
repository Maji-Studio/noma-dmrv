import { describe, expect, it } from "vitest";
import { MISSING_VALUE } from "@/lib/copy-utils";
import {
  errorLineCopy,
  missingLineCopy,
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

  it("composes a missing line from the shared vocabulary", () => {
    const copy = missingLineCopy(MISSING_VALUE.notSet, "Needs a batch.");
    expect(copy).toMatchObject({ lead: "Credit batch: Not set", info: "Needs a batch.", tone: "neutral", batches: [], retry: false });
    expect(missingLineCopy(MISSING_VALUE.notAvailable).info).toBeNull();
  });
});
