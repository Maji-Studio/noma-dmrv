import { z } from "zod";
import { formatFacilityDate } from "@/lib/date-utils";
import { SafeError } from "@/lib/errors";
import { canonicalJson } from "@/lib/canonical-json";
import { ownValue } from "@/lib/isometric/semantic-binding-catalog";
import {
  compareTemplateObservations,
  isEntryCompatible,
} from "@/lib/isometric/template-observations/compare";
import {
  effectiveContract,
  validateLineSources,
  type LineSources,
} from "@/lib/isometric/template-observations/line-sources";
import { canonicalDecimal, canonicalUnit } from "@/lib/isometric/template-observations/units";
import type { QuantityKind, TemplateObservation } from "@/lib/isometric/template-observations/types";
import type { MassDistanceDetail } from "@/db/schema/emission-entries";

export interface EntryObservation extends TemplateObservation {
  externalTemplateId: string;
  lineSources: LineSources;
}
export interface EntryValueInput {
  inputKey: string;
  quantityKind: QuantityKind;
  magnitude: string;
  unit: string;
  massDistanceDetail?: MassDistanceDetail | null;
}
export const ENTRY_DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
export function requireEntryMagnitude(value: string): string {
  if (!ENTRY_DECIMAL_PATTERN.test(value)) throw new SafeError("Enter a non-negative decimal value.");
  return canonicalDecimal(value)!;
}
/** Integer multiplication preserves every entered decimal digit. */
export function multiplyEntryDecimals(a: string, b: string): string {
  const left = canonicalDecimal(a)!;
  const right = canonicalDecimal(b)!;
  const scale = (left.split(".")[1]?.length ?? 0) + (right.split(".")[1]?.length ?? 0);
  const product = BigInt(left.replace(".", "")) * BigInt(right.replace(".", ""));
  const digits = product.toString().padStart(scale + 1, "0");
  return canonicalDecimal(scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits)!;
}
export function entryLine(observation: EntryObservation, componentId: string) {
  const component = observation.definition.groups
    .flatMap((group) => group.components)
    .find((line) => line.id === componentId);
  const stored = ownValue(observation.lineSources, componentId);
  const contract = stored && effectiveContract(stored);
  return component && contract
    ? {
        component,
        enrichment: ownValue(observation.enrichment, componentId) ?? {},
        entryPolicy: contract.entryPolicy,
        contract,
      }
    : null;
}
export function validateEmissionEntry(args: {
  observation: EntryObservation;
  componentId: string;
  values: EntryValueInput[];
  occurredOn: string;
  batchStartDate: string;
  timezone: string;
  now?: Date;
  activeValueCount: number;
}) {
  const line = entryLine(args.observation, args.componentId);
  if (!line) throw new SafeError("This template line is no longer available. Choose another line.");
  if (
    line.contract.scope !== "operating" ||
    line.entryPolicy === "none" ||
    validateLineSources(args.observation.definition, args.observation.lineSources).some(
      (problem) => problem.componentId === args.componentId,
    )
  ) {
    throw new SafeError("This template line does not allow entries. Review its setup.");
  }
  if (line.entryPolicy === "single" && args.activeValueCount > 0)
    throw new SafeError("This line already has an entry. Edit that entry instead.");
  const shape = line.component.inputs.filter((input) => input.type === "monitored");
  if (
    args.values.length !== shape.length ||
    new Set(args.values.map((value) => value.inputKey)).size !== shape.length
  ) {
    throw new SafeError("Enter a value for each input on this template line.");
  }
  if (
    shape.some((input) => {
      const enriched = ownValue(line.enrichment, input.key);
      return !enriched || "status" in enriched || !canonicalUnit(input.quantityKind, enriched.unit);
    })
  )
    throw new SafeError("Read the template input units before adding an entry.");
  for (const value of args.values) {
    const input = shape.find((input) => input.key === value.inputKey);
    if (!input || input.quantityKind !== value.quantityKind)
      throw new SafeError("The entry inputs do not match this template line. Enter the values again.");
    requireEntryMagnitude(value.magnitude);
    const enriched = ownValue(line.enrichment, input.key)!;
    if (
      canonicalUnit(input.quantityKind, value.unit) !== value.unit ||
      "status" in enriched ||
      value.unit !== canonicalUnit(input.quantityKind, enriched.unit)
    )
      throw new SafeError("Choose a supported unit for this input.");
    const detail = value.massDistanceDetail;
    if (input.quantityKind === "mass_distance") {
      if (!detail) throw new SafeError("Enter the mass and distance for this value.");
      requireEntryMagnitude(detail.mass.magnitude);
      requireEntryMagnitude(detail.distance.magnitude);
      if (
        canonicalUnit("mass", detail.mass.unit) !== detail.mass.unit ||
        canonicalUnit("distance", detail.distance.unit) !== detail.distance.unit ||
        canonicalUnit("mass_distance", `${detail.mass.unit} * ${detail.distance.unit}`) !== value.unit ||
        multiplyEntryDecimals(detail.mass.magnitude, detail.distance.magnitude) !==
          canonicalDecimal(value.magnitude)
      ) {
        throw new SafeError("The mass and distance must match the recorded total and unit.");
      }
    } else if (detail)
      throw new SafeError("Mass and distance detail is only supported for mass-distance inputs.");
  }
  if (!z.iso.date().safeParse(args.occurredOn).success) throw new SafeError("Enter a valid entry date.");
  if (args.occurredOn < args.batchStartDate)
    throw new SafeError("Entry date cannot be before the credit batch start date.");
  if (args.occurredOn > formatFacilityDate(args.now ?? new Date(), args.timezone))
    throw new SafeError("Entry date cannot be in the future at this facility.");
  return { inputShape: shape, lineRule: line.entryPolicy as "additive" | "single" };
}
export function emissionEntryCounts(
  previous: EntryObservation,
  current: EntryObservation,
  componentId: string,
) {
  const before = entryLine(previous, componentId);
  const after = entryLine(current, componentId);
  const incompatible = {
    counts: false,
    reason: "Enter the values again for the current template line.",
    canConfirm: false,
  };
  if (
    previous.externalTemplateId !== current.externalTemplateId ||
    !before ||
    !after ||
    after.contract.scope !== "operating" ||
    after.entryPolicy === "none" ||
    validateLineSources(current.definition, current.lineSources).some(
      (problem) => problem.componentId === componentId,
    ) ||
    !isEntryCompatible(before, after) ||
    before.component.inputs.filter((input) => input.type === "monitored").some((input) => {
      const oldInput = ownValue(before.enrichment, input.key);
      const newInput = ownValue(after.enrichment, input.key);
      return !oldInput || !newInput || "status" in oldInput || "status" in newInput ||
        canonicalUnit(input.quantityKind, oldInput.unit) !== canonicalUnit(input.quantityKind, newInput.unit);
    })
  )
    return incompatible;
  const change = compareTemplateObservations(previous, current)[componentId];
  const contractsMatch =
    canonicalJson({ ...before.contract, origin: undefined }) ===
    canonicalJson({ ...after.contract, origin: undefined });
  if ((change === "unchanged" || change === "cosmetic") && contractsMatch)
    return { counts: true, reason: null, canConfirm: true };
  return { counts: false, reason: "Confirm this entry for the changed template line.", canConfirm: true };
}

/** Compare persisted content, excluding row identity and input order. */
export function normalizedEntryValues(values: Omit<EntryValueInput, "quantityKind">[]) {
  return values
    .map((value) => ({
      inputKey: value.inputKey,
      magnitude: requireEntryMagnitude(value.magnitude),
      unit: value.unit,
      massDistanceDetail: value.massDistanceDetail
        ? {
            mass: {
              unit: value.massDistanceDetail.mass.unit,
              magnitude: requireEntryMagnitude(value.massDistanceDetail.mass.magnitude),
            },
            distance: {
              unit: value.massDistanceDetail.distance.unit,
              magnitude: requireEntryMagnitude(value.massDistanceDetail.distance.magnitude),
            },
          }
        : null,
    }))
    .sort((a, b) => a.inputKey.localeCompare(b.inputKey));
}
