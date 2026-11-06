import { act, create } from "react-test-renderer";
import { beforeAll, describe, expect, it } from "vitest";
import type { ReviewItem } from "./review-items";
import { useFixProgress, type FixEntry } from "./use-fix-progress";

const item = (id: string): ReviewItem => ({ id, title: id, explanation: null, lines: [], batchCode: null, fixes: [] });

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function Probe({ items, onEntries }: { items: ReviewItem[]; onEntries: (entries: FixEntry[]) => void }) {
  onEntries(useFixProgress(items));
  return null;
}

describe("useFixProgress", () => {
  it("keeps a fixed item in its place as done and adds items that show up later", async () => {
    const out = { entries: [] as FixEntry[] };
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Probe items={[item("a"), item("b")]} onEntries={(entries) => { out.entries = entries; }} />);
    });
    expect(out.entries.map((e) => [e.item.id, e.fixed])).toEqual([["a", false], ["b", false]]);

    await act(async () => renderer.update(<Probe items={[item("b")]} onEntries={(entries) => { out.entries = entries; }} />));
    expect(out.entries.map((e) => [e.item.id, e.fixed])).toEqual([["a", true], ["b", false]]);

    await act(async () => renderer.update(<Probe items={[item("b"), item("c")]} onEntries={(entries) => { out.entries = entries; }} />));
    expect(out.entries.map((e) => [e.item.id, e.fixed])).toEqual([["a", true], ["b", false], ["c", false]]);
  });
});
