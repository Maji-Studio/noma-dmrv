"use client";

/**
 * TripTypeChoice: the one trip type control shared by the transport leg,
 * feedstock and delivery record forms. The organization default in settings
 * stays a plain select: it is a default, not a per-record consequence. Return doubles the
 * distance in emissions accounting, so the consequence is the visible caption
 * on each card, with a small route drawing beside it.
 */

import { forwardRef, type SVGProps } from "react";
import type { TripTypeValue } from "@/schemas/trip-type";
import {
  ChoiceCardGroup,
  type ChoiceCardGroupProps,
  type ChoiceCardOption,
} from "./choice-card-group";

const ART_WIDTH = 44;
const ART_HEIGHT = 30;

function RouteArt(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={ART_WIDTH}
      height={ART_HEIGHT}
      viewBox="0 0 48 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    />
  );
}

/** Origin and destination with a single arrow between them. */
function OneWayArt() {
  return (
    <RouteArt>
      <rect x="3" y="11" width="8" height="10" />
      <circle cx="42" cy="16" r="3" />
      <path d="M13 16 H37" />
      <path d="M33.5 12.5 L37.5 16 L33.5 19.5" />
    </RouteArt>
  );
}

/** Out along the top, back along the bottom (dashed: empty truck). */
function ReturnArt() {
  return (
    <RouteArt>
      <rect x="3" y="11" width="8" height="10" />
      <circle cx="42" cy="16" r="3" />
      <path d="M13 12 C22 4 30 4 38 12" />
      <path d="M34.5 8.8 L38.3 12.2 L33.6 13" />
      <path d="M38 20 C30 28 22 28 13 20" strokeDasharray="2.5 3" />
      <path d="M16.6 23.4 L13 20 L17.7 19.2" />
    </RouteArt>
  );
}

const TRIP_TYPE_CARDS: readonly (ChoiceCardOption & { value: TripTypeValue })[] = [
  {
    value: "return",
    title: "Return",
    description: "Distance counts twice.",
    art: <ReturnArt />,
  },
  {
    value: "one_way",
    title: "One-way",
    description: "Distance counts once.",
    art: <OneWayArt />,
  },
];

type TripTypeChoiceProps = Omit<ChoiceCardGroupProps, "options" | "legend">;

export const TripTypeChoice = forwardRef<HTMLInputElement, TripTypeChoiceProps>(
  (props, ref) => (
    <ChoiceCardGroup ref={ref} legend="Trip type" options={TRIP_TYPE_CARDS} {...props} />
  ),
);

TripTypeChoice.displayName = "TripTypeChoice";
