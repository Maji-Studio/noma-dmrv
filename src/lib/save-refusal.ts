/**
 * Turn a refused save into what a form shows (#1298): a short error at each
 * field the refusal names that is on screen, and one footer line for the rest.
 * Pure, so the rule is tested without a form; `useSaveRefusal` applies it.
 */
import { isActionError } from "./action-error";

/** What a locked field says; the lock's reason is shown once in the footer. */
export const LOCKED_FIELD_MESSAGE = "Locked. Your change was not saved.";

const LOCK_CODE = "certification_locked";
const STALE_VERSION_CODE = "stale_version";
/** Code of a refusal because a bin holds less than asked for. */
export const INSUFFICIENT_STOCK_CODE = "insufficient_stock";
const FOOTER_SEPARATOR = " ";

export interface SaveRefusalFieldError {
  field: string;
  message: string;
  /** A lock refusal: the field says "Locked", the reason is in the footer. */
  locked: boolean;
}

export interface SaveRefusalPlan {
  fieldErrors: SaveRefusalFieldError[];
  /** Text for the rest of the refusal, or null when every issue sits at a field. */
  footer: string | null;
}

export interface SaveRefusalOptions {
  /** Server path to form field: whole path, one-segment wildcards (first matching pattern wins), then first segment. */
  aliases?: Readonly<Record<string, string>>;
  /** The field is rendered and editable in the form. */
  isShown: (field: string) => boolean;
  /** The operator changed the field (a lock only points at what they touched). */
  isChanged: (field: string) => boolean;
}

export function shouldMarkLockedField(field: string, options: SaveRefusalOptions): boolean {
  return options.isShown(field) && options.isChanged(field);
}

function formField(path: readonly (string | number)[], aliases: Readonly<Record<string, string>>): string {
  const whole = path.join(".");
  if (aliases[whole] !== undefined) return aliases[whole];
  for (const [pattern, target] of Object.entries(aliases)) {
    const parts = pattern.split(".");
    if (!parts.includes("*") || parts.length !== path.length) continue;
    const captures: string[] = [];
    const matches = parts.every((part, index) => {
      if (part !== "*") return part === String(path[index]);
      captures.push(String(path[index]));
      return true;
    });
    if (matches) {
      const targetParts = target.split(".");
      if (targetParts.filter((part) => part === "*").length > captures.length) continue;
      let captureIndex = 0;
      return targetParts.map((part) => part === "*" ? captures[captureIndex++] : part).join(".");
    }
  }
  return (path[0] !== undefined ? aliases[String(path[0])] : undefined) ?? whole;
}

/** The refusal holds a lock issue: the edit was refused whole, not partly saved. */
export function isLockRefusal(error: unknown): boolean {
  return isActionError(error) && error.issues.some((issue) => issue.code === LOCK_CODE);
}

/**
 * Null means the form has nothing to add: not an `ActionError`, no issues
 * (including a lock that names no field), a stale-version refusal, or a conflict
 * other than insufficient stock. Stock issues can sit at fields while the caller
 * keeps showing the bin conflict and its blockers.
 */
export function planSaveRefusal(error: unknown, options: SaveRefusalOptions): SaveRefusalPlan | null {
  if (!isActionError(error) || error.issues.length === 0) return null;
  if (error.code === STALE_VERSION_CODE || (error.conflict && error.code !== INSUFFICIENT_STOCK_CODE)) return null;
  const aliases = options.aliases ?? {};
  const fieldErrors: SaveRefusalFieldError[] = [];
  const footer = new Set<string>();
  for (const issue of error.issues) {
    const field = formField(issue.path, aliases);
    const locked = issue.code === LOCK_CODE;
    if (locked) footer.add(issue.message);
    const atField = locked ? shouldMarkLockedField(field, options) : options.isShown(field);
    // A field shows one error; a second reason for it goes to the footer.
    const taken = fieldErrors.find((existing) => existing.field === field);
    if (!atField || (taken && !locked && taken.message !== issue.message)) {
      footer.add(issue.message);
    } else if (!taken) {
      fieldErrors.push({ field, message: locked ? LOCKED_FIELD_MESSAGE : issue.message, locked });
    }
  }
  return { fieldErrors, footer: footer.size > 0 ? [...footer].join(FOOTER_SEPARATOR) : null };
}
