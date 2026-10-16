import { isDeepStrictEqual } from "node:util";
import { FORMULATION_CASES, type FormulationCaseId } from "./config";
import type { CaseScore } from "./score";
import type { Transcript } from "./transcript";

export interface FormulationRow {
  id: string; code: string; name: string; biocharRatio: number | null; version: number; archivedAt: string | null;
  [key: string]: unknown;
}
export interface FormulationLine {
  id: string; formulationId: string; feedstockTypeId: string; ratio: number | null;
  [key: string]: unknown;
}
export interface FormulationSnapshot {
  formulations: FormulationRow[];
  lines: FormulationLine[];
  feedstockTypes: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  products: Record<string, unknown>[];
  stock: Record<string, unknown>[][];
}
export interface FormulationTarget {
  formulationId: string; code: string; name: string; compostTypeId: string; before: FormulationSnapshot;
}
const BIOCHAR_RATIO = 0.7;
const COMPOST_RATIO = 0.3;
const VERSION_INCREMENT = 1;

// Fixture queries sort by id; comparisons ignore object property order.
const same = isDeepStrictEqual;
function appFirstAdvice(text: string): boolean {
  return /\bfeedstock[ -]types?\b/i.test(text) && /\b(?:app(?:lication)?|Noma)\b/i.test(text)
    && /\b(?:add|create|added|created)\b/i.test(text)
    && /\b(?:first|before|must|needs?|please|required|then|once|has to|have to|should)\b/i.test(text)
    && !/\b(?:no need|not required|(?:do not|don['’]t)(?:\s+need)?)\s+(?:to\s+)?(?:add|create)/i.test(text);
}
function orderRefusal(text: string): boolean {
  return /\borders?\b/i.test(text) && /\b(?:uses?|used|in use|references?|referenced|linked)\b/i.test(text)
    && !/\b(?:no orders?|not (?:used|in use|referenced|linked))\b/i.test(text);
}

/** Require an affirmative archive statement about the recipe, not a hypothetical or a bin. */
function archivedRefusal(text: string, target: FormulationTarget): boolean {
  const sentences = text.split(/[.!?\n]+/);
  return sentences.some(sentence => {
    const lower = sentence.toLowerCase();
    const namesTarget = /\bformulation\b/i.test(sentence)
      || lower.includes(target.name.toLowerCase()) || lower.includes(target.code.toLowerCase());
    return namesTarget && /\barchived\b/i.test(sentence)
      && !/\b(?:not|never|no longer|isn['’]t|wasn['’]t|hasn['’]t)\s+(?:\w+\s+){0,2}archived\b/i.test(sentence)
      && !/\b(?:if|whether|might|may|perhaps)\b/i.test(sentence);
  });
}

export function scoreFormulationCase(
  caseId: FormulationCaseId, target: FormulationTarget, snapshot: FormulationSnapshot, transcript: Transcript,
): CaseScore {
  const definition = FORMULATION_CASES.find(({ id }) => id === caseId)!;
  const before = target.before;
  const criteria: Record<string, boolean> = {
    completed: transcript.completed,
    budget: transcript.calls.length <= definition.budget,
    otherEntitiesUnchanged: same(snapshot.feedstockTypes, before.feedstockTypes) && same(snapshot.orders, before.orders)
      && same(snapshot.products, before.products) && same(snapshot.stock, before.stock),
  };
  if (caseId === "formulation-blend") {
    const added = snapshot.formulations.filter((row) => !before.formulations.some(({ id }) => id === row.id));
    const row = added[0];
    const lines = snapshot.lines.filter((line) => line.formulationId === row?.id);
    Object.assign(criteria, {
      oneNewFormulation: added.length === 1 && snapshot.formulations.length === before.formulations.length + 1,
      blend: row?.name.trim().toLowerCase() === "compost blend" && row.biocharRatio === BIOCHAR_RATIO && row.archivedAt === null,
      compostLine: lines.length === 1 && lines[0].feedstockTypeId === target.compostTypeId && lines[0].ratio === COMPOST_RATIO,
      existingUnchanged: same(snapshot.formulations.filter((value) => value.id !== row?.id), before.formulations)
        && same(snapshot.lines.filter((line) => line.formulationId !== row?.id), before.lines),
    });
  } else if (caseId === "formulation-unknown-ingredient" || caseId === "formulation-guarded-delete") {
    criteria.nothingSaved = same(snapshot, before);
    criteria.explainsRefusal = caseId === "formulation-unknown-ingredient"
      ? appFirstAdvice(transcript.finalText) : orderRefusal(transcript.finalText);
  } else if (caseId === "formulation-archived") {
    criteria.nothingSaved = same(snapshot, before);
    const original = before.formulations.find(({ id }) => id === target.formulationId);
    const current = snapshot.formulations.find(({ id }) => id === target.formulationId);
    criteria.stillArchived = !!original?.archivedAt && !!current?.archivedAt;
    criteria.noSuccessfulRestore = !transcript.calls.some(call =>
      call.name === "mcp__noma__restore_formulation" && call.isError === false);
    criteria.explainsRefusal = archivedRefusal(transcript.finalText, target);
  } else {
    const restore = caseId === "formulation-restore";
    const original = before.formulations.find(({ id }) => id === target.formulationId);
    const current = snapshot.formulations.find(({ id }) => id === target.formulationId);
    const expected = before.formulations.map((row) => row.id === target.formulationId ? {
      ...row, version: row.version + VERSION_INCREMENT, archivedAt: restore ? null : current?.archivedAt,
      updatedAt: current?.updatedAt,
    } : row);
    Object.assign(criteria, {
      transition: !!original && !!current && (restore ? original.archivedAt !== null && current.archivedAt === null
        : original.archivedAt === null && current.archivedAt !== null && Number.isFinite(Date.parse(current.archivedAt))),
      onlyTargetChanged: same(snapshot.formulations, expected) && same(snapshot.lines, before.lines),
    });
    if (restore) {
      const restoredAt = transcript.calls.findIndex((call) => call.name === "mcp__noma__restore_formulation"
        && call.arguments.formulationId === target.formulationId && call.arguments.dryRun !== true && call.isError === false);
      criteria.archivedLookup = restoredAt >= 0 && transcript.calls.slice(0, restoredAt).some((call) =>
        call.name === "mcp__noma__find_formulations" && (call.arguments.archived === true || call.arguments.archived === "true") && call.isError === false);
    }
  }
  return { caseId, expectation: definition.text(target), budget: definition.budget, passed: Object.values(criteria).every(Boolean), criteria, toolCalls: transcript.calls.length,
    turns: transcript.turns, durationMs: transcript.durationMs };
}
