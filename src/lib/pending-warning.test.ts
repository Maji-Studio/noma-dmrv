import { afterEach, describe, expect, it, vi } from "vitest";
import { stashPendingWarning, takePendingWarning } from "./pending-warning";

function withStorage(store = new Map<string, string>()) {
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("pending warning", () => {
  it("hands one stashed warning to the next page and clears it", () => {
    withStorage();
    stashPendingWarning("It was not saved as your default.");

    expect(takePendingWarning()).toBe("It was not saved as your default.");
    expect(takePendingWarning()).toBeNull();
  });

  it("stashes nothing when the outcome carried no warning", () => {
    const store = withStorage();
    stashPendingWarning(undefined);

    expect(store.size).toBe(0);
    expect(takePendingWarning()).toBeNull();
  });

  it("answers null rather than throwing when storage is blocked", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => undefined,
      },
    });

    expect(() => stashPendingWarning("anything")).not.toThrow();
    expect(takePendingWarning()).toBeNull();
  });
});
