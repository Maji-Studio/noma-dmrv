import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const documentsForEntity = vi.fn();

vi.mock("@/hooks/use-documents", () => ({
  useDocumentsForEntity: (...args: unknown[]) => documentsForEntity(...args),
}));

vi.mock("@/components/forms", async () => {
  const actual = await vi.importActual<typeof import("@/components/forms")>(
    "@/components/forms",
  );
  return {
    ...actual,
    FormSection: ({ children }: { children: React.ReactNode }) => children,
    FormField: ({
      label,
      certifyRequired,
      certifyStatus,
      children,
    }: {
      label: string;
      certifyRequired?: boolean;
      certifyStatus?: string;
      children: React.ReactNode;
    }) => (
      <div
        data-label={label}
        data-cert-required={certifyRequired ? "true" : "false"}
        data-cert-status={certifyStatus}
      >
        {children}
      </div>
    ),
  };
});

vi.mock("./production-readings-documents", () => {
  return {
    isUploadedReadingsDocument: (document: {
      documentType: string;
      uploadStatus: string;
      fileName: string;
      mimeType: string | null;
    }) =>
      document.documentType === "sensor_data" &&
      document.uploadStatus === "uploaded" &&
      document.fileName.endsWith(".csv") &&
      document.mimeType === "text/csv",
    ProductionReadingsDocuments: () => <div data-readings-documents />,
  };
});

import { ProductionReadingsField } from "./production-readings-field";

function renderField(productionRunId?: string) {
  return renderToStaticMarkup(
    <ProductionReadingsField productionRunId={productionRunId} />,
  );
}

describe("ProductionReadingsField certification status", () => {
  beforeEach(() => {
    documentsForEntity.mockReset();
  });

  it("shows a neutral CERT chip in create mode and while saved files load", () => {
    documentsForEntity.mockReturnValue({ data: undefined, isLoading: true });

    expect(renderField()).toContain('data-cert-status="neutral"');
    expect(renderField("run-1")).toContain('data-cert-status="neutral"');
  });

  it("shows missing when no successfully uploaded readings file exists", () => {
    documentsForEntity.mockReturnValue({
      data: [
        {
          documentType: "sensor_data",
          uploadStatus: "pending",
          fileName: "run.csv",
          mimeType: "text/csv",
        },
        {
          documentType: "sensor_data",
          uploadStatus: "failed",
          fileName: "run.csv",
          mimeType: "text/csv",
        },
      ],
      isLoading: false,
    });

    const html = renderField("run-1");
    expect(html).toContain('data-label="Readings CSV file"');
    expect(html).toContain('data-cert-required="true"');
    expect(html).toContain('data-cert-status="missing"');
  });

  it("shows satisfied only for saved uploaded sensor-data evidence", () => {
    documentsForEntity.mockReturnValue({
      data: [
        {
          documentType: "sensor_data",
          uploadStatus: "uploaded",
          fileName: "run.csv",
          mimeType: "text/csv",
        },
      ],
      isLoading: false,
    });

    expect(renderField("run-1")).toContain(
      'data-cert-status="satisfied"',
    );
  });
});
