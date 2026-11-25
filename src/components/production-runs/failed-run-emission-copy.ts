/**
 * The words about where a Failed run's emissions go (#1714), shared by the
 * form footer, the read sheet and the facility to-do so one fact reads the
 * same everywhere. A failed run adds no biochar, so these lines never say it
 * "joins" a credit batch; its diesel, electricity and feedstock transport
 * count in the batch that covers its end day. Pure, so every state is tested
 * without a server.
 */
import { formatDayString } from "@/lib/format-utils";
import type { FailedRunEmissionGuidance } from "@/types/failed-run-emission-guidance";

export interface FailedRunEmissionCopy {
  /** Text before the batch link; the whole line when there is no batch. */
  lead: string;
  /** The batch the emissions count in, when there is one. */
  batch: { id: string; code: string } | null;
  /** The ⓘ explanation. */
  info: string;
  /** Mixed or empty feedstock, or no batch yet: where the operator goes next. */
  action: { label: string; href: string } | null;
  /** Mixed and empty feedstock need the operator's attention; the rest are quiet. */
  tone: "neutral" | "warning";
}

export const EMISSION_LEAD = "Emissions count in credit batch ";

const WHAT_COUNTS = "A failed run adds no biochar. Its diesel, electricity and feedstock transport count in the credit batch that covers its end day";

/** A failed run that is not saved yet: no batch can be named before the run exists. */
export const UNSAVED_FAILED_RUN_EMISSIONS: FailedRunEmissionCopy = {
  lead: "Emissions count in the credit batch for its end day",
  batch: null,
  info: `${WHAT_COUNTS}, for its feedstock. Save the run to see which one.`,
  action: null,
  tone: "neutral",
};

/** The saved run's attachment, in operator words. */
export function describeFailedRunEmissions(guidance: FailedRunEmissionGuidance): FailedRunEmissionCopy {
  const day = formatDayString(guidance.endDay);
  const feedstock = guidance.feedstockTypeName ?? "its feedstock";
  switch (guidance.state) {
    case "attached":
      return {
        lead: EMISSION_LEAD,
        batch: guidance.batch,
        info: `${WHAT_COUNTS}, ${day}, for ${feedstock}.`,
        action: null,
        tone: "neutral",
      };
    case "no-match":
      return {
        lead: "No credit batch for its emissions yet",
        batch: null,
        info: `${WHAT_COUNTS}. No credit batch for ${feedstock} covers ${day} yet. Create one and the emissions count in it. You can save the run now.`,
        action: { label: "Open credit batches", href: guidance.href },
        tone: "neutral",
      };
    case "mixed-feedstock":
      return {
        lead: "Its feedstock records hold more than one feedstock type.",
        batch: null,
        info: "A credit batch holds one feedstock type, so these emissions have no credit batch until the run's feedstock is one type.",
        action: { label: "Review feedstock sources", href: guidance.href },
        tone: "warning",
      };
    case "empty-feedstock":
      return {
        lead: "Its emissions have no feedstock type.",
        batch: null,
        info: "Without a feedstock type, noma cannot pick a credit batch for these emissions.",
        action: { label: "Review feedstock sources", href: guidance.href },
        tone: "warning",
      };
  }
}

/** One facility to-do row, after its run code. */
export function describeFailedRunEmissionTodo(guidance: FailedRunEmissionGuidance): string {
  const day = formatDayString(guidance.endDay);
  const feedstock = guidance.feedstockTypeName ?? "its feedstock";
  switch (guidance.state) {
    case "mixed-feedstock":
      return "its feedstock records hold more than one feedstock type.";
    case "empty-feedstock":
      return "its emissions have no feedstock type.";
    default:
      return `create a credit batch for ${feedstock} that covers ${day}.`;
  }
}

/** The to-do's title: the count, then what is wrong. */
export function failedRunEmissionTodoTitle(count: number): string {
  return count === 1 ? "1 failed run has emissions without a credit batch" : `${count} failed runs have emissions without a credit batch`;
}
