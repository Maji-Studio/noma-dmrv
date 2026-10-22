// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useBusyUntilUnload } from "./use-busy-until-unload";

afterEach(cleanup);

function pageshow(persisted: boolean) {
  const event = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(event, "persisted", { value: persisted });
  act(() => { window.dispatchEvent(event); });
}

it("is idle until held, stays held, and clears only on release", () => {
  const { result } = renderHook(() => useBusyUntilUnload<"allow" | "deny">());
  expect(result.current.held).toBeNull();
  act(() => result.current.hold("allow"));
  expect(result.current.held).toBe("allow");
  pageshow(false);
  expect(result.current.held).toBe("allow");
  act(() => result.current.release());
  expect(result.current.held).toBeNull();
});

it("is not busy when the page comes back from the back-forward cache", () => {
  const { result } = renderHook(() => useBusyUntilUnload());
  act(() => result.current.hold(true));
  expect(result.current.held).toBe(true);
  pageshow(true);
  expect(result.current.held).toBeNull();
  // A new action after the restore holds again.
  act(() => result.current.hold(true));
  expect(result.current.held).toBe(true);
});
