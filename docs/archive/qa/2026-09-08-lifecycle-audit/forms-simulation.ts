import { describe, expect, it, vi } from "vitest";
import { guardCreateWithEvidenceUpdate } from "@/hooks/use-create-with-evidence";
import { numericValue } from "@/lib/form-utils";

describe("baseline form observations", () => {
  it("F09: held GIS evidence blocks the pre-update guard", () => {
    const setError = vi.fn();
    expect(guardCreateWithEvidenceUpdate({
      attachments: [{ status: "held" }], message: "Unresolved evidence", setError,
    })).toBe(true);
    expect(setError).toHaveBeenCalledWith("Unresolved evidence");
  });
  it("F10: clearing an optional numeric input produces an omitted patch value", () => {
    expect(numericValue("")).toBeUndefined();
    expect(JSON.stringify({ value: numericValue("") })).toBe("{}");
    expect(numericValue("0")).toBe(0);
  });
});
