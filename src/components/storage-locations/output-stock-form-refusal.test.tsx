// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { LOCKED_FIELD_MESSAGE } from "@/lib/save-refusal";
import type { OutputStockPreviewInput } from "@/types/output-stock";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), input: null as OutputStockPreviewInput | null }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }) }));
vi.mock("@/hooks/use-output-stock", () => ({
  useOutputSubBins: () => ({ data: { stockMode: "mix", subBins: [] }, error: null }),
  useOutputStockBalance: () => ({ data: undefined }),
  usePostOutputStock: () => ({ mutateAsync: mocks.mutate, isPending: false }),
  useOutputStockPreview: (input: OutputStockPreviewInput | null) => {
    mocks.input = input;
    return { data: { basisFingerprint: "current-basis", blockingMessage: null, expectedProductVersions: {} }, isFetching: false, error: null, refetch: vi.fn() };
  },
}));
vi.mock("./output-stock-preview", () => ({ OutputStockPreview: () => <div>Preview</div>, OutputStockAllocations: () => null }));
vi.mock("./output-stock-history", () => ({ OutputStockHistory: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));
import { OutputStockForm } from "./output-stock-form";

const refusal = new ActionError({
  error: "Mass is too high", code: "validation_failed",
  issues: [{ path: ["wetMassKg"], code: "validation_failed", message: "Mass is too high" }],
});

afterEach(cleanup);

describe("OutputStockForm refused save", () => {
  it("shows a field-named refusal at its field with no footer message", async () => {
    mocks.mutate.mockReset().mockRejectedValue(refusal);
    const { container } = render(<OutputStockForm storageLocationId="00000000-0000-4000-8000-000000000002" facilityId="00000000-0000-4000-8000-000000000003" onCancel={vi.fn()} onRecorded={vi.fn()} />);
    fireEvent.change(container.querySelector("#stock-wet")!, { target: { value: "10" } });
    fireEvent.change(container.querySelector("#stock-moisture")!, { target: { value: "20" } });
    fireEvent.change(container.querySelector("#stock-reason")!, { target: { value: "Spillage while loading" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledOnce());
    await waitFor(() => expect(container.querySelector("#stock-wet-error")?.textContent).toContain("Mass is too high"));
    // The refusal sits at its field; the footer holds no copy of it.
    expect(screen.queryAllByRole("alert").map((node) => node.textContent)).toEqual(["Mass is too high", "Not saved. Fix the fields that show an error."]);
  });

  it("puts a locked field back to its saved value and says so", async () => {
    mocks.mutate.mockReset().mockRejectedValue(new ActionError({
      error: "This bin is locked.", code: "certification_locked",
      issues: [{ path: ["reason"], code: "certification_locked", message: "This bin is locked." }],
    }));
    const { container } = render(<OutputStockForm storageLocationId="00000000-0000-4000-8000-000000000002" facilityId="00000000-0000-4000-8000-000000000003" onCancel={vi.fn()} onRecorded={vi.fn()} />);
    fireEvent.change(container.querySelector("#stock-wet")!, { target: { value: "10" } });
    fireEvent.change(container.querySelector("#stock-moisture")!, { target: { value: "20" } });
    fireEvent.change(container.querySelector("#stock-reason")!, { target: { value: "Spillage while loading" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect((container.querySelector("#stock-reason") as HTMLTextAreaElement).value).toBe(""));
    expect(container.querySelector("#stock-reason-error")?.textContent).toBe(LOCKED_FIELD_MESSAGE);
  });
});
