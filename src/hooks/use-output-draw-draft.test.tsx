import { useEffect } from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutputStockPreviewInput } from "@/types/output-stock";
import { useOutputDrawDraft } from "./use-output-draw-draft";

const mocks = vi.hoisted(() => ({
  preview: { data: undefined, isFetching: false, error: null } as Record<string, unknown>,
  previewInput: undefined as OutputStockPreviewInput | null | undefined,
  estimateArgs: [] as unknown[],
}));
vi.mock("./use-output-stock", () => ({
  useOutputStockPreview: (input: OutputStockPreviewInput | null) => { mocks.previewInput = input; return mocks.preview; },
}));
vi.mock("./use-output-moisture-estimate", () => ({
  useOutputMoistureEstimate: (...args: unknown[]) => { mocks.estimateArgs = args; return null; },
}));

type Options = Parameters<typeof useOutputDrawDraft>[0];
const ready = { basisFingerprint: "basis-1", blockingMessage: null, moistureEstimate: null };
const entry: OutputStockPreviewInput = { storageLocationId: "bin-1", facilityId: "fac-1", occurredAt: "2026-09-30T10:00:00.000Z", kind: "delivery", wetMassKg: 10, moisturePercent: 12 };
const sources = [{ layerId: "layer-1", moisturePercent: 8 }];
const flat = { active: false, sources: null, usesSingleMoisture: true, untickCode: null, needsTick: false };

function render({ draw, ...options }: Omit<Partial<Options>, "draw"> & { draw?: Record<string, unknown> }) {
  let out!: ReturnType<typeof useOutputDrawDraft>;
  function Harness() {
    const current = useOutputDrawDraft({
      draw: { ...flat, ...draw } as Options["draw"],
      singleMoistureReady: true,
      buildInput: (s) => ({ ...entry, ...(s ? { sources: s } : {}) }),
      estimateFor: { storageLocationId: "bin-1", facilityId: "fac-1", occurredAt: entry.occurredAt },
      ...options,
    });
    useEffect(() => { out = current; }, [current]);
    return null;
  }
  act(() => { create(<Harness />); });
  return out;
}

beforeEach(() => { mocks.preview = { data: ready, isFetching: false, error: null }; mocks.previewInput = undefined; });

describe("useOutputDrawDraft", () => {
  it("saves when the preview is fresh and unblocked", () => {
    expect(render({}).gate()).toEqual({ canSave: true, submitDisabled: false });
  });

  it.each([
    ["while fetching", { data: ready, isFetching: true, error: null }],
    ["on an error with stale data", { data: ready, isFetching: false, error: new Error("boom") }],
    ["while there is no data", { data: undefined, isFetching: false, error: null }],
    ["on a blocking message", { data: { ...ready, blockingMessage: "Not enough stock" }, isFetching: false, error: null }],
  ])("cannot save %s", (_name, preview) => {
    mocks.preview = preview;
    expect(render({}).gate()).toEqual({ canSave: false, submitDisabled: true });
  });

  it("cannot save without a preview input", () => {
    expect(render({ buildInput: () => null }).gate().canSave).toBe(false);
  });

  it("folds an extra preview into the gate", () => {
    const draft = render({});
    expect(draft.gate(true)).toEqual({ canSave: false, submitDisabled: true });
    expect(draft.gate(false).canSave).toBe(true);
  });

  it("bypasses the preview for an edit", () => {
    mocks.preview = { data: undefined, isFetching: true, error: new Error("boom") };
    expect(render({ bypass: true, buildInput: () => null }).gate()).toEqual({ canSave: true, submitDisabled: false });
  });

  it("builds no input until a single moisture is usable", () => {
    const draft = render({ singleMoistureReady: false });
    expect(mocks.previewInput).toBeNull();
    expect(draft.readingsReady).toBe(false);
  });

  it("passes the split sources to the input and skips the moisture estimate", () => {
    const draft = render({ draw: { active: true, sources } });
    expect(mocks.previewInput).toMatchObject({ sources });
    expect(mocks.estimateArgs[0]).toBeNull();
    expect(draft.readingsReady).toBe(true);
  });

  it("keeps the button pressable while a reached split row is empty", () => {
    mocks.preview = { data: undefined, isFetching: false, error: null };
    const draft = render({ draw: { active: true, sources: null } });
    expect(mocks.previewInput).toBeNull();
    expect(draft.gate()).toEqual({ canSave: false, submitDisabled: false });
  });

  it("disables the button once the blocking reading is named", () => {
    mocks.preview = { data: undefined, isFetching: false, error: null };
    expect(render({ draw: { active: true, sources: null, needsTick: true } }).gate().submitDisabled).toBe(true);
  });

  it("estimates moisture for the chosen bin and exposes the preview's basis", () => {
    const draft = render({});
    expect(mocks.estimateArgs.slice(0, 3)).toEqual(["bin-1", "fac-1", entry.occurredAt]);
    expect(draft.basisFingerprint).toBe("basis-1");
  });
});
