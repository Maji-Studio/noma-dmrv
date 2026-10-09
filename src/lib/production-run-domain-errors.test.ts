import { expect, it, vi } from "vitest";
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn(), warn: vi.fn(), child: vi.fn() } }));
import { ProductionRunOverlapError } from "@/data-access/production-runs/overlap";
import { ProductionRunDependencyError } from "@/data-access/production-runs/delete";
import { assertProductionRunTimesNotFuture } from "@/data-access/production-runs/future-time";
import { staleRowVersion } from "@/data-access/row-version";
import { conflictCode } from "@/lib/conflict-ref";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { toActionFailure } from "@/fn/action-errors";
import { withProductionRunErrors } from "./production-run-domain-errors";

const conflict = { entity: "productionRun", id: "run-id", code: conflictCode("PR-26-001") };
const failureOptions = { fallbackMessage: "Failed to save", log: { message: "test" } };

it.each([ProductionRunOverlapError, ProductionRunDependencyError])("preserves %s through the domain and action boundaries", async (ErrorClass) => {
  const refusal = new ErrorClass("Existing operator message", conflict);
  await expect(withProductionRunErrors(async () => { throw refusal; })).rejects.toBe(refusal);
  expect(refusal).toBeInstanceOf(DomainError);
  expect(toActionFailure(refusal, failureOptions)).toMatchObject({
    success: false, code: "conflict", error: refusal.message, conflict,
  });
});

it("preserves the existing stale-version refusal and typed conflict", async () => {
  const refusal = staleRowVersion("productionRun", conflict.id);
  await expect(withProductionRunErrors(async () => { throw refusal; })).rejects.toBe(refusal);
  expect(toActionFailure(refusal, failureOptions)).toMatchObject({ success: false, code: "stale_version", conflict: refusal.conflict });
});

it("keeps safe stock copy with an explicit field path", async () => {
  const message = "There is not enough feedstock in this bin.";
  await expect(withProductionRunErrors(async () => { throw new SafeError(message); }, ["feedstockDraws"]))
    .rejects.toMatchObject({ code: "validation_failed", message, issues: [{ path: ["feedstockDraws"], code: "validation_failed", message }] });
});

it("gives future-time refusals their field paths without changing the message", () => {
  try {
    assertProductionRunTimesNotFuture({ startTime: new Date("2026-01-02"), endTime: null }, new Date("2026-01-01"));
    throw new Error("Expected a refusal");
  } catch (error) {
    expect(error).toMatchObject({ code: "validation_failed", message: "Start time cannot be in the future. Enter a time at or before now.", issues: [{ path: ["startTime"], code: "validation_failed", message: expect.any(String) }] });
  }
});

it("leaves unexpected failures for the runner to sanitize", async () => {
  const error = new Error("internal failure");
  await expect(withProductionRunErrors(async () => { throw error; })).rejects.toBe(error);
});
