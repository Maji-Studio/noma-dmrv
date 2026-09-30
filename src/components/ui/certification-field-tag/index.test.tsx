import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CertificationFieldTag } from "./index";

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

