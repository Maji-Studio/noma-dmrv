import type { ChainOfCustodyData, ChainSourceLineage } from "@/data-access/chain-of-custody";
import type { ChainRunRollForward } from "@/data-access/chain-of-custody-roll-forward";
import { kgToTonnes, tonnesToKg } from "@/lib/calculations/unit-conversions";
import { sumNullable } from "@/lib/nullable-sum";
import { splitWetMass } from "@/lib/mass-moisture";
import { resolveChainSources } from "./sources";

export const PRODUCTION_RUN_NODE_PREFIX = "production-run:";
export const productionRunNodeId = (id: string) => `${PRODUCTION_RUN_NODE_PREFIX}${id}`;
export const productNodeId = (id: string) => `biochar-product:${id}`;
export const applicationNodeId = (id: string) => `application:${id}`;
export const deliveryNodeId = (id: string) => `delivery:${id}`;
export const flowEdgeId = (from: string, to: string) => `${from}->${to}`;

export interface LineageMass {
  wetKg: number | null;
  dryKg: number | null;
}

export interface LineageNodeMass extends LineageMass {
  /** Product popups show source allocations; batch cards show applied totals. */
  sourceAllocation?: LineageMass;
}

export interface LineageEdgeMass extends LineageMass {
  /** Native branch-share value, retained without a tonnes → kg → tonnes round trip. */
  mass: number | null;
  unit: "kg" | "tDry";
}

export interface LineageRollup {
  nodes: ReadonlyMap<string, LineageNodeMass>;
  edges: ReadonlyMap<string, LineageEdgeMass>;
}

const UNKNOWN: LineageMass = { wetKg: null, dryKg: null };

export function nodeMass(rollup: LineageRollup, id: string): LineageNodeMass {
  return rollup.nodes.get(id) ?? { ...UNKNOWN };
}

export function sourceAllocationMass(rollup: LineageRollup, id: string): LineageMass {
  return nodeMass(rollup, id).sourceAllocation ?? { ...UNKNOWN };
}

export function edgeMass(rollup: LineageRollup, from: string, to: string): LineageEdgeMass {
  return rollup.edges.get(flowEdgeId(from, to)) ?? { ...UNKNOWN, mass: null, unit: "kg" };
}

/** Contributions retain the units in which the original graph summed each figure. */
interface MassPair {
  wet: number | null;
  dry: number | null;
}
type Contributions = Map<string, MassPair[]>;

function collect(into: Contributions, id: string, mass: MassPair): void {
  const values = into.get(id) ?? [];
  values.push(mass);
  into.set(id, values);
}

function total(values: readonly MassPair[]): MassPair {
  // A stable order keeps floating-point totals independent of lineage order.
  const sum = (basis: keyof MassPair) => sumNullable(
    values.map(value => value[basis])
      .filter((value): value is number => value != null && Number.isFinite(value))
      .sort((left, right) => left - right),
  );
  return { wet: sum("wet"), dry: sum("dry") };
}

function convert(value: number | null | undefined, fn: (value: number) => number): number | null {
  return value == null || !Number.isFinite(value) ? null : fn(value);
}

function kilograms(pair: MassPair): LineageMass {
  return { wetKg: pair.wet, dryKg: pair.dry };
}

function sourceMass(source: ChainSourceLineage): MassPair {
  return { wet: source.allocatedWetMassKg, dry: source.allocatedDryMassKg };
}

function finishNodes(contributions: Contributions): Map<string, LineageNodeMass> {
  return new Map([...contributions].map(([id, values]) => [id, kilograms(total(values))]));
}

/** Shipment edges sum wet kg and dry tonnes, matching the original branch-share units. */
function finishEdges(
  contributions: Contributions,
  unit: LineageEdgeMass["unit"],
  fallbackToWet = false,
): Map<string, LineageEdgeMass> {
  return new Map([...contributions].map(([id, values]) => {
    const pair = total(values);
    return [id, {
      wetKg: pair.wet,
      dryKg: unit === "tDry" ? convert(pair.dry, tonnesToKg) : pair.dry,
      mass: pair.dry ?? (fallbackToWet ? pair.wet : null),
      unit,
    }];
  }));
}

/**
 * Roll up expanded application/product slices. Only the figures consumed by
 * graph cards and applied edges live here; upstream recorded facts stay on
 * their source records. Each mass basis uses the same nullable-sum rule.
 */
