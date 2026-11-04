import { describe, expect, it } from "vitest";
import { unwrap } from "@/hooks/types";
import type { ActionResult } from "@/types/actions";
import { ActionError, isActionError } from "./action-error";
import { ConflictError, conflictCode, getConflict } from "./conflict-ref";
import {
  getStaleVersionConflict,
  STALE_VERSION_CONFLICT_CODE,
  STALE_VERSION_MESSAGE,
  StaleVersionError,
  throwActionError,
  toSaveErrorMessage,
} from "./stale-version";

const refusal: Extract<ActionResult<unknown>, { success: false }> = {
  success: false,
  error: "These fields are locked by a certification submission.",
  code: "certification_locked",
  issues: [
    { path: ["massKg"], code: "certification_locked", message: "Mass is locked." },
    { path: ["moistureContentPercent"], code: "certification_locked", message: "Moisture is locked." },
  ],
};
const conflict = { entity: "storageLocation", id: "bin-1", code: conflictCode("BIN-001") };
const blockers = [{ entity: "productionRun", id: "run-1", code: conflictCode("PR-001") }];
const preview = { basisFingerprint: "fresh-basis", stockEffects: [] };

function catchError(run: () => unknown): unknown {
  try { run(); }
  catch (error) { return error; }
  return expect.fail("Expected the action refusal to throw");
}

describe("ActionError", () => {
  it("carries the failed result's message and structured detail", () => {
    const error = new ActionError({ ...refusal, conflict, blockers, preview });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ActionError");
    expect(error.message).toBe(refusal.error);
    expect(error.code).toBe("certification_locked");
    expect(error.issues).toBe(refusal.issues);
    expect(error.conflict).toBe(conflict);
    expect(error.blockers).toBe(blockers);
    expect(error.preview).toBe(preview);
    expect(isActionError(error)).toBe(true);
  });

  it("defaults missing issues to an empty array and rejects unrelated errors", () => {
    expect(new ActionError({ error: "Refused." }).issues).toEqual([]);
    for (const error of [new Error("Refused."), { issues: [] }, null, undefined]) {
      expect(isActionError(error)).toBe(false);
    }
  });
});

describe.each([
  { name: "unwrap", throwFailure: (result: ActionResult<unknown>) => unwrap(result) },
  { name: "throwActionError", throwFailure: throwActionError },
])("$name", ({ throwFailure }) => {
  it("preserves a certification refusal and both field issues", () => {
    const error = catchError(() => throwFailure(refusal));
    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({ message: refusal.error, code: "certification_locked", issues: refusal.issues });
  });

  it("keeps stale-version identity, detail and save copy", () => {
    const staleConflict = { ...conflict, code: STALE_VERSION_CONFLICT_CODE };
    const error = catchError(() => throwFailure({ ...refusal, code: "stale_version", conflict: staleConflict, blockers, preview }));
    expect(error).toBeInstanceOf(StaleVersionError);
    expect(isActionError(error)).toBe(true);
    expect(error).toMatchObject({ message: refusal.error, code: "stale_version", issues: refusal.issues, blockers, preview });
    expect(getStaleVersionConflict(error)).toEqual(staleConflict);
    expect(toSaveErrorMessage(error, "Fallback")).toBe(STALE_VERSION_MESSAGE);
  });

  it("keeps conflict identity, detail and the conflict helper", () => {
    const error = catchError(() => throwFailure({ ...refusal, code: "conflict", conflict, blockers, preview }));
    expect(error).toBeInstanceOf(ConflictError);
    expect(isActionError(error)).toBe(true);
    expect(error).toMatchObject({ message: refusal.error, code: "conflict", issues: refusal.issues, preview });
    expect(getConflict(error)).toEqual({ conflict, blockers });
  });

  it("throws an ActionError with empty issues for a prose-only failure", () => {
    const error = catchError(() => throwFailure({ success: false, error: "Refused." }));
    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({ message: "Refused.", issues: [] });
  });
});

it("unwrap returns successful data unchanged", () => {
  const data = { id: "saved" };
  expect(unwrap({ success: true, data })).toBe(data);
});
