// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExactIdFilterParam } from "./use-exact-id-filter-param";

const ID_A = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";
const ID_B = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const harness = vi.hoisted(() => ({
  query: {} as Record<string, string | null>,
  set: vi.fn(),
}));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (key: string) => [
    harness.query[key] ?? null,
    (value: string | null) => {
      harness.set(key, value);
      harness.query[key] = value;
      return Promise.resolve(new URLSearchParams());
    },
  ],
}));

describe("useExactIdFilterParam", () => {
  beforeEach(() => {
    harness.query = {};
    harness.set.mockClear();
  });
  afterEach(cleanup);

  it("returns no ids and leaves the URL alone without a param", () => {
    const { result } = renderHook(() => useExactIdFilterParam());
    expect(result.current.ids).toEqual([]);
    expect(result.current.normalized).toBeNull();
    expect(harness.set).not.toHaveBeenCalled();
  });

  it("keeps a clean param untouched", () => {
    harness.query.ids = `${ID_A},${ID_B}`;
    const { result } = renderHook(() => useExactIdFilterParam());
    expect(result.current.ids).toEqual([ID_A, ID_B]);
    expect(harness.set).not.toHaveBeenCalled();
  });

  it("drops invalid and duplicate ids and rewrites the URL", () => {
    harness.query.ids = `${ID_A.toUpperCase()},nope,${ID_A},${ID_B}`;
    const { result } = renderHook(() => useExactIdFilterParam());
    expect(result.current.ids).toEqual([ID_A, ID_B]);
    expect(result.current.normalized).toBe(`${ID_A},${ID_B}`);
    expect(harness.set).toHaveBeenCalledWith("ids", `${ID_A},${ID_B}`);
  });

  it("removes the param when no id is valid", () => {
    harness.query.ids = "nope";
    renderHook(() => useExactIdFilterParam());
    expect(harness.set).toHaveBeenCalledWith("ids", null);
  });

  it("clear sets the param to null", () => {
    harness.query.ids = ID_A;
    const { result } = renderHook(() => useExactIdFilterParam());
    act(() => {
      void result.current.clear();
    });
    expect(harness.set).toHaveBeenCalledWith("ids", null);
  });
});
