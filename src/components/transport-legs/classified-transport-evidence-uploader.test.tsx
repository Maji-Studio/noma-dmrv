import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

let latestUploaderProps: Record<string, unknown> = {};

vi.mock("@/components/forms/form-file-upload", () => ({
  FormFileUpload: (props: {
    multiple?: boolean;
    documentType?: string;
    accept?: string;
    deliveryEvidenceRole?: string;
  }) => {
    latestUploaderProps = props;
    return (
      <div
        data-testid="file-uploader"
        data-multiple={String(props.multiple)}
        data-document-type={props.documentType}
        data-accept={props.accept}
        data-delivery-evidence-role={props.deliveryEvidenceRole ?? ""}
      />
    );
  },
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));

import { ClassifiedTransportEvidenceUploader } from "./classified-transport-evidence-uploader";

describe("ClassifiedTransportEvidenceUploader", () => {
  async function selectDeliveryPhoto(
    props: React.ComponentProps<typeof ClassifiedTransportEvidenceUploader>,
  ): Promise<ReactTestRenderer> {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ClassifiedTransportEvidenceUploader {...props} />);
    });
    const photoRadio = renderer.root.findAllByType("input").find(
      (input) => input.props.value === "photo",
    );
    expect(photoRadio).toBeDefined();
    await act(async () => {
      photoRadio!.props.onChange();
    });
    return renderer;
  }

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
    expect(html).not.toContain("Distance provenance");
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toMatch(
      /<input type="radio"[^>]*checked=""[^>]*value="bill_of_lading"/,
    );
    expect(html.match(/data-testid="file-uploader"/g)).toHaveLength(1);
    expect(html).toContain('data-multiple="true"');
    expect(html).toContain('data-document-type="bill_of_lading"');
    expect(html).toContain('data-delivery-evidence-role=""');
  });

  it("offers the five delivery classifications with delivery labels", () => {
    const html = renderToStaticMarkup(
      <ClassifiedTransportEvidenceUploader
        id="delivery-evidence-test"
        entityType="delivery"
        entityId="00000000-0000-4000-8000-000000000002"
      />,
    );

    expect(html.match(/type="radio"/g)).toHaveLength(5);
    expect(html).toContain("Bill of lading");
    expect(html).toContain("Weigh-scale ticket");
    expect(html).toContain("Other transport evidence");
    expect(html).toContain("Delivery receipt");
    expect(html).toContain("Delivery photo");
    // The default bill_of_lading chip stamps no role.
    expect(html).toContain('data-delivery-evidence-role=""');
  });

  it("keeps the transport-leg chip list unchanged", () => {
    const html = renderToStaticMarkup(
      <ClassifiedTransportEvidenceUploader
        id="transport-leg-evidence-test"
        entityType="transport_leg"
        entityId="00000000-0000-4000-8000-000000000003"
      />,
    );

    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain("Weigh-scale ticket");
    expect(html).not.toContain("Delivery receipt");
  });

  it("stamps Delivery photo on live upload requests", async () => {
    const renderer = await selectDeliveryPhoto({
      id: "delivery-live-evidence-test",
      entityType: "delivery",
      entityId: "00000000-0000-4000-8000-000000000004",
    });

    expect(latestUploaderProps).toMatchObject({
      documentType: "photo",
      deliveryEvidenceRole: "proof_of_delivery",
      accept: "image/*",
    });
    renderer.unmount();
  });

  it("stamps Delivery photo on deferred attachment metadata", async () => {
    const add = vi.fn();
    const renderer = await selectDeliveryPhoto({
      id: "delivery-deferred-evidence-test",
      entityType: "delivery",
      deferredAttachments: {
        attachments: [],
        add,
        remove: vi.fn(),
        updateMeta: vi.fn(),
        clear: vi.fn(),
        hasHeld: false,
        flush: vi.fn(),
        flushMany: vi.fn(),
        retry: vi.fn(),
      },
    });
    const files = [new File(["photo"], "delivery.jpg", { type: "image/jpeg" })];

    (latestUploaderProps.onDeferredAdd as (files: File[]) => void)(files);

    expect(add).toHaveBeenCalledWith(files, "photo", {
      deliveryEvidenceRole: "proof_of_delivery",
    });
    renderer.unmount();
  });
});
