import type { EntryObservation } from "@/lib/certification/emission-entry-rules";
import type { BatchEmissionContext } from "@/lib/certification/batch-emission-context";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { normalizeTemplateDefinition } from "@/lib/isometric/template-observations";

export function lineFileEvidenceFacts(fuel = false) {
  const inputKey = fuel ? "volume_of_fuel" : "electricity_use";
  const source: "run-genset-diesel" | "run-electricity" = fuel ? "run-genset-diesel" : "run-electricity";
  const template = { id: "template", project_id: "project", groups: [{ id: "group", key: "pyrolysis", display_name: "Pyrolysis",
    components: [{ id: "component", display_name: "Energy", blueprint_key: fuel ? "fuel_usage_by_volume" : "grid_electricity_use",
      inputs: [{ input_key: inputKey, type: "monitored", quantity_kind: fuel ? "volume" : "energy", datapoint_id: null }] }],
  }] } as IsometricGhgEntryTemplate;
  const observation: EntryObservation = { externalTemplateId: template.id, definition: normalizeTemplateDefinition(template),
    lineSources: { component: { scope: "operating", entryPolicy: "additive", origin: "reviewed", automaticSource: source, filePolicy: "lineFile" } },
    enrichment: { component: { [inputKey]: { unit: fuel ? "l" : "kWh" } } },
  };
  const batch: BatchEmissionContext[string] = { entries: [], previousObservations: new Map(),
    automaticFigures: { [source]: { magnitude: "0.5", unit: fuel ? "l" : "kWh" } },
    lineFiles: [{ anchor: { id: "anchor", componentId: "component", version: 2 }, documents: [{ id: "document", fileName: "proof.pdf", version: 1 }] }],
  };
  return { template, observation, batch, source, inputKey };
}
