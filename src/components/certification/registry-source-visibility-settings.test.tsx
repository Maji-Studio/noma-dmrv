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

    expect(html).toContain("New registry Sources");
    expect(html).toContain("every facility in the active organization");
    expect(html).toContain("Save organization policy");
    expect(html).toContain("Existing Isometric Sources are not rewritten");
    expect(html).toContain(
      '<option value="private" selected="">Private — verifier access only</option>',
    );
  });

  it("shows the persisted policy to viewers without mutation controls", () => {
    hookState.viewerCanManage = false;
    hookState.sourceVisibility = "public";

    const html = renderToStaticMarkup(<RegistrySourceVisibilitySettings />);

    expect(html).toContain("Public");
    expect(html).toContain("Organization Owners and Admins manage this policy");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<button");
  });
});
