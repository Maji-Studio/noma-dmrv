import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CertificationFieldTag, CertificationLegend } from "./index";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";

describe("CertificationFieldTag", () => {
  it("is a seal glyph with an accessible explanation, never a CERT chip", () => {
    const markup = renderToStaticMarkup(<CertificationFieldTag />);

    expect(markup).toContain('data-cert-field="neutral"');
    expect(markup).toContain('width="14"');
    expect(markup).toContain('<span class="sr-only">Required for certification</span>');
    expect(markup).not.toContain("CERT");
  });

  it("keeps the missing and satisfied colours", () => {
    expect(renderToStaticMarkup(<CertificationFieldTag status="missing" />)).toContain("text-[var(--st-wait)]");
    expect(renderToStaticMarkup(<CertificationFieldTag status="satisfied" />)).toContain("text-[var(--st-ok)]");
  });
});

describe("CertificationLegend", () => {
  it("names the seal once, hidden by CSS until its scope holds a seal", () => {
    const markup = renderToStaticMarkup(<CertificationLegend />);

    expect(markup).toContain('data-cert-legend=""');
    expect(markup).toContain("Required for certification");
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
