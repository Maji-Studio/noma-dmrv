import sandbox from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import type { GhgEntryTemplate } from "@/lib/isometric/template-observations";

/** Protocol-default shapes, using the captured blueprint inputs with fresh IDs (no bootstrap). */
export function protocolDefaultFixture(): GhgEntryTemplate {
  const template = structuredClone(sandbox) as GhgEntryTemplate;
  template.id = "protocol-default";
  template.display_name = "Protocol default";
  template.groups = template.groups.filter((group) => ["pyrolysis", "co2-stored"].includes(group.key));
  const pyrolysis = template.groups.find((group) => group.key === "pyrolysis")!;
  const electricity = pyrolysis.components.find((component) => component.blueprint_key === "grid_electricity_use")!;
  const diesel = pyrolysis.components.find((component) => component.blueprint_key === "fuel_usage_by_volume")!;
  pyrolysis.components = [electricity, { ...structuredClone(electricity), id: "electricity-second" }, diesel];
  for (const group of template.groups) for (const component of group.components) component.id = `protocol-${component.id}`;
  return template;
}
