import type { ButtonHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-certification-sources", () => ({
  useCandidateDocumentsForRemoval: () => ({
    data: {
      hasMapping: true,
      candidates: [
        {
          document: {
            id: "legacy-document-id",
            fileName: "legacy-boundary-logbook.pdf",
            documentType: "boundary_logbook",
            storageKey: null,
          },
          lineageEntity: {
            entityLabel: "Application AP-26-001",
          },
          mirror: null,
        },
      ],
    },
    isLoading: false,
    error: null,
  }),
  useMirrorDocumentToSource: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useSetDocumentSourceVisibility: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useUnlinkDocumentSource: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/components/ui", () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  EmptyState: () => null,
}));
vi.mock("@phosphor-icons/react/dist/ssr", () => ({
  ArrowsClockwiseIcon: () => null,
  CheckCircleIcon: () => null,
  CloudIcon: () => null,
  FileIcon: () => null,
  LockIcon: () => null,
  GlobeIcon: () => null,
}));
vi.mock("./panel-layout", () => ({
  Section: ({ children }: { children?: ReactNode }) => (
    <section>{children}</section>
  ),
}));

import { SourcesPanel } from "./sources-panel";

describe("SourcesPanel legacy URL-only documents", () => {
  it("shows an honest disabled affordance instead of an enabled Mirror action", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" />,
    );

    expect(html).toContain("Re-upload required");
    expect(html).toContain("disabled");
    expect(html).not.toContain(">Mirror</button>");
  });
});
