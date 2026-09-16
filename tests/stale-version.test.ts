/**
 * The client-safe half of the expected-version seam (issue #768).
 *
 * `throwActionError` is what every update hook calls on a failed result, so it
 * has to keep a stale-version refusal typed while leaving every other failure
 * the plain `Error` the forms already handle.
 */

import { describe, expect, it } from "vitest";
import { ActionConflictError } from "@/lib/errors";
import {
  getStaleVersionConflict,
  isStaleVersionFailure,
  STALE_VERSION_CONFLICT_CODE,
  STALE_VERSION_MESSAGE,
  StaleVersionError,
  throwActionError,
  toSaveErrorMessage,
} from "@/lib/stale-version";
import { toActionFailure } from "@/fn/action-errors";

const ENTITY_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FALLBACK = "Facility was not saved. Try again.";

const staleConflict = {
  entity: "facility",
  id: ENTITY_ID,
  code: STALE_VERSION_CONFLICT_CODE,
};
const overlapConflict = { entity: "productionRun", id: ENTITY_ID, code: "PR-1" };

describe("stale-version transport", () => {
  it("survives the server-to-client hop an ActionConflictError takes", () => {
    const failure = toActionFailure(
      new ActionConflictError(STALE_VERSION_MESSAGE, staleConflict),
      { fallbackMessage: FALLBACK, log: { message: "test" } },
    );

    expect(failure).toEqual({
      success: false,
      error: STALE_VERSION_MESSAGE,
      conflict: staleConflict,
    });
    expect(isStaleVersionFailure(failure)).toBe(true);
    expect(() => throwActionError(failure)).toThrow(StaleVersionError);
  });

  it("leaves another conflict as a plain Error", () => {
    const failure = { error: "Overlaps run PR-1", conflict: overlapConflict };

    expect(isStaleVersionFailure(failure)).toBe(false);
    expect(() => throwActionError(failure)).toThrow("Overlaps run PR-1");
    try {
      throwActionError(failure);
    } catch (error) {
      expect(error).not.toBeInstanceOf(StaleVersionError);
      expect(getStaleVersionConflict(error)).toBeNull();
    }
  });

  it("carries the conflict through to the form helper", () => {
    try {
      throwActionError({ error: STALE_VERSION_MESSAGE, conflict: staleConflict });
    } catch (error) {
      expect(getStaleVersionConflict(error)).toEqual(staleConflict);
      expect(toSaveErrorMessage(error, FALLBACK)).toBe(STALE_VERSION_MESSAGE);
    }
  });

  it("falls back to the server message, then the caller's copy", () => {
    expect(toSaveErrorMessage(new Error("Bin is archived."), FALLBACK)).toBe(
      "Bin is archived.",
    );
    expect(toSaveErrorMessage("not an error", FALLBACK)).toBe(FALLBACK);
  });
});
