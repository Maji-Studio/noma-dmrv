import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EntitySideSheet } from "./index";

vi.mock("@/components/ui/slide-over-panel", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { SlideOverPanel: {
    Root: Wrapper, Content: Wrapper, Title: Wrapper, Description: Wrapper, Footer: Wrapper, Close: Wrapper,
    FooterClose: () => <button>Close</button>,
    Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
    Body: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  } };
});
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));
vi.mock("@/components/ui/modal", () => ({ Modal: () => null }));
vi.mock("@/components/ui/notice", () => ({
  Notice: ({ children }: { children: ReactNode }) => <p data-testid="archived">{children}</p>,
}));

let renderer: ReactTestRenderer;
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => act(() => renderer?.unmount()));

const SECTIONS = [{ title: "Order information", fields: [{ label: "Order date", value: "29 Oct 2026" }] }];

function renderSheet(mode: "view" | "edit" | "create", readOnlyReason?: string) {
  act(() => {
    renderer = create(
      <EntitySideSheet open mode={mode} onModeChange={() => undefined} onOpenChange={() => undefined} title="ORD-1"
        editLabel="Edit order" sections={SECTIONS} readOnlyReason={readOnlyReason}
        titleBadge={<span data-testid="lock-chip">Open</span>}
        viewModeNotice={<p data-testid="lock-line">Lock line</p>}
        viewModeChildren={<p data-testid="used-by">Used by</p>}>
        <form data-testid="order-form" />
      </EntitySideSheet>,
    );
  });
  return {
    buttons: renderer.root.findAll((node) => node.type === "button").map((node) => node.props.children),
    form: renderer.root.findAll((node) => node.props["data-testid"] === "order-form"),
    notice: renderer.root.findAll((node) => node.props["data-testid"] === "archived"),
    chip: renderer.root.findAll((node) => node.props["data-testid"] === "lock-chip"),
  };
}

const NOTICE = "Mafinga is archived, so this order is read-only.";

describe("EntitySideSheet readOnlyReason", () => {
  it("shows the notice first and drops Edit and the title chip, keeping Close", () => {
    const { buttons, notice, chip } = renderSheet("view", NOTICE);
    expect(notice.map((node) => node.props.children)).toEqual([NOTICE]);
    expect(chip).toHaveLength(0);
    expect(buttons).toEqual(["Close"]);
    const main = renderer.root.findByType("main");
    const order = main.findAll((node) => typeof node.props["data-testid"] === "string").map((node) => node.props["data-testid"]);
    expect(order[0]).toBe("archived");
  });

  it("drops the lock line, which says how to change the record, and keeps Used by", () => {
    renderSheet("view", NOTICE);
    expect(renderer.root.findAll((node) => node.props["data-testid"] === "lock-line")).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.props["data-testid"] === "used-by")).toHaveLength(1);
    renderSheet("view");
    expect(renderer.root.findAll((node) => node.props["data-testid"] === "lock-line")).toHaveLength(1);
  });

  it("keeps an edit link in view mode, so the form never mounts", () => {
    const { buttons, form, notice } = renderSheet("edit", NOTICE);
    expect(form).toHaveLength(0);
    expect(notice).toHaveLength(1);
    expect(buttons).toEqual(["Close"]);
  });

  it("leaves a writable record alone", () => {
    expect(renderSheet("view").buttons).toEqual(["Edit order", "Close"]);
    expect(renderSheet("view").chip).toHaveLength(1);
    expect(renderSheet("edit").form).toHaveLength(1);
  });

  it("does not apply to create", () => {
    expect(renderSheet("create", NOTICE).form).toHaveLength(1);
  });
});
