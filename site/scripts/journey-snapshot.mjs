// Local-only publication boundary: the source stays outside this public repository.
// Usage, from the repository root (Node 22):
// OPENROUTESERVICE_API_KEY=... node site/scripts/journey-snapshot.mjs <source journey.json> [--no-routes]
// --no-routes preserves only the existing output's routes; a first run omits routes.
// Suppliers are always anonymised; use "location not recorded" when no city was recorded.
// Individual supplier points use destination precision; other supplier points use 3 decimals.
// All other source fields retain their shape, except the privacy transforms below.
// Routes use published endpoints. Recorded km remain authoritative; lines are for drawing.
// routes?: { provider, routedOn, legs: [...] }
// leg: { id, kind, from, to, recordedKmOneWay, routedKm, coordinates, error? }
// Lines are [lng, lat][]; an unroutable leg has null coordinates/routedKm and error "no route".
// Customer labels use their earliest delivery town; the hero records follow the same policy.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const SCRIPT = 'site/scripts/journey-snapshot.mjs';
const OUTPUT = resolve(import.meta.dirname, '../src/data/journey/journey.json');
const BUILT_FROM = 'noma dMRV read 2026-10-27';
// Facility FAC-26-001 GPS as recorded on staging, rounded like supplier points.
const PLANT_LAT = -8.255;
const PLANT_LNG = 35.331;
const PLANT_LOCATION = 'Mafinga, Iringa Region, Tanzania';
const DESTINATION_DECIMALS = 2;
const SUPPLIER_DECIMALS = 3;
const ROUTE_DECIMALS = 4;
const DISTANCE_DECIMALS = 1;
const ROUTE_TOLERANCE_DEGREES = 0.0002;
const ORS_URL = 'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson';
const ORS_TIMEOUT_MS = 10_000;
const ORS_SNAP_RADIUS_METERS = 5000;
const ORS_DELAY_MS = 1600; // Stay below the free tier's 40 requests per minute.
const METERS_PER_KM = 1000;
const MIN_LINE_POINTS = 2;
const JSON_INDENT = 2;
const TANZANIA_BOUNDS = { west: 29, east: 41, south: -12, north: -1 };
const CUSTOMER_LABEL = /^Customer, \S/u;
const UNRECORDED_SUPPLIER_CITY = 'location not recorded';
const FORBIDDEN_KEYS = new Set(['notes', 'note', 'accreditation']);
const PRIVATE_GRAPH_TYPES = new Set(['customer', 'field', 'delivery', 'application']);
// Only these reviewed city/purpose combinations may leave the private lab text.
const LAB_ROLES = [
  { city: /\bMumbai\b/iu, purpose: /^chemistry$/iu, label: 'Lab in Mumbai (chemistry)' },
  { city: /\bZabrze\b/iu, purpose: /^R0$/iu, label: 'lab in Zabrze, Poland (R0)' },
];

function round(value, decimals) {
  return Number(value.toFixed(decimals));
}

function roundPoint(point, decimals) {
  if (!point) return;
  for (const key of ['lat', 'lng']) {
    if (typeof point[key] === 'number') point[key] = round(point[key], decimals);
  }
}

function visit(value, callback, path = '$', key = '') {
  callback(value, path, key);
  if (Array.isArray(value)) {
    value.forEach((child, index) => visit(child, callback, `${path}[${index}]`, key));
  } else if (value && typeof value === 'object') {
    for (const [name, child] of Object.entries(value)) {
      visit(child, callback, `${path}.${name}`, name);
    }
  }
}

function includesLabel(text, label) {
  return text.toLocaleLowerCase('en').includes(label.toLocaleLowerCase('en'));
}

function containsCustomer(value, labels) {
  let found = false;
  visit(value, (child) => {
    if (typeof child === 'string' && labels.some((label) => includesLabel(child, label))) found = true;
  });
  return found;
}

