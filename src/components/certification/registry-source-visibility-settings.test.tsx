import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  viewerCanManage: true,
  sourceVisibility: "private" as "private" | "public",
}));

vi.mock("@/hooks/use-certification", () => ({
  useRegistrySourceVisibility: () => ({
    data: {
      sourceVisibility: hookState.sourceVisibility,
      viewerCanManage: hookState.viewerCanManage,
    },
    isLoading: false,
    error: null,
  }),
  useSaveRegistrySourceVisibility: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { RegistrySourceVisibilitySettings } from "./registry-source-visibility-settings";

beforeEach(() => {
  hookState.viewerCanManage = true;
  hookState.sourceVisibility = "private";
});

describe("RegistrySourceVisibilitySettings", () => {
  it("gives organization managers one policy control with forward-only copy", () => {
    const html = renderToStaticMarkup(<RegistrySourceVisibilitySettings />);

    expect(html).toContain("Default visibility");
    expect(html).toContain(
      "Applies to new Sources across the organization.",
    );
    expect(html).toContain("Save policy");
    expect(html).toContain(
      "Only new Sources use this setting. Existing Sources are unchanged.",
    );
    expect(html).toContain(
      '<option value="private" selected="">Private — verifier only</option>',
    );
  });

  it("shows the persisted policy to viewers without mutation controls", () => {
    hookState.viewerCanManage = false;
    hookState.sourceVisibility = "public";

    const html = renderToStaticMarkup(<RegistrySourceVisibilitySettings />);

    expect(html).toContain("Public");
    expect(html).toContain("Organization Owners and Admins manage this policy");
    expect(html).toContain(
      "Only new Sources use this setting. Existing Sources are unchanged.",
    );
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<button");
  });

  it("uses the simplified private policy copy for read-only viewers", () => {
    hookState.viewerCanManage = false;

    const html = renderToStaticMarkup(<RegistrySourceVisibilitySettings />);

    expect(html).toContain("Private — verifier only");
    expect(html).not.toContain("Private — verifier access only");
  });
});
