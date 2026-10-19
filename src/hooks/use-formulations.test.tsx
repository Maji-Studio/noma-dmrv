// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ archive: vi.fn(), restore: vi.fn() }));
vi.mock("@/fn/formulations", () => ({
  getFormulationsFn: vi.fn(), getFormulationByIdFn: vi.fn(), createFormulationFn: vi.fn(),
  updateFormulationFn: vi.fn(), deleteFormulationFn: vi.fn(),
  archiveFormulationFn: actions.archive, restoreFormulationFn: actions.restore,
}));
import { formulationKeys, useArchiveFormulation, useRestoreFormulation } from "./use-formulations";

afterEach(cleanup);

it.each([
  { name: "archive", useLifecycle: useArchiveFormulation, action: actions.archive, archivedAt: new Date("2026-10-16T00:00:00Z") },
  { name: "restore", useLifecycle: useRestoreFormulation, action: actions.restore, archivedAt: null },
])("merges the returned $name row into every cached list before refetch", async ({ useLifecycle, action, archivedAt }) => {
  const client = new QueryClient();
  const row = { id: "formulation", version: 1, archivedAt: archivedAt ? null : new Date("2026-10-15T00:00:00Z"), ingredients: [] };
  const saved = { ...row, version: 2, archivedAt };
  const keys = [formulationKeys.list(), formulationKeys.list({ search: "blend" })];
  for (const key of keys) client.setQueryData(key, { items: [row], total: 1 });
  action.mockResolvedValueOnce({ success: true, data: saved });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, unmount } = renderHook(() => useLifecycle(), { wrapper });
  await act(async () => { await result.current.mutateAsync({ formulationId: row.id, expectedVersion: 1 }); });
  for (const key of keys) {
    expect(client.getQueryData(key)).toEqual({ items: [saved], total: 1 });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  }
  expect(client.getQueryData(formulationKeys.detail(row.id))).toEqual(saved);
  unmount();
  client.clear();
});
