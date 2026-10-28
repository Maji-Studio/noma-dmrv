// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useSubBinDraw } from "./use-sub-bin-draw";

vi.mock("./use-output-stock", () => ({ useOutputSubBins: () => ({ data: { stockMode: "mix", subBins: [] } }) }));

it("restores saved sub-bin selections and readings and clears changed", () => {
  const sources = [{ layerId: "p1", moisturePercent: 20 }, { layerId: "p2", moisturePercent: 30 }];
  const { result } = renderHook(() => useSubBinDraw({
    bin: { storageLocationId: "bin", facilityId: "facility" },
    occurredAt: "2026-01-01", wetKg: 100,
    correction: { movementId: "movement", kind: "delivery", sources },
  }));
  act(() => result.current.setOrder(["p2"]));
  act(() => result.current.setReading("p2", "45"));
  expect(result.current.changed).toBe(true);
  act(() => result.current.restoreSaved());
  expect(result.current.order).toEqual(["p1", "p2"]);
  expect(result.current.readings).toEqual({ p1: "20", p2: "30" });
  expect(result.current.changed).toBe(false);
});
