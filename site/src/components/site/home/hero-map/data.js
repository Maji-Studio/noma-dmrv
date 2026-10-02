// Illustrative sites and stops for the home hero map. Same records as the trace explorer
// (../../trace/trace-data.js), placed on a map.
// The coordinates are a PLACEHOLDER in Tanzania's southern highlands: publishing a real plant
// location needs the producer's written OK.

/** Plotted sites. kind: supplier (orange square), facility (purple square), field (pink diamond). */
export const SITES = [
  { id: "sawmill-a", kind: "supplier", code: "Sawmill A", sub: "Supplier", lng: 35.352, lat: -8.206 },
  { id: "sawmill-b", kind: "supplier", code: "Sawmill B", sub: "Supplier", lng: 35.176, lat: -8.392 },
  { id: "plant", kind: "facility", code: "Plant", sub: "2 runs, 1 mix bin", lng: 35.3, lat: -8.305 },
  { id: "field-coffee", kind: "field", code: "Coffee field", sub: "Application", lng: 35.452, lat: -8.452 },
  { id: "field-maize", kind: "field", code: "Maize field", sub: "Application", lng: 35.118, lat: -8.214 },
];

/** Legs between sites. inbound = feedstock delivery, outbound = biochar delivery. */
export const LEGS = [
  { id: "FD-001", from: "sawmill-a", to: "plant", kind: "inbound" },
  { id: "FD-002", from: "sawmill-b", to: "plant", kind: "inbound" },
  { id: "DL-001", from: "plant", to: "field-coffee", kind: "outbound" },
  { id: "DL-002", from: "plant", to: "field-maize", kind: "outbound" },
];

/** Record card per site (label/value rows, the app's popup grammar). */
export const RECORDS = {
  "sawmill-a": { type: "Supplier", rows: [["Material", "Wood residues"], ["Sent", "FD-001, 1,000 kg"], ["Evidence", "Supplier record"]] },
  "sawmill-b": { type: "Supplier", rows: [["Material", "Wood residues"], ["Sent", "FD-002, 1,000 kg"], ["Evidence", "Supplier record"]] },
  plant: { type: "Facility", rows: [["Runs", "PR-001, PR-002"], ["Produced", "540 kg dry biochar"], ["Stored", "Mix bin, origins kept"]] },
  "field-coffee": { type: "Application", rows: [["Applied", "270 kg dry biochar"], ["Came from", "135 kg from each run"], ["Evidence", "Application record"]] },
  "field-maize": { type: "Application", rows: [["Applied", "270 kg dry biochar"], ["Came from", "135 kg from each run"], ["Evidence", "Application record"]] },
};

const ALL_SITES = SITES.map((s) => s.id);
const ALL_LEGS = LEGS.map((l) => l.id);

/** Tracing a site: a field goes back through both runs (mix bin) to both sawmills, and the reverse. */
export const TRACES = {
  "field-coffee": { sites: ["field-coffee", "plant", "sawmill-a", "sawmill-b"], legs: ["DL-001", "FD-001", "FD-002"] },
  "field-maize": { sites: ["field-maize", "plant", "sawmill-a", "sawmill-b"], legs: ["DL-002", "FD-001", "FD-002"] },
  "sawmill-a": { sites: ["sawmill-a", "plant", "field-coffee", "field-maize"], legs: ["FD-001", "DL-001", "DL-002"] },
  "sawmill-b": { sites: ["sawmill-b", "plant", "field-coffee", "field-maize"], legs: ["FD-002", "DL-001", "DL-002"] },
  plant: { sites: ALL_SITES, legs: ALL_LEGS },
};

/**
 * Tour stops, one per scroll step. lit: what the map lights. focus: what the camera frames.
 * at: the site the record card opens on. close: a close-up at the plant. card: the card's rows.
 * station: the line drawing (../contours/<station>.svg) on the step card and the record card.
 */
export const STOPS = [
  { label: "Source", station: "source", note: "Where the wood residues came from.", records: ["Sawmill A", "Sawmill B"],
    lit: { sites: ["sawmill-a", "sawmill-b"], legs: [] }, focus: ["sawmill-a", "sawmill-b"], at: "sawmill-b",
    card: [["Sawmill A", "FD-001, 1,000 kg"], ["Sawmill B", "FD-002, 1,000 kg"], ["Evidence", "Supplier records"]] },
  { label: "Intake", station: "feedstock-delivery", note: "2,000 kg received, weighbridge tickets attached.", records: ["FD-001", "FD-002"],
    lit: { sites: ["sawmill-a", "sawmill-b", "plant"], legs: ["FD-001", "FD-002"] }, focus: ["sawmill-a", "sawmill-b", "plant"], at: "plant",
    card: [["FD-001", "1,000 kg received"], ["FD-002", "1,000 kg received"], ["Dry", "800 kg each, 20% moisture"], ["Evidence", "Weighbridge tickets"]] },
  { label: "Production", station: "production-run", note: "Two runs, 270 kg dry biochar each.", records: ["PR-001", "PR-002"],
    lit: { sites: ["plant"], legs: [] }, focus: ["plant"], at: "plant", close: true,
    card: [["PR-001", "300 kg at 10% moisture"], ["PR-002", "300 kg at 10% moisture"], ["Evidence", "Production records"]] },
  { label: "Storage", station: "mix-bin", note: "Both runs mixed, origins retained.", records: ["Mix bin"],
    lit: { sites: ["plant"], legs: [] }, focus: ["plant"], at: "plant", close: true,
    card: [["Holds", "540 kg dry biochar"], ["From", "PR-001, PR-002"], ["Evidence", "Bin movements"]] },
  { label: "Product", station: "biochar-product", note: "540 kg drawn from the mix bin.", records: ["Biochar product"],
    lit: { sites: ["plant"], legs: [] }, focus: ["plant"], at: "plant", close: true,
    card: [["Drawn", "540 kg from the mix bin"], ["Blend", "Pure biochar"], ["Evidence", "Product record"]] },
  { label: "Delivery", station: "delivery", note: "Bills of lading for both trucks.", records: ["DL-001", "DL-002"],
    lit: { sites: ["plant", "field-coffee", "field-maize"], legs: ["DL-001", "DL-002"] }, focus: ["plant", "field-coffee", "field-maize"], at: "field-maize",
    card: [["DL-001", "270 kg to the coffee field"], ["DL-002", "270 kg to the maize field"], ["Evidence", "Bills of lading"]] },
  { label: "Application", station: "application", note: "135 kg from each production run, per field.", records: ["Coffee field", "Maize field"],
    lit: { sites: ["field-coffee", "field-maize"], legs: [] }, focus: ["field-coffee", "field-maize"], at: "field-maize",
    card: [["Coffee field", "270 kg dry biochar"], ["Maize field", "270 kg dry biochar"], ["Evidence", "Application records"]] },
  { label: "Both directions", note: "Start from a field and find the sawmills. Start from a sawmill and find the fields.", records: [],
    lit: TRACES["field-coffee"], focus: ALL_SITES, at: "field-coffee", end: true },
];

/** Straight-line km times a road factor, rounded. Illustrative, like everything here. */
const ROAD_FACTOR = 1.3;
const EARTH_KM = 6371;
export function legKm(leg) {
  const a = SITES.find((s) => s.id === leg.from);
  const b = SITES.find((s) => s.id === leg.to);
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * EARTH_KM * Math.asin(Math.sqrt(h)) * ROAD_FACTOR);
}
