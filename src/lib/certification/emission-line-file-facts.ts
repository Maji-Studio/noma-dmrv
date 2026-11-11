import type { BatchEmissionLineFacts } from "./emission-lines";

/** The uploaded-document join has one row per anchor and document, including empty anchors. */
export function groupEmissionLineFiles(rows: readonly {
  anchor: { id: string; componentId: string; version: number };
  document: { id: string; fileName: string; version: number } | null;
}[]): NonNullable<BatchEmissionLineFacts["lineFiles"]> {
  const anchors = new Map<string, NonNullable<BatchEmissionLineFacts["lineFiles"]>[number]>();
  for (const { anchor, document } of rows) {
    let facts = anchors.get(anchor.id);
    if (!facts) {
      facts = { anchor: { id: anchor.id, componentId: anchor.componentId, version: anchor.version }, documents: [] };
      anchors.set(anchor.id, facts);
    }
    if (document) facts.documents.push({ id: document.id, fileName: document.fileName, version: document.version });
  }
  return [...anchors.values()];
}
