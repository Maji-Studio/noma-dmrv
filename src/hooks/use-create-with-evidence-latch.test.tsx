// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCreateWithEvidence } from "./use-create-with-evidence";

const attachments = vi.hoisted(() => ({ attachments: [], clear: vi.fn(), flushMany: vi.fn() }));
vi.mock("@/hooks/use-deferred-attachments", () => ({ useDeferredAttachments: () => attachments }));
afterEach(cleanup);

it.each(["success", "create failure", "flush failure"])("shares one create and evidence flush until %s settles, then releases", async (outcome) => {
  let resolve!: (value: { entities: { id: string }[]; result: undefined }) => void;
  let reject!: (reason: Error) => void;
  const pending = new Promise<{ entities: { id: string }[]; result: undefined }>((done, fail) => { resolve = done; reject = fail; });
  const executeCreate = vi.fn(() => pending);
  let finishFlush!: () => void;
  attachments.flushMany.mockReset().mockImplementation(async () => {
    await new Promise<void>((done) => { finishFlush = done; });
    return { ok: outcome !== "flush failure", uploaded: [], failed: outcome === "flush failure" ? [{ key: "file" }] : [] };
  });
  const { result } = renderHook(() => useCreateWithEvidence({
    entityType: "sample", entityNoun: "Sample", executeCreate,
    setError: vi.fn(), setUpdateError: vi.fn(), getCreateErrorMessage: () => "Failed",
    unresolvedUpdateMessage: "Resolve attachments", openEditOnFailure: vi.fn(),
    closeOnSuccess: vi.fn(), onSuccess: vi.fn(),
  }));
  let first!: Promise<void>;
  act(() => {
    first = result.current.handleCreate(undefined);
    expect(result.current.handleCreate(undefined)).toBe(first);
  });
  expect(executeCreate).toHaveBeenCalledTimes(1);
  if (outcome === "create failure") {
    await act(async () => { reject(new Error("Failed")); await first; });
    expect(attachments.flushMany).not.toHaveBeenCalled();
  } else {
    await act(async () => { resolve({ entities: [{ id: "sample-1" }], result: undefined }); await pending; });
    expect(result.current.handleCreate(undefined)).toBe(first);
    expect(attachments.flushMany).toHaveBeenCalledTimes(1);
    expect(attachments.flushMany).toHaveBeenCalledWith("sample", ["sample-1"]);
    await act(async () => { finishFlush(); await first; });
  }
  executeCreate.mockRejectedValueOnce(new Error("Retry failed"));
  await act(async () => { await result.current.handleCreate(undefined); });
  expect(executeCreate).toHaveBeenCalledTimes(2);
});
