// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreditBatchDurabilityPanel } from "./credit-batch-durability-panel";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/hooks/use-certification", () => ({ useBatchDurabilitySummary: () => ({ data: { sampleCount: 0 }, isLoading: false, error: null }) }));

afterEach(cleanup);

describe("durability panel empty state", () => {
  it("H9: states the fact alone when the batch cannot record Samples", () => {
    render(<CreditBatchDurabilityPanel creditBatchId="cb" facilityId="fac" canRecord={false} />);
    expect(screen.getByText("Lab Samples recorded for this credit batch appear here.")).toBeTruthy();
    expect(screen.queryByText(/Record at least three/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Record a Sample/ })).toBeNull();
  });
  it("keeps the guidance for an editable batch", () => {
    render(<CreditBatchDurabilityPanel creditBatchId="cb" facilityId="fac" />);
    expect(screen.getByText(/Record at least three/)).toBeTruthy();
  });
});
