import { describe, expect, it, vi } from "vitest";
import { RowActionsMenu } from "./index";

describe("RowActionsMenu", () => {
  it("stops menu trigger interaction from bubbling to its clickable row or card", () => {
    const stopPropagation = vi.fn();
    const view = RowActionsMenu({ label: "Actions for test", actions: [] });

    view.props.onClick({ stopPropagation });

    expect(stopPropagation).toHaveBeenCalledOnce();
  });
});
