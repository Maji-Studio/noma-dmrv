/**
 * DOM helpers for the form error summary: read each control's label and
 * position when Save is pressed, and move focus to a field by its RHF path.
 * They run only in event handlers and effects, never during render.
 */

/** Label and tree-order position of one control, keyed by its name and id. */
export interface FieldDirectoryEntry {
  label: string | null;
  index: number;
}

export type FieldDirectory = ReadonlyMap<string, FieldDirectoryEntry>;

/**
 * Everything a field can be: native controls plus the ARIA widgets custom
 * pickers render. Buttons are included because the entity select trigger is
 * one; the Save and Cancel buttons carry no name or id, so they never key in.
 */
const CONTROL_SELECTOR = [
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "button",
  "[role='combobox']",
  "[role='radiogroup']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='slider']",
  "[role='spinbutton']",
  "[role='textbox']",
].join(",");

/** A field array or object refine reports at `<path>.root`. */
const ROOT_SUFFIX = ".root";

function controlsIn(form: HTMLElement): HTMLElement[] {
  return Array.from(form.querySelectorAll<HTMLElement>(CONTROL_SELECTOR));
}

/**
 * The RHF paths a control answers to: `data-field-name` (a picker whose `id`
 * must stay unique, such as `FormEntitySelect`), its `name` (`register`), and
 * its `id` (a `Controller` widget whose id is the field name).
 */
function pathKeys(element: HTMLElement): string[] {
  return [element.dataset.fieldName, element.getAttribute("name"), element.id].filter(
    (key): key is string => Boolean(key),
  );
}

/** Visible label text, without the sr-only unit and "Required" or the star. */
function cleanText(element: Element): string | null {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll(".sr-only, [aria-hidden='true']").forEach((node) => node.remove());
  const text = copy.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return text.length > 0 ? text : null;
}

function textOfIds(ids: string, root: Document): string | null {
  const parts = ids
    .split(/\s+/)
    .map((id) => root.getElementById(id))
    .filter((node): node is HTMLElement => node !== null)
    .map(cleanText)
    .filter((text): text is string => text !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * A group's visible name: the FormField label that points at the fieldset,
 * else its legend (often sr-only, and worded for screen readers).
 */
function groupNameOf(element: HTMLElement): string | null {
  const fieldset = element.closest("fieldset");
  if (!fieldset) return null;
  if (fieldset.id) {
    const label = element.ownerDocument.querySelector(`label[for="${CSS.escape(fieldset.id)}"]`);
    const text = label ? cleanText(label) : null;
    if (text) return text;
  }
  const legend = fieldset.querySelector("legend");
  return legend ? cleanText(legend) : null;
}

/**
 * The name an operator sees for a control: a radio or checkbox in a group is
 * named by its group (its own label is the option), anything else by its
 * label, then aria-labelledby, aria-label, then a surrounding group.
 */
export function controlLabel(element: HTMLElement): string | null {
  const isOption =
    element instanceof HTMLInputElement &&
    (element.type === "radio" || element.type === "checkbox");
  if (isOption) {
    const group = groupNameOf(element);
    if (group) return group;
  }
  const labels = "labels" in element ? (element as HTMLInputElement).labels : null;
  if (labels && labels.length > 0) {
    const text = cleanText(labels[0]);
    if (text) return text;
  }
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = textOfIds(labelledBy, element.ownerDocument);
    if (text) return text;
  }
  const ariaLabel = element.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;
  return groupNameOf(element);
}

/**
 * Read every control in the form once, in tree order, keyed by each of its
 * `pathKeys`. The first control with a key wins, which is the first radio of
 * a group.
 */
export function readFieldDirectory(form: HTMLElement | null): FieldDirectory {
  const directory = new Map<string, FieldDirectoryEntry>();
  if (!form) return directory;
  controlsIn(form).forEach((element, index) => {
    const keys = pathKeys(element);
    if (keys.length === 0) return;
    const entry = { label: controlLabel(element), index };
    for (const key of keys) {
      if (!directory.has(key)) directory.set(key, entry);
    }
  });
  return directory;
}

/** The path itself, or the field a `.root` error belongs to. */
function ownPaths(path: string): string[] {
  return path.endsWith(ROOT_SUFFIX) ? [path, path.slice(0, -ROOT_SUFFIX.length)] : [path];
}

/**
 * Where an error sits in the form: its own control, else (for a whole array
 * or group) the first control inside it. `label` is set only for the field's
 * own control, so a group error never borrows a row's label.
 */
export function locateInDirectory(
  directory: FieldDirectory,
  path: string,
): FieldDirectoryEntry | null {
  for (const own of ownPaths(path)) {
    const entry = directory.get(own);
    if (entry) return entry;
  }
  const prefix = `${ownPaths(path).at(-1)}.`;
  let first: FieldDirectoryEntry | null = null;
  for (const [key, entry] of directory) {
    if (key.startsWith(prefix) && (first === null || entry.index < first.index)) {
      first = { label: null, index: entry.index };
    }
  }
  return first;
}

function findControl(form: HTMLElement, path: string): HTMLElement | null {
  const controls = controlsIn(form);
  for (const own of ownPaths(path)) {
    const match = controls.find((element) => pathKeys(element).includes(own));
    if (match) return preferredOption(match);
  }
  const prefix = `${ownPaths(path).at(-1)}.`;
  return (
    controls.find((element) => pathKeys(element).some((key) => key.startsWith(prefix))) ?? null
  );
}

/** Focus the checked radio of a group, as arrow-key navigation expects. */
function preferredOption(element: HTMLElement): HTMLElement {
  if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.form) {
    return element;
  }
  const group = element.form.elements.namedItem(element.name);
  if (group instanceof RadioNodeList) {
    const checked = Array.from(group).find(
      (node) => node instanceof HTMLInputElement && node.checked,
    );
    if (checked instanceof HTMLElement) return checked;
  }
  return element;
}

/** Open any closed `<details>` around the control so it can take focus. */
function revealControl(element: HTMLElement): void {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement && !node.open) node.open = true;
  }
}

/**
 * Move focus to the field at `path` and scroll it to the middle of its
 * scroll container, so its label and message both show above the sticky
 * footer. Returns false when no control matches the path.
 */
export function focusField(form: HTMLElement | null, path: string, options: { focus?: boolean } = {}): boolean {
  if (!form) return false;
  const control = findControl(form, path);
  if (!control) return false;
  revealControl(control);
  // A just-opened <details> lays out on the next frame.
  requestAnimationFrame(() => {
    // A locked field is disabled, or about to be: scroll to it, leave focus alone.
    if (options.focus !== false) control.focus({ preventScroll: true });
    control.scrollIntoView({ block: "center" });
  });
  return true;
}
