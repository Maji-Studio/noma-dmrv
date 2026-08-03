import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WizardRegistryStep } from "./wizard-registry-step";

vi.mock("@/components/certification", () => ({
  CertifierSettingsPanel: ({
    projectLinkPresentation,
  }: {
    projectLinkPresentation?: "dialog" | "inline";
  }) => (
    <div data-project-link-presentation={projectLinkPresentation}>
      Certifier settings
    </div>
  ),
}));

describe("WizardRegistryStep", () => {
  it("uses inline project linking inside the onboarding modal", () => {
    const markup = renderToStaticMarkup(
      <WizardRegistryStep facilityId="facility-1" canManage />,
    );

    expect(markup).toContain('data-project-link-presentation="inline"');
  });
});
