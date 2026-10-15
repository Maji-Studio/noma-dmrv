// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_FILES_LOCKED_MESSAGE } from "@/lib/certification/lineage-lock-message";
import { TEST_GIS_BOUNDARY } from "../../../tests/helpers/application-evidence-fixtures";

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";
const mocks = vi.hoisted(() => ({ locked: false, lockArgs: [] as unknown[][] }));

vi.mock("@/hooks/use-record-certification-lock", () => ({
  useIsRecordCertificationLocked: (...args: unknown[]) => {
    mocks.lockArgs.push(args);
    return mocks.locked;
  },
}));
vi.mock("@/hooks/use-documents", () => ({
  documentKeys: { forEntity: (type: string, id: string) => [type, id] },
  useDeleteDocument: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDocumentsForEntity: () => ({
    data: [
      {
        id: "document-1",
        fileName: "field.jpg",
        fileSizeBytes: 1000,
        uploadStatus: "uploaded",
        documentType: "photo",
        metadata: {},
      },
    ],
    error: null,
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-applications", () => ({
  applicationKeys: { lists: () => ["applications", "list"] },
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: () => null,
}));
vi.mock("@/components/forms", () => ({
  FormFileUpload: () => <div data-testid="uploader" />,
  FormField: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ServerError: ({ message }: { message: string }) => <p>{message}</p>,
}));
vi.mock("@/components/forms/failed-deferred-attachments", () => ({
  FailedDeferredAttachments: () => null,
}));
vi.mock("@/components/forms/choice-card-group", () => ({
  ChoiceCardGroup: () => <div data-testid="method-choice" />,
}));
vi.mock("./gis-reference-dialog", () => ({ GisReferenceDialog: () => null }));
vi.mock("./gis-reference-summary", () => ({
  GisReferenceSummary: ({ actions }: { actions?: ReactNode }) => (
    <div data-testid="gis-summary">{actions}</div>
  ),
}));

vi.mock("./application-storage-location-sync", () => ({ ApplicationStorageLocationSync: () => null }));

import type { ApplicationListItem } from "@/data-access/applications";
import { ApplicationEvidencePanel } from "./application-evidence-panel";
import { applicationSheetSections } from "./application-read-sections";
import { ApplicationSupportingEvidencePanel } from "./application-supporting-evidence-panel";

afterEach(cleanup);

function withQueryClient(children: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe("application evidence panels and the certification lock", () => {
  beforeEach(() => {
    mocks.locked = false;
    mocks.lockArgs = [];
  });

  it("keeps a locked application's supporting files downloadable and hides every change control", () => {
    mocks.locked = true;
    render(withQueryClient(<ApplicationSupportingEvidencePanel applicationId={APPLICATION_ID} />));

    expect(mocks.lockArgs).toContainEqual(["application", APPLICATION_ID]);
    expect(screen.getByText(RECORD_FILES_LOCKED_MESSAGE)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open field.jpg" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete field.jpg" })).toBeNull();
    expect(screen.queryByTestId("uploader")).toBeNull();
  });

  it("leaves the supporting evidence panel unchanged while unlocked", () => {
    render(withQueryClient(<ApplicationSupportingEvidencePanel applicationId={APPLICATION_ID} />));

    expect(screen.queryByText(RECORD_FILES_LOCKED_MESSAGE)).toBeNull();
    expect(screen.getByRole("button", { name: "Delete field.jpg" })).toBeTruthy();
    expect(screen.getByTestId("uploader")).toBeTruthy();
  });

  it("shows a locked application's GIS reference without method, replace or remove controls", () => {
    mocks.locked = true;
    render(withQueryClient(
      <ApplicationEvidencePanel applicationId={APPLICATION_ID} mode="boundary" boundary={TEST_GIS_BOUNDARY} />,
    ));

    expect(mocks.lockArgs).toContainEqual(["application", APPLICATION_ID]);
    expect(screen.getByText(RECORD_FILES_LOCKED_MESSAGE)).toBeTruthy();
    expect(screen.getByTestId("gis-summary")).toBeTruthy();
    expect(screen.queryByTestId("method-choice")).toBeNull();
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("leaves the evidence method panel unchanged while unlocked", () => {
    render(withQueryClient(
      <ApplicationEvidencePanel applicationId={APPLICATION_ID} mode="boundary" boundary={TEST_GIS_BOUNDARY} />,
    ));

    expect(screen.queryByText(RECORD_FILES_LOCKED_MESSAGE)).toBeNull();
    expect(screen.getByTestId("method-choice")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });

  it("shows one lock notice on a locked application's view sheet and no Edit hint", () => {
    mocks.locked = true;
    const application = {
      id: APPLICATION_ID, evidenceMethod: "boundary", gisBoundary: null, allocationShares: [],
      heldOutOfCredits: false, durabilityOption: "1000_year", applicationDate: new Date("2026-06-01T00:00:00Z"),
    } as unknown as ApplicationListItem;
    const lock = { data: true, isPending: false, error: null, isFetching: false, refetch: vi.fn() };
    const sections = applicationSheetSections(application, { delivery: undefined, lock, durabilityOption: "1000_year" });
    render(withQueryClient(<>{sections.map((section) => <div key={section.title}>{section.content}</div>)}</>));

    expect(screen.getAllByText(RECORD_FILES_LOCKED_MESSAGE)).toHaveLength(1);
    expect(screen.getByText("No GIS reference")).toBeTruthy();
    expect(screen.queryByText("Choose Edit to add the field boundary.")).toBeNull();
    expect(sections.flatMap((section) => section.fields).some((field) => field.label === "Certification")).toBe(false);
  });
});
