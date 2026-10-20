import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOpenCreateIntent } from "./use-open-create-intent";

const mocks = vi.hoisted(() => ({
  effect: null as (() => void) | null,
  handledRef: { current: false },
  replaceState: vi.fn(),
  searchParams: new URLSearchParams(),
  setIntent: vi.fn(),
}));

vi.mock("react", () => ({
  useEffect: (effect: () => void) => {
    mocks.effect = effect;
  },
  useRef: () => mocks.handledRef,
  useState: <T>(initializer: T | (() => T)) => [
    typeof initializer === "function"
      ? (initializer as () => T)()
      : initializer,
    mocks.setIntent,
  ],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/samples",
  useSearchParams: () => mocks.searchParams,
}));

describe("useOpenCreateIntent client effect", () => {
  beforeEach(() => {
    mocks.effect = null;
    mocks.handledRef.current = false;
    mocks.replaceState.mockReset();
    mocks.setIntent.mockReset();
    mocks.searchParams = new URLSearchParams(
      "create=true&createCreditBatch=create-batch&creditBatch=filter-batch",
    );
    vi.stubGlobal("window", {
      history: {
        state: null,
        replaceState: mocks.replaceState,
      },
    });
  });

  it("opens once and consumes only create-intent parameters", async () => {
    useOpenCreateIntent({ contextParam: "createCreditBatch" });
    const effect = mocks.effect;
    expect(effect).not.toBeNull();
    effect?.();
    effect?.();
    await Promise.resolve();

    expect(mocks.setIntent).toHaveBeenCalledOnce();
    expect(mocks.setIntent).toHaveBeenCalledWith({
      context: "create-batch",
    });
    expect(mocks.replaceState).toHaveBeenCalledOnce();
    expect(mocks.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/samples?creditBatch=filter-batch",
    );
  });

  it("hands the context to the caller's own opener and consumes it", () => {
    mocks.searchParams = new URLSearchParams("facility=f1&create=true&bin=bin-1");
    const onOpen = vi.fn();
    useOpenCreateIntent({ contextParam: "bin", onOpen });
    mocks.effect?.();

    expect(onOpen).toHaveBeenCalledWith("bin-1");
    expect(mocks.setIntent).not.toHaveBeenCalled();
    expect(mocks.replaceState).toHaveBeenCalledWith(null, "", "/samples?facility=f1");
  });
});
