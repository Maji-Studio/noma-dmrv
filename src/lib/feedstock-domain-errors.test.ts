import { expect, it, vi } from "vitest";
import { ActionConflictError, SafeError } from "./errors";
import { DomainError } from "./domain-errors";
import { conflictCode } from "./conflict-ref";
import { withFeedstockErrors } from "./feedstock-domain-errors";

it("preserves typed failures and refuses to disguise unexpected infrastructure failures", async () => {
  for (const error of [new DomainError("stale_version", "Reload."), new Error("Database unavailable")]) {
    await expect(withFeedstockErrors(async () => { throw error; })).rejects.toBe(error);
  }
});
it("carries stock blockers across the operation boundary", async () => {
  const conflict = { entity: "storageLocation", id: "bin-id", code: conflictCode("BIN-01") };
  const blockers = [{ entity: "productionRun", id: "run-id", code: conflictCode("RUN-01") }];
  await expect(withFeedstockErrors(async () => { throw new ActionConflictError("Stock is in use.", conflict, { blockers }); }))
    .rejects.toMatchObject({ code: "conflict", conflict, blockers });
});
it("gives a legacy reference guard its statically selected code and pointer", async () => {
  await expect(withFeedstockErrors(async () => { throw new SafeError("Supplier not found"); }, "not_found", ["supplierId"]))
    .rejects.toMatchObject({ code: "not_found", issues: [{ path: ["supplierId"], code: "not_found" }] });
});

vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() } }));
it("keeps the reference message through the server-action and form error path", async () => {
  const { toActionFailure } = await import("@/fn/action-errors");
  const { throwActionError, toSaveErrorMessage } = await import("@/lib/stale-version");
  const message = "Supplier was not found in this Organization.";
  try {
    await withFeedstockErrors(async () => { throw new SafeError("Supplier not found in this organization"); }, "not_found", ["supplierId"]);
    expect.unreachable("The reference guard must fail");
  } catch (error) {
    const failure = toActionFailure(error, { fallbackMessage: "Unable to save", log: { message: "Save failed" } });
    expect(failure).toMatchObject({ success: false, code: "not_found", error: message });
    try {
      throwActionError(failure);
    } catch (formError) {
      expect(toSaveErrorMessage(formError, "Unable to save")).toBe(message);
    }
  }
});

it("preserves stock metadata and the existing operator message through actions and forms", async () => {
  const { toActionFailure } = await import("@/fn/action-errors");
  const { throwActionError, toSaveErrorMessage } = await import("@/lib/stale-version");
  const message = "Feedstock was not saved. Bin BIN-01 would go 10 kg below zero. Review bin BIN-01 intake and withdrawal history, including recorded losses.";
  const meta = { storageLocationId: "bin-id", availableWetKg: 20, requestedWetKg: 30, unit: "kg" };
  const error = new DomainError("insufficient_stock", message, {
    conflict: { entity: "storageLocation", id: "bin-id", code: conflictCode("BIN-01") },
    issues: [{ path: ["storageLocationId"], code: "insufficient_stock", message, meta }],
  });
  await expect(withFeedstockErrors(async () => { throw error; })).rejects.toBe(error);
  const failure = toActionFailure(error, { fallbackMessage: "Unable to save", log: { message: "Save failed" } });
  expect(failure).toMatchObject({ code: "insufficient_stock", error: message, issues: [{ meta }] });
  try {
    throwActionError(failure);
    expect.unreachable("The form must receive the refusal");
  } catch (formError) {
    expect(toSaveErrorMessage(formError, "Unable to save")).toBe(message);
  }
});
