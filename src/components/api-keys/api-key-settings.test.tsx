import type { ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModalProps } from "@/components/ui/modal";
import type { ApiKeyListItem } from "@/hooks/use-api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS, API_KEY_MAX_EXPIRY_SECONDS } from "@/config/api-keys";
import { StaleVersionError, STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE } from "@/lib/stale-version";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { API_SCOPES } from "@/lib/auth/api-scopes";
import { ApiKeySettings } from "./api-key-settings";
import { CreateApiKeyForm, EditApiKeyForm } from "./api-key-form";
import { CreateApiKeyDialog } from "./create-api-key-dialog";

const state = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  revoke: vi.fn(),
  reset: vi.fn(),
  pending: false,
}));

vi.mock("@/hooks/use-api-keys", () => ({
  useApiKeys: () => state.list(),
  useCreateApiKey: (_org: string, onCreated: (data: { key: string }) => void) => ({
    mutateAsync: async (input: unknown) => {
      await state.create(input);
      onCreated({ key: "test-only-placeholder" });
      return { id: "key-1" };
    },
    isPending: state.pending,
    reset: state.reset,
  }),
  useUpdateApiKey: () => ({ mutateAsync: state.update, isPending: false }),
  useRevokeApiKey: () => ({ mutateAsync: state.revoke, isPending: false }),
}));

// Keep the real form primitives without importing unrelated upload/quick-add
// barrel exports, whose server modules require env and database setup.
vi.mock("@/components/forms", async () => ({
  ...await import("@/components/forms/form-actions"),
  ...await import("@/components/forms/form-error"),
  ...await import("@/components/forms/form-field"),
  ...await import("@/components/forms/form-input"),
  ...await import("@/components/forms/form-select"),
  ...await import("@/components/forms/server-error"),
}));

vi.mock("@/components/ui", async () => ({
  ...await import("@/components/ui/button"),
  ...await import("@/components/ui/input"),
  ...await import("@/components/ui/empty-state"),
  ...await import("@/components/ui/notice"),
  ...await import("@/components/ui/modal"),
}));

// Test the feature's interactions in Node. Shared Modal owns DOM focus/portals.
vi.mock("@/components/ui/modal", () => ({
  Modal: ({ isOpen, onClose, children, dismissible, ariaLabelledBy }: ModalProps) => isOpen ? (
    <section role="dialog" aria-labelledby={ariaLabelledBy}>
      <button aria-label="Close" disabled={dismissible === false} onClick={onClose}>Close</button>
      {children}
    </section>
  ) : null,
}));

const activeKey: ApiKeyListItem = {
  id: "key-1", version: 1, name: "Example integration", ownerId: "owner-1", ownerName: "Example owner",
  permissions: { feedstocks: ["read"] }, enabled: true,
  createdAt: new Date("2026-01-01"), lastUsedAt: null, expiresAt: new Date("2099-01-01"),
};

let tree: ReactTestRenderer;

async function render(node: ReactNode) {
  await act(async () => { tree = create(<>{node}</>); });
  return tree.root;
}

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : text(child)).join("");
}

function button(label: string, root = tree.root) {
  return root.findAllByType("button").find((node) => (node.props["aria-label"] ?? text(node)) === label)!;
}

async function click(label: string, root = tree.root) {
  await act(async () => { await button(label, root).props.onClick(); });
}

async function fillAndSubmit(name = "Example integration") {
  await act(async () => {
    await tree.root.findAllByType("input").find((node) => node.props.id === "api-key-name")!.props.onChange({ target: { name: "name", value: name } });
  });
  await act(async () => { await tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  state.pending = false;
  state.list.mockReturnValue({ data: [activeKey], isLoading: false, isError: false });
});

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  vi.unstubAllGlobals();
});

