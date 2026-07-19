import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { ListPagination } from "./index";

type ElementProps = Record<string, unknown> & { children?: ReactNode };

function findElements(node: ReactNode, predicate: (element: ReactElement<ElementProps>) => boolean) {
  const matches: ReactElement<ElementProps>[] = [];

  function visit(child: ReactNode) {
    if (!isValidElement<ElementProps>(child)) return;
    if (predicate(child)) matches.push(child);
    const children = child.props.children;
    if (Array.isArray(children)) children.forEach(visit);
    else visit(children);
  }

  visit(node);
  return matches;
}

function renderPagination(page: number, pageCount: number) {
  return ListPagination({
    page,
    pageCount,
    pageSize: 10,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
  });
}

describe("ListPagination", () => {
  it("renders the shared rows-per-page and current-page contract", () => {
    const html = renderToStaticMarkup(renderPagination(2, 4));

    expect(html).toContain("Rows per page:");
    expect(html).toContain('aria-label="Rows per page"');
    expect(html).toContain('<option value="10" selected="">10</option>');
    expect(html).toContain("Page 2 of 4");
  });

  it("disables backward controls on the first page and forward controls on the last", () => {
    const firstPageButtons = findElements(
      renderPagination(1, 3),
      (element) => element.type === Button,
    );
    const lastPageButtons = findElements(
      renderPagination(3, 3),
      (element) => element.type === Button,
    );

    expect(firstPageButtons.map((button) => button.props.disabled)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(lastPageButtons.map((button) => button.props.disabled)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("routes all four navigation controls to the correct one-based page", () => {
    const onPageChange = vi.fn();
    const view = ListPagination({
      page: 2,
      pageCount: 4,
      pageSize: 10,
      onPageChange,
      onPageSizeChange: vi.fn(),
    });
    const buttons = findElements(view, (element) => element.type === Button);

    buttons.forEach((button) => {
      (button.props.onClick as () => void)();
    });

    expect(onPageChange.mock.calls.map(([page]) => page)).toEqual([1, 1, 3, 4]);
  });
});
