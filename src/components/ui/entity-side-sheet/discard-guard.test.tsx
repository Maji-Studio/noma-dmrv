// @vitest-environment jsdom
import { useEffect, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Controller, useForm, useFormState } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { EntitySideSheet, type SideSheetMode } from "./index";
import { useSideSheetActions } from "./side-sheet-context";

vi.mock("@/components/ui/slide-over-panel", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { FILL_CHILDREN_CLASS: "[&>*]:flex [&>*]:flex-1 [&>*]:flex-col", SlideOverPanel: {
    Root: ({ children, onOpenChange }: { children: ReactNode; onOpenChange: (open: boolean) => void }) => <div><button onClick={() => onOpenChange(false)}>Close sheet</button>{children}</div>,
    Content: Wrapper, Title: Wrapper, Description: Wrapper, Footer: Wrapper, Close: Wrapper,
    Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
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
    <Controller name="reason" control={control} render={({ field }) => <input aria-label="Reason" {...field} />} />
    <output>{isDirty ? "dirty" : "clean"}</output>
    <p role="alert">Mandatory evidence is missing</p>
    <span>Mass<ExplanationInfo title="Mass">Arithmetic</ExplanationInfo></span>
    <button onClick={() => actions?.cancel()}>Cancel form</button>
  </>;
}

afterEach(cleanup);

const close = vi.fn();
const changeMode = vi.fn();
function mount(mode: SideSheetMode = "edit") {
  close.mockClear(); changeMode.mockClear();
  return render(<EntitySideSheet open onOpenChange={close} mode={mode} onModeChange={changeMode} title="Record">
    <EditableFields />
  </EntitySideSheet>);
}

describe("sheet discard guard", () => {
  it.each(["view", "edit", "create"] as const)("renders %s without a Simple or Detailed switch", mode => {
    const { container } = mount(mode);
    expect(container.querySelector('input[type="radio"]')).toBeNull();
  });

  it("keeps the warning and lets a press on an (i) open its panel without dirtying the form", async () => {
    mount();
    expect(screen.getByRole("alert").textContent).toBe("Mandatory evidence is missing");
    fireEvent.click(screen.getByRole("button", { name: "About Mass" }));
    expect(await screen.findByText("Arithmetic")).toBeTruthy();
    expect(screen.getByText("clean")).toBeTruthy();
    // A clean form leaves without the discard dialog.
    fireEvent.click(screen.getByRole("button", { name: "Cancel form" }));
    expect(changeMode).toHaveBeenCalledWith("view");
    expect(document.querySelector("aside")).toBeNull();
  });

  it("guards Cancel after an actual RHF edit", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Edited reason" } });
    expect(screen.getByText("dirty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel form" }));
    expect(document.querySelector("aside")).not.toBeNull();
    expect(changeMode).not.toHaveBeenCalled();
  });

  it("still guards native edits", () => {
    mount("create");
    fireEvent.input(screen.getByLabelText("Reason"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Close sheet" }));
    expect(close).not.toHaveBeenCalled();
    expect(document.querySelector("aside")).not.toBeNull();
  });

  it("opens an (i) inside a disabled fieldset, as a locked record shows", async () => {
    render(<fieldset disabled><ExplanationInfo title="Yield">Arithmetic</ExplanationInfo></fieldset>);
    fireEvent.click(screen.getByRole("button", { name: "About Yield" }));
    expect(await screen.findByText("Arithmetic")).toBeTruthy();
  });
});