function customerPolicy(source) {
  const byCode = new Map();
  const replacements = new Map();
  const deliveries = [...source.deliveries, source.heroDelivery].filter(Boolean);
  deliveries.sort((a, b) => a.date.localeCompare(b.date));
  for (const delivery of deliveries) {
    const { customer, destination } = delivery;
    if (!customer?.code || !customer.label?.trim() || !destination?.city?.trim()) {
      throw new Error('Cannot derive a customer role from delivery records.');
    }
    if (!byCode.has(customer.code)) byCode.set(customer.code, `Customer, ${destination.city}`);
  }
  // Include alternate labels on customer objects and graph nodes, not just deliveries.
  visit(source, (value, path, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (key !== 'customer' && key !== 'customers' && value.type !== 'customer') return;
    if (typeof value.label !== 'string' || !value.label.trim()) return;
    const role = byCode.get(value.code);
    if (!role) throw new Error('Cannot derive a customer role at a customer record.');
    const existing = replacements.get(value.label);
    if (existing && existing !== role) throw new Error('Conflicting customer labels need review.');
    replacements.set(value.label, role);
  });
  return { byCode, replacements };
}

function labPolicy(source) {
  const replacements = new Map();
  const companyNames = new Set();
  for (const [index, sample] of source.labSamples.entries()) {
    const parts = typeof sample.lab === 'string' ? sample.lab.split(';') : [];
    if (!parts.length) throw new Error(`Unreviewed lab format at $.labSamples[${index}].lab`);
    const roles = parts.map((part) => {
      // Keep company tokens in memory only; unknown formats fail before writing.
      const match = part.trim().match(/^(.+?),\s*(.+?)\s*\(([^()]+)\)$/u);
      const role = match && LAB_ROLES.find((entry) => entry.city.test(match[2]) && entry.purpose.test(match[3]));
      if (!role) throw new Error(`Unreviewed lab format at $.labSamples[${index}].lab`);
      const company = match[1].trim();
      companyNames.add(company);
      replacements.set(company, role.label);
      return role.label;
    });
    replacements.set(sample.lab, roles.join('; '));
  }
  return { replacements, companyNames };
}

function stringRewriter(replacements) {
  const entries = [...replacements].filter(([label]) => label.length > 0);
  entries.sort((a, b) => b[0].length - a[0].length);
  if (!entries.length) return (text) => text;
  // A single pass avoids reprocessing role labels that contain an original town token.
  const byLabel = new Map(entries.map(([label, role]) => [label.toLocaleLowerCase('en'), role]));
  const escaped = entries.map(([label]) => label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  const pattern = new RegExp(escaped.join('|'), 'giu');
  return (text) => text.replace(pattern, (match) => byLabel.get(match.toLocaleLowerCase('en')));
}

function scrub(value, rewrite) {
  if (typeof value === 'string') return rewrite(value);
  if (Array.isArray(value)) return value.map((child) => scrub(child, rewrite));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !FORBIDDEN_KEYS.has(key))
    .map(([key, child]) => [key, scrub(child, rewrite)]));
}

