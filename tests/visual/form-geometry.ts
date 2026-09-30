/**
 * In-page geometry for the form capture harness (plan "Browser rescan",
 * Instrument A). `measureFormGeometry` runs inside the browser through
 * `page.evaluate`, so it must stay self-contained: no imports, no closures
 * over module scope, every helper nested in the function body.
 *
 * The capture marks the surface's root element with `data-capture-root`
 * before measuring. For a side sheet the measured body is the scrolling
 * `SlideOverPanel.Body`; the header and footer are sheet chrome. For a modal
 * it is the content wrapper inside the popup. For a page it is `main`.
 */

export type SurfaceKind = "sheet" | "dialog" | "page";
export type BodyMode = "form" | "read" | "page";

export interface MeasureArgs {
  kind: SurfaceKind;
  mode: BodyMode;
}

export interface TextStyle {
  key: string;
  size: string;
  weight: string;
  transform: string;
  tracking: string;
  mono: boolean;
  count: number;
  samples: string[];
}

export interface LineItem {
  side: "top" | "bottom";
  element: string;
  text: string;
  allowed: string | null;
}

export interface GapItem {
  level: "section" | "field" | "label" | "read-label";
  value: number;
  between: string;
}

export interface Geometry {
  body: { width: number; clientHeight: number; scrollHeight: number };
  textStyles: {
    count: number;
    styles: TextStyle[];
    uppercaseOrTracked: { text: string; key: string }[];
  };
  lines: { items: LineItem[]; violations: number };
  rhythm: { gaps: GapItem[] };
  alignment: {
    controlLeftEdges: { section: string; edges: number[] }[];
    nearMisaligned: { section: string; edges: number[] }[];
    loneHalfWidth: { field: string; widthRatio: number }[];
    orphanedGridItems: { grid: string; columns: number; items: number }[];
    wrappedLabels: { row: string; labels: string[] }[];
  };
  overflow: {
    bodyHorizontalScroll: boolean;
    pageHorizontalScroll: boolean;
    clipped: { element: string; text: string }[];
    tooWide: { element: string; overflowPx: number }[];
    innerScrollers: { element: string; scrollWidth: number; clientWidth: number }[];
  };
  prose: { helperCaptions: number; paragraphs: number; samples: string[] };
  /** Visible labels, titles and actions, split into content and explanation-block items. */
  r1: { labels: string[]; sectionTitles: string[]; actions: string[]; explanation: string[] };
}

