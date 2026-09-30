import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CertificationFieldTag, CertificationLegend } from "./index";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";

describe("CertificationFieldTag", () => {
  it("is a CERT chip with an accessible explanation", () => {
    const markup = renderToStaticMarkup(<CertificationFieldTag />);

    expect(markup).toContain('data-cert-field="neutral"');
    expect(markup).toContain("CERT");
    expect(markup).toContain('<span class="sr-only">Required for certification</span>');
  });

  it("keeps the missing and satisfied colours and explanations", () => {
    const missing = renderToStaticMarkup(<CertificationFieldTag status="missing" />);
    const satisfied = renderToStaticMarkup(<CertificationFieldTag status="satisfied" />);

    expect(missing).toContain("text-[var(--st-wait)]");
    expect(missing).toContain("Required for certification. Not provided.");
    expect(satisfied).toContain("text-[var(--st-ok)]");
    expect(satisfied).toContain("Required for certification. Provided.");
  });
});

describe("CertificationLegend", () => {
  it("shows the chip and its meaning, and is not itself a chip", () => {
    const markup = renderToStaticMarkup(<CertificationLegend />);

    expect(markup).toContain('data-cert-legend=""');
    expect(markup).toContain("CERT");
    expect(markup).toContain("Required for certification");
    // A data-cert-field inside the legend would keep it visible in every sheet.
    expect(markup).not.toContain("data-cert-field");
  });

  it("sits in every sheet header", () => {
    const sheetHeader = renderToStaticMarkup(
      <SlideOverPanel.Header showClose={false}>
        <span>Title</span>
      </SlideOverPanel.Header>,
    );
    expect(sheetHeader).toContain("data-cert-legend");
  });
});
