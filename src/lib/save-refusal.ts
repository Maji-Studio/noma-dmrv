/**
 * Turn a refused save into what a form shows (#1298): a short error at each
 * field the refusal names that is on screen, and one footer line for the rest.
 * Pure, so the rule is tested without a form; `useSaveRefusal` applies it.
 */
import { isActionError } from "./action-error";

/** What a locked field says; the lock's reason is shown once in the footer. */
export const LOCKED_FIELD_MESSAGE = "Locked";

const LOCK_CODE = "certification_locked";
const STALE_VERSION_CODE = "stale_version";
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
  /** Server path to form field, matched on the whole dotted path, then its first segment. */
  aliases?: Readonly<Record<string, string>>;
  /** The field is rendered and editable in the form. */
  isShown: (field: string) => boolean;
  /** The operator changed the field (a lock only points at what they touched). */
  isChanged: (field: string) => boolean;
}

function formField(path: readonly (string | number)[], aliases: Readonly<Record<string, string>>): string {
  const whole = path.join(".");
  return aliases[whole] ?? (path[0] !== undefined ? aliases[String(path[0])] : undefined) ?? whole;
}

/**
 * Null means the form has nothing to add: not an `ActionError`, no issues
 * (including a lock that names no field), or a stale-version or conflict
 * refusal, which keep their own message and blockers.
 */
export function planSaveRefusal(error: unknown, options: SaveRefusalOptions): SaveRefusalPlan | null {
  if (!isActionError(error) || error.issues.length === 0) return null;
  if (error.conflict || error.code === STALE_VERSION_CODE) return null;
  const aliases = options.aliases ?? {};
  const fieldErrors: SaveRefusalFieldError[] = [];
  const footer = new Set<string>();
  for (const issue of error.issues) {
    const field = formField(issue.path, aliases);
    const locked = issue.code === LOCK_CODE;
    if (locked) footer.add(issue.message);
    const atField = options.isShown(field) && (!locked || options.isChanged(field));
    if (!atField) {
      footer.add(issue.message);
    } else if (!fieldErrors.some((existing) => existing.field === field)) {
      fieldErrors.push({ field, message: locked ? LOCKED_FIELD_MESSAGE : issue.message, locked });
    }
  }
  return { fieldErrors, footer: footer.size > 0 ? [...footer].join(FOOTER_SEPARATOR) : null };
}
