import type { Page } from "@playwright/test";
import type { MeasureArgs } from "./form-geometry";

const TEMPORAL_INPUT_SELECTOR = 'input[type="date"], input[type="time"], input[type="datetime-local"]';
const PICKER_SHADOW_ID = "picker";
const QUAD_COORDINATE_PAIRS = 2;

interface ShadowNode {
  nodeId: number;
  backendNodeId: number;
  attributes?: string[];
  children?: ShadowNode[];
  shadowRoots?: ShadowNode[];
}

function findPicker(node: ShadowNode): ShadowNode | undefined {
  const attributes = node.attributes ?? [];
  const idIndex = attributes.indexOf("id");
  if (idIndex >= 0 && attributes[idIndex + 1] === PICKER_SHADOW_ID) return node;
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
    const picker = findPicker(child);
    if (picker) return picker;
  }
}

/** DOM APIs cannot measure UA shadow parts. Read their real content quads,
 * not getComputedStyle(input, pseudo), which can return the host's style.
 * The visual harness uses Chromium; Safari's platform picker needs manual QA.
 */
export async function measureNativePickerIcons(page: Page): Promise<NonNullable<MeasureArgs["nativePickerIcons"]>> {
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-capture-root]" });
    const { nodeIds } = await session.send("DOM.querySelectorAll", { nodeId, selector: TEMPORAL_INPUT_SELECTOR });
    const icons: NonNullable<MeasureArgs["nativePickerIcons"]> = [];
    for (const [index, inputId] of nodeIds.entries()) {
      const { node } = await session.send("DOM.describeNode", { nodeId: inputId, depth: -1, pierce: true });
      const picker = findPicker(node);
      let right: number | null = null;
      if (picker) {
        // Hidden/disabled native parts may have no layout box.
        const box = await session.send("DOM.getBoxModel", { backendNodeId: picker.backendNodeId }).catch(() => null);
        if (box && box.model.width > 0 && box.model.height > 0) {
          right = Math.max(...box.model.content.filter((_, coordinate) => coordinate % QUAD_COORDINATE_PAIRS === 0));
        }
      }
      icons.push({ index, right });
    }
    return icons;
  } finally {
    await session.detach();
  }
}
