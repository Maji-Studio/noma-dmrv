import { act, create } from "react-test-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReviewItem } from "./review-items";
import { useFixProgress, useRecheckOnReturn, type FixEntry } from "./use-fix-progress";

const item = (id: string): ReviewItem => ({ id, title: id, explanation: null, lines: [], batchCode: null, fixes: [] });

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function Probe({ items, onEntries, holdNew }: { items: ReviewItem[]; onEntries: (entries: FixEntry[]) => void; holdNew?: boolean }) {
  onEntries(useFixProgress(items, holdNew));
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

  it("adds no new item while the build is read again, so a stale refusal never shows as a row or counts as fixed", async () => {
    const out = { entries: [] as FixEntry[] };
    const collect = (entries: FixEntry[]) => { out.entries = entries; };
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Probe items={[item("check:samples")]} onEntries={collect} />);
    });
    // Readiness refreshed (the check is met) while the build still holds the old refusal.
    await act(async () => renderer.update(<Probe items={[item("blocker:refusal")]} onEntries={collect} holdNew />));
    expect(out.entries.map((e) => [e.item.id, e.fixed])).toEqual([["check:samples", true]]);
    // The fresh build has no refusal: one problem, one fixed item.
    await act(async () => renderer.update(<Probe items={[]} onEntries={collect} holdNew={false} />));
    expect(out.entries.map((e) => [e.item.id, e.fixed])).toEqual([["check:samples", true]]);
  });

  it("adds a genuinely new item once the fresh build lands", async () => {
    const out = { entries: [] as FixEntry[] };
    const collect = (entries: FixEntry[]) => { out.entries = entries; };
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Probe items={[item("a")]} onEntries={collect} />);
    });
    await act(async () => renderer.update(<Probe items={[item("a"), item("b")]} onEntries={collect} holdNew />));
    expect(out.entries.map((e) => e.item.id)).toEqual(["a"]);
    await act(async () => renderer.update(<Probe items={[item("a"), item("b")]} onEntries={collect} />));
    expect(out.entries.map((e) => e.item.id)).toEqual(["a", "b"]);
  });
});

describe("useRecheckOnReturn", () => {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const fire = (target: EventTarget, type: string) => target.dispatchEvent(new Event(type));
  const goAway = () => {
    doc.visibilityState = "hidden";
    fire(win, "blur");
    fire(doc, "visibilitychange");
  };
  const comeBack = () => {
    doc.visibilityState = "visible";
    fire(doc, "visibilitychange");
    fire(win, "focus");
  };

  beforeAll(() => {
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
  });
  afterEach(() => {
    doc.visibilityState = "visible";
  });

  function mount(refresh: () => void) {
    const out = { markUsed: () => undefined as void };
    function Hook() {
      out.markUsed = useRecheckOnReturn(refresh);
      return null;
    }
    return { out, render: () => act(async () => { create(<Hook />); }) };
  }

  it("reads the review again on every return from a repair, not only the first", async () => {
    const refresh = vi.fn();
    const { out, render } = mount(refresh);
    await render();
    out.markUsed();
    goAway();
    comeBack();
    expect(refresh).toHaveBeenCalledTimes(1);
    // A second trip without a new click (the repair tab is used again) still refreshes once.
    goAway();
    comeBack();
    expect(refresh).toHaveBeenCalledTimes(2);
    // A click from the details view starts a trip as well.
    out.markUsed();
    comeBack();
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("does nothing before any repair link was used", async () => {
    const refresh = vi.fn();
    const { render } = mount(refresh);
    await render();
    goAway();
    comeBack();
    expect(refresh).not.toHaveBeenCalled();
  });
});
