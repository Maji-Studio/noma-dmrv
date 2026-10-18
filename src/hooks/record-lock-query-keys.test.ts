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
