import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { useEffect, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OutputSubBin } from "@/types/output-stock";

vi.mock("@/components/ui", () => ({
  // The dialog resets its draft when it opens, so the stand-in opens it once on mount.
  Modal: function Modal({ isOpen, onOpen, children }: { isOpen: boolean; onOpen?: () => void; children: ReactNode }) {
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once, like the real dialog's open event
    useEffect(() => { if (isOpen) onOpen?.(); }, []);
    return isOpen ? <div>{children}</div> : null;
  },
  Button: ({ children, ...props }: { children: ReactNode }) => <button {...props}>{children}</button>,
}));
vi.mock("./sub-bin-card", () => ({ SubBinInfo: () => null, subBinWetText: () => "wet", subBinMoistureText: () => "26.7%" }));
import { SubBinOrderDialog } from "./sub-bin-order-dialog";

// Focus goes back to the moved row once React renders; the stand-ins record where.
const focused = vi.hoisted(() => ({ ids: [] as string[] }));
vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 0; });
vi.stubGlobal("document", { getElementById: (id: string) => ({ focus: () => focused.ids.push(id) }) });

function subBin(layerId: string, code: string): OutputSubBin {
  return { layerId, code, placedAt: "2026-09-10T12:00:00.000Z", dryMassKg: 100, solidsKg: 110, wetEstimateKg: 150, moisturePercent: 26.7, basis: null, recentMovements: [] };
}
const SUB_BINS = [subBin("a", "B-0412"), subBin("b", "B-0419")];

function button(renderer: ReactTestRenderer, name: string): ReactTestInstance {
  return renderer.root.find(node => node.type === "button" && (node.props["aria-label"] === name || node.props.children === name));
}

async function open(order: string[] | null) {
  const onApply = vi.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<SubBinOrderDialog isOpen onClose={vi.fn()} subBins={SUB_BINS} order={order} onApply={onApply} timeZone="UTC" />); });
  return { renderer, onApply };
}

describe("SubBinOrderDialog", () => {
  it("reorders with the arrow buttons and applies the operator order", async () => {
    const { renderer, onApply } = await open(null);
    expect(button(renderer, "Move B-0412 up").props.disabled).toBe(true);
    await act(async () => { button(renderer, "Move B-0419 up").props.onClick(); });
    // At the top its up arrow is disabled, so focus lands on its down arrow.
    expect(focused.ids.at(-1)).toBe(button(renderer, "Move B-0419 down").props.id);
    await act(async () => { button(renderer, "Use this order").props.onClick(); });
    expect(onApply).toHaveBeenCalledWith(["b", "a"]);
  });

  it("applies oldest first as no operator order", async () => {
    const { renderer, onApply } = await open(["b"]);
    await act(async () => { button(renderer, "Reset to oldest first").props.onClick(); });
    await act(async () => { button(renderer, "Use this order").props.onClick(); });
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("unticks a sub-bin and will not apply an empty load", async () => {
    const { renderer, onApply } = await open(null);
    const boxes = () => renderer.root.findAll(node => node.type === "input" && node.props.type === "checkbox");
    await act(async () => { boxes()[0].props.onChange(); });
    // The unticked row moves to the other list; its checkbox keeps focus.
    expect(focused.ids.at(-1)).toBe(boxes().find(box => box.props.checked === false)?.props.id);
    await act(async () => { button(renderer, "Use this order").props.onClick(); });
    expect(onApply).toHaveBeenLastCalledWith(["b"]);
    const again = await open(["b"]);
    await act(async () => { again.renderer.root.findAll(node => node.type === "input" && node.props.checked === true)[0].props.onChange(); });
    expect(button(again.renderer, "Use this order").props.disabled).toBe(true);
    expect(JSON.stringify(again.renderer.toJSON())).toContain("Tick at least one sub-bin.");
  });
});
