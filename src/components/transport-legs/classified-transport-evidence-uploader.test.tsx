import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/forms/form-file-upload", () => ({
  FormFileUpload: (props: {
    multiple?: boolean;
    documentType?: string;
  }) => (
    <div
      data-testid="file-uploader"
      data-multiple={String(props.multiple)}
      data-document-type={props.documentType}
    />
  ),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));

import { ClassifiedTransportEvidenceUploader } from "./classified-transport-evidence-uploader";

describe("ClassifiedTransportEvidenceUploader", () => {
  it("renders one multi-file uploader and three explicit classification radios", () => {
    const html = renderToStaticMarkup(
      <ClassifiedTransportEvidenceUploader
        id="transport-evidence-test"
        entityType="feedstock"
        entityId="00000000-0000-4000-8000-000000000001"
      />,
    );

    expect(html).toContain("Bill of lading");
    expect(html).toContain("Weigh-scale ticket");
    expect(html).toContain("Other transport evidence");
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toMatch(
      /<input type="radio"[^>]*checked=""[^>]*value="bill_of_lading"/,
    );
    expect(html.match(/data-testid="file-uploader"/g)).toHaveLength(1);
    expect(html).toContain('data-multiple="true"');
    expect(html).toContain('data-document-type="bill_of_lading"');
  });
});
