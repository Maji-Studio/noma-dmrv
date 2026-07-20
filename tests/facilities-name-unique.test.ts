import { describe, expect, it } from "vitest";
import { guardFacilityName } from "@/data-access/unique-name-guards";
import { SafeError } from "@/lib/errors";
import { makeTestOrgContext } from "./helpers/test-org";

/**
 * `guardFacilityName` is the friendly translator for the org-scoped
 * `facilities_organization_id_name_unique` index (migration 0082). It owns the
 * user-facing "duplicate facility name" message and is the seam every facility
 * create/update path shares. These are pure-logic assertions — no DB round-trip
 * — mirroring the guard's contract in `unique-name-guards.ts`.
 */

const ctx = makeTestOrgContext();

/** A node-postgres unique-violation shaped like the driver's thrown error. */
function pgUniqueViolation(constraint: string): Error {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: "23505",
    constraint,
  });
}

describe("guardFacilityName", () => {
  it("returns the wrapped result when no violation occurs", async () => {
    const result = await guardFacilityName(ctx, "Moshi Hub", async () => "created");
    expect(result).toBe("created");
  });

  it("translates the facility name unique-index violation into a friendly SafeError", async () => {
    const attempt = guardFacilityName(ctx, "  Moshi Hub  ", async () => {
      throw pgUniqueViolation("facilities_organization_id_name_unique");
    });

    await expect(attempt).rejects.toBeInstanceOf(SafeError);
    // The trimmed name is echoed back to the operator.
    await expect(attempt).rejects.toThrow(/A facility named "Moshi Hub" already exists/);
  });

  it("passes through a violation on a different constraint unchanged", async () => {
    // The auto-code path relies on the code-constraint 23505 propagating so it
    // can retry; the name guard must not swallow it.
    const codeViolation = pgUniqueViolation("facilities_organization_id_code_unique");
    const attempt = guardFacilityName(ctx, "Moshi Hub", async () => {
      throw codeViolation;
    });

    await expect(attempt).rejects.toBe(codeViolation);
  });
});
