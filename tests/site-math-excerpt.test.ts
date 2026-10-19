/**
 * The marketing site's /why page quotes app calculations verbatim, with line
 * numbers and a worked example each (site/src/components/site/why/
 * math-excerpts.json, shown by MathExcerpt.astro). The site is a separate
 * package and cannot import the app, so this guard compares each excerpt
 * against the real source text and recomputes its example.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeCo2eStoredTonnes,
  computeFDurable200,
} from "@/lib/calculations/biochar-removal";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { countedRoundTripKm } from "@/lib/calculations/round-trip";

const ROOT = resolve(__dirname, "..");
const EXCERPTS_PATH = resolve(
  ROOT,
  "site/src/components/site/why/math-excerpts.json",
);

interface Excerpt {
  title: string;
  file: string;
  firstLine: number;
  hit: number;
  lines: string[];
  example: [before: string, figure: string, after: string];
}

const excerpts = JSON.parse(readFileSync(EXCERPTS_PATH, "utf8")) as Excerpt[];

const durable = computeFDurable200({ soilTemperatureC: 20, hToCorgRatio: 0.3 });

/** Each example's bold figure, recomputed with the quoted function. */
const EXAMPLE_FIGURES: Record<string, string> = {
  "Dry mass": `${deriveMassDryKg(1000, 15)} kg dry`,
  "Round trip": `${countedRoundTripKm(30)} km`,
  "Durable fraction": `an F_durable of ${durable.fDurable.toFixed(3)}`,
  "CO₂e stored": `${computeCo2eStoredTonnes({
    organicCarbonPercent: 50,
    dryMassTonnes: 0.4,
    fDurable: durable.fDurable,
  }).toFixed(2)} t CO₂e`,
};

describe("site /why MathExcerpt", () => {
  it("has an example check for every excerpt", () => {
    expect(excerpts.map((x) => x.title).sort()).toEqual(
      Object.keys(EXAMPLE_FIGURES).sort(),
    );
  });

  describe.each(excerpts)("$title", (excerpt) => {
    const source = readFileSync(resolve(ROOT, excerpt.file), "utf8").split("\n");

    it("quotes the source verbatim at its line numbers", () => {
      const start = excerpt.firstLine - 1;
      expect(excerpt.lines).toEqual(
        source.slice(start, start + excerpt.lines.length),
      );
    });

    it("highlights a line of the excerpt", () => {
      expect(excerpt.lines[excerpt.hit]?.trim()).toBeTruthy();
    });

    it("states the figure the function returns", () => {
      expect(excerpt.example[1]).toBe(EXAMPLE_FIGURES[excerpt.title]);
    });
  });
});