export function measureFormGeometry(args: MeasureArgs): Geometry {
  const SAMPLE_LIMIT = 3;
  const TEXT_SNIPPET = 60;
  const GRID_ORPHAN_MIN_COLUMNS = 2;
  const HALF_WIDTH_RATIO = 0.6;
  const NEAR_MISALIGN_MAX_PX = 12;
  const PX_TOLERANCE = 1;
  const MIN_PARAGRAPH_CHARS = 1;
  /** The FormSpine's gutter column (form-spine.tsx grid-cols-[24px_1fr]); not a layout grid. */
  const FORM_SPINE_GUTTER_PX = 24;
  /** How much of a grid's text identifies it in the report. */
  const GRID_SNIPPET = 30;
  /** How many class names identify an element in the report. */
  const CLASS_SNIPPET = 4;
  /** An all-caps run this long is an uppercase label, not an acronym (GPS, TGA). */
  const LITERAL_CAPS_MIN_LETTERS = 4;
  /** SectionLabel, the FormSection/DetailSection title (section-label.tsx). */
  const SECTION_TITLE = "h3.body-small.font-medium";

  const root = document.querySelector("[data-capture-root]") as HTMLElement | null;
  if (!root) throw new Error("No [data-capture-root] element to measure.");

  const pickBody = (): HTMLElement => {
    if (args.kind === "sheet") {
      const scroller = Array.from(root.children).find((child) => {
        const overflowY = getComputedStyle(child).overflowY;
        return overflowY === "auto" || overflowY === "scroll";
      });
      return (scroller as HTMLElement | undefined) ?? root;
    }
    if (args.kind === "dialog") {
      const children = Array.from(root.children) as HTMLElement[];
      return children[children.length - 1] ?? root;
    }
    return root;
  };
  const body = pickBody();
  const bodyRect = body.getBoundingClientRect();

  const CONTROL_SELECTOR = [
    "input:not([type=hidden])",
    "select",
    "textarea",
    "button",
    "[role=combobox]",
    "[role=option]",
    "[role=listbox]",
    "[role=radio]",
    "[role=checkbox]",
    "[role=switch]",
    "[role=slider]",
    "[data-presentation-control]",
    // A FormField unit suffix renders inside the control's box.
    "[data-control-unit]",
  ].join(",");

  const clean = (value: string | null | undefined) =>
    (value ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_SNIPPET);
  /** A label's own words, without the required marker, CERT chip or sr-only text. */
  const ownText = (el: Element) =>
    clean(Array.from(el.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(" ")) || clean(el.textContent);

  const isSrOnly = (el: Element) => {
    const style = getComputedStyle(el);
    return style.position === "absolute" && (style.clip === "rect(0px, 0px, 0px, 0px)" || el.classList.contains("sr-only"));
  };

  const isVisible = (el: Element): boolean => {
    if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return false;
    if (el.closest("[hidden]")) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
    let node: Element | null = el;
    while (node && node !== body) {
      if (isSrOnly(node)) return false;
      node = node.parentElement;
    }
    return true;
  };

  const describe = (el: Element) => {
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, CLASS_SNIPPET).join(".") : "";
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
  };

  const inControl = (el: Element) => Boolean(el.closest(CONTROL_SELECTOR));

  const hasSide = (style: CSSStyleDeclaration, side: "Top" | "Bottom" | "Left" | "Right") => {
    const width = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`));
    const lineStyle = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
    const color = style.getPropertyValue(`border-${side.toLowerCase()}-color`);
    const transparent = color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color);
    return width > 0 && lineStyle !== "none" && lineStyle !== "hidden" && !transparent;
  };
  // FormActions: the sticky CTA row, or its static variant (a top-ruled row holding the submit).
  const isFormActionsRow = (el: Element) => {
    const style = getComputedStyle(el);
    if (style.position === "sticky" && el.querySelector("button")) return true;
    const isLast = el.parentElement?.lastElementChild === el;
    return isLast && hasSide(style, "Top") && Boolean(el.querySelector(":scope > div > button, :scope > button"));
  };
  const insideFormActions = (el: Element) => {
    let node: Element | null = el;
    while (node && node !== body) {
      if (isFormActionsRow(node)) return true;
      node = node.parentElement;
    }
    return false;
  };

  const all = Array.from(body.querySelectorAll("*")).filter(isVisible);

  /* ---------------------------------------------------------------- Text */
  const styleMap = new Map<string, TextStyle>();
  const uppercaseOrTracked: { text: string; key: string }[] = [];
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = clean(node.textContent);
    if (!text) continue;
    const parent = node.parentElement;
    if (!parent || !isVisible(parent)) continue;
    if (inControl(parent) || insideFormActions(parent)) continue;
    if (parent.closest("svg, [role=tooltip], table thead")) continue;
    const style = getComputedStyle(parent);
    const tracking = style.letterSpacing === "normal" ? "0" : String(parseFloat(style.letterSpacing));
    const mono = /mono/i.test(style.fontFamily);
    const key = `${style.fontSize}|${style.fontWeight}|${style.textTransform}|${tracking}${mono ? "|mono" : ""}`;
    const entry = styleMap.get(key) ?? {
      key,
      size: style.fontSize,
      weight: style.fontWeight,
      transform: style.textTransform,
      tracking,
      mono,
      count: 0,
      samples: [],
    };
    entry.count += 1;
    if (entry.samples.length < SAMPLE_LIMIT && !entry.samples.includes(text)) entry.samples.push(text);
    styleMap.set(key, entry);
    const letters = text.replace(/[^A-Za-z]/g, "");
    const literalCaps = letters.length >= LITERAL_CAPS_MIN_LETTERS && letters === letters.toUpperCase() && !/\d/.test(text);
    // The CERT chip is a deliberate marker, not an uppercase label.
    const certMarker = parent.closest("[data-cert-field], [data-cert-legend]") !== null;
    if (!certMarker && (style.textTransform === "uppercase" || tracking !== "0" || literalCaps)) {
      uppercaseOrTracked.push({ text, key });
    }
  }
  const styles = Array.from(styleMap.values()).sort((a, b) => b.count - a.count);

  /* --------------------------------------------------------------- Lines */
  const lineItems: LineItem[] = [];
  for (const el of all) {
    const style = getComputedStyle(el);
    const top = hasSide(style, "Top");
    const bottom = hasSide(style, "Bottom");
    if (!top && !bottom) continue;
    const box = top && bottom && hasSide(style, "Left") && hasSide(style, "Right");
    if (box) continue; // Cards, markers and control boxes are not rules.
    let allowed: string | null = null;
    if (inControl(el) || el.querySelector(":scope > input, :scope > select, :scope > textarea")) allowed = "control";
    else if (el.parentElement === body && (el === body.firstElementChild || el === body.lastElementChild) && args.kind === "page") allowed = "surface-chrome";
    else if (args.kind === "dialog" && bottom && !top && Math.abs(el.getBoundingClientRect().top - bodyRect.top) <= PX_TOLERANCE * 2) allowed = "dialog-header";
    else if (isFormActionsRow(el) || insideFormActions(el)) allowed = "form-actions";
    else if (el.closest("section[aria-label]") && el.querySelector(":scope > [data-presentation-control]")) allowed = "composition-action-row";
    // design-system.md keeps the hairline between plain FormSection/DetailSection blocks.
    else if (top && !bottom && el.querySelector(`:scope > ${SECTION_TITLE}, :scope > div > ${SECTION_TITLE}`)) allowed = "section-divider";
    const text = clean((el as HTMLElement).innerText);
    if (top) lineItems.push({ side: "top", element: describe(el), text, allowed });
    if (bottom) lineItems.push({ side: "bottom", element: describe(el), text, allowed });
  }

  /* -------------------------------------------------------------- Rhythm */
  const contentRect = (el: Element) => {
    let top = Infinity;
    let bottom = -Infinity;
    const candidates = [el, ...Array.from(el.querySelectorAll("*"))];
    for (const child of candidates) {
      if (!isVisible(child)) continue;
      const style = getComputedStyle(child);
      if (style.position === "absolute" && child.getAttribute("aria-hidden") !== null) continue;
      const leaf = child.children.length === 0 || child.matches(CONTROL_SELECTOR) || child.tagName === "svg";
      if (!leaf) continue;
      const rect = child.getBoundingClientRect();
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    }
    return { top, bottom };
  };

  const titles = Array.from(body.querySelectorAll<HTMLElement>(SECTION_TITLE)).filter(isVisible);
  const sectionRoots: HTMLElement[] = [];
  for (const title of titles) {
    let node: HTMLElement = title;
    while (node.parentElement && node.parentElement !== body) {
      const parent: HTMLElement = node.parentElement;
      const others = Array.from(parent.querySelectorAll(SECTION_TITLE)).filter((h) => !node.contains(h) && isVisible(h));
      // A title that sits directly in its box owns that box, even when the box
      // nests a sub-section title further down (DetailSection "Inventory").
      const ownsBox = node === title && others.every((h) => title.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (others.length > 0 && !ownsBox) break;
      node = parent;
    }
    if (!sectionRoots.includes(node)) sectionRoots.push(node);
  }
  const sectionName = (el: Element) => {
    const title = el.matches(SECTION_TITLE) ? el : el.querySelector(SECTION_TITLE);
    return title ? ownText(title) : describe(el);
  };

  const gaps: GapItem[] = [];
  const round = (value: number) => Math.round(value * 10) / 10;
  // The space above each section: from whatever renders before it to its title row.
  for (const next of sectionRoots) {
    let prev = next.previousElementSibling;
    while (prev && !isVisible(prev)) prev = prev.previousElementSibling;
    if (!prev) continue;
    const a = contentRect(prev);
    const b = contentRect(next);
    if (!Number.isFinite(a.bottom) || !Number.isFinite(b.top)) continue;
    const before = sectionRoots.includes(prev as HTMLElement) ? sectionName(prev) : describe(prev);
    gaps.push({ level: "section", value: round(b.top - a.bottom), between: `${before} → ${sectionName(next)}` });
  }

  interface Field {
    root: HTMLElement;
    label: HTMLElement;
    name: string;
    section: HTMLElement | undefined;
  }
  const fields: Field[] = [];
  const sectionOf = (el: Element) => sectionRoots.find((section) => section.contains(el));
  const FIELD_CONTROL = "input:not([type=hidden]), select, textarea, [role=combobox]";
  const controlAfterLabel = (label: HTMLElement): Element | null => {
    const labelRow = label.parentElement as HTMLElement;
    for (let node = labelRow.parentElement; node && node !== body; node = node.parentElement) {
      const found = Array.from(node.querySelectorAll(FIELD_CONTROL)).find((el) => !labelRow.contains(el) && isVisible(el));
      if (found) return found;
    }
    return null;
  };
  for (const label of Array.from(body.querySelectorAll("label[for]")) as HTMLLabelElement[]) {
    if (!isVisible(label) || label.closest("[data-presentation-control]")) continue;
    // EntitySelect's trigger carries no id, so its label's `for` resolves to
    // nothing; fall back to the nearest control after the label row.
    const control = document.getElementById(label.htmlFor) ?? controlAfterLabel(label);
    if (!control || label.contains(control)) continue;
    let fieldRoot: HTMLElement | null = label.parentElement;
    while (fieldRoot && fieldRoot !== body && !fieldRoot.contains(control)) fieldRoot = fieldRoot.parentElement;
    if (!fieldRoot || fieldRoot === body) continue;
    fields.push({ root: fieldRoot, label, name: ownText(label), section: sectionOf(fieldRoot) });
    const labelRow = label.parentElement as HTMLElement;
    const labelBottom = labelRow.getBoundingClientRect().bottom;
    const firstBelow = Array.from(fieldRoot.querySelectorAll("*")).find((el) => {
      if (labelRow.contains(el) || el.contains(labelRow) || !isVisible(el)) return false;
      return el.getBoundingClientRect().top >= labelBottom - PX_TOLERANCE;
    });
    if (firstBelow) {
      gaps.push({ level: "label", value: round(firstBelow.getBoundingClientRect().top - labelBottom), between: ownText(label) });
    }
  }
  if (args.mode === "read") {
    for (const el of all) {
      const [first, second] = Array.from(el.children);
      if (!first || !second) continue;
      if (first.tagName !== "SPAN" || !first.classList.contains("body-small")) continue;
      if (!second.classList.contains("body-medium")) continue;
      fields.push({ root: el as HTMLElement, label: first as HTMLElement, name: ownText(first), section: sectionOf(el) });
      gaps.push({ level: "read-label", value: round(second.getBoundingClientRect().top - first.getBoundingClientRect().bottom), between: ownText(first) });
    }
  }
  const overlapX = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > PX_TOLERANCE;
  const leafRects = all
    .filter((el) => el.children.length === 0 || el.matches(CONTROL_SELECTOR) || el.tagName === "svg" || el.tagName === "CANVAS")
    .map((el) => ({ el, rect: el.getBoundingClientRect() }));
  // Two fields are neighbours only when nothing else renders in the band between them.
  const somethingBetween = (upper: Field, lower: Field, a: DOMRect, b: DOMRect) =>
    leafRects.some(({ el, rect }) =>
      !upper.root.contains(el) && !lower.root.contains(el) &&
      rect.top >= a.bottom - PX_TOLERANCE && rect.bottom <= b.top + PX_TOLERANCE &&
      overlapX(rect, a.width > b.width ? a : b),
    );
  for (const field of fields) {
    const rect = field.root.getBoundingClientRect();
    let best: { gap: number; name: string } | null = null;
    for (const other of fields) {
      if (other === field || other.section !== field.section) continue;
      if (other.root.contains(field.root) || field.root.contains(other.root)) continue;
      const otherRect = other.root.getBoundingClientRect();
      if (otherRect.top < rect.bottom - PX_TOLERANCE || !overlapX(rect, otherRect)) continue;
      const gap = otherRect.top - rect.bottom;
      if (best && gap >= best.gap) continue;
      if (somethingBetween(field, other, rect, otherRect)) continue;
      best = { gap, name: other.name };
    }
    if (best) gaps.push({ level: "field", value: round(best.gap), between: `${field.name} → ${best.name}` });
  }

  /* ----------------------------------------------------------- Alignment */
  const controlLeftEdges: { section: string; edges: number[] }[] = [];
  const nearMisaligned: { section: string; edges: number[] }[] = [];
  const groups = sectionRoots.length > 0 ? sectionRoots : [body];
  for (const section of groups) {
    const controls = Array.from(section.querySelectorAll("input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea, [role=combobox]"))
      .filter((el) => isVisible(el) && !el.closest("[data-presentation-control]"));
    const edges: number[] = [];
    for (const control of controls) {
      const left = Math.round(control.getBoundingClientRect().left - bodyRect.left);
      if (!edges.some((edge) => Math.abs(edge - left) <= PX_TOLERANCE)) edges.push(left);
    }
    edges.sort((a, b) => a - b);
    if (edges.length === 0) continue;
    controlLeftEdges.push({ section: sectionName(section), edges });
    const close = edges.filter((edge, i) => i > 0 && edge - edges[i - 1] <= NEAR_MISALIGN_MAX_PX);
    if (close.length > 0) nearMisaligned.push({ section: sectionName(section), edges });
  }

  const loneHalfWidth: { field: string; widthRatio: number }[] = [];
  const wrappedLabels: { row: string; labels: string[] }[] = [];
  const formFields = fields.filter((field) => field.label.tagName === "LABEL");
  const rowsSeen = new Set<Field>();
  for (const field of formFields) {
    if (rowsSeen.has(field)) continue;
    const rect = field.root.getBoundingClientRect();
    // The row is this field plus every unrelated field whose top lines up with it.
    const row = formFields.filter((other) => {
      if (other === field) return true;
      if (other.root.contains(field.root) || field.root.contains(other.root)) return false;
      return Math.abs(other.root.getBoundingClientRect().top - rect.top) <= PX_TOLERANCE * 2;
    });
    row.forEach((member) => rowsSeen.add(member));
    // Measure against the first ancestor wider than the field, so a grid cell
    // wrapper around one field does not hide that it spans half the row.
    let container = field.root.parentElement;
    while (container && container !== body && container.getBoundingClientRect().width <= rect.width + PX_TOLERANCE) container = container.parentElement;
    const containerWidth = container?.getBoundingClientRect().width ?? bodyRect.width;
    if (row.length === 1 && containerWidth > 0 && rect.width / containerWidth < HALF_WIDTH_RATIO) {
      loneHalfWidth.push({ field: field.name, widthRatio: round(rect.width / containerWidth) });
    }
    if (row.length > 1) {
      const lines = row.map((member) => {
        const lineHeight = parseFloat(getComputedStyle(member.label).lineHeight) || member.label.getBoundingClientRect().height;
        return Math.round(member.label.getBoundingClientRect().height / lineHeight);
      });
      if (Math.max(...lines) > 1 && Math.min(...lines) === 1) {
        wrappedLabels.push({ row: row.map((member) => member.name).join(" | "), labels: row.filter((_, i) => lines[i] > 1).map((member) => member.name) });
      }
    }
  }

  const orphanedGridItems: { grid: string; columns: number; items: number }[] = [];
  for (const el of all) {
    const style = getComputedStyle(el);
    if (style.display !== "grid" && style.display !== "inline-grid") continue;
    const columns = style.gridTemplateColumns.split(" ").filter((track) => /px$/.test(track)).length;
    if (columns < GRID_ORPHAN_MIN_COLUMNS) continue;
    const firstTrack = parseFloat(style.gridTemplateColumns);
    if (Math.abs(firstTrack - FORM_SPINE_GUTTER_PX) <= PX_TOLERANCE) continue;
    const items = Array.from(el.children).filter(isVisible).length;
    const orphaned = (items > columns && items % columns !== 0) || (items > 0 && items < columns);
    if (orphaned) orphanedGridItems.push({ grid: `${describe(el)} ${clean((el as HTMLElement).innerText).slice(0, GRID_SNIPPET)}`, columns, items });
  }

  /* ------------------------------------------------------------ Overflow */
  const clipped: { element: string; text: string }[] = [];
  const tooWide: { element: string; overflowPx: number }[] = [];
  const innerScrollers: { element: string; scrollWidth: number; clientWidth: number }[] = [];
  const insideScroller = (el: Element) => {
    let node = el.parentElement;
    while (node && node !== body) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
      node = node.parentElement;
    }
    return false;
  };
  for (const el of all) {
    const style = getComputedStyle(el);
    const html = el as HTMLElement;
    if ((style.overflowX === "auto" || style.overflowX === "scroll") && html.scrollWidth > html.clientWidth + PX_TOLERANCE) {
      innerScrollers.push({ element: describe(el), scrollWidth: html.scrollWidth, clientWidth: html.clientWidth });
    }
    const clipsText = style.overflowX === "hidden" || style.overflow === "hidden" || style.textOverflow === "ellipsis";
    if (clipsText && html.scrollWidth > html.clientWidth + PX_TOLERANCE && clean(html.innerText) && !el.matches("input, select, textarea")) {
      clipped.push({ element: describe(el), text: clean(html.innerText) });
    }
    if (insideScroller(el)) continue;
    const rect = el.getBoundingClientRect();
    const over = Math.max(rect.right - bodyRect.right, bodyRect.left - rect.left);
    if (over > PX_TOLERANCE && getComputedStyle(el).position !== "fixed") tooWide.push({ element: describe(el), overflowPx: round(over) });
  }

  /* --------------------------------------------------------------- Prose */
  // A FormField `cue` is the visible helper caption since explanations moved to the ⓘ.
  const helpers = all.filter((el) => el.matches("p[id$='-helper'], p[id$='-cue']"));
  const paragraphs = all.filter((el) => el.tagName === "P" && !el.matches("[id$='-helper'], [id$='-cue'], [id$='-error'], [role=alert]") && !inControl(el) && !insideFormActions(el) && clean(el.textContent).length >= MIN_PARAGRAPH_CHARS);
  const proseSamples = [...helpers, ...paragraphs].slice(0, SAMPLE_LIMIT * 2).map((el) => clean(el.textContent));

  /* ------------------------------------------------------ R1 inventories */
  // Explanation blocks carry data-detail-explanation (DetailedOnly,
  // CompositionCard and MoistureSplit detail regions); R1 lets only those differ.
  const EXPLANATION = "[data-detail-explanation]";
  const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
  const explained = (el: Element) => Boolean(el.closest(EXPLANATION));
  const labelEls: Element[] = [
    ...all.filter((el) => (el.tagName === "LABEL" || el.tagName === "LEGEND") && !el.closest("[data-presentation-control]")),
    ...fields.filter((field) => field.label.tagName !== "LABEL").map((field) => field.label),
  ];
  const titleEls = all.filter((el) => /^H[1-6]$/.test(el.tagName) || el.matches("section[aria-label], [role=region][aria-label]"));
  const titleText = (el: Element) => (/^H[1-6]$/.test(el.tagName) ? ownText(el) : clean(el.getAttribute("aria-label")));
  const actionEls = all.filter((el) => el.matches("button, a[href], [role=button]") && !el.closest("[data-presentation-control]:not(button)") && !el.matches("[data-presentation-control]:not(button)"));
  const actionText = (el: Element) => clean(el.getAttribute("aria-label") || (el as HTMLElement).innerText);
  const labels = unique(labelEls.filter((el) => !explained(el)).map(ownText));
  const sectionTitles = unique(titleEls.filter((el) => !explained(el)).map(titleText));
  const actions = unique(actionEls.filter((el) => !explained(el)).map(actionText));
  const explanation = unique([
    ...labelEls.filter(explained).map(ownText),
    ...titleEls.filter(explained).map(titleText),
    ...actionEls.filter(explained).map(actionText),
  ]);

  const html = document.documentElement;
  return {
    body: { width: Math.round(bodyRect.width), clientHeight: body.clientHeight, scrollHeight: body.scrollHeight },
    textStyles: { count: styles.length, styles, uppercaseOrTracked: uppercaseOrTracked.slice(0, SAMPLE_LIMIT * 4) },
    lines: { items: lineItems, violations: lineItems.filter((item) => item.allowed === null).length },
    rhythm: { gaps },
    alignment: { controlLeftEdges, nearMisaligned, loneHalfWidth, orphanedGridItems, wrappedLabels },
    overflow: {
      bodyHorizontalScroll: body.scrollWidth > body.clientWidth + PX_TOLERANCE,
      pageHorizontalScroll: html.scrollWidth > window.innerWidth + PX_TOLERANCE,
      clipped: clipped.slice(0, SAMPLE_LIMIT * 4),
      tooWide: tooWide.slice(0, SAMPLE_LIMIT * 4),
      innerScrollers,
    },
    prose: { helperCaptions: helpers.length, paragraphs: paragraphs.length, samples: proseSamples },
    r1: { labels, sectionTitles, actions, explanation },
  };
}
