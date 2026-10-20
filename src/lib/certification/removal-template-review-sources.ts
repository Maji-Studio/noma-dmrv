import { automaticSourceAvailable } from "@/lib/isometric/template-observations/catalog-sources";
import type { LineSources } from "@/lib/isometric/template-observations/line-sources";

/** Apply the server availability gate before exposing contracts to the browser. */
export function reviewLineSources(lineSources: LineSources): LineSources {
  return Object.fromEntries(Object.entries(lineSources).map(([id, contract]) => [id,
    contract.automaticSource && !automaticSourceAvailable(contract.automaticSource)
      ? { ...contract, automaticSource: undefined }
      : contract,
  ]));
}
