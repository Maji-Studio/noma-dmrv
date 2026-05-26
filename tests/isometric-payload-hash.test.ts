import { describe, expect, it } from "vitest";
import { payloadHash } from "@/lib/isometric";

describe("Isometric payload hash", () => {
  it("keeps GHG statement semantic hashes stable across property ordering", () => {
    const a = payloadHash({ projectId: "prj_123", endOn: "2026-05-05" });
    const b = payloadHash({ endOn: "2026-05-05", projectId: "prj_123" });

    expect(a).toBe(b);
  });

  // Regression: functions inside INPUT_MAPPING (transforms like (v) => v / 100)
  // used to be silently dropped by JSON.stringify, so MAPPING_REVISION never
  // changed when a transform body did. canonicalize must fingerprint them.
  it("changes hash when a nested function body changes", () => {
    const a = payloadHash({ transform: (v: number) => v / 100 });
    const b = payloadHash({ transform: (v: number) => v / 1000 });

    expect(a).not.toBe(b);
  });

  it("keeps hash stable when an equivalent function appears in two payloads", () => {
    const fn = (v: number) => v / 100;
    const a = payloadHash({ transform: fn });
    const b = payloadHash({ transform: (v: number) => v / 100 });

    expect(a).toBe(b);
  });
});
