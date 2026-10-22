// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlideOverPanel } from "./index";

afterEach(cleanup);

describe("SlideOverPanel.FooterClose", () => {
  it("renders an outline Close that closes the sheet", () => {
    const onOpenChange = vi.fn();
    render(
      <SlideOverPanel.Root open onOpenChange={onOpenChange}>
        <SlideOverPanel.Content>
          <SlideOverPanel.Title>FS-1</SlideOverPanel.Title>
          <SlideOverPanel.Footer>
            <SlideOverPanel.FooterClose />
          </SlideOverPanel.Footer>
        </SlideOverPanel.Content>
      </SlideOverPanel.Root>,
    );

    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    const footerClose = closeButtons.find((button) => button.textContent === "Close");
    expect(footerClose).toBeDefined();
    fireEvent.click(footerClose!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