function publish(source, customers, labs) {
  const replacements = new Map([...labs.replacements, ...customers.replacements]);
  const individuals = new Set(source.suppliers.filter((supplier) => supplier.kind === 'individual').map((supplier) => supplier.code));
  for (const supplier of source.suppliers) {
    if (!supplier.name?.trim()) {
      throw new Error('Cannot derive a supplier role from supplier records.');
    }
    const city = supplier.location?.city?.trim() || UNRECORDED_SUPPLIER_CITY;
    replacements.set(supplier.name, `Supplier, ${city}`);
  }
  const output = structuredClone(source);
  // Source route geometry has not passed the publication boundary.
  delete output.routes;
  for (const [key, value] of Object.entries(output.meta)) {
    if (containsCustomer(value, [...customers.replacements.keys()])) delete output.meta[key];
  }
  output.meta.snapshot = { builtFrom: BUILT_FROM, script: SCRIPT };
  Object.assign(output.facility, {
    lat: PLANT_LAT, lng: PLANT_LNG, location: PLANT_LOCATION,
  });
  for (const supplier of output.suppliers) {
    delete supplier.location.name;
    roundPoint(supplier.location, supplier.kind === 'individual' ? DESTINATION_DECIMALS : SUPPLIER_DECIMALS);
  }
  for (const delivery of [...output.deliveries, output.heroDelivery].filter(Boolean)) {
    roundPoint(delivery.destination, DESTINATION_DECIMALS);
  }
  for (const application of [...output.applications, output.heroApplication].filter(Boolean)) {
    roundPoint(application, DESTINATION_DECIMALS);
  }
  visit(output, (value, path, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (key === 'customer' || key === 'customers' || value.type === 'customer') {
      delete value.kind;
      roundPoint(value, DESTINATION_DECIMALS);
    }
  });
  for (const node of output.graph.nodes) {
    if (PRIVATE_GRAPH_TYPES.has(node.type)) roundPoint(node, DESTINATION_DECIMALS);
    if (node.type === 'supplier') roundPoint(node, individuals.has(node.code) ? DESTINATION_DECIMALS : SUPPLIER_DECIMALS);
    if (node.type === 'facility' || node.code === output.facility.code) {
      Object.assign(node, { lat: PLANT_LAT, lng: PLANT_LNG });
    }
  }
  return { output, rewrite: stringRewriter(replacements) };
}

function point(record) {
  return record && Number.isFinite(record.lng) && Number.isFinite(record.lat)
    ? [record.lng, record.lat] : null;
}

function suppliesPineBin(supplier, output) {
  const bin = output.feedstockFanIn.binCode;
  if (supplier.deliveriesToPineOffcutBin > 0
    || output.feedstockFanIn.bySupplier[supplier.code]?.deliveries > 0
    || output.heroFeedstockDeliveries.some((delivery) => delivery.supplier === supplier.code && delivery.bin === bin)) return true;
  const nodes = output.graph.nodes;
  const pending = nodes.filter((node) => node.code === supplier.code).map((node) => node.id);
  const targets = new Set(nodes.filter((node) => node.code === bin).map((node) => node.id));
  const seen = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id)) continue;
    if (targets.has(id)) return true;
    seen.add(id);
    for (const edge of output.graph.edges) if (edge.from === id) pending.push(edge.to);
  }
  return false;
}

function routeLegs(output) {
  const facility = output.facility.code;
  const plant = point(output.facility);
  const legs = output.suppliers.filter((supplier) => point(supplier.location) && suppliesPineBin(supplier, output))
    .map((supplier) => ({
      id: `in:${supplier.code}`, kind: 'inbound', from: supplier.code, to: facility,
      recordedKmOneWay: supplier.distanceToPlantKm ?? null,
      endpoints: [point(supplier.location), plant],
    }));
  const deliveries = new Map(output.deliveries.map((delivery) => [delivery.code, delivery]));
  if (output.heroDelivery && !deliveries.has(output.heroDelivery.code)) {
    deliveries.set(output.heroDelivery.code, output.heroDelivery);
  }
  for (const delivery of deliveries.values()) {
    legs.push({
      id: `out:${delivery.code}`, kind: 'outbound', from: facility, to: delivery.code,
      recordedKmOneWay: delivery.distanceKmOneWay ?? null,
      endpoints: [plant, point(delivery.destination)],
    });
  }
  return legs;
}

function segmentDistanceSquared(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared === 0 ? 0
    : Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return (point[0] - start[0] - fraction * dx) ** 2 + (point[1] - start[1] - fraction * dy) ** 2;
}

function simplify(coordinates) {
  // Iterative Douglas-Peucker avoids a call-stack limit on long ORS lines.
  const last = coordinates.length - 1;
  const keep = new Set([0, last]);
  const pending = [[0, last]];
  while (pending.length) {
    const [start, end] = pending.pop();
    let largest = ROUTE_TOLERANCE_DEGREES ** 2;
    let furthest;
    for (let index = start + 1; index < end; index++) {
      const distance = segmentDistanceSquared(coordinates[index], coordinates[start], coordinates[end]);
      if (distance > largest) { largest = distance; furthest = index; }
    }
    if (furthest !== undefined) {
      keep.add(furthest);
      pending.push([start, furthest], [furthest, end]);
    }
  }
  return [...keep].sort((a, b) => a - b)
    .map((index) => coordinates[index].map((value) => round(value, ROUTE_DECIMALS)));
}

