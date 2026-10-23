import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { ProductionRunDependencyError } from "@/data-access/production-runs/delete";
import { toActionFailure } from "@/fn/action-errors";
import { ActionError } from "@/lib/action-error";
import { conflictCode } from "@/lib/conflict-ref";
import { isInUseDeleteRefusal } from "@/lib/delete-refusal";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn(), warn: vi.fn(), child: vi.fn() } }));
const { deleteProductionRunFn } = vi.hoisted(() => ({ deleteProductionRunFn: vi.fn() }));
vi.mock("@/fn/production-runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fn/production-runs")>()),
  deleteProductionRunFn,
}));

import { useDeleteProductionRun } from "./use-production-runs";

const RUN_ID = "44444444-4444-4444-8444-444444444444";
const blocker = { entity: "creditBatch", id: "batch-1", code: conflictCode("CB-1") };

describe("useDeleteProductionRun", () => {
  it("rejects an in-use refusal with its code, issues and blocker so the list can open the in-use dialog", async () => {
    const refusal = new ProductionRunDependencyError(
      "Production run PR-1 was not deleted because credit batches still use it. Remove those credit batches first, or keep this run.", blocker);
    deleteProductionRunFn.mockResolvedValueOnce(toActionFailure(refusal, { fallbackMessage: "Failed to delete", log: { message: "test" } }));
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    let rejection: unknown;
    function Harness() {
      const mutation = useDeleteProductionRun();
      return <button onClick={() => mutation.mutateAsync({ productionRunId: RUN_ID, expectedVersion: 1 }).catch((error) => { rejection = error; })}>Delete</button>;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>); });
    try {
      await act(async () => { await renderer.root.findByType("button").props.onClick(); });
      expect(rejection).toBeInstanceOf(ActionError);
      expect(isInUseDeleteRefusal(rejection)).toBe(true);
      expect((rejection as ActionError).conflict).toEqual(blocker);
    } finally {
      act(() => renderer.unmount());
      queryClient.clear();
    }
  });
});
