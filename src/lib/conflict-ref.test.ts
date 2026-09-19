import { describe, expect, it } from "vitest";
import {
  ConflictError,
  conflictCode,
  getConflict,
} from "./conflict-ref";

describe("conflictCode", () => {
  it("brands a record code and trims it", () => {
    expect(conflictCode(" FB-001 ")).toBe("FB-001");
  });

  it("accepts display labels and ids without proving a stored record code", () => {
    expect(conflictCode("Documented loss (2026-09-17)")).toBe("Documented loss (2026-09-17)");
    expect(conflictCode("ingredient-id")).toBe("ingredient-id");
  });

  it("refuses a blank code, because a conflict must name a record", () => {
    expect(() => conflictCode("")).toThrow("A conflict must carry the record's code.");
    expect(() => conflictCode("   ")).toThrow("A conflict must carry the record's code.");
  });
});

describe("ConflictError", () => {
  const conflict = { entity: "storageLocation", id: "bin-1", code: conflictCode("FB-001") };
  const blockers = [{ entity: "productionRun", id: "run-1", code: conflictCode("PR-001") }];

  it("carries the conflicting record and its blockers", () => {
    const error = new ConflictError("Refused.", { conflict, blockers });
    expect(getConflict(error)).toEqual({ conflict, blockers });
  });

  it("omits blockers it was not given", () => {
    const error = new ConflictError("Refused.", { conflict });
    expect("blockers" in error).toBe(false);
    expect(getConflict(error)).toEqual({ conflict, blockers: undefined });
  });

  it("does not claim an ordinary error", () => {
    expect(getConflict(new Error("Refused."))).toBeNull();
  });
});
