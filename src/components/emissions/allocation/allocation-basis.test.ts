import { describe, expect, it } from "vitest";
import { BATCH_A, REMOVAL_1, allocationFixture } from "./allocation-test-fixtures";
import { basisSentence } from "./allocation-basis";
import { buildFocus } from "./allocation-model";

const allocation = allocationFixture();
const byId = (id: string) => allocation.records.find((record) => record.id === id)!;
const batch = buildFocus(allocation, { creditBatchId: BATCH_A })!;
const removal = buildFocus(allocation, { removalId: REMOVAL_1 })!;

describe("basisSentence", () => {
  it("says what the row rests on, in words", () => {
    expect(basisSentence(byId("fs-1"), batch.owner)).toBe("First completed run PR-26-001");
    expect(basisSentence(byId("dl-1"), batch.owner)).toBe("3,000 kg on the load");
    expect(basisSentence(byId("fs-2"), batch.notYet)).toBe("No completed run has drawn from it");
    expect(basisSentence(byId("dl-1"), removal.owner)).toBe("2,500 kg of the load applied in it");
  });

  it("leaves the line out when it would repeat the row or show a raw code", () => {
    expect(basisSentence(byId("run-1"), batch.owner)).toBeNull();
    expect(basisSentence(byId("me-1"), batch.owner)).toBeNull();
    expect(basisSentence(byId("dl-1"), batch.notYet)).toBeNull();
  });

  it("says a draft Removal would send a record", () => {
    const draft = structuredClone(byId("run-1"));
    draft.removalParts = [{ key: REMOVAL_1, fraction: 1, basis: [{ kind: "wouldClaim", label: "PR-26-001", kg: null }] }];
    expect(basisSentence(draft, removal.owner)).toBe("Would be sent with RM-26-001");
  });
});
