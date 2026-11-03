// The /journey URL hash must reopen exactly the record that was selected (issue #1465).
import { describe, expect, it } from "vitest";
import { CHAIN, HASH, HOME, R as RECORDS, SIBLINGS } from "../site/src/components/site/journey/model.js";
import { buildHash, parseHash } from "../site/src/components/site/journey/route.js";

type Branch = { ids: string[] };
const R = RECORDS as Record<string, { br: Branch[] }>;
type Parsed = { mode: string; snap: string; summary: boolean; chainIdx: number; recordId: string | null };

const OFF_CHAIN_RUN = "PR-26-008";
const DEEP_RECORD = (SIBLINGS.run as string[]).find((id: string) => !CHAIN.includes(id)) as string;
const FIELD_FLAGS = { mode: "map", snap: "mid", summary: false };

/** The record a restored hash selects: the chain card, or the off-chain record. */
function restored(hash: string): string {
  const p = parseHash(hash) as Parsed;
  return p.recordId ?? CHAIN[p.chainIdx];
}

describe("journey hash round trip", () => {
  it("restores a main-chain record, and keeps its readable chain name", () => {
    for (const id of CHAIN as string[]) {
      const hash = buildHash({ ...FIELD_FLAGS, recordId: id });
      expect(hash).toBe(`#${HASH[CHAIN.indexOf(id)]}`);
      expect(restored(hash)).toBe(id);
    }
  });

  it("restores a run outside the open branch, like PR-26-008", () => {
    expect(R[OFF_CHAIN_RUN]).toBeDefined();
    expect(CHAIN).not.toContain(OFF_CHAIN_RUN);
    const hash = buildHash({ ...FIELD_FLAGS, recordId: OFF_CHAIN_RUN });
    expect(hash).toBe("#r.PR-26-008");
    expect(restored(hash)).toBe(OFF_CHAIN_RUN);
  });

  it("restores a record picked more than two levels deep", () => {
    // The hash carries the record, not the path of branches that led to it.
    const hash = buildHash({ mode: "graph", snap: "full", summary: true, recordId: DEEP_RECORD });
    const parsed = parseHash(hash) as Parsed;
    expect(parsed).toMatchObject({ mode: "graph", snap: "full", summary: true, recordId: DEEP_RECORD });
    expect(restored(hash)).toBe(DEEP_RECORD);
  });

  it("restores every record in the snapshot", () => {
    for (const id of Object.keys(R)) {
      const hash = buildHash({ ...FIELD_FLAGS, recordId: id });
      expect(restored(hash)).toBe(id);
    }
  });
});

describe("journey hash compatibility", () => {
  it("reads the old chain names, with and without view flags", () => {
    expect(parseHash("#graph-full-summary-run")).toMatchObject({ mode: "graph", snap: "full", summary: true, chainIdx: HASH.indexOf("run"), recordId: null });
    expect(parseHash("#product").chainIdx).toBe(HASH.indexOf("product"));
  });

  it("reads the old branch tokens as the record they pointed at", () => {
    const si = HASH.indexOf("run");
    const br = R[CHAIN[si]].br[0];
    const withoutIndex = parseHash(`#${HASH[si]}-b0`) as Parsed;
    expect(withoutIndex.recordId ?? CHAIN[withoutIndex.chainIdx]).toBe(br.ids[0]);
    const withIndex = parseHash(`#${HASH[si]}-b0x1`) as Parsed;
    expect(withIndex.recordId ?? CHAIN[withIndex.chainIdx]).toBe(br.ids[1]);
  });

  it("opens the default view for no hash, a map hash and unknown ids", () => {
    for (const h of ["", "#", "#map", "#r.NOPE-1", "#nonsense", "#b9x9", "#r."]) {
      expect(parseHash(h)).toMatchObject({ chainIdx: HOME, recordId: null });
    }
    expect((parseHash("#graph-r.NOPE-1") as Parsed).mode).toBe("graph");
  });
});
