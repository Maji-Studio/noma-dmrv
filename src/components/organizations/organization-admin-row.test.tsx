import type { ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModalProps } from "@/components/ui/modal";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { OrganizationAdminRow } from "./organization-admin-row";

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  pending: false,
}));

vi.mock("@/hooks/use-organizations", () => ({
  useSetOrganizationApiAccess: () => ({ mutateAsync: state.mutate, isPending: state.pending }),
}));
vi.mock("@/hooks/use-certifier-credentials", () => ({
  useOrgCertifierCredentialsStatus: () => ({ data: { configured: false } }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: state.success, error: state.error }),
}));
vi.mock("./organization-certifier-credentials", () => ({
  OrganizationCertifierCredentials: () => null,
}));
// Shared Modal owns DOM focus and portals; this suite checks row interactions in Node.
vi.mock("@/components/ui/modal", () => ({
  Modal: ({ isOpen, children, onClose, dismissible, ariaLabelledBy }: ModalProps) => isOpen ? (
    <section role="dialog" aria-labelledby={ariaLabelledBy}>
      <button aria-label="Close" disabled={dismissible === false} onClick={onClose}>Close</button>
      {children}
    </section>
  ) : null,
}));

const org = { id: "org-1", name: "Example organization", slug: "example", memberCount: 1 };
let tree: ReactTestRenderer;

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : text(child)).join("");
}
function button(label: string, root = tree.root) {
  return root.findAllByType("button").find((node) => (node.props["aria-label"] ?? text(node)) === label)!;
}
async function render(enabled: boolean | undefined) {
  const node: ReactNode = <OrganizationAdminRow org={org} apiAccessEnabled={enabled} entering={false} onEnter={vi.fn()} />;
  await act(async () => { tree = create(node); });
}
async function click(label: string, root = tree.root) {
  await act(async () => { await button(label, root).props.onClick(); });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  state.pending = false;
  state.mutate.mockResolvedValue(undefined);
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });

describe("OrganizationAdminRow API access", () => {
  it.each([true, false])("shows the %s state", async (enabled) => {
    await render(enabled);
    expect(text(tree.root)).toContain(`API access ${enabled ? "on" : "off"}`);
    expect(button(`Turn API access ${enabled ? "off" : "on"}`)).toBeDefined();
  });

  it("requires confirmation before turning access off and explains the key consequence", async () => {
    await render(true);
    await click("Turn API access off");
    expect(state.mutate).not.toHaveBeenCalled();
    const dialog = tree.root.findByProps({ role: "dialog" });
    expect(text(dialog)).toContain("Every API key in this organization stops working until API access is turned back on.");
    expect(text(dialog)).toContain("The API keys are not revoked.");
    await click("Turn API access off", dialog);
    expect(state.mutate).toHaveBeenCalledExactlyOnceWith({ id: org.id, enabled: false });
    expect(state.success).toHaveBeenCalledWith(`API access turned off for ${org.name}.`);
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  });

  it("cancels without calling the action", async () => {
    await render(true);
    await click("Turn API access off");
    await click("Cancel");
    expect(state.mutate).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  });

  it("turns access on directly", async () => {
    await render(false);
    await click("Turn API access on");
    expect(state.mutate).toHaveBeenCalledExactlyOnceWith({ id: org.id, enabled: true });
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    expect(state.success).toHaveBeenCalledWith(`API access turned on for ${org.name}.`);
  });

  it("keeps confirmation open and toasts a failed change", async () => {
    state.mutate.mockRejectedValue(new Error("API access was not changed. Try again."));
    await render(true);
    await click("Turn API access off");
    await click("Turn API access off", tree.root.findByProps({ role: "dialog" }));
    expect(state.success).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith("API access was not changed. Try again.");
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(1);
  });

  it("disables the toggle while the state is unavailable", async () => {
    await render(undefined);
    expect(text(tree.root)).toContain(`API access: ${MISSING_VALUE.notAvailable}`);
    expect(button("Turn API access off").props.disabled).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("disables the toggle while a mutation is pending", async () => {
    state.pending = true;
    await render(false);
    expect(button("Turn API access on").props.disabled).toBe(true);
  });
});