describe("API key forms", () => {
  it("defaults every Read on, Write and Delete off, with no unavailable controls", async () => {
    await render(<CreateApiKeyForm onSubmit={state.create} onCancel={vi.fn()} isPending={false} />);
    const boxes = tree.root.findAllByType("input").filter((node) => node.props.type === "checkbox");
    expect(boxes).toHaveLength(API_SCOPES.length);
    API_SCOPES.forEach((scope, index) => {
      expect(boxes[index].props.checked).toBe(scope.endsWith(":read"));
      expect(boxes[index].props.disabled).not.toBe(true);
    });
    const expiry = tree.root.findByType("select");
    expect(expiry.props.value).toBe(API_KEY_DEFAULT_EXPIRY_SECONDS);
    expect(Math.max(...expiry.findAllByType("option").map((option) => Number(option.props.value)))).toBe(API_KEY_MAX_EXPIRY_SECONDS);
  });

  it("saves deliberate Write and Delete selections through the schema", async () => {
    await render(<CreateApiKeyForm onSubmit={state.create} onCancel={vi.fn()} isPending={false} />);
    for (const label of ["Feedstocks Write", "Feedstocks Delete"]) {
      const checkbox = tree.root.findAllByType("label").find((node) => text(node) === label)!.findByType("input");
      await act(async () => checkbox.props.onChange({ target: { checked: true } }));
    }
    await fillAndSubmit();
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({
      name: "Example integration", expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
      scopes: expect.arrayContaining(["feedstocks:read", "feedstocks:write", "feedstocks:delete"]),
    }));
  });

  it("edits saved name and permissions without an expiry input or payload", async () => {
    await render(<EditApiKeyForm apiKey={activeKey} onSubmit={state.update} onCancel={vi.fn()} isPending={false} />);
    expect(tree.root.findAllByType("select")).toHaveLength(0);
    await fillAndSubmit("Renamed integration");
    expect(state.update).toHaveBeenCalledWith({ id: activeKey.id, expectedVersion: 1, name: "Renamed integration", scopes: ["feedstocks:read"] });
  });

  it("keeps the edit draft and loaded version after a stale refusal and list refresh", async () => {
    state.update.mockRejectedValueOnce(new StaleVersionError(STALE_VERSION_MESSAGE, {
      entity: "api-key", id: activeKey.id, code: STALE_VERSION_CONFLICT_CODE,
    }));
    await render(<ApiKeySettings canManage organizationId="org-1" />);
    await click("Edit Example integration");
    await fillAndSubmit("Unsaved draft");
    state.list.mockReturnValue({ data: [{ ...activeKey, name: "Latest saved name", version: 2 }], isLoading: false, isError: false });
    await act(async () => tree.update(<ApiKeySettings canManage organizationId="org-1" />));
    expect(text(tree.root)).toContain(STALE_VERSION_MESSAGE);
    expect(tree.root.findAllByType("form")).toHaveLength(1);
    // Resubmitting without changing the input proves RHF retained the draft.
    await act(async () => { await tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    expect(state.update).toHaveBeenLastCalledWith({
      id: activeKey.id, expectedVersion: 1, name: "Unsaved draft", scopes: ["feedstocks:read"],
    });
  });

  it("keeps a failed create form open with an inline error", async () => {
    state.create.mockRejectedValueOnce(new Error("Creation refused. Check your organization role."));
    await render(<CreateApiKeyDialog isOpen onClose={vi.fn()} organizationId="org-1" />);
    await fillAndSubmit();
    expect(tree.root.findAllByType("form")).toHaveLength(1);
    expect(text(tree.root)).toContain("Creation refused. Check your organization role.");
    expect(tree.root.findAllByProps({ id: "api-key-plaintext" })).toHaveLength(0);
  });
});

describe("one-time API key", () => {
  it.each(["Done", "Close"])("shows plaintext once, copies it and clears it on %s", async (closeLabel) => {
    const onClose = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await render(<CreateApiKeyDialog isOpen onClose={onClose} organizationId="org-1" />);
    await fillAndSubmit();
    expect(tree.root.findByType("input").props.value).toBe("test-only-placeholder");
    expect(text(tree.root)).toContain("It will not be shown again");
    await click("Copy key");
    expect(writeText).toHaveBeenCalledWith("test-only-placeholder");
    expect(text(tree.root)).toContain("API key copied.");
    await click(closeLabel);
    expect(onClose).toHaveBeenCalledOnce();
    // Parent deliberately stays open here: clearing is synchronous even before
    // controlled close/animation, and reopening cannot resurrect the secret.
    expect(tree.root.findAllByProps({ id: "api-key-plaintext" })).toHaveLength(0);
    expect(tree.root.findAllByType("form")).toHaveLength(1);
    expect(state.reset).toHaveBeenCalledOnce();
  });

  it("shows a manual-copy instruction if clipboard access fails", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Clipboard unavailable")) } });
    await render(<CreateApiKeyDialog isOpen onClose={vi.fn()} organizationId="org-1" />);
    await fillAndSubmit();
    await click("Copy key");
    expect(text(tree.root)).toContain("Select the key and copy it manually.");
  });

  it("keeps the issued key visible when the follow-up list refresh fails", async () => {
    await render(<ApiKeySettings canManage organizationId="org-1" />);
    await click("New API key");
    await fillAndSubmit();
    state.list.mockReturnValue({ data: [activeKey], isLoading: false, isError: true, refetch: vi.fn() });
    await act(async () => tree.update(<ApiKeySettings canManage organizationId="org-1" />));
    expect(tree.root.findByType("input").props.value).toBe("test-only-placeholder");
    await click("Done");
    expect(tree.root.findAllByType("input")).toHaveLength(0);
  });

  it("clears the one-time view when the organization changes", async () => {
    await render(<ApiKeySettings canManage organizationId="org-1" />);
    await click("New API key");
    await fillAndSubmit();
    expect(tree.root.findByType("input").props.value).toBe("test-only-placeholder");
    await act(async () => tree.update(<ApiKeySettings canManage organizationId="org-2" />));
    expect(tree.root.findAllByType("input")).toHaveLength(0);
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  });
});

