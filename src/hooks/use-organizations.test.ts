// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isUnloadWarningSuppressed, suppressUnloadWarning } from "@/lib/leave-guard";
import { useResetAfterOrgSwitch } from "./use-organizations";

const mocks = vi.hoisted(() => ({ assign: vi.fn() }));
vi.mock("@/fn/organizations", () => ({}));
vi.mock("@/fn/organization-api-access", () => ({}));
vi.mock("@/lib/read-api/client", () => ({}));

beforeEach(() => {
  vi.stubGlobal("location", { assign: mocks.assign });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("still lands in the new organization when storage is blocked, without throwing", () => {
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  expect(() => useResetAfterOrgSwitch()()).not.toThrow();
  expect(mocks.assign).toHaveBeenCalledWith("/dashboard");
});

it("drops the unload prompt before the hard load, so the operator is not asked twice", () => {
  mocks.assign.mockImplementation(() => {
    expect(isUnloadWarningSuppressed()).toBe(true);
  });
  useResetAfterOrgSwitch()();
  expect(mocks.assign).toHaveBeenCalledWith("/dashboard");
});

it("allows the unload prompt again after a back-forward-cache restore", () => {
  suppressUnloadWarning();
  expect(isUnloadWarningSuppressed()).toBe(true);
  window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
  expect(isUnloadWarningSuppressed()).toBe(true);
  window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
  expect(isUnloadWarningSuppressed()).toBe(false);
});
