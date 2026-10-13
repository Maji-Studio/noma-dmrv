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
  toDeleteErrorMessage,
  toArchiveRestoreErrorMessage,
} from "@/lib/stale-version";
import { toActionFailure } from "@/fn/action-errors";
import { ConflictError, conflictCode } from "@/lib/conflict-ref";

const ENTITY_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FALLBACK = "Facility was not saved. Try again.";

const staleConflict = {
  entity: "facility",
  id: ENTITY_ID,
  code: STALE_VERSION_CONFLICT_CODE,
};
const overlapConflict = { entity: "productionRun", id: ENTITY_ID, code: conflictCode("PR-1") };

describe("stale-version transport", () => {
  it("survives the server-to-client hop an ActionConflictError takes", () => {
    const failure = toActionFailure(
      new ActionConflictError(STALE_VERSION_MESSAGE, staleConflict),
      { fallbackMessage: FALLBACK, log: { message: "test" } },
    );

    expect(failure).toEqual({
      success: false,
      error: STALE_VERSION_MESSAGE,
      code: "stale_version",
      conflict: staleConflict,
    });
    expect(isStaleVersionFailure(failure)).toBe(true);
    expect(() => throwActionError(failure)).toThrow(StaleVersionError);
  });

  it("re-throws another conflict as a ConflictError with its blockers", () => {
    const blocker = { entity: "binMovement", id: ENTITY_ID, code: conflictCode("Loss (2026-09-01)") };
    const failure = { error: "Overlaps run PR-1", conflict: overlapConflict, blockers: [blocker] };

    expect(isStaleVersionFailure(failure)).toBe(false);
    expect(() => throwActionError(failure)).toThrow("Overlaps run PR-1");
    try {
      throwActionError(failure);
    } catch (error) {
      expect(error).not.toBeInstanceOf(StaleVersionError);
      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({ conflict: overlapConflict, blockers: [blocker] });
    }
  });

  it("carries the conflict through to the form helper", () => {
    // Both assertions live in the catch, so the count is what proves the call
    // threw at all rather than passing the test by doing nothing.
    expect.assertions(2);
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


describe("delete error copy", () => {
  const label = "Customer CUS-1";
  const fallback = "Customer was not deleted. Try again.";
  it("names the stale record and offers the delete recovery action", () => {
    expect(toDeleteErrorMessage(new StaleVersionError(STALE_VERSION_MESSAGE, staleConflict), label, fallback))
      .toBe("Customer CUS-1 was not deleted. It changed since the list loaded. Review it before deleting.");
  });
  it("preserves ordinary errors and falls back for unknown failures", () => {
    expect(toDeleteErrorMessage(new Error("Still has locations"), label, fallback)).toBe("Still has locations");
    expect(toDeleteErrorMessage(null, label, fallback)).toBe(fallback);
  });
});

describe("archive and restore error copy", () => {
  const label = "Facility FAC-1";

  it.each([
    ["archive", "archived", "archiving"],
    ["restore", "restored", "restoring"],
  ] as const)("names the stale record and offers the %s recovery action", (action, outcome, retry) => {
    const message = toArchiveRestoreErrorMessage(
      new StaleVersionError(STALE_VERSION_MESSAGE, staleConflict),
      label,
      action,
      FALLBACK,
    );
    expect(message).toBe(`Facility FAC-1 was not ${outcome}. It changed since the list loaded. Review it before ${retry}.`);
    expect(message).not.toMatch(/[\u2013\u2014]/);
  });

  it.each(["archive", "restore"] as const)("preserves ordinary %s errors and unknown-failure fallbacks", (action) => {
    const fallback = `Facility was not ${action === "archive" ? "archived" : "restored"}. Try again.`;
    expect(toArchiveRestoreErrorMessage(new Error("Facility has active runs."), label, action, fallback))
      .toBe("Facility has active runs.");
    expect(toArchiveRestoreErrorMessage(null, label, action, fallback)).toBe(fallback);
  });
});
