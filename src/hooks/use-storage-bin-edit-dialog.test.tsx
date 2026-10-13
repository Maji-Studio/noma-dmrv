// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStorageBinEditDialog } from "./use-storage-bin-edit-dialog";
const mocks = vi.hoisted(() => ({ load: vi.fn(), error: vi.fn() }));
vi.mock("./use-storage-locations", () => ({ useLoadStorageLocation: () => mocks.load }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: mocks.error }) }));
const bin = { id: "one", name: "North bin", archivedAt: null };
afterEach(cleanup);
beforeEach(() => { mocks.load.mockReset(); mocks.error.mockReset(); });
describe("useStorageBinEditDialog", () => {
  it("does nothing without a selection", async () => {
    const { result } = renderHook(useStorageBinEditDialog);
    await act(() => result.current.open(""));
    expect(mocks.load).not.toHaveBeenCalled(); expect(result.current.bin).toBeNull();
  });
  it("loads fresh on every open and closes", async () => {
    mocks.load.mockResolvedValue(bin);
    const { result } = renderHook(useStorageBinEditDialog);
    await act(() => result.current.open("one"));
    expect(result.current.bin).toEqual(bin);
    act(() => result.current.close()); expect(result.current.bin).toBeNull();
    await act(() => result.current.open("one"));
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.load).toHaveBeenCalledWith("one");
  });
  it("preserves archived status for the read-only modal", async () => {
    const archived = { ...bin, archivedAt: new Date() };
    mocks.load.mockResolvedValue(archived);
    const { result } = renderHook(useStorageBinEditDialog);
    await act(() => result.current.open("one")); expect(result.current.bin).toEqual(archived);
  });
  it("reports a failed load without opening", async () => {
    mocks.load.mockRejectedValue(new Error("failed"));
    const { result } = renderHook(useStorageBinEditDialog);
    await act(() => result.current.open("one"));
    expect(result.current.bin).toBeNull();
    expect(mocks.error).toHaveBeenCalledWith("The storage bin could not be loaded. Try again.");
  });
  it("ignores a pending load after close", async () => {
    let resolve!: (value: typeof bin) => void;
    mocks.load.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { result } = renderHook(useStorageBinEditDialog);
    let pending!: Promise<void>;
    act(() => { pending = result.current.open("one"); result.current.close(); });
    await act(async () => { resolve(bin); await pending; });
    expect(result.current.bin).toBeNull();
  });
});
