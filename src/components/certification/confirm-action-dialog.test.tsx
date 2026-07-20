import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui";
import { ConfirmActionDialog } from "./confirm-action-dialog";

type ElementProps = Record<string, unknown> & { children?: ReactNode };

function findButtons(node: ReactNode): ReactElement<ElementProps>[] {
  const matches: ReactElement<ElementProps>[] = [];

  function visit(child: ReactNode) {
    if (!isValidElement<ElementProps>(child)) return;
    if (child.type === Button) matches.push(child);
    const children = child.props.children;
    if (Array.isArray(children)) children.forEach(visit);
    else visit(children);
  }

  visit(node);
  return matches;
}

describe("ConfirmActionDialog", () => {
  it("renders reversible confirmations with the neutral outline treatment", () => {
    const view = ConfirmActionDialog({
      isOpen: true,
      onClose: vi.fn(),
      onConfirm: vi.fn(),
      title: "Unlink Isometric project",
      body: "Past submissions stay on Isometric.",
      confirmLabel: "Unlink",
      variant: "neutral",
    });

    const confirmButton = findButtons(view)[1];

    expect(confirmButton?.props.variant).toBe("default");
    expect(confirmButton?.props.className).toBeUndefined();
  });
});
