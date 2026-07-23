import { describe, expect, it } from "vitest";
import SamplesPage from "./page";

describe("SamplesPage", () => {
  it("passes hard-entry create and batch context into the client list", async () => {
    const element = await SamplesPage({
      searchParams: Promise.resolve({
        facility: "facility-1",
        create: "1",
        createCreditBatch: "batch-1",
        creditBatch: "filter-batch",
      }),
    });

    expect(element.props).toMatchObject({
      initialCreate: true,
      initialCreditBatchId: "batch-1",
    });
  });
});
