import type { Edge } from "@xyflow/react";
import { formatWetDryMass } from "@/lib/mass-moisture";

/** Below this share, round-to-percent would read as a misleading "0%". */
const SUB_ONE_PERCENT = 0.01;
const NEAR_FULL_PERCENT = 0.995;

/** A unit must never be mixed within one fan when normalizing to a share. */
export type EdgeMassUnit = "kg" | "tDry";

export interface EdgeMass {
  value: number | null;
  unit: EdgeMassUnit;
}

export type EdgeMassBasis = "applied" | "recorded";

/**
 * Which figure `mass` holds. Allocation edges carry dry kg and fall back to
 * wet kg when dry is unknown (lineage-mass-totals.ts `finishEdges`), so two
 * edges in the same unit can still measure different things.
 */
export type EdgeMassFooting = "dry" | "wet";

/**
 * Data carried on every flow edge. `mass`/`unit` feed the branch-share %;
 * `kgLabel`/`pctLabel` are the pre-formatted strings the toggle swaps between;
 * `variant` distinguishes mass flow from the reactor's mass-less equipment
 * link; `inferred` marks a link worked out rather than recorded (a feedstock
 * bin's draw order decides which intakes a run drew).
 */
export interface ChainEdgeBuildData {
  variant: "flow" | "equipment";
  inferred: boolean;
  mass: number | null;
  unit: EdgeMassUnit | null;
  massFooting: EdgeMassFooting | null;
  /**
   * A merged edge whose members' masses could not be summed (mixed unit,
   * basis or footing). It has no mass, and any fan it belongs to shows no %,
   * since the shares of the rest would not add up to the whole.
   */
  mixedMass?: boolean;
  wetKg: number | null;
  dryKg: number | null;
  kgLabel: string | null;
  pctLabel: string | null;
  /**
   * What the mass measures: `applied` (rollback allocations) or `recorded`
   * (roll-forward draws and shipments). Branch shares never mix the two.
   */
  massBasis: EdgeMassBasis;
  [key: string]: unknown;
}

export function formatKg(value: number | null | undefined): string | null {
  if (value == null) return null;
  return `${Math.round(value).toLocaleString()} kg`;
}

function formatDryTons(value: number | null | undefined): string | null {
  if (value == null) return null;
  return `${value.toFixed(2)} t dry`;
}

export function massLabel(mass: EdgeMass | null): string | null {
  if (!mass || mass.value == null) return null;
  return mass.unit === "kg" ? formatKg(mass.value) : formatDryTons(mass.value);
}

/** A share is derived, so one that cannot be worked out is left off the edge. */
function formatShare(fraction: number): string | null {
  if (!Number.isFinite(fraction) || fraction <= 0) return null;
  if (fraction < SUB_ONE_PERCENT) return "<1%";
  if (fraction >= NEAR_FULL_PERCENT) return "100%";
  return `${Math.round(fraction * 100)}%`;
}

/**
 * Branch-share % per edge (plan decision): an edge in a fan reads as its
 * share of that fan. A split (one source → many targets) normalizes against
 * the source's total outflow; a merge (many sources → one target) against the
 * target's total inflow; a straight 1:1 hand-off reads 100%. Sums stay within
 * one unit, since a fan never mixes kg and dry-tons. A fan that mixes applied
 * and recorded mass (rollback next to roll-forward) gets no share at all:
 * summing the two describes neither split.
 *
 * Mutates `edge.data.pctLabel`; callers pass edges they own.
 */
