import type { components } from "../generated/certify";
import { isSequestrationBlueprintFamily } from "../storage-blueprints";

export type ComponentType = components["schemas"]["ComponentType"];
export type TemplateLineSection = "mitigated" | "emitted";
const SECTION_ORDER: readonly TemplateLineSection[] = ["mitigated", "emitted"];
const DISPLAY_NAME_COLLATOR = new Intl.Collator("en", { sensitivity: "base" });

export function templateLineSection(
  blueprintType: ComponentType | null | undefined,
  blueprintKey: string,
): TemplateLineSection {
  if (blueprintType) {
    return blueprintType === "SEQUESTRATION" || blueprintType === "REDUCTION" ? "mitigated" : "emitted";
  }
  return isSequestrationBlueprintFamily(blueprintKey) ? "mitigated" : "emitted";
}

export interface SectionableTemplateLine {
  section: TemplateLineSection;
  groupKey: string;
  groupName: string;
  groupPosition: number;
  component: { displayName: string };
}

export function sectionTemplateLines<T extends SectionableTemplateLine>(lines: readonly T[]) {
  return SECTION_ORDER.flatMap((section) => {
    const sectionLines = lines.filter((line) => line.section === section);
    const grouped = new Map<string, { key: string; name: string; position: number; lines: T[] }>();
    for (const line of sectionLines) {
      const group = grouped.get(line.groupKey) ?? {
        key: line.groupKey, name: line.groupName, position: line.groupPosition, lines: [],
      };
      group.position = Math.min(group.position, line.groupPosition);
      group.lines.push(line);
      grouped.set(group.key, group);
    }
    const groups = [...grouped.values()].sort((a, b) => a.position - b.position).map((group) => ({
      key: group.key, name: group.name, lineCount: group.lines.length,
      lines: group.lines.sort((a, b) => DISPLAY_NAME_COLLATOR.compare(a.component.displayName, b.component.displayName)),
    }));
    return sectionLines.length ? [{ section, lineCount: sectionLines.length, groups }] : [];
  });
}
