import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreditBatchKeyNumbers } from "./credit-batch-page-header";

const state = vi.hoisted(() => ({
  preview: null as null | { co2eStoredTonnes: number | null; missingInputs: string[] },
}));

vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => <a>{children as never}</a> }));
vi.mock("./credit-batch-page-context", () => ({
  useCreditBatchPage: () => ({
    batch: { id: "b1", co2eStoredPreview: state.preview },
    pageModel: undefined,
    pageModelError: null,
  }),
}));
vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-certification")>()),
  useBatchDurabilitySummary: () => ({ data: undefined, isError: false }),
}));

describe("CreditBatchKeyNumbers", () => {
  beforeEach(() => { state.preview = null; });

  it("keeps the Carbon estimate cell and three columns when there is no estimate and no gap sentence", () => {
    state.preview = { co2eStoredTonnes: null, missingInputs: [] };
    const html = renderToStaticMarkup(<CreditBatchKeyNumbers />);
    expect(html).toContain("Carbon estimate");
    expect(html).toContain("Not yet computed");
    expect(html).toContain("sm:grid-cols-3");
    expect(html).not.toContain("sm:grid-cols-2");
    expect(html.match(/<dt/g)).toHaveLength(3);
  });
});
