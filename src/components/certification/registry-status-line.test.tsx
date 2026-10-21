// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { useRegistryConnectionStatus } from "./registry-status-line";

const { credentials, mapping } = vi.hoisted(() => ({
  credentials: { data: { configured: true } },
  mapping: {
    data: undefined as { isConfigured: boolean } | undefined,
    error: null as Error | null,
    isLoading: false,
  },
}));
vi.mock("@/hooks/use-certification", () => ({ useFacilityCertifierMapping: vi.fn(() => mapping) }));
vi.mock("@/hooks/use-certifier-credentials", () => ({ useOrgCertifierCredentialsStatus: vi.fn(() => credentials) }));

const input = { organizationId: "org-1", facilityId: "facility-1", canManage: true };

beforeEach(() => {
  credentials.data.configured = true;
  mapping.data = undefined;
  mapping.error = null;
  mapping.isLoading = false;
});

describe("useRegistryConnectionStatus", () => {
  it("reports rejected saved keys as failing", () => {
    mapping.error = new ActionError({ error: "Isometric refused the saved keys.", code: "registry_read_refused" });
    expect(renderHook(() => useRegistryConnectionStatus(input)).result.current).toBe("failing");
  });

  it.each([
    new Error("Network unavailable"),
    new ActionError({ error: "Registry unavailable", code: "registry_unavailable" }),
    new ActionError({ error: "Check failed" }),
    Object.assign(new Error("Uncoded transport failure"), { code: "registry_read_refused" }),
  ])("keeps other errors unchecked: %s", (error) => {
    mapping.error = error;
    expect(renderHook(() => useRegistryConnectionStatus(input)).result.current).toBe("unchecked");
  });

  it.each([true, false])("uses a successful mapping's configured status (%s)", (isConfigured) => {
    mapping.data = { isConfigured };
    expect(renderHook(() => useRegistryConnectionStatus(input)).result.current).toBe(isConfigured ? "connected" : "failing");
  });

  it("keeps the saved-keys and viewer checks ahead of a cached refusal", () => {
    mapping.error = new ActionError({ error: "Keys refused", code: "registry_read_refused" });
    credentials.data.configured = false;
    expect(renderHook(() => useRegistryConnectionStatus(input)).result.current).toBe("keys-not-saved");
    credentials.data.configured = true;
    expect(renderHook(() => useRegistryConnectionStatus({ ...input, canManage: false, keysSavedFallback: true })).result.current).toBe("keys-saved");
    expect(renderHook(() => useRegistryConnectionStatus({ ...input, facilityId: null })).result.current).toBe("keys-saved");
    mapping.isLoading = true;
    expect(renderHook(() => useRegistryConnectionStatus(input)).result.current).toBe("keys-saved");
  });
});
