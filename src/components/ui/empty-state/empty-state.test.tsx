// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { EmptyState } from "./empty-state";

afterEach(cleanup);

it.each([
  ["sm", "body-lead"],
  ["md", "title-heading-3"],
  ["lg", "title-heading-3"],
] as const)("renders the %s tier title as %s", (padding, cls) => {
  render(<EmptyState icon={<span />} title="Nothing" padding={padding} />);
  expect(screen.getByRole("heading", { name: "Nothing" }).className).toContain(cls);
});
