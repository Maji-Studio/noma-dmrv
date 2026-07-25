import { describe, expect, it } from "vitest";
import {
  leaveSampleCreateIntent,
  resolveSampleCreateCreditBatchId,
  sampleCreateHref,
} from "./sample-create-intent";

describe("sample create intent", () => {
  it("clears intent before leaving create mode", () => {
    const events: string[] = [];

    leaveSampleCreateIntent(
      () => events.push("clear"),
      () => events.push("transition"),
    );

    expect(events).toEqual(["clear", "transition"]);
  });

  it("encodes the active facility and credit batch in the recovery link", () => {
    const href = sampleCreateHref("facility-1", "batch-1");
    const url = new URL(href, "https://example.test");

    expect(url.pathname).toBe("/samples");
    expect(url.searchParams.get("facility")).toBe("facility-1");
    expect(url.searchParams.get("create")).toBe("true");
    expect(url.searchParams.get("createCreditBatch")).toBe("batch-1");
    expect(url.searchParams.has("creditBatch")).toBe(false);
  });

  it("preselects only a batch returned by the active facility query", () => {
    const activeFacilityBatches = [{ id: "batch-1" }, { id: "batch-2" }];

    expect(
      resolveSampleCreateCreditBatchId("batch-2", activeFacilityBatches),
    ).toBe("batch-2");
    expect(
      resolveSampleCreateCreditBatchId("foreign-batch", activeFacilityBatches),
    ).toBeUndefined();
    expect(
      resolveSampleCreateCreditBatchId("stale-batch", undefined),
    ).toBeUndefined();
  });
});
