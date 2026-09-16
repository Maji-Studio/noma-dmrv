import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { UseFormRegisterReturn } from "react-hook-form";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OutputStockPreviewInput, OutputStockHistoryEntry } from "@/types/output-stock";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), refetch: vi.fn(), input: null as OutputStockPreviewInput | null }));
vi.mock("@/hooks/use-output-stock", () => ({
  usePostOutputStock: () => ({ mutateAsync: mocks.mutate, isPending: false }),
  useOutputStockPreview: (input: OutputStockPreviewInput | null) => {
    mocks.input = input;
    return { data: { basisFingerprint: "current-basis", blockingMessage: null }, isFetching: false, refetch: mocks.refetch };
  },
}));
vi.mock("@/components/forms/mass-moisture-fields", () => ({
  WetMassField: ({ registration }: { registration: UseFormRegisterReturn }) => <input {...registration} />,
  MoistureField: ({ registration }: { registration: UseFormRegisterReturn }) => <input {...registration} />,
}));
vi.mock("./output-stock-preview", () => ({ OutputStockPreview: ({ moreInfo }: { moreInfo: ReactNode }) => <div>Preview{moreInfo}{moreInfo}</div>, OutputStockAllocations: () => <div>Allocations</div> }));
vi.mock("@/components/forms", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { FormSpine: Wrapper, FormSection: Wrapper, FormField: Wrapper, FormInput: "input", FormTextarea: "textarea", ResolvedErrorRevalidator: () => null, FormActions: ({ errorMessage }: { errorMessage?: string }) => <div>{errorMessage}</div> };
});
vi.mock("./output-stock-history", () => ({ OutputStockHistory: ({ storageLocationId }: { storageLocationId: string }) => <button data-history-bin={storageLocationId}>More info</button> }));
import { OutputStockForm } from "./output-stock-form";

const original: OutputStockHistoryEntry = {
  id: "00000000-0000-4000-8000-000000000001", kind: "count", physicalDate: "2026-09-14", recordedAt: "2026-09-14T10:00:00Z", actorName: null,
  reason: "Original", wetMassKg: 0, moisturePercent: null, dryMassKg: 350, beforeDryKg: 350, afterDryKg: 0, correctsMovementId: null, deliveryId: null, allocations: [],
};

describe("OutputStockForm", () => {
  it("stops a nested child's submit before validation so an owning product form cannot submit", async () => {
    const parentSubmit = vi.fn();
    const recorded = vi.fn();
    mocks.mutate.mockReset().mockResolvedValue({ id: "saved" });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<form onSubmit={parentSubmit}><OutputStockForm storageLocationId="00000000-0000-4000-8000-000000000002" facilityId="00000000-0000-4000-8000-000000000003" kind="count" original={original} onCancel={vi.fn()} onRecorded={recorded} /></form>); });
    const forms = renderer.root.findAllByType("form");
    // React portals preserve this owning React ancestry despite separate DOM roots.
    const dispatchSubmit = async () => {
      let stopped = false;
      const event = { stopPropagation: () => { stopped = true; }, preventDefault: vi.fn(), persist: vi.fn() };
      const pending = forms[1].props.onSubmit(event);
      expect(stopped).toBe(true);
      if (!stopped) forms[0].props.onSubmit(event);
      await pending;
    };
    await act(dispatchSubmit);
    expect(mocks.mutate).not.toHaveBeenCalled();
    await act(async () => { renderer.root.findByType("textarea").props.onChange({ target: { name: "reason", value: "Verified empty bin" }, type: "change" }); });
    await act(dispatchSubmit);
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(recorded).toHaveBeenCalledOnce();
    expect(parentSubmit).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });
  it("allows zero count without moisture and retries a correction with the same key and current basis", async () => {
    mocks.mutate.mockReset().mockRejectedValueOnce(new Error("Stock changed. Review the refreshed preview.")).mockResolvedValueOnce({ id: "saved" });
    const recorded = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<OutputStockForm storageLocationId="00000000-0000-4000-8000-000000000002" facilityId="00000000-0000-4000-8000-000000000003" kind="count" original={original} onCancel={vi.fn()} onRecorded={recorded} />); });
    expect(renderer.root.findAllByProps({ "data-history-bin": "00000000-0000-4000-8000-000000000002" })).toHaveLength(2);
    expect(mocks.input?.moisturePercent).toBeNull();
    expect(mocks.input?.wetMassKg).toBe(0);
    await act(async () => { renderer.root.findByType("textarea").props.onChange({ target: { name: "reason", value: "Verified empty bin" }, type: "change" }); });
    const submit = () => renderer.root.findByType("form").props.onSubmit({ stopPropagation: vi.fn(), preventDefault: vi.fn(), persist: vi.fn() });
    await act(async () => { await submit(); });
    expect(recorded).not.toHaveBeenCalled();
    expect(mocks.refetch).toHaveBeenCalled();
    await act(async () => { await submit(); });
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    const first = mocks.mutate.mock.calls[0][0];
    expect(first).toMatchObject({ wetMassKg: 0, moisturePercent: null, correctsMovementId: original.id, basisFingerprint: "current-basis", reason: "Verified empty bin" });
    expect(mocks.mutate.mock.calls[1][0].idempotencyKey).toBe(first.idempotencyKey);
    expect(recorded).toHaveBeenCalledOnce();
    await act(async () => renderer.unmount());
  });
});
