import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AttentionList } from "./attention-list";
import {
  DashboardAttentionRow,
  formatDashboardRecordMetadata,
} from "./dashboard-attention-row";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

describe("DashboardAttentionRow", () => {
  it("renders the shared compact metadata, issue title, and link output", () => {
    const html = renderToStaticMarkup(
      <ul>
        <DashboardAttentionRow
          href="/production-runs?run=run-1"
          metadata={formatDashboardRecordMetadata("PR-26-0042", "2026-07-04")}
          title="Complete run missing mass data"
        />
        <DashboardAttentionRow
          href="/feedstocks?feedstock=feedstock-1"
          metadata="Feedstock form · Transport route · 1 affected"
          title="Transport endpoint GPS missing"
          divided
        />
      </ul>,
    );

    expect(html).toContain("PR-26-0042 · Jul 4, 2026");
    expect(html).toContain("Complete run missing mass data");
    expect(html).toContain(
      "Feedstock form · Transport route · 1 affected",
    );
    expect(html).toContain("Transport endpoint GPS missing");
    expect(html.match(/grid-cols-\[minmax\(0,1fr\)_auto\]/g)).toHaveLength(2);
  });

  it("omits the date separator when the record date is missing or invalid", () => {
    expect(formatDashboardRecordMetadata("FS-26-0042", null)).toBe("FS-26-0042");
    expect(formatDashboardRecordMetadata("FS-26-0042", "not-a-date")).toBe(
      "FS-26-0042",
    );
  });

  it("removes row badges and only shows the truncation footer when needed", () => {
    const html = renderToStaticMarkup(
      <AttentionList
        attention={[
          {
            id: "run-mass-run-1",
            entityCode: "PR-26-0042",
            date: "2026-07-04",
            title: "Complete run missing mass data",
            href: "/production-runs?run=run-1",
          },
        ]}
        structuralGaps={[
          {
            key: "transportEndpointGps",
            label: "Transport endpoint GPS missing",
            metadata: "Feedstock form · Transport route · 1 affected",
            count: 1,
            href: "/feedstocks?feedstock=feedstock-1&focus=transport-route",
          },
        ]}
        total={3}
      />,
    );

    expect(html).not.toContain(">Flag<");
    expect(html).not.toContain(">Upcoming<");
    expect(html).not.toContain("from blocking checks");
    expect(html).toContain("Showing first 2 of 3");
  });
});
