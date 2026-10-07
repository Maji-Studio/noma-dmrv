import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DomainError } from "@/lib/domain-errors";
import { validationFailed } from "@/lib/operations/errors";
import { ActionConflictError, SafeError } from "@/lib/errors";
import { conflictCode } from "@/lib/conflict-ref";
import { STALE_VERSION_CONFLICT_CODE, StaleVersionError, throwActionError } from "@/lib/stale-version";
import { assertRowVersion } from "@/data-access/row-version";
import { formatZodActionError, toActionFailure } from "./action-errors";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { error: logError }, sanitizeErrorMessage: () => "sanitized" }));
const options = {
  fallbackMessage: "Failed to update feedstock",
  log: { message: "feedstock action failed", context: { op: "feedstock:update" } },
};
const conflict = { entity: "feedstock", id: "record-id", code: conflictCode("FS-26-001") };
beforeEach(() => logError.mockClear());

describe("toActionFailure", () => {
  it("preserves domain code, issue paths and business conflict references", () => {
    const issues = [{ path: ["allocations", 0, "mass"], code: "too_small", message: "Too small", meta: { minimum: 0 } }];
    expect(toActionFailure(new DomainError("insufficient_stock", "Stock is insufficient.", {
      issues, conflict, blockers: [conflict],
    }), options)).toEqual({ success: false, error: "Stock is insufficient.", code: "insufficient_stock", issues, conflict, blockers: [conflict] });
    expect(logError).not.toHaveBeenCalled();
  });

  it("omits absent domain details", () => {
    expect(toActionFailure(new DomainError("not_found", "Missing."), options)).toEqual({
      success: false, error: "Missing.", code: "not_found",
    });
  });

  it("keeps all Zod prose and paths on direct and runner decode paths without rejected values", () => {
    const schema = z.object({ allocations: z.array(z.object({ mass: z.number().positive(" Enter positive mass ") })), note: z.string().min(2, "Enter a note") });
    const parsed = schema.safeParse({ allocations: [{ mass: -42 }, { mass: -42 }], note: "x" });
    if (parsed.success) throw new Error("Expected invalid fixture");
    const direct = toActionFailure(parsed.error, options);
    const decoded = toActionFailure(validationFailed(parsed.error), options);
    expect(decoded).toEqual(direct);
    expect(direct.error).toBe("Enter positive mass. Enter a note.");
    expect(direct.error).toBe(formatZodActionError(parsed.error));
    expect(direct.code).toBe("validation_failed");
    expect(direct.issues?.map((issue) => issue.path)).toEqual([["allocations", 0, "mass"], ["allocations", 1, "mass"], ["note"]]);
    expect(JSON.stringify(direct.issues)).not.toContain("-42");
    expect(toActionFailure(parsed.error, { ...options, zodErrorPrefix: "Invalid input:" }).error).toBe("Invalid input: Enter positive mass. Enter a note.");
  });

  it.each([ [conflict.code, "conflict"], [STALE_VERSION_CONFLICT_CODE, "stale_version"] ] as const)("maps ActionConflictError %s", (code, expectedCode) => {
    expect(toActionFailure(new ActionConflictError("Cannot save.", { ...conflict, code }, { blockers: [conflict] }), options)).toEqual({
      success: false, error: "Cannot save.", code: expectedCode, conflict: { ...conflict, code }, blockers: [conflict],
    });
  });

  it("keeps integer version failures on the client's typed stale-edit path", () => {
    let failure: unknown;
    try { assertRowVersion({ entity: "feedstock", id: conflict.id, expectedVersion: 1, actualVersion: 2 }); }
    catch (error) { failure = error; }
    const result = toActionFailure(failure, options);
    expect(result.code).toBe("stale_version");
    expect(() => throwActionError(result)).toThrow(StaleVersionError);
    expect(() => assertRowVersion({ entity: "feedstock", id: conflict.id, expectedVersion: 2, actualVersion: 2 })).not.toThrow();
  });

  it("preserves safe prose and sanitizes unexpected errors with the existing log context", () => {
    expect(toActionFailure(new SafeError("Intentional refusal."), options)).toEqual({ success: false, error: "Intentional refusal." });
    expect(logError).not.toHaveBeenCalled();
    expect(toActionFailure(new Error("private failure"), options)).toEqual({ success: false, error: "Feedstock was not saved. Try again." });
    expect(logError).toHaveBeenCalledWith({ op: "feedstock:update", errorName: "Error", errorMessage: "sanitized" }, "feedstock action failed");
  });
});
