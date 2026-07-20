import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ENTITY_STATUS_STATES } from "@/lib/status-state";
import { StatusBadge, statusLabels } from ".";

describe("StatusBadge semantic state treatment", () => {
  it("maps every supported status through the canonical state mapping", () => {
    for (const status of Object.keys(statusLabels)) {
      expect(Object.hasOwn(ENTITY_STATUS_STATES, status), status).toBe(true);
    }
  });

  it("renders failed as an error without changing its label", () => {
    const html = renderToStaticMarkup(<StatusBadge status="failed" />);

    expect(html).toContain('data-status="failed"');
    expect(html).toContain('data-status-state="error"');
    expect(html).toContain("--st-bad-bg");
    expect(html).toContain(">Failed</span>");
  });

  it("renders cancelled as neutral without changing its label", () => {
    const html = renderToStaticMarkup(<StatusBadge status="cancelled" />);

    expect(html).toContain('data-status="cancelled"');
    expect(html).toContain('data-status-state="neutral"');
    expect(html).toContain("--st-off-bg");
    expect(html).toContain(">Cancelled</span>");
  });
});
