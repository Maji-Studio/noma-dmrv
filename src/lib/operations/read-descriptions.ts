/** Shared REST and MCP operation descriptions. */
export const readDescriptions = {
  "list": "List a page ordered newest first by (createdAt, id). Cursors bind organization and filters; no totals or include. Lookup lists exclude archived rows where supported.",
  "get": "Read a stable resource representation by UUID or exact code; archived lookups remain readable.",
  "supplierLocations": "List supplier source locations by parent UUID only. Search matches a literal name prefix; the cursor also binds the parent.",
  "whoami": "Read the credential organization, active facilities, local today dates and localTime wall clocks, role, scopes and safe credential metadata."
} as const;