function validRoutePoint(pair) {
  return Array.isArray(pair) && pair.length === MIN_LINE_POINTS
    && pair.every(Number.isFinite)
    && pair[0] >= TANZANIA_BOUNDS.west && pair[0] <= TANZANIA_BOUNDS.east
    && pair[1] >= TANZANIA_BOUNDS.south && pair[1] <= TANZANIA_BOUNDS.north;
}

async function requestRoute(leg, key) {
  const started = Date.now();
  let status = null;
  const failed = { coordinates: null, routedKm: null, error: 'no route' };
  try {
    const response = await fetch(ORS_URL, {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: leg.endpoints, radiuses: [ORS_SNAP_RADIUS_METERS, ORS_SNAP_RADIUS_METERS] }),
      signal: AbortSignal.timeout(ORS_TIMEOUT_MS),
    });
    status = response.status;
    if (!response.ok) return failed;
    const body = await response.json();
    const feature = body.features?.[0];
    const line = feature?.geometry?.coordinates;
    const meters = feature?.properties?.summary?.distance;
    if (!Array.isArray(line) || line.length < MIN_LINE_POINTS || !line.every(validRoutePoint)
      || !Number.isFinite(meters) || meters < 0) return failed;
    const coordinates = simplify(line);
    // ORS snaps to roads; the drawing must still meet the published markers exactly.
    coordinates[0] = leg.endpoints[0];
    coordinates[coordinates.length - 1] = leg.endpoints[1];
    return { coordinates, routedKm: round(meters / METERS_PER_KM, DISTANCE_DECIMALS) };
  } catch {
    return failed;
  } finally {
    console.log(JSON.stringify({ id: leg.id, status, durationMs: Date.now() - started }));
  }
}

async function buildRoutes(output, key) {
  const cache = new Map();
  const legs = [];
  for (const { endpoints, ...record } of routeLegs(output)) {
    const cacheKey = JSON.stringify(endpoints);
    let route = cache.get(cacheKey);
    if (!route) {
      if (endpoints.every(validRoutePoint)) {
        if (cache.size) await new Promise((done) => setTimeout(done, ORS_DELAY_MS));
        route = await requestRoute({ ...record, endpoints }, key);
      } else {
        route = { coordinates: null, routedKm: null, error: 'no route' };
      }
      cache.set(cacheKey, route);
    }
    legs.push({ ...record, ...route });
  }
  return {
    provider: 'OpenRouteService driving-car', routedOn: new Date().toISOString().slice(0, 10),
    legs,
  };
}

function guard(output, customers, labs, source) {
  const violations = new Set();
  const forbidden = [...customers.replacements.keys(), ...labs.companyNames, ...source.suppliers.map((supplier) => supplier.name)];
  const individuals = new Set(source.suppliers.filter((supplier) => supplier.kind === 'individual').map((supplier) => supplier.code));
  visit(output, (value, path, key) => {
    if (FORBIDDEN_KEYS.has(key)) violations.add(path);
    if (typeof value === 'string' && forbidden.some((label) => includesLabel(value, label))) violations.add(path);
    if (value && typeof value === 'object' && !Array.isArray(value)
      && (key === 'customer' || key === 'customers' || value.type === 'customer')) {
      if (typeof value.label !== 'string' || !CUSTOMER_LABEL.test(value.label)) violations.add(`${path}.label`);
    }
  });
  const checkPoint = (record, path) => {
    for (const key of ['lat', 'lng']) {
      const value = record?.[key];
      if (value !== null && value !== undefined
        && (!Number.isFinite(value) || round(value, DESTINATION_DECIMALS) !== value)) violations.add(`${path}.${key}`);
    }
  };
  output.deliveries.forEach((delivery, index) => checkPoint(delivery.destination, `$.deliveries[${index}].destination`));
  if (output.heroDelivery) checkPoint(output.heroDelivery.destination, '$.heroDelivery.destination');
  output.applications.forEach((application, index) => checkPoint(application, `$.applications[${index}]`));
  if (output.heroApplication) checkPoint(output.heroApplication, '$.heroApplication');
  output.suppliers.forEach((supplier, index) => {
    if (individuals.has(supplier.code)) checkPoint(supplier.location, `$.suppliers[${index}].location`);
  });
  output.graph.nodes.forEach((node, index) => {
    if (PRIVATE_GRAPH_TYPES.has(node.type) || (node.type === 'supplier' && individuals.has(node.code))) {
      checkPoint(node, `$.graph.nodes[${index}]`);
    }
  });
  if (violations.size) throw new Error(`Publication guard failed:\n${[...violations].sort().join('\n')}`);
}

