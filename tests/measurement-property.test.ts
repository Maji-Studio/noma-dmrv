import { describe, expect, it } from "vitest";
import {
  encodeMeasurementProperty,
} from "@/lib/isometric/utils/measurement-property";

describe("measurement property encoding", () => {
  it("preserves empty-string qualifiers", () => {
    const encoded = encodeMeasurementProperty({
      quantity_kind: "temperature",
      qualifier: "",
    } as unknown as Parameters<typeof encodeMeasurementProperty>[0]);

    expect(encoded).toBe("temperature|");
  });

  it("omits only null qualifiers", () => {
    expect(
      encodeMeasurementProperty({
        quantity_kind: "pressure",
        qualifier: null,
      }),
    ).toBe("pressure");
  });
});
