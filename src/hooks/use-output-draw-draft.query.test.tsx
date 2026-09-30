import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { useOutputDrawDraft } from "./use-output-draw-draft";

const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("@/fn/output-stock", () => ({ previewOutputStockFn: mocks.preview }));
vi.mock("./use-output-moisture-estimate", () => ({ useOutputMoistureEstimate: () => null }));

type Draw = Parameters<typeof useOutputDrawDraft>[0]["draw"];
const draw = { active: false, sources: null, usesSingleMoisture: true, untickCode: null, needsTick: false } as unknown as Draw;
const entry = { storageLocationId: "bin-1", facilityId: "fac-1", occurredAt: "2026-09-30T10:00:00.000Z", kind: "delivery" as const, wetMassKg: 10 };
const okPreview = { success: true, data: { basisFingerprint: "basis-1", blockingMessage: null, moistureEstimate: null } };

describe("useOutputDrawDraft with React Query", () => {
  it("cannot save while fetching or after a refetch fails with stale data", async () => {
    let resolveFirst!: (value: unknown) => void;
    mocks.preview.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    const client = new QueryClient();
    let out!: ReturnType<typeof useOutputDrawDraft>;
    function Harness() {
      const current = useOutputDrawDraft({ draw, singleMoistureReady: true, moisturePercent: 12, entry, estimateFor: { storageLocationId: "bin-1", facilityId: "fac-1", occurredAt: entry.occurredAt }, writeReadings: vi.fn() });
      useEffect(() => { out = current; }, [current]);
      return null;
    }
    await act(async () => { create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
    expect(out.gate().canSave).toBe(false);

    await act(async () => { resolveFirst(okPreview); });
    expect(out.gate()).toMatchObject({ canSave: true, basisFingerprint: "basis-1" });

    mocks.preview.mockResolvedValueOnce({ success: false, error: "Stock changed" });
    await act(async () => { await out.preview.refetch(); });
    expect(out.preview.data).toBeDefined();
    expect(out.preview.error).toBeTruthy();
    expect(out.gate().canSave).toBe(false);
  });
});
