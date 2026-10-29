import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EntitySideSheet } from "./index";
import type { SheetReadOnly } from "@/lib/linked-record-read-only";

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
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
}));
vi.mock("@/components/ui/modal", () => ({ Modal: () => null }));
vi.mock("@/components/ui/notice", () => ({
  Notice: ({ children, tone, action }: { children: ReactNode; tone: string; action?: ReactNode }) => (
    <div data-testid="archived" data-tone={tone}>{children}{action}</div>
  ),
}));

let renderer: ReactTestRenderer;
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => act(() => renderer?.unmount()));

const SECTIONS = [{ title: "Order information", fields: [{ label: "Order date", value: "29 Oct 2026" }] }];

function renderSheet(mode: "view" | "edit" | "create", readOnly?: SheetReadOnly) {
  act(() => {
    renderer = create(
      <EntitySideSheet open mode={mode} onModeChange={() => undefined} onOpenChange={() => undefined} title="ORD-1"
        editLabel="Edit order" sections={SECTIONS} readOnly={readOnly}
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

const MESSAGE = "Mafinga is archived, so this order is read-only.";
const NOTICE: SheetReadOnly = { tone: "info", message: MESSAGE };

describe("EntitySideSheet readOnly", () => {
  it("shows the notice first and drops Edit and the title chip, keeping Close", () => {
    const { buttons, notice, chip } = renderSheet("view", NOTICE);
    expect(notice.map((node) => node.props["data-tone"])).toEqual(["info"]);
    expect(notice[0].findByType("div").children).toContain(MESSAGE);
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

  it("shows a failed check as a warning with Try again wired to the retry", () => {
    const run = vi.fn();
    const { buttons, notice } = renderSheet("view", { tone: "warning", message: "Could not be checked.", retry: { run, running: false } });
    expect(notice.map((node) => node.props["data-tone"])).toEqual(["warning"]);
    expect(buttons).toEqual(["Try again", "Close"]);
    act(() => renderer.root.findAll((node) => node.type === "button" && node.props.children === "Try again")[0].props.onClick());
    expect(run).toHaveBeenCalledOnce();
  });
});
