import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-bin-movements", () => ({
  useBinMovements: () => ({
    data: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        organizationId: "org-test",
        storageLocationId: "00000000-0000-4000-8000-000000000002",
        lane: "feedstock",
        movementType: "adjustment",
        massDeltaKg: 0,
        reason: "Exact confirmation",
        createdBy: null,
        countedMassKg: 80,
        derivedMassKgAtTime: 80,
        countedWetMassKg: 100,
        moistureRatioUsed: 0.2,
        createdAt: new Date("2026-07-23T10:00:00Z"),
        actorName: null,
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

import { BinMovementHistory } from "./bin-movement-history";

describe("BinMovementHistory", () => {
  it("renders an exact stock-take confirmation with neutral delta styling", () => {
    const html = renderToStaticMarkup(
      <BinMovementHistory storageLocationId="00000000-0000-4000-8000-000000000002" />,
    );

    expect(html).toContain(
      'text-[var(--color-text-primary)]">0 kg</span>',
    );
    expect(html).not.toContain(
      'text-[var(--color-signal-red)]">0 kg</span>',
    );
  });
});
