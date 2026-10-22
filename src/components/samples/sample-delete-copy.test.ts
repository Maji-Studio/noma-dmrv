import { describe, expect, it } from "vitest";
import { SAMPLE_DELETE_MESSAGE } from "./sample-delete-copy";

describe("Sample delete confirmation", () => {
  it("states what is deleted and when deleting is refused", () => {
    expect(SAMPLE_DELETE_MESSAGE).toContain("transport legs and documents");
  });

  it("does not claim a refusal rule the server can lift or widen", () => {
    expect(SAMPLE_DELETE_MESSAGE).not.toMatch(/linked to credit batches|is Sent/i);
  });
});