describe("API key management", () => {
  it("requires confirmation to revoke and allows cancellation", async () => {
    await render(<ApiKeySettings canManage organizationId="org-1" />);
    await click("Revoke Example integration");
    expect(state.revoke).not.toHaveBeenCalled();
    expect(text(tree.root)).toContain("This cannot be undone.");
    await click("Cancel");
    expect(state.revoke).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    await click("Revoke Example integration");
    await click("Revoke key");
    expect(state.revoke).toHaveBeenCalledWith({ id: activeKey.id, expectedVersion: 1 });
  });

  it.each(["Member", "Platform Admin without an Owner/Admin membership"])("shows no controls or list request for %s", async () => {
    await render(<ApiKeySettings canManage={false} organizationId="org-1" />);
    expect(state.list).not.toHaveBeenCalled();
    expect(tree.root.findAllByType("button")).toHaveLength(0);
    expect(text(tree.root)).toContain("Only organization Owners and Admins with a membership");
  });

  it("lists safe metadata and all statuses, keeping revoked keys as Disabled", async () => {
    state.list.mockReturnValue({ data: [activeKey,
      { ...activeKey, id: "disabled", name: "Disabled integration", enabled: false },
      { ...activeKey, id: "expired", name: "Expired integration", expiresAt: new Date("2020-01-01") },
    ], isLoading: false, isError: false });
    await render(<ApiKeySettings canManage organizationId="org-1" />);
    expect(text(tree.root)).toContain("Example owner");
    expect(text(tree.root)).toContain(MISSING_VALUE.notRecorded);
    expect(text(tree.root)).toContain("Feedstocks: Read");
    expect(tree.root.findAllByType("li").map(text)).toEqual([
      expect.stringContaining("Active"), expect.stringContaining("Disabled"), expect.stringContaining("Expired"),
    ]);
    expect(tree.root.findAllByType("button").filter((node) => node.props["aria-label"]?.startsWith("Revoke "))).toHaveLength(1);
    expect(tree.root.findAllByType("input")).toHaveLength(0);
  });

  it("uses an EmptyState and a distinct first-key action", async () => {
    state.list.mockReturnValue({ data: [], isLoading: false, isError: false });
    await render(<ApiKeySettings canManage organizationId="org-1" />);
    expect(text(tree.root)).toContain("No API keys yet");
    expect(button("New API key")).toBeDefined();
    expect(button("Create your first API key")).toBeDefined();
  });

  it("removes management controls after a failed live-role refresh", async () => {
    state.list.mockReturnValue({ data: [activeKey], isLoading: false, isError: true, refetch: vi.fn() });
    await render(<ApiKeySettings canManage organizationId="org-1" />);
    expect(button("New API key")).toBeUndefined();
    expect(text(tree.root)).toContain("Check your organization role and try again.");
  });
});
