/** The settings index opens General and preserves the working facility. */
import { describe, expect, it, vi } from "vitest";
import SettingsIndexPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const params = (value: Record<string, string>) => ({ searchParams: Promise.resolve(value) });

describe("settings redirects", () => {
  it("opens /settings on General", async () => {
    await expect(SettingsIndexPage(params({}))).rejects.toThrow("redirect:/settings/general");
    await expect(SettingsIndexPage(params({ facility: "f" }))).rejects.toThrow("redirect:/settings/general?facility=f");
  });
});
