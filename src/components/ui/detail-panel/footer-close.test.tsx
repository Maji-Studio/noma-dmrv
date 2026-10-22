import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EntityDetailPanel } from "./index";

const onCloseClick = vi.hoisted(() => vi.fn());

vi.mock("@/components/ui/slide-over-panel", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { SlideOverPanel: {
    Root: Wrapper, Content: Wrapper, Title: Wrapper, Description: Wrapper, Footer: Wrapper, Body: Wrapper, Header: Wrapper,
    FooterClose: () => <span data-close onClick={onCloseClick}><button data-variant="default">Close</button></span>,
  } };
});
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, variant }: { children: ReactNode; variant?: string }) => <button data-variant={variant}>{children}</button>,
}));

let renderer: ReactTestRenderer;
beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
afterEach(() => act(() => renderer?.unmount()));

function buttons(onEdit?: () => void) {
  act(() => {
    renderer = create(
      <EntityDetailPanel open onOpenChange={() => undefined} title="FS-1" sections={[]} onEdit={onEdit} editLabel="Edit feedstock" />,
    );
  });
  return renderer.root.findAll((n) => n.type === "button").map((n) => [n.props.children, n.props["data-variant"]]);
}

describe("EntityDetailPanel footer", () => {
  it("puts Close after the Edit action", () => {
    expect(buttons(() => undefined)).toEqual([["Edit feedstock", "primary"], ["Close", "default"]]);
  });

  it("keeps Close alone when there is nothing to edit, wrapped in the close primitive", () => {
    expect(buttons()).toEqual([["Close", "default"]]);
    expect(renderer.root.findByProps({ "data-close": true }).findByType("button").props.children).toBe("Close");
  });
});
