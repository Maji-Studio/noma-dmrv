import { describe, expect, it } from "vitest";
import { SAMPLE_DELETE_MESSAGE } from "./sample-delete-copy";

describe("Sample delete confirmation", () => {
  it("states what is deleted and when deleting is refused", () => {
    expect(SAMPLE_DELETE_MESSAGE).toContain("transport legs and documents");
    expect(SAMPLE_DELETE_MESSAGE).toContain("once its Removal is Sent");
  });

  it("does not claim credit batch links block deleting", () => {
    expect(SAMPLE_DELETE_MESSAGE).not.toMatch(/linked to credit batches/i);
  });
});
