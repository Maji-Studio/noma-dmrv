import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportEvidencePanel } from "./transport-evidence-documents";

vi.mock("@/hooks/use-documents", () => ({
  documentKeys: { forEntity: () => ["documents"] },
  useDeleteDocument: () => ({ isPending: false }),
  useDocumentsForEntity: () => ({
    data: [],
    error: null,
    isLoading: false,
  }),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));

describe("TransportEvidencePanel chrome", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps its heading and divider when used standalone", () => {
    const html = renderToStaticMarkup(
      <TransportEvidencePanel
        entityType="feedstock"
        entityId="feedstock-1"
        readOnly
      />,
    );

    expect(html).toContain("<h3");
    expect(html).toContain("Transport evidence</h3>");
    expect(html).toContain("border-t");
  });

  it("uses the parent heading without duplicate visible chrome when embedded", () => {
    const html = renderToStaticMarkup(
      <TransportEvidencePanel
        entityType="feedstock"
        entityId="feedstock-1"
        readOnly
        embedded
      />,
    );

    expect(html).not.toContain("<h3");
    expect(html).not.toContain("border-t");
    expect(html).toContain('aria-label="Transport evidence"');
    expect(html).not.toContain("CERT");
  });
});
