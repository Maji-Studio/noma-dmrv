import { ActionError } from "@/lib/action-error";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateRecordLocksAfter, RECORD_LOCK_TOUCHES, recordLockKeys, recordLockMeta } from "./record-lock-query-keys";

function client() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  return { queryClient, invalidate };
}

describe("invalidateRecordLocksAfter", () => {
  it("refreshes the declared kinds after a successful write", () => {
    const { queryClient, invalidate } = client();
    invalidateRecordLocksAfter(queryClient, { success: true }, null, { meta: recordLockMeta(RECORD_LOCK_TOUCHES.order) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: recordLockKeys.kind("order") });
  });

  it("leaves locks alone after a failed ordinary write or an undeclared one", () => {
    const { queryClient, invalidate } = client();
    invalidateRecordLocksAfter(queryClient, undefined, new ActionError({ error: "Reload", code: "stale_version" }), { meta: recordLockMeta(RECORD_LOCK_TOUCHES.order) });
    invalidateRecordLocksAfter(queryClient, undefined, new Error("refused"), { meta: recordLockMeta(RECORD_LOCK_TOUCHES.order) });
    invalidateRecordLocksAfter(queryClient, { success: false, error: "refused" }, null, { meta: recordLockMeta(RECORD_LOCK_TOUCHES.order) });
    invalidateRecordLocksAfter(queryClient, { success: true }, null, { meta: undefined });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("refreshes every lock after a registry submission, even a failed one", () => {
    const { queryClient, invalidate } = client();
    invalidateRecordLocksAfter(queryClient, undefined, new Error("Submission interrupted"), { meta: recordLockMeta(RECORD_LOCK_TOUCHES.registry) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: recordLockKeys.all });
  });
});

it("refreshes every declared kind after a certification lock refusal", () => {
  const { queryClient, invalidate } = client();
  invalidateRecordLocksAfter(queryClient, undefined, new ActionError({ error: "Locked", code: "certification_locked" }), { meta: recordLockMeta(RECORD_LOCK_TOUCHES.transport) });
  expect(invalidate).toHaveBeenCalledTimes(RECORD_LOCK_TOUCHES.transport.length);
  for (const kind of RECORD_LOCK_TOUCHES.transport) expect(invalidate).toHaveBeenCalledWith({ queryKey: recordLockKeys.kind(kind) });
});

it.each([{ touch: RECORD_LOCK_TOUCHES.transport }, { touch: RECORD_LOCK_TOUCHES.registry }])("refreshes refusal-only meta only for lock refusals ($touch)", ({ touch }) => {
  const { queryClient, invalidate } = client();
  const mutation = { meta: recordLockMeta(touch, { onRefusalOnly: true }) };
  invalidateRecordLocksAfter(queryClient, { success: true }, null, mutation);
  invalidateRecordLocksAfter(queryClient, undefined, new Error("offline"), mutation);
  invalidateRecordLocksAfter(queryClient, undefined, new ActionError({ error: "Reload", code: "stale_version" }), mutation);
  expect(invalidate).not.toHaveBeenCalled();
  invalidateRecordLocksAfter(queryClient, undefined, new ActionError({ error: "Locked", code: "certification_locked" }), mutation);
  expect(invalidate).toHaveBeenCalledTimes(touch === "all" ? 1 : touch.length);
});
