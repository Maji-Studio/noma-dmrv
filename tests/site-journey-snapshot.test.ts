// The public snapshot is a publication boundary; failures report paths, never values.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SNAPSHOT_PATH = resolve(__dirname, "../site/src/data/journey/journey.json");
const SCRIPT_PATH = resolve(__dirname, "../site/scripts/journey-snapshot.mjs");
const CUSTOMER_LABEL = /^Customer, \S/u;
const SUPPLIER_LABEL = /^Supplier, \S/u;
const FORBIDDEN_KEYS = new Set(["note", "notes", "accreditation"]);
const DESTINATION_DECIMALS = 2;
const MIN_ROUTE_POINTS = 2;
const TANZANIA_BOUNDS = { west: 29, east: 41, south: -12, north: -1 };
const LAB_COMPANY_TOKENS = /Ltd|Engineers|Analysts/iu;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonRecord = { [key: string]: Json };

const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as JsonRecord;

function isRecord(value: Json | undefined): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function visit(
  value: Json,
  callback: (value: Json, path: string, key: string) => void,
  path = "$",
  key = "",
): void {
  callback(value, path, key);
  if (Array.isArray(value)) {
    value.forEach((child, index) => visit(child, callback, `${path}[${index}]`, key));
  } else if (isRecord(value)) {
    Object.entries(value).forEach(([name, child]) => visit(child, callback, `${path}.${name}`, name));
  }
}

function coordinateViolations(record: Json | undefined, path: string): string[] {
  if (!isRecord(record)) return [path];
  return ["lat", "lng"].flatMap((key) => {
    const value = record[key];
    // A missing measurement remains missing, rather than inventing a position.
    if (value === null || value === undefined) return [];
    return typeof value === "number" && Number.isFinite(value)
      && Number(value.toFixed(DESTINATION_DECIMALS)) === value ? [] : [`${path}.${key}`];
  });
}

function validRoutePoint(value: Json): boolean {
  if (!Array.isArray(value) || value.length !== MIN_ROUTE_POINTS) return false;
  const [lng, lat] = value;
  return typeof lng === "number" && Number.isFinite(lng)
    && typeof lat === "number" && Number.isFinite(lat)
    && lng >= TANZANIA_BOUNDS.west && lng <= TANZANIA_BOUNDS.east
    && lat >= TANZANIA_BOUNDS.south && lat <= TANZANIA_BOUNDS.north;
}