function snapshotJson(value, depth = 0) {
  const indent = ' '.repeat(depth * JSON_INDENT);
  const childIndent = ' '.repeat((depth + 1) * JSON_INDENT);
  // One record per line keeps growing datasets below the file line cap.
  if (Array.isArray(value)) {
    if (!value.length || value.every((item) => !item || typeof item !== 'object')) return JSON.stringify(value);
    return `[\n${value.map((item) => `${childIndent}${JSON.stringify(item)}`).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    return `{\n${entries.map(([key, child]) => `${childIndent}${JSON.stringify(key)}: ${snapshotJson(child, depth + 1)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

async function main() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: { 'no-routes': { type: 'boolean' } },
    });
  } catch {
    throw new Error(`Usage: node ${SCRIPT} <source journey.json> [--no-routes]`);
  }
  if (args.positionals.length !== 1) throw new Error(`Expected one source JSON file. See ${SCRIPT} for usage.`);
  const noRoutes = args.values['no-routes'];
  const key = process.env.OPENROUTESERVICE_API_KEY;
  if (!noRoutes && !key?.trim()) throw new Error('OPENROUTESERVICE_API_KEY is required unless --no-routes is passed.');
  if (resolve(args.positionals[0]) === OUTPUT) throw new Error('Source must be a private file distinct from the published output.');
  let source;
  try {
    source = JSON.parse(await readFile(args.positionals[0], 'utf8'));
  } catch {
    throw new Error('Could not read source JSON.');
  }
  const customers = customerPolicy(source);
  const labs = labPolicy(source);
  const { output, rewrite } = publish(source, customers, labs);
  if (noRoutes) {
    try {
      const previous = JSON.parse(await readFile(OUTPUT, 'utf8'));
      if (Object.hasOwn(previous, 'routes')) output.routes = previous.routes;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Could not read existing output JSON; routes were not overwritten.');
    }
  } else {
    output.routes = await buildRoutes(output, key);
  }
  const final = scrub(output, rewrite);
  // Resolve labels by code after the one-pass rewrite, including any graph aliases.
  visit(final, (value, path, key) => {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && (key === 'customer' || key === 'customers' || value.type === 'customer')) {
      value.label = customers.byCode.get(value.code);
    }
  });
  guard(final, customers, labs, source);
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${snapshotJson(final)}\n`);
}

main().catch((error) => {
  // Never echo an exception from JSON parsing, fetch or filesystem I/O: it may carry PII.
  const safe = error instanceof Error && (error.message.startsWith('Publication guard failed:')
    || error.message.startsWith('Unreviewed lab format at ')
    || error.message.startsWith('Cannot derive a ')
    || error.message.startsWith('Conflicting customer labels')
    || error.message.startsWith('Could not read ')
    || error.message.startsWith('Usage: ')
    || error.message.startsWith('Expected one source ')
    || error.message.startsWith('Source must be ')
    || error.message.startsWith('OPENROUTESERVICE_API_KEY is required'));
  console.error(safe ? error.message : 'Snapshot generation failed; output was not published. Review the source shape locally.');
  process.exitCode = 1;
});
