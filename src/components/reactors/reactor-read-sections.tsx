/** Reactor side-sheet view mode: the sections config for EntitySideSheet. */
import { formatReactorType } from "@/schemas/reactors";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { ReactorWithRelations } from "@/data-access/reactors";

export function reactorSheetSections(reactor: ReactorWithRelations): DetailPanelSection[] {
  return [
    {
      title: "Required information",
      fields: [
        { label: "Identifier", value: reactor.identifier },
      ],
    },
    {
      title: "Reactor configuration",
      fields: [
        { label: "Reactor type", value: formatReactorType(reactor.reactorType) },
        { label: "Nominal throughput (tph)", value: reactor.nominalThroughputTph },
      ],
    },
  ];
}
