// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useTablistKeys } from "./tablist-keys";

const KEYS = ["one", "two", "three"] as const;
type Key = (typeof KEYS)[number];

function Tabs() {
  const [selected, setSelected] = useState<Key>("one");
  const tabProps = useTablistKeys({ keys: KEYS, selected, onSelect: setSelected, tabId: (key) => `tab-${key}` });
  return (
    <div role="tablist">
      {KEYS.map((key) => (
        <button key={key} id={`tab-${key}`} role="tab" type="button" aria-selected={selected === key} onClick={() => setSelected(key)} {...tabProps(key)}>
          {key}
        </button>
      ))}
    </div>
  );
}

afterEach(cleanup);

const tab = (name: string) => screen.getByRole("tab", { name });

describe("useTablistKeys", () => {
  it("moves selection and focus with ArrowRight, ArrowLeft (wrapping), Home and End", () => {
    render(<Tabs />);
    fireEvent.keyDown(tab("one"), { key: "ArrowRight" });
    expect(tab("two").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("two"));
    fireEvent.keyDown(tab("two"), { key: "End" });
    expect(document.activeElement).toBe(tab("three"));
    fireEvent.keyDown(tab("three"), { key: "ArrowRight" });
    expect(tab("one").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("one"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tab("three"));
    fireEvent.keyDown(tab("three"), { key: "Home" });
    expect(tab("one").getAttribute("aria-selected")).toBe("true");
  });

  it("keeps only the selected tab in the tab order and ignores other keys", () => {
    render(<Tabs />);
    fireEvent.keyDown(tab("one"), { key: "Enter" });
    expect(tab("one").getAttribute("tabindex")).toBe("0");
    expect(tab("two").getAttribute("tabindex")).toBe("-1");
    expect(tab("three").getAttribute("tabindex")).toBe("-1");
  });
});