export function buildLineageRollup(lineages: readonly ChainOfCustodyData[]): LineageRollup {
  const nodes: Contributions = new Map();
  const applications: Contributions = new Map();
  const allocations: Contributions = new Map();
  const shipments: Contributions = new Map();
  const legacyCandidates = new Map<string, MassPair>();
  const productAllocations: Contributions = new Map();

  for (const lineage of lineages) {
    const sources = resolveChainSources(lineage);
    const applicationId = applicationNodeId(lineage.application.id);
    const deliveryId = deliveryNodeId(lineage.delivery.id);
    const appliedTonnes = {
      wet: lineage.application.biocharAppliedTons ?? null,
      dry: lineage.application.biocharAppliedDryTons,
    };
    const appliedKg = {
      wet: convert(appliedTonnes.wet, tonnesToKg),
      dry: convert(appliedTonnes.dry, tonnesToKg),
    };
    const shipment = { wet: appliedKg.wet, dry: appliedTonnes.dry };
    collect(applications, applicationId, appliedTonnes);
    collect(shipments, flowEdgeId(deliveryId, applicationId), shipment);

    const productId = lineage.biocharProduct ? productNodeId(lineage.biocharProduct.id) : null;
    if (productId) {
      collect(nodes, productId, appliedKg);
      collect(shipments, flowEdgeId(productId, deliveryId), shipment);
      // An empty source list still produces an explicitly unknown allocation.
      if (sources.length === 0) collect(productAllocations, productId, { wet: null, dry: null });
      for (const source of sources) collect(productAllocations, productId, sourceMass(source));
    }
    for (const source of sources) {
      const runId = productionRunNodeId(source.productionRun.id);
      const allocated = sourceMass(source);
      collect(nodes, runId, allocated);
      if (productId && lineage.biocharProduct) {
        const id = flowEdgeId(runId, productId);
        collect(allocations, id, allocated);
        if (sources.length === 1) {
          const product = lineage.biocharProduct;
          legacyCandidates.set(id, {
            wet: product.massKg,
            dry: splitWetMass(product.massKg, product.moistureContentPercent)?.dryKg ?? null,
          });
        }
      }
    }
  }

  const nodeTotals = finishNodes(nodes);
  for (const [id, values] of applications) {
    const pair = total(values);
    nodeTotals.set(id, {
      wetKg: convert(pair.wet, tonnesToKg),
      dryKg: convert(pair.dry, tonnesToKg),
    });
  }
  for (const [id, sourceAllocation] of finishNodes(productAllocations)) {
    nodeTotals.set(id, { ...(nodeTotals.get(id) ?? UNKNOWN), sourceAllocation });
  }
  for (const [id, values] of allocations) {
    const pair = total(values);
    const legacy = legacyCandidates.get(id);
    allocations.set(id, [{ wet: pair.wet ?? legacy?.wet ?? null, dry: pair.dry ?? legacy?.dry ?? null }]);
  }
  return { nodes: nodeTotals, edges: new Map([...finishEdges(allocations, "kg", true), ...finishEdges(shipments, "tDry")]) };
}

/** Recorded draws sum in kg; shipments sum wet kg and each run's dry-tonne share. */
export function buildRollForwardRollup(rollForwards: readonly ChainRunRollForward[]): LineageRollup {
  const nodes: Contributions = new Map();
  const draws: Contributions = new Map();
  const shipments: Contributions = new Map();
  const recordedShipments: Contributions = new Map();
  for (const { source, products } of rollForwards) {
    for (const { product, drawnWetMassKg, drawnDryMassKg, deliveries } of products) {
      const productId = productNodeId(product.id);
      const drawn = { wet: drawnWetMassKg, dry: drawnDryMassKg };
      collect(nodes, productId, drawn);
      collect(draws, flowEdgeId(productionRunNodeId(source.productionRun.id), productId), drawn);
      for (const shipped of deliveries) {
        const id = flowEdgeId(productId, deliveryNodeId(shipped.delivery.id));
        collect(shipments, id, { wet: shipped.wetMassKg, dry: convert(shipped.dryMassKg, kgToTonnes) });
        collect(recordedShipments, id, { wet: shipped.wetMassKg, dry: shipped.dryMassKg });
      }
    }
  }
  const shipmentTotals = finishEdges(shipments, "tDry");
  for (const [id, values] of recordedShipments) {
    const shipment = shipmentTotals.get(id);
    // A single shipment displayed its recorded kg; only merged shipments
    // converted their summed dry tonnes back to kg for the label.
    if (values.length === 1 && shipment) {
      shipmentTotals.set(id, { ...shipment, ...kilograms(total(values)) });
    }
  }
  return { nodes: finishNodes(nodes), edges: new Map([...finishEdges(draws, "kg"), ...shipmentTotals]) };
}
