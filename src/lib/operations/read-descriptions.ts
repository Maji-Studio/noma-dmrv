/** Shared REST and MCP operation descriptions. */
export const readDescriptions = {
  "list": "List a page ordered newest first by (createdAt, id). Cursors bind organization and filters; no totals or include. Lookup lists exclude archived rows where supported.",
  "get": "Read a stable resource representation by UUID or exact code; archived lookups remain readable.",
  "supplierLocations": "List supplier source locations by parent UUID only. Search matches a literal name prefix; the cursor also binds the parent.",
  "outputStockMovements": "List the stock movements posted on one biochar or product bin by bin UUID or code, newest posting first. Read-only history: draws, losses, counts, deliveries and corrections. A feedstock bin answers 422. Cursors bind the organization and bin; no totals.",
  "whoami": "Read the credential organization, active facilities, local today dates and localTime wall clocks, role, scopes and safe credential metadata."
} as const;
