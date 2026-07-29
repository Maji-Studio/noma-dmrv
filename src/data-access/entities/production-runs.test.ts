import { describe, expect, it } from "vitest";
import { toProductionRunEntityOption } from "./production-runs";

describe("toProductionRunEntityOption", () => {
  it("uses the date, bin name, and explicit wet and dry masses without visible codes or facilities", () => {
    expect(
      toProductionRunEntityOption({
        id: "run-1",
        code: "PR-26-003",
        date: "2026-05-17",
        status: "complete",
        biocharOutputKg: 850,
        biocharDryMassKg: 820,
        biocharStorageName: "Moshi Raw Biochar Curing Pad",
      }),
    ).toEqual({
      id: "run-1",
      code: "PR-26-003",
      name: "May 17, 2026",
      subtitle:
        "Complete · Moshi Raw Biochar Curing Pad · Wet: 850 kg · Dry: 820 kg",
    });
  });

  it("keeps both mass labels visible when measurements are missing", () => {
    expect(
      toProductionRunEntityOption({
        id: "run-2",
        code: "PR-26-004",
        date: "2026-05-18",
        status: "draft",
        biocharOutputKg: null,
        biocharDryMassKg: null,
        biocharStorageName: null,
      }).subtitle,
    ).toBe("Draft · Wet: Not recorded · Dry: Not recorded");
  });
});
