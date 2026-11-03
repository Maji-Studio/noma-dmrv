import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import type { ChainOfCustodyData } from "./chain-of-custody";
import { projectChainOfCustodyGeoData, projectRunRollForwardGeoData } from "./chain-of-custody-geo";
import type { ChainRunRollForward } from "./chain-of-custody-roll-forward";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

// Exercise real Drizzle selection, joins and result mapping without a connection.
vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Client } = await import("pg");
  const client = new Client();
  client.query = query;
  return { db: drizzle(client) };
});

const ctx = makeTestOrgContext();
const FACILITY_GPS = { lat: -8.3, lng: 35.3 };
const DESTINATION_GPS = { lat: -7.2, lng: 36.4 };
const APPLICATION_GPS = { lat: -6.1, lng: 37.5 };
const chain: ChainOfCustodyData = {
  facility: { id: "facility", code: "TZ001", name: "Facility" },
  application: {
    id: "application", code: "AP-26-001", status: "complete",
    applicationDate: new Date("2026-10-01"), fieldIdentifier: null,
    evidenceMethod: "location", gisBoundary: null, biocharAppliedDryTons: null,
    soilTemperatureC: null, href: "/applications",
  },
  delivery: {
    id: "delivery", code: "DL-26-001", status: "delivered",
    deliveryDate: new Date("2026-10-01"), proofOfDeliveryCount: 0,
    massDryKg: null, href: "/deliveries",
  },
  order: null, biocharProduct: null, productionRun: null, reactor: null,
  feedstocks: [], warnings: [],
};

const rollForwards: ChainRunRollForward[] = [{
  source: {
    productionRun: {
      id: "run", code: "PR-26-001", status: "complete", date: "2026-10-01",
      biocharDryMassKg: null, feedstockMassDryKg: null, href: "/production-runs",
    },
    reactor: null, feedstocks: [], allocatedWetMassKg: null, allocatedDryMassKg: null,
  },
  products: [{
    product: {
      id: "product", code: "BP-26-001", status: "complete", productionDate: "2026-10-01",
      massKg: null, moistureContentPercent: null, formulationName: null,
      linkedProductionRunId: "run", href: "/biochar-products",
    },
    drawnWetMassKg: 0, drawnDryMassKg: 0,
    deliveries: [{ delivery: chain.delivery, wetMassKg: null, dryMassKg: 0 }],
  }],
}];

beforeEach(() => {
  query.mockClear();
  query.mockImplementation(async (config: { text: string }) => {
    if (config.text.includes('from "facilities"')) return { rows: [[FACILITY_GPS.lat, FACILITY_GPS.lng]] };
    if (config.text.includes('from "applications"')) return { rows: [[APPLICATION_GPS.lat, APPLICATION_GPS.lng]] };
    if (config.text.includes('from "deliveries"')) return { rows: [[chain.delivery.id, DESTINATION_GPS.lat, DESTINATION_GPS.lng]] };
    throw new Error(`Unexpected geo query: ${config.text}`);
  });
});

