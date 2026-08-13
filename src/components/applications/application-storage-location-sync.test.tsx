import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  data: {
    state: "failed" as "failed" | "synced" | "drifted" | "not_synced",
    externalStorageLocationId: null as string | null,
    lastError: "Registry unavailable" as string | null,
    attemptedAt: new Date("2026-08-13T11:00:00Z") as Date | null,
    blocker: null as string | null,
    viewerCanManage: true,
  },
  isLoading: false,
  error: null as Error | null,
  isPending: false,
  mutate: vi.fn(),
}));

vi.mock("@/hooks/use-storage-location-sync", () => ({
  useApplicationStorageLocationSync: () => ({
    data: hookState.data,
    isLoading: hookState.isLoading,
    error: hookState.error,
  }),
  useSyncApplicationStorageLocation: () => ({
    isPending: hookState.isPending,
    mutate: hookState.mutate,
  }),
}));

import { ApplicationStorageLocationSync } from "./application-storage-location-sync";

beforeEach(() => {
  vi.clearAllMocks();
  hookState.data = {
    state: "failed",
    externalStorageLocationId: null,
    lastError: "Registry unavailable",
    attemptedAt: new Date("2026-08-13T11:00:00Z"),
    blocker: null,
    viewerCanManage: true,
  };
  hookState.isLoading = false;
  hookState.error = null;
  hookState.isPending = false;
});

describe("ApplicationStorageLocationSync", () => {
  it("shows a failed attempt and retries only after an explicit click", () => {
    const html = renderToStaticMarkup(
      <ApplicationStorageLocationSync applicationId="app-1" />,
    );

    expect(html).toContain("Sync failed");
    expect(html).toContain("Registry unavailable");
    expect(html).toContain("Retry sync");
    expect(hookState.mutate).not.toHaveBeenCalled();
  });

  it("shows the immutable registry identity after synchronization", () => {
    hookState.data = {
      state: "synced",
      externalStorageLocationId: "slc-test",
      lastError: null,
      attemptedAt: new Date("2026-08-13T11:00:00Z"),
      blocker: null,
      viewerCanManage: true,
    };

    const html = renderToStaticMarkup(
      <ApplicationStorageLocationSync applicationId="app-1" />,
    );

    expect(html).toContain("Synced");
    expect(html).toContain("slc-test");
    expect(html).toContain("Check for drift");
  });
});
