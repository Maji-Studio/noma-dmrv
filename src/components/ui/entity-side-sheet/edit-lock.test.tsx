import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useForm } from "react-hook-form";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FormActions } from "@/components/forms/form-actions";
import type { SubmitBlock } from "@/components/ui/submit-block-context";
import { EntitySideSheet } from "./index";

vi.mock("@/components/ui/slide-over-panel", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { SlideOverPanel: {
    Root: Wrapper, Content: Wrapper, Title: Wrapper, Description: Wrapper, Footer: Wrapper, Close: Wrapper,
    Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
    Body: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  } };
});
vi.mock("@/components/ui/button", () => ({ Button: ({ children, busy, ...props }: { children: ReactNode; busy?: boolean }) => <button data-busy={busy} {...props}>{children}</button> }));
vi.mock("@/components/ui/modal", () => ({ Modal: () => null }));

function DraftForm() {
  const { control, register } = useForm({ defaultValues: { notes: "Typed draft" } });
  return <form>
    <input {...register("notes")} />
    <FormActions control={control} onCancel={() => undefined} submitLabel="Save changes" />
  </form>;
}

const SENT: SubmitBlock = { reason: "This record was sent with its Removal, so it cannot be saved.", tone: "error", readOnly: true };
const PENDING: SubmitBlock = { reason: "Checking whether this record can change.", tone: "info", readOnly: false };

function renderSheet(block: SubmitBlock | null) {
  return create(
    <EntitySideSheet open mode="edit" onModeChange={() => undefined} onOpenChange={() => undefined} title="ORD-1"
      editNotice={<p>Sent with Removal Jan 1 to Mar 31, 2026, so every field is locked.</p>} submitBlock={block}>
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

const buttonsNamed = (name: string) => renderer.root.findAll((node) => node.type === "button" && node.props.children === name);
const text = () => JSON.stringify(renderer.toJSON());

describe("EntitySideSheet record lock in edit mode", () => {
  it("keeps a Sent draft visible but read-only, with the lock line and the way back", () => {
    act(() => { renderer = renderSheet(SENT); });
    // The form stays mounted (RHF keeps the draft) inside a disabled fieldset.
    expect(renderer.root.findAllByType("input")).toHaveLength(1);
    expect(renderer.root.findByType("fieldset").props.disabled).toBe(true);
    expect(text()).toContain("Sent with Removal Jan 1 to Mar 31, 2026, so every field is locked.");
    expect(buttonsNamed("Save changes")).toHaveLength(0);
    expect(buttonsNamed("Back to view")).toHaveLength(1);
  });

  it("explains a pending check above Save, which stays off, and leaves fields to the form", () => {
    act(() => { renderer = renderSheet(PENDING); });
    expect(renderer.root.findByType("fieldset").props.disabled).toBe(false);
    const [save] = buttonsNamed("Save changes");
    expect(save.props.disabled).toBe(true);
    const [reason] = renderer.root.findAll((node) => node.type === "div" && node.props.id === save.props["aria-describedby"]);
    expect(reason.props.role).toBe("status");
    expect(reason.props["data-tone"]).toBe("info");
    // Above the buttons: the reason renders before Save in document order.
    expect(text().indexOf("Checking whether this record can change.")).toBeLessThan(text().indexOf("Save changes"));
  });

  it("offers an in-place retry for a failed check, in the blocked tone", () => {
    const run = vi.fn();
    act(() => {
      renderer = renderSheet({ reason: "Couldn't check whether this record can change. Try again.", tone: "error", readOnly: false, retry: { label: "Try again", run } });
    });
    const [save] = buttonsNamed("Save changes");
    const [reason] = renderer.root.findAll((node) => node.type === "div" && node.props.id === save.props["aria-describedby"]);
    expect(reason.props["data-tone"]).toBe("error");
    act(() => buttonsNamed("Try again")[0].props.onClick());
    expect(run).toHaveBeenCalled();
    expect(renderer.root.findAllByType("input")).toHaveLength(1);
  });

  it("leaves Save on when nothing blocks it", () => {
    act(() => { renderer = renderSheet(null); });
    expect(buttonsNamed("Save changes")[0].props.disabled).toBe(false);
  });
});

describe("RecordLockFormFrame (picker edit dialogs)", () => {
  it("shows the lock line and turns Save off until the lock answers", async () => {
    const { RecordLockFormFrame } = await import("@/components/record-locks/record-lock-sheet-props");
    act(() => {
      renderer = create(<RecordLockFormFrame lock={undefined} status="pending"><DraftForm /></RecordLockFormFrame>);
    });
    expect(buttonsNamed("Save changes")[0].props.disabled).toBe(true);
    expect(text()).toContain("Checking whether this record can change.");
  });

  it("makes the dialog form read-only once Sent", async () => {
    const { RecordLockFormFrame } = await import("@/components/record-locks/record-lock-sheet-props");
    const sent = { level: "sent" as const, heldBy: [], usedBy: [], freeFields: [], howToFree: null, returnedBy: [] };
    act(() => {
      renderer = create(<RecordLockFormFrame lock={sent} status="ready"><DraftForm /></RecordLockFormFrame>);
    });
    expect(renderer.root.findByType("fieldset").props.disabled).toBe(true);
    expect(buttonsNamed("Save changes")).toHaveLength(0);
  });
});