describe("site journey snapshot publication boundary", () => {
  it("labels every supplier by role and town", () => {
    const violations: string[] = [];
    const suppliers = snapshot.suppliers;
    expect(Array.isArray(suppliers)).toBe(true);
    if (Array.isArray(suppliers)) {
      expect(suppliers.length).toBeGreaterThan(0);
      suppliers.forEach((supplier, index) => {
        if (!isRecord(supplier) || typeof supplier.name !== "string" || !SUPPLIER_LABEL.test(supplier.name)) {
          violations.push(`$.suppliers[${index}].name`);
        }
      });
    }
    const graph = snapshot.graph;
    expect(isRecord(graph) && Array.isArray(graph.nodes)).toBe(true);
    let nodes = 0;
    if (isRecord(graph) && Array.isArray(graph.nodes)) {
      graph.nodes.forEach((node, index) => {
        if (!isRecord(node) || node.type !== "supplier") return;
        nodes++;
        if (typeof node.label !== "string" || !SUPPLIER_LABEL.test(node.label)) violations.push(`$.graph.nodes[${index}].label`);
      });
    }
    expect(nodes).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it("limits individual supplier and graph coordinates to two decimals", () => {
    const violations: string[] = [];
    const individuals = new Set<Json>();
    const suppliers = snapshot.suppliers;
    expect(Array.isArray(suppliers)).toBe(true);
    if (Array.isArray(suppliers)) {
      suppliers.forEach((supplier, index) => {
        if (!isRecord(supplier) || supplier.kind !== "individual") return;
        individuals.add(supplier.code);
        violations.push(...coordinateViolations(supplier.location, `$.suppliers[${index}].location`));
      });
    }
    expect(individuals.size).toBeGreaterThan(0);
    const graph = snapshot.graph;
    expect(isRecord(graph) && Array.isArray(graph.nodes)).toBe(true);
    // Suppliers outside the displayed chain need not have graph nodes.
    if (isRecord(graph) && Array.isArray(graph.nodes)) {
      graph.nodes.forEach((node, index) => {
        if (!isRecord(node) || node.type !== "supplier" || !individuals.has(node.code)) return;
        violations.push(...coordinateViolations(node, `$.graph.nodes[${index}]`));
      });
    }
    expect(violations).toEqual([]);
  });

  it("publishes a synthetic source without a supplier anonymisation flag", () => {
    // Isolate the CLI's fixed output path; never overwrite the committed snapshot.
    const directory = mkdtempSync(resolve(__dirname, ".journey-snapshot-"));
    try {
      const suppliers = [
        { code: "SUP-TEST-001", name: "Synthetic supplier alpha", kind: "individual", location: { city: "Test town", lat: -8.12345, lng: 35.12345 } },
        { code: "SUP-TEST-002", name: "Synthetic supplier beta", kind: "company", location: { lat: -8.23456, lng: 35.23456 } },
      ];
      const source = {
        meta: { description: suppliers.map((supplier) => supplier.name).join("; ") }, facility: {}, suppliers,
        deliveries: [], applications: [], labSamples: [],
        graph: { nodes: suppliers.map((supplier) => ({ type: "supplier", code: supplier.code, label: supplier.name, ...supplier.location })), edges: [] },
      };
      const script = resolve(directory, "scripts/journey-snapshot.mjs");
      const sourcePath = resolve(directory, "source.json");
      mkdirSync(resolve(directory, "scripts"));
      copyFileSync(SCRIPT_PATH, script);
      writeFileSync(sourcePath, JSON.stringify(source));
      const result = spawnSync(process.execPath, [script, sourcePath, "--no-routes"], { encoding: "utf8" });
      expect(result.status).toBe(0);
      const output = JSON.parse(readFileSync(resolve(directory, "src/data/journey/journey.json"), "utf8")) as JsonRecord;
      const violations: string[] = [];
      visit(output, (value, path) => {
        if (typeof value === "string" && suppliers.some((supplier) => value.toLowerCase().includes(supplier.name.toLowerCase()))) {
          violations.push(path);
        }
        if (isRecord(value) && value.code === suppliers[0].code) {
          violations.push(...coordinateViolations(value.type === "supplier" ? value : value.location, path));
        }
      });
      expect(violations).toEqual([]);
      expect(Object.hasOwn(output, "routes")).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("labels every customer by role and town", () => {
    const violations: string[] = [];
    let customers = 0;
    visit(snapshot, (value, path, key) => {
      if (!isRecord(value) || (key !== "customer" && key !== "customers" && value.type !== "customer")) return;
      customers++;
      if (typeof value.label !== "string" || !CUSTOMER_LABEL.test(value.label)) violations.push(`${path}.label`);
      if (Object.hasOwn(value, "kind")) violations.push(`${path}.kind`);
    });
    expect(customers).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it("contains no internal remarks or accreditation keys at any depth", () => {
    const violations: string[] = [];
    visit(snapshot, (value, path, key) => {
      if (FORBIDDEN_KEYS.has(key)) violations.push(path);
    });
    expect(violations).toEqual([]);
  });

  it("limits delivery, application and private graph coordinates to two decimals", () => {
    const violations: string[] = [];
    for (const key of ["deliveries", "applications"]) {
      const records = snapshot[key];
      expect(Array.isArray(records)).toBe(true);
      if (!Array.isArray(records)) continue;
      expect(records.length).toBeGreaterThan(0);
      records.forEach((record, index) => {
        const path = `$.${key}[${index}]`;
        violations.push(...coordinateViolations(
          key === "deliveries" && isRecord(record) ? record.destination : record,
          key === "deliveries" ? `${path}.destination` : path,
        ));
      });
    }
    const heroDelivery = snapshot.heroDelivery;
    violations.push(...coordinateViolations(isRecord(heroDelivery) ? heroDelivery.destination : undefined, "$.heroDelivery.destination"));
    violations.push(...coordinateViolations(snapshot.heroApplication, "$.heroApplication"));
    const graph = snapshot.graph;
    expect(isRecord(graph) && Array.isArray(graph.nodes)).toBe(true);
    if (isRecord(graph) && Array.isArray(graph.nodes)) {
      graph.nodes.forEach((node, index) => {
        if (isRecord(node) && ["customer", "field", "delivery", "application"].includes(String(node.type))) {
          violations.push(...coordinateViolations(node, `$.graph.nodes[${index}]`));
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("places the plant at the recorded facility position", () => {
    const facility = isRecord(snapshot.facility) ? snapshot.facility : {};
    expect(Number.isFinite(facility.lat) && Number.isFinite(facility.lng)).toBe(true);
    expect(facility.approximate).toBeUndefined();
  });

  it("publishes lab descriptions without company tokens", () => {
    const violations: string[] = [];
    expect(Array.isArray(snapshot.labSamples)).toBe(true);
    if (Array.isArray(snapshot.labSamples)) {
      expect(snapshot.labSamples.length).toBeGreaterThan(0);
      snapshot.labSamples.forEach((sample, index) => {
        if (!isRecord(sample) || typeof sample.lab !== "string" || LAB_COMPANY_TOKENS.test(sample.lab)) {
          violations.push(`$.labSamples[${index}].lab`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("publishes valid road lines or an explicit route failure when routes exist", () => {
    if (!Object.hasOwn(snapshot, "routes")) return;
    const routes = snapshot.routes;
    expect(isRecord(routes) && Array.isArray(routes.legs)).toBe(true);
    const violations: string[] = [];
    if (isRecord(routes) && Array.isArray(routes.legs)) {
      expect(routes.legs.length).toBeGreaterThan(0);
      routes.legs.forEach((leg, index) => {
        const path = `$.routes.legs[${index}]`;
        if (!isRecord(leg)) { violations.push(path); return; }
        const line = leg.coordinates;
        if (Array.isArray(line) && line.length >= MIN_ROUTE_POINTS && line.every(validRoutePoint)) return;
        if (leg.error === "no route" && leg.coordinates === null && leg.routedKm === null) return;
        violations.push(path);
      });
    }
    expect(violations).toEqual([]);
  });
});
