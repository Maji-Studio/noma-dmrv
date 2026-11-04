// Preload for the dev server behind the returned Removal screen specs. `pnpm test:e2e:returned` does all of this. By hand, start the server with
//   RETURNED_STATEMENT_STUB=1 DISABLE_RATE_LIMIT=true NODE_OPTIONS="--require ./tests/e2e/helpers/returned-removal-registry-stub.cjs" pnpm exec next dev -p <port>
// (NODE_OPTIONS splits on spaces: use a path without any, e.g. copy this file.) and run the spec with RETURNED_STATEMENT_STUB=1. It answers the few
// registry reads the Removals screens make, with the template the seed describes. Every other
// registry call gets a quick 404, so nothing leaves this machine with the fake E2E credentials.
// The seed also imports this preload in the Playwright worker for its in-process compiler reads.
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
  }, {
    id: "e2e-storage-group", key: "co2-stored", display_name: "CO2 stored", description: "",
    components: [{
      id: "e2e-returned-storage", display_name: "Sequestration", description: null, blueprint_key: "carbon_rich_substance_sequestration",
      inputs: [
        { input_key: "carbon_content", type: "monitored", quantity_kind: "dimensionless", datapoint_id: null, display_name: "Organic carbon" },
        { input_key: "product_mass", type: "monitored", quantity_kind: "mass", datapoint_id: null, display_name: "Biochar mass" },
      ],
    }],
  }],
};
// A second template that fits the facility (it has a storage component), for the template setup dialog.
const SETUP_TEMPLATE = {
  id: "e2e-setup-template", name: "E2E setup template", credit_type: "REMOVAL",
  groups: [{
    id: "e2e-setup-group", key: "storage", display_name: "Storage", description: "",
    components: [{
      id: "e2e-storage", display_name: "Sequestration", description: null, blueprint_key: "biochar_sequestration_200_year_c_org",
      inputs: [{ input_key: "biochar_mass", type: "monitored", quantity_kind: "mass", datapoint_id: null, display_name: "Biochar mass" }],
    }],
  }],
};
const BLUEPRINT = { key: "grid_electricity_use", display_name: "Grid electricity use",
  inputs: [{ input_key: "electricity_use", quantity_kind: "energy", compatible_unit: "kWh", data_shape: "SCALAR" }] };
const STORAGE_BLUEPRINT = { key: "biochar_sequestration_200_year_c_org", display_name: "Biochar sequestration",
  inputs: [{ input_key: "biochar_mass", quantity_kind: "mass", compatible_unit: "kg", data_shape: "SCALAR" }] };
const RETURNED_STORAGE_BLUEPRINT = { key: "carbon_rich_substance_sequestration", display_name: "Biochar sequestration",
  inputs: [
    { input_key: "carbon_content", quantity_kind: "dimensionless", compatible_unit: "dimensionless", data_shape: "SCALAR" },
    { input_key: "product_mass", quantity_kind: "mass", compatible_unit: "kg", data_shape: "SCALAR" },
  ] };
globalThis.fetch = async function stubbedFetch(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const statement = /isometric\.com\/mrv\/v0\/ghg_statements\/(ghg_e2e_returned_[^/?]+)/.exec(url);
  if (statement) {
    const id = statement[1];
    return json({ id, status: id.includes("_draft_") ? "DRAFT" : "FAILED_VERIFICATION", submitted_at: "2026-10-05T09:00:00Z",
      ghg_entry_ids: [`rmv_e2e_returned_${id.split("_").pop()}`] });
  }
  if (/isometric\.com\/mrv\/v0\/projects\?/.test(url)) return page([{ id: "prj_e2e_returned", name: "E2E returned project" }]);
  if (/isometric\.com\/mrv\/v0\/projects\/prj_e2e_returned\/ghg_entry_templates/.test(url)) return page([TEMPLATE, SETUP_TEMPLATE]);
  if (/isometric\.com\/mrv\/v0\/component_blueprints/.test(url)) return page([BLUEPRINT, STORAGE_BLUEPRINT, RETURNED_STORAGE_BLUEPRINT]);
  if (/isometric\.com\/(mrv|graphql)/.test(url)) return json({ detail: "stubbed for the returned Removal screens" }, 404);
  return realFetch(input, init);
};
module.exports = {};
