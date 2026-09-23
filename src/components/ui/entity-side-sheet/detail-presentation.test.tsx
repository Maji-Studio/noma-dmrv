import { useEffect, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Controller, useForm, useFormState } from "react-hook-form";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EntitySideSheet, type SideSheetMode } from "./index";
import { useSideSheetActions } from "./side-sheet-context";
import { DetailedOnly } from "@/components/forms/form-detail-context";

vi.mock("@/components/ui/slide-over-panel", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { SlideOverPanel: {
    Root: ({ children, onOpenChange }: { children: ReactNode; onOpenChange: (open: boolean) => void }) => <div><button onClick={() => onOpenChange(false)}>Close sheet</button>{children}</div>,
    Content: Wrapper, Title: Wrapper, Description: Wrapper, Footer: Wrapper, Close: Wrapper,
    Header: ({ children, actions }: { children: ReactNode; actions: ReactNode }) => <header>{children}{actions}</header>,
    Body: ({ children, ...props }: { children: ReactNode }) => <main {...props}>{children}</main>,
  } };
});
vi.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: { children: ReactNode }) => <button {...props}>{children}</button> }));
vi.mock("@/components/ui/modal", () => ({ Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => isOpen ? <aside>{children}</aside> : null }));

function EditableFields() {
  const { control } = useForm({ defaultValues: { reason: "Saved reason" } });
  const { isDirty } = useFormState({ control });
  const actions = useSideSheetActions();
  useEffect(() => actions?.reportDirty(isDirty), [actions, isDirty]);
  return <>
    <Controller name="reason" control={control} render={({ field }) => <input {...field} />} />
    <output>{isDirty ? "dirty" : "clean"}</output>
    <p role="alert">Mandatory evidence is missing</p>
    <DetailedOnly><p>Optional provenance</p></DetailedOnly>
    <button onClick={() => actions?.cancel()}>Cancel form</button>
  </>;
}

let renderer: ReactTestRenderer;
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });

const close = vi.fn();
const changeMode = vi.fn();
function sheet(mode: SideSheetMode = "edit", open = true, record = "one") {
  return <EntitySideSheet detailToggle detailScope={record} open={open} onOpenChange={close} mode={mode} onModeChange={changeMode} title="Record">
    <EditableFields />
  </EntitySideSheet>;
}
async function mount(mode: SideSheetMode = "edit") {
  close.mockClear(); changeMode.mockClear();
  await act(async () => { renderer = create(sheet(mode), { createNodeMock: element => element.type === "main" ? { contains: () => true, querySelector: () => null, scrollTop: 0 } : null }); });
}
async function select(value: string) {
  await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === value)!.props.onChange());
}
function button(text: string) { return renderer.root.findAllByType("button").find(node => node.children.includes(text))!; }
function simpleSelected() { return renderer.root.findAllByType("input").find(node => node.props.value === "simple")!.props.checked; }

describe("sheet detail presentation", () => {
  it.each(["view", "edit", "create"] as const)("starts %s in Simple and places the only switch in heading chrome", async mode => {
    await mount(mode);
    expect(simpleSelected()).toBe(true);
    expect(renderer.root.findByType("header").findAllByType("fieldset")).toHaveLength(1);
    expect(renderer.root.findByType("main").findAllByType("fieldset")).toHaveLength(0);
  });

  it("toggles without dirty/discard, keeps warnings, and ignores presentation events in the body", async () => {
    await mount();
    await select("detailed"); await select("simple");
    expect(renderer.root.findByType("output").children).toEqual(["clean"]);
    expect(renderer.root.findByProps({ role: "alert" }).children).toEqual(["Mandatory evidence is missing"]);
    await act(async () => renderer.root.findByType("main").props.onChangeCapture({ target: { closest: () => ({}) } }));
    await act(async () => button("Cancel form").props.onClick());
    expect(changeMode).toHaveBeenCalledWith("view");
    expect(renderer.root.findAllByType("aside")).toHaveLength(0);
  });

  it("preserves actual RHF edits through repeated toggles and guards Cancel", async () => {
    await mount();
    await act(async () => renderer.root.findAllByType("input").find(node => node.props.name === "reason")!.props.onChange({ target: { value: "Edited reason" } }));
    await select("detailed"); await select("simple");
    expect(renderer.root.findAllByType("input").find(node => node.props.name === "reason")!.props.value).toBe("Edited reason");
    expect(renderer.root.findByType("output").children).toEqual(["dirty"]);
    await act(async () => button("Cancel form").props.onClick());
    expect(renderer.root.findAllByType("aside")).toHaveLength(1);
    expect(changeMode).not.toHaveBeenCalled();
  });

  it("resets on mode, record, close and reopen boundaries", async () => {
    await mount();
    for (const [mode, open, record] of [["view", true, "one"], ["edit", true, "one"], ["edit", true, "two"], ["edit", false, "two"], ["edit", true, "two"]] as const) {
      await select("detailed");
      await act(async () => renderer.update(sheet(mode, open, record)));
      expect(simpleSelected()).toBe(true);
    }
  });

  it("still guards native edits", async () => {
    await mount("create");
    await act(async () => renderer.root.findByType("main").props.onInputCapture({ target: { closest: () => null } }));
    await act(async () => button("Close sheet").props.onClick());
    expect(close).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType("aside")).toHaveLength(1);
  });
});