export function computeEdgeShareLabels(edges: Edge[]): void {
  const outSum = new Map<string, number>();
  const outCount = new Map<string, number>();
  const inSum = new Map<string, number>();
  const inCount = new Map<string, number>();
  const outBases = new Map<string, Set<EdgeMassBasis>>();
  const inBases = new Map<string, Set<EdgeMassBasis>>();
  // Fans holding a merged edge whose mass could not be summed: no % at all.
  const mixedOut = new Map<string, number>();
  const mixedIn = new Map<string, number>();
  const bump = (counts: Map<string, number>, key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  const addBasis = (bases: Map<string, Set<EdgeMassBasis>>, key: string, basis: EdgeMassBasis) =>
    bases.set(key, (bases.get(key) ?? new Set()).add(basis));
  for (const edge of edges) {
    const data = edge.data as ChainEdgeBuildData | undefined;
    if (data?.mixedMass) {
      bump(mixedOut, edge.source);
      bump(mixedIn, edge.target);
      continue;
    }
    if (!data || data.mass == null || data.unit == null) continue;
    const outKey = `${edge.source}|${data.unit}`;
    const inKey = `${edge.target}|${data.unit}`;
    outSum.set(outKey, (outSum.get(outKey) ?? 0) + data.mass);
    bump(outCount, outKey);
    inSum.set(inKey, (inSum.get(inKey) ?? 0) + data.mass);
    bump(inCount, inKey);
    addBasis(outBases, outKey, data.massBasis);
    addBasis(inBases, inKey, data.massBasis);
  }
  for (const edge of edges) {
    const data = edge.data as ChainEdgeBuildData | undefined;
    if (!data) continue;
    if (data.mixedMass) {
      data.pctLabel = null;
      continue;
    }
    if (data.mass == null || data.unit == null) continue;
    const outKey = `${edge.source}|${data.unit}`;
    const inKey = `${edge.target}|${data.unit}`;
    const mixedSplit = mixedOut.get(edge.source) ?? 0;
    const mixedMerge = mixedIn.get(edge.target) ?? 0;
    let fraction: number;
    if ((outCount.get(outKey) ?? 0) + mixedSplit > 1) {
      if (mixedSplit > 0 || (outBases.get(outKey)?.size ?? 0) > 1) {
        data.pctLabel = null;
        continue;
      }
      fraction = data.mass / (outSum.get(outKey) || 1);
    } else if ((inCount.get(inKey) ?? 0) + mixedMerge > 1) {
      if (mixedMerge > 0 || (inBases.get(inKey)?.size ?? 0) > 1) {
        data.pctLabel = null;
        continue;
      }
      fraction = data.mass / (inSum.get(inKey) || 1);
    } else {
      fraction = 1;
    }
    data.pctLabel = formatShare(fraction);
  }
}

function sumOrNull(values: Array<number | null>): number | null {
  if (values.some((value) => value == null)) return null;
  return (values as number[]).reduce((total, value) => total + value, 0);
}

/**
 * One edge standing for several parallel edges (a collapsed group's links to
 * the same record). Wet and dry kg sum independently, each only when every
 * member has that figure. The share mass sums only when every member has one
 * in the same unit, basis and footing; otherwise the merged edge is marked
 * `mixedMass` so no fan it joins shows a %.
 */
export function mergeEdgeMass(members: ChainEdgeBuildData[]): ChainEdgeBuildData {
  const [first] = members;
  const summable = members.every(
    (member) =>
      member.mass != null &&
      member.unit === first.unit &&
      member.massBasis === first.massBasis &&
      member.massFooting === first.massFooting,
  );
  const anyMass = members.some((member) => member.mass != null);
  const mass = summable ? sumOrNull(members.map((member) => member.mass)) : null;
  const wetKg = sumOrNull(members.map((member) => member.wetKg));
  const dryKg = sumOrNull(members.map((member) => member.dryKg));
  const kgLabel =
    wetKg != null || dryKg != null
      ? formatWetDryMass({ wetKg, dryKg })
      : mass != null
        ? massLabel({ value: mass, unit: first.unit ?? "kg" })
        : null;
  return {
    ...first,
    inferred: members.some((member) => member.inferred),
    mass,
    unit: mass == null ? null : first.unit,
    massFooting: mass == null ? null : first.massFooting,
    mixedMass: anyMass && !summable,
    wetKg,
    dryKg,
    kgLabel,
    pctLabel: null,
  };
}
