import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EntitySideSheet } from "./index";

vi.mock("@/components/ui/slide-over-panel", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { FILL_CHILDREN_CLASS: "[&>*]:flex [&>*]:flex-1 [&>*]:flex-col", SlideOverPanel: {
    Root: Wrapper, Content: Wrapper, Title: Wrapper, Description: Wrapper, Footer: Wrapper, Close: Wrapper,
    FooterClose: () => <button data-variant="default">Close</button>,
    Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
    Body: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  } };
});
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, variant }: { children: ReactNode; variant?: string }) => <button data-variant={variant}>{children}</button>,
}));
vi.mock("@/components/ui/modal", () => ({ Modal: () => null }));

let renderer: ReactTestRenderer;
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => act(() => renderer?.unmount()));

function renderView(viewPrimaryAction?: ReactNode) {
  act(() => {
    renderer = create(
      <EntitySideSheet open mode="view" onModeChange={() => undefined} onOpenChange={() => undefined} title="CB-1"
        editLabel="Edit" viewPrimaryAction={viewPrimaryAction}>
        <form />
      </EntitySideSheet>,
    );
  });
  return renderer.root.findAll((node) => node.type === "button").map((node) => [node.props.children, node.props["data-variant"]]);
}

describe("EntitySideSheet viewPrimaryAction", () => {
  it("keeps Edit primary by default, with Close last", () => {
    expect(renderView()).toEqual([["Edit", "primary"], ["Close", "default"]]);
  });

  it("keeps a footer with Close alone when the record cannot be edited", () => {
    act(() => {
      renderer = create(
        <EntitySideSheet open mode="view" onModeChange={() => undefined} onOpenChange={() => undefined} title="CB-1" canEdit={false}>
          <form />
        </EntitySideSheet>,
      );
    });
    const labels = renderer.root.findAll((node) => node.type === "button").map((node) => node.props.children);
    expect(labels).toEqual(["Close"]);
  });

  it("leads with a preview's own action and drops Edit to secondary", () => {
    const buttons = renderView(<span data-testid="lead">Open credit batch</span>);
    expect(renderer.root.findByProps({ "data-testid": "lead" }).props.children).toBe("Open credit batch");
    expect(buttons.filter(([label]) => label === "Edit" || label === "Close")).toEqual([["Edit", "default"], ["Close", "default"]]);
  });
});
