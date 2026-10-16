import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useForm } from "react-hook-form";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FormActions } from "@/components/forms/form-actions";
import { EntitySideSheet } from "./index";

vi.mock("@/components/ui/slide-over-panel", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { SlideOverPanel: {
    Root: Wrapper, Content: Wrapper, Title: Wrapper, Description: Wrapper, Footer: Wrapper, Close: Wrapper,
    Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
    Body: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  } };
});
vi.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: { children: ReactNode }) => <button {...props}>{children}</button> }));
vi.mock("@/components/ui/modal", () => ({ Modal: () => null }));

function DraftForm() {
  const { control, register } = useForm({ defaultValues: { notes: "Typed draft" } });
  return <form>
    <input {...register("notes")} />
    <FormActions control={control} onCancel={() => undefined} submitLabel="Save changes" />
  </form>;
}

function renderSheet(reason: string | null, mode: "view" | "edit" = "edit") {
  return create(
    <EntitySideSheet open mode={mode} onModeChange={() => undefined} onOpenChange={() => undefined} title="ORD-1"
      editNotice={<p>Sent with Removal Jan 1 to Mar 31, 2026, so every field is locked.</p>} submitBlockedReason={reason}>
      <DraftForm />
    </EntitySideSheet>,
  );
}

let renderer: ReactTestRenderer;
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => act(() => renderer?.unmount()));

const saveButton = () => renderer.root.findAll((node) => node.type === "button" && node.props.children === "Save changes")[0];

describe("EntitySideSheet record lock in edit mode", () => {
  it("keeps the draft, shows the lock line and turns Save off with the reason", () => {
    act(() => { renderer = renderSheet("This record was sent with its Removal, so it cannot be saved."); });
    // The form stays mounted, so RHF keeps the typed draft.
    expect(renderer.root.findAllByType("input")).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).toContain("Sent with Removal Jan 1 to Mar 31, 2026, so every field is locked.");
    const save = saveButton();
    expect(save.props.disabled).toBe(true);
    // The reason is a Notice, linked to Save for screen readers.
    const [reason] = renderer.root.findAll((node) => node.type === "div" && node.props.id === save.props["aria-describedby"]);
    expect(reason.props.role).toBe("status");
    expect(JSON.stringify(renderer.toJSON())).toContain("This record was sent with its Removal, so it cannot be saved.");
  });

  it("leaves Save on when nothing blocks it", () => {
    act(() => { renderer = renderSheet(null); });
    expect(saveButton().props.disabled).toBe(false);
    expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
  });
});

describe("RecordLockFormFrame (picker edit dialogs)", () => {
  it("shows the lock line and turns Save off until the lock answers", async () => {
    const { RecordLockFormFrame } = await import("@/components/record-locks/record-lock-sheet-props");
    act(() => {
      renderer = create(<RecordLockFormFrame lock={undefined} status="pending"><DraftForm /></RecordLockFormFrame>);
    });
    expect(saveButton().props.disabled).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain("Checking whether this record can change.");
  });
});
