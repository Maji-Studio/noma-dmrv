import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ICON_BUTTON_HIT_AREA } from "@/components/ui/touch-target";
import { RowActionsMenu } from "./index";

describe("RowActionsMenu", () => {
  it("stops menu trigger interaction from bubbling to its clickable row or card", () => {
    const stopPropagation = vi.fn();
    const view = RowActionsMenu({ label: "Actions for test", actions: [] });

    view.props.onClick({ stopPropagation });

    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("gives the trigger a 32px width and a 44px hit area", () => {
    const html = renderToStaticMarkup(<RowActionsMenu label="Actions for test" actions={[]} />);

    for (const cls of ICON_BUTTON_HIT_AREA.split(" ")) {
      expect(html.replaceAll("&#x27;", "'")).toContain(cls);
    }
  });
});
