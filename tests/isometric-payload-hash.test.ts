import { describe, expect, it } from "vitest";
import { payloadHash } from "@/lib/isometric";

describe("Isometric payload hash", () => {
  it("keeps GHG statement semantic hashes stable across property ordering", () => {
    const a = payloadHash({ projectId: "prj_123", endOn: "2026-05-05" });
    const b = payloadHash({ endOn: "2026-05-05", projectId: "prj_123" });

    expect(a).toBe(b);
  });
});
