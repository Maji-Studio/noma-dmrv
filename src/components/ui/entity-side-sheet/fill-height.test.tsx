import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FILL_CHILDREN_CLASS } from "@/components/ui/slide-over-panel";
import { EntitySideSheet } from "./index";

vi.mock("@/components/ui/slide-over-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/slide-over-panel")>();
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { ...actual, SlideOverPanel: {
    Root: Wrapper, Content: Wrapper, Title: Wrapper, Description: Wrapper, Footer: Wrapper, Close: Wrapper,
    Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
    Body: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  } };
});
vi.mock("@/components/ui/button", () => ({ Button: ({ children }: { children: ReactNode }) => <button>{children}</button> }));
vi.mock("@/components/ui/modal", () => ({ Modal: () => null }));

let renderer: ReactTestRenderer;
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => act(() => renderer?.unmount()));

// jsdom cannot measure layout, so pin the classes that make the fill work.
describe("EntitySideSheet form fill", () => {
  it("passes the body's fill on to the form through the fieldset", () => {
    act(() => {
      renderer = create(
        <EntitySideSheet open mode="edit" onModeChange={() => undefined} onOpenChange={() => undefined} title="X"
          editNotice={<p>Notice</p>}>
          <form />
        </EntitySideSheet>,
      );
    });
    const fieldset = renderer.root.findByType("fieldset").props.className as string;
    expect(fieldset).not.toContain("contents");
    expect(fieldset).toContain("min-w-0");
    expect(FILL_CHILDREN_CLASS).toContain("[&>*]:flex-1");
    expect(fieldset).toContain(FILL_CHILDREN_CLASS);
  });

  it("keeps the edit notice at natural height", () => {
    act(() => {
      renderer = create(
        <EntitySideSheet open mode="edit" onModeChange={() => undefined} onOpenChange={() => undefined} title="X"
          editNotice={<p>Notice</p>}>
          <form />
        </EntitySideSheet>,
      );
    });
    const notice = renderer.root.findAll((n) => n.type === "div" && String(n.props.className).includes("pb-20"))[0];
    expect(notice.props.className).toContain("flex-none!");
  });
});
