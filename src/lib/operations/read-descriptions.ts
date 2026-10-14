import { OUTPUT_BIN_STOCK_ETAG, OUTPUT_BIN_STOCK_SOURCES } from "./agent-guidance";

/** Shared REST and MCP operation descriptions. */
export const readDescriptions = {
  "list": "List a page ordered newest first by (createdAt, id). Cursors bind organization and filters; no totals or include. Lookup lists exclude archived rows where supported.",
  "get": "Read a stable resource representation by UUID or exact code; archived lookups remain readable.",
  "supplierLocations": "List supplier source locations by parent UUID only. Search matches a literal name prefix; the cursor also binds the parent.",
  "outputStockMovements": "List the stock movements posted on one biochar or product bin by bin UUID or code, newest posting first. Read-only history: draws, losses, counts, deliveries and corrections. A feedstock bin answers 422. Cursors bind the organization and bin; no totals.",
  "outputBinStock": `Read current stock in one biochar or product bin by UUID or exact code, optionally narrowed by facilityId. Archived bins remain readable; a feedstock bin answers 422. Unresolved stock answers 200 with a fixed explanation and no figures. Kilograms publish to 3 decimal places and percent to 2. ${OUTPUT_BIN_STOCK_SOURCES} ${OUTPUT_BIN_STOCK_ETAG}`,
  "whoami": "Read the credential organization, active facilities, local today dates and localTime wall clocks, role, scopes and safe credential metadata."
} as const;
