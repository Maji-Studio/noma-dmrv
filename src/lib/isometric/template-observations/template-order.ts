import type { LineSources } from "./line-sources";
import type { GhgEntryTemplate } from "./types";
import { ownValue } from "../semantic-binding-catalog";

/** Persist array positions separately from the fingerprint's sorted definition. */
export function withTemplateOrder(template: GhgEntryTemplate, lineSources: LineSources): LineSources {
  return Object.fromEntries(template.groups.flatMap((group, groupPosition) =>
    group.components.flatMap((component, position) => {
      const contract = ownValue(lineSources, component.id);
      return contract ? [[component.id, { ...contract, templateOrder: { groupPosition, position } }]] : [];
    }),
  ));
}
