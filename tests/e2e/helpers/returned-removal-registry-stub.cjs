// Preload for the dev server behind tests/e2e/removal-correction-screen.spec.ts. Start the server with
//   RETURNED_STATEMENT_STUB=1 DISABLE_RATE_LIMIT=true NODE_OPTIONS="--require ./tests/e2e/helpers/returned-removal-registry-stub.cjs" pnpm exec next dev -p <port>
// (NODE_OPTIONS splits on spaces: use a path without any, e.g. copy this file.) and run the spec with RETURNED_STATEMENT_STUB=1. It answers the few
// registry reads the Removals screens make, with the template the seed describes. Every other
// registry call gets a quick 404, so nothing leaves this machine with the fake E2E credentials.
const realFetch = globalThis.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const page = (nodes) => json({ nodes, page_info: { has_next_page: false, end_cursor: null } });
const TEMPLATE = {
  id: "e2e-returned-template", name: "E2E returned template", credit_type: "REMOVAL",
  groups: [{
    id: "e2e-group", key: "operations", display_name: "Operations", description: "",
    components: [["e2e-diesel", "Diesel use"], ["e2e-transport", "Transport to field"]].map(([id, display_name]) => ({
      id, display_name, description: null, blueprint_key: "grid_electricity_use",
      inputs: [{ input_key: "electricity_use", type: "monitored", quantity_kind: "energy", datapoint_id: null, display_name: "Electricity" }],
    })),
  }],
};
const BLUEPRINT = { key: "grid_electricity_use", display_name: "Grid electricity use",
  inputs: [{ input_key: "electricity_use", quantity_kind: "energy", compatible_unit: "kWh", data_shape: "SCALAR" }] };
globalThis.fetch = async function stubbedFetch(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const statement = /isometric\.com\/mrv\/v0\/ghg_statements\/(ghg_e2e_returned_[^/?]+)/.exec(url);
  if (statement) {
    const id = statement[1];
    return json({ id, status: id.includes("_draft_") ? "DRAFT" : "FAILED_VERIFICATION", submitted_at: "2026-10-05T09:00:00Z",
      ghg_entry_ids: [`rmv_e2e_returned_${id.split("_").pop()}`] });
  }
  if (/isometric\.com\/mrv\/v0\/projects\?/.test(url)) return page([{ id: "prj_e2e_returned", name: "E2E returned project" }]);
  if (/isometric\.com\/mrv\/v0\/projects\/prj_e2e_returned\/ghg_entry_templates/.test(url)) return page([TEMPLATE]);
  if (/isometric\.com\/mrv\/v0\/component_blueprints/.test(url)) return page([BLUEPRINT]);
  if (/isometric\.com\/(mrv|graphql)/.test(url)) return json({ detail: "stubbed for the returned Removal screens" }, 404);
  return realFetch(input, init);
};