describe("delivery map positions", () => {
  it("uses the customer destination GPS as the delivery's own position without a transport leg", async () => {
    const result = await projectChainOfCustodyGeoData(ctx, chain);

    expect(result.nodes.find((node) => node.kind === "delivery")).toMatchObject({
      ...DESTINATION_GPS, positionSource: "own", inheritedFromFacility: false,
    });
    expect(result.nodes.find((node) => node.kind === "application")).toMatchObject(APPLICATION_GPS);
    expect(result.legs).toEqual([]);
  });

  it("positions unapplied deliveries in batch roll-forwards at the customer destination", async () => {
    const result = await projectRunRollForwardGeoData(ctx, chain.facility, rollForwards);

    expect(result.nodes.find((node) => node.kind === "delivery")).toMatchObject({
      ...DESTINATION_GPS, positionSource: "own", inheritedFromFacility: false,
    });
  });

  it("keeps each destination attached to its delivery across multiple batch runs", async () => {
    const otherDelivery = { ...chain.delivery, id: "other-delivery", code: "DL-26-002" };
    const otherDestination = { lat: -5.4, lng: 38.7 };
    const defaultQuery = query.getMockImplementation()!;
    query.mockImplementation(async (config: { text: string }) => {
      if (config.text.includes('from "deliveries"')) {
        // Return in a different order from the chains, including shared deliveries.
        return { rows: [
          [otherDelivery.id, otherDestination.lat, otherDestination.lng],
          [chain.delivery.id, DESTINATION_GPS.lat, DESTINATION_GPS.lng],
        ] };
      }
      return defaultQuery(config);
    });
    const otherRun: ChainRunRollForward = {
      ...rollForwards[0],
      source: {
        ...rollForwards[0].source,
        productionRun: { ...rollForwards[0].source.productionRun, id: "other-run" },
      },
      products: [{
        ...rollForwards[0].products[0],
        deliveries: [
          ...rollForwards[0].products[0].deliveries,
          { delivery: otherDelivery, wetMassKg: null, dryMassKg: 0 },
        ],
      }],
    };

    const result = await projectRunRollForwardGeoData(ctx, chain.facility, [...rollForwards, otherRun]);
    expect(result.nodes.filter((node) => node.kind === "delivery")).toEqual([
      expect.objectContaining({ entityId: chain.delivery.id, ...DESTINATION_GPS, positionSource: "own" }),
      expect.objectContaining({ entityId: otherDelivery.id, ...otherDestination, positionSource: "own" }),
    ]);
  });

  for (const [name, project] of [
    ["application", () => projectChainOfCustodyGeoData(ctx, chain)],
    ["batch", () => projectRunRollForwardGeoData(ctx, chain.facility, rollForwards)],
  ] as const) {
    it(`${name} selects destination coordinates with organization scope on every joined table`, async () => {
      await project();

      const call = query.mock.calls.find(([config]) => config.text.includes('from "deliveries"'));
      expect(call).toBeDefined();
      const [{ text }, params] = call! as [{ text: string }, unknown[]];
      expect(text).toContain('"customer_locations"."gps_latitude"');
      expect(text).toContain('"customer_locations"."gps_longitude"');
      for (const table of ["deliveries", "orders", "customer_locations"]) {
        const binding = text.match(new RegExp(`"${table}"\\."organization_id" = \\$(\\d+)`));
        expect(binding).not.toBeNull();
        expect(params[Number(binding![1]) - 1]).toBe(ctx.organizationId);
      }
      expect(params).toContain(chain.delivery.id);
    });

    it.each([
      { destination: [null, null], facility: FACILITY_GPS, source: "facility" },
      { destination: [DESTINATION_GPS.lat, null], facility: FACILITY_GPS, source: "facility" },
      { destination: [null, DESTINATION_GPS.lng], facility: FACILITY_GPS, source: "facility" },
      { destination: [null, null], facility: { lat: null, lng: null }, source: "none" },
      { destination: [0, 0], facility: FACILITY_GPS, source: "own" },
    ])(`${name} resolves incomplete or zero GPS with source $source`, async ({ destination, facility, source }) => {
      const defaultQuery = query.getMockImplementation()!;
      query.mockImplementation(async (config: { text: string }) => {
        if (config.text.includes('from "deliveries"')) return { rows: [[chain.delivery.id, ...destination]] };
        if (config.text.includes('from "facilities"')) return { rows: [[facility.lat, facility.lng]] };
        return defaultQuery(config);
      });

      const result = await project();
      expect(result.nodes.find((node) => node.kind === "delivery")).toMatchObject({
        lat: source === "own" ? 0 : facility.lat,
        lng: source === "own" ? 0 : facility.lng,
        positionSource: source, inheritedFromFacility: source === "facility",
      });
    });
  }
});
