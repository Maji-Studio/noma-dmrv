import type { ChainOfCustodyData, ChainSourceLineage } from "@/data-access/chain-of-custody";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import { sumNullable } from "@/lib/nullable-sum";
import { splitWetMass } from "@/lib/mass-moisture";
import { resolveChainSources } from "./sources";

export interface LineageMass {
  wetKg: number | null;
  dryKg: number | null;
}

export interface LineageNodeMass extends LineageMass {
  /** Product popups show source allocations; batch cards show applied totals. */
  sourceAllocation?: LineageMass;
}

export interface LineageRollup {
  /** Run allocations, product/application applied totals, or recorded entity masses. */
  nodes: ReadonlyMap<string, LineageNodeMass>;
  /** Mass flowing along each physical graph edge, always in kg on both bases. */
  edges: ReadonlyMap<string, LineageMass>;
}

type Contributions = Map<string, LineageMass[]>;

function collect(into: Contributions, id: string, mass: LineageMass): void {
  const values = into.get(id) ?? [];
  values.push(mass);
  into.set(id, values);
}

function kgFromTonnes(value: number | null | undefined): number | null {
  return value == null ? null : tonnesToKg(value);
}

function total(values: readonly LineageMass[]): LineageMass {
  // Fix summation order as well as membership: floating-point addition itself
  // is order sensitive. Neither sorting nor nullable-sum mutates the inputs.
  const sum = (basis: keyof LineageMass) => sumNullable(
    values.map(value => value[basis])
      .filter((value): value is number => value != null && Number.isFinite(value))
      .sort((left, right) => left - right),
  );
  return { wetKg: sum("wetKg"), dryKg: sum("dryKg") };
}

function finish(contributions: Contributions): Map<string, LineageMass> {
  return new Map([...contributions].map(([id, values]) => [id, total(values)]));
}

function sourceMass(source: ChainSourceLineage): LineageMass {
  return { wetKg: source.allocatedWetMassKg, dryKg: source.allocatedDryMassKg };
}

/** Upstream withdrawals repeat in application slices; they are physical facts, not additive shares. */
function collectSourceEdges(edges: Contributions, source: ChainSourceLineage): void {
  const runId = `production-run:${source.productionRun.id}`;
  for (const feedstock of source.feedstocks) {
    const id = `feedstock:${feedstock.id}->${runId}`;
    if (!edges.has(id)) {
      collect(edges, id, { wetKg: feedstock.wetMassUsedKg, dryKg: null });
    }
  }
}

/**
 * Roll up already-expanded application/product slices. Only allocated/applied
 * shares add across lineages. Recorded delivery, order and feedstock quantities
 * describe whole entities and must not multiply when those entities recur.
 * Missing/non-finite values follow sumNullable independently on each basis.
 * Legacy single-source edges fall back per basis to recorded product mass;
 * node allocations retain their saved values.
 */
export function buildLineageRollup(lineages: readonly ChainOfCustodyData[]): LineageRollup {
  const nodes: Contributions = new Map();
  const edges: Contributions = new Map();
  const productAllocations: Contributions = new Map();

  for (const lineage of lineages) {
    const sources = resolveChainSources(lineage);
    const applicationId = `application:${lineage.application.id}`;
    const deliveryId = `delivery:${lineage.delivery.id}`;
    const applied = {
      wetKg: kgFromTonnes(lineage.application.biocharAppliedTons),
      dryKg: kgFromTonnes(lineage.application.biocharAppliedDryTons),
    };
    collect(nodes, applicationId, applied);
    collect(edges, `${deliveryId}->${applicationId}`, applied);
    if (!nodes.has(deliveryId)) {
      collect(nodes, deliveryId, {
        wetKg: lineage.delivery.deliveredWetMassKg ?? null,
        dryKg: lineage.delivery.massDryKg,
      });
    }
    if (lineage.order && !nodes.has(`order:${lineage.order.id}`)) {
      collect(nodes, `order:${lineage.order.id}`, { wetKg: lineage.order.quantityKg, dryKg: null });
    }

    const productId = lineage.biocharProduct ? `biochar-product:${lineage.biocharProduct.id}` : null;
    if (productId) {
      collect(nodes, productId, applied);
      collect(edges, `${productId}->${deliveryId}`, applied);
      // An empty source list still produces an explicitly unknown allocation.
      if (sources.length === 0) collect(productAllocations, productId, { wetKg: null, dryKg: null });
      for (const source of sources) collect(productAllocations, productId, sourceMass(source));
    }
    for (const source of sources) {
      const runId = `production-run:${source.productionRun.id}`;
      const allocated = sourceMass(source);
      collect(nodes, runId, allocated);
      collectSourceEdges(edges, source);
      for (const feedstock of source.feedstocks) {
        const feedstockId = `feedstock:${feedstock.id}`;
        if (!nodes.has(feedstockId)) {
          collect(nodes, feedstockId, { wetKg: feedstock.wetMassUsedKg, dryKg: feedstock.massDryKg });
        }
      }
      if (productId && lineage.biocharProduct) {
        const product = lineage.biocharProduct;
        // Older lineages can have one run but no saved allocation. Preserve
        // their edge figures without treating whole-product mass as a node share.
        const legacyProduct = sources.length === 1 ? product : null;
        collect(edges, `${runId}->${productId}`, {
          wetKg: allocated.wetKg ?? legacyProduct?.massKg ?? null,
          dryKg: allocated.dryKg ?? splitWetMass(
            legacyProduct?.massKg,
            legacyProduct?.moistureContentPercent,
          )?.dryKg ?? null,
        });
      }
    }
  }

  const nodeTotals: Map<string, LineageNodeMass> = finish(nodes);
  for (const [id, sourceAllocation] of finish(productAllocations)) {
    nodeTotals.set(id, { ...nodeTotals.get(id)!, sourceAllocation });
  }
  return { nodes: nodeTotals, edges: finish(edges) };
}

