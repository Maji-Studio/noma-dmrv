/**
 * The stage band: the landscape scene as a short band, with six columns laid
 * over it. Each column is a stage's cell: name and icon, the counted figure,
 * the open-items bubble, then its record actions in their own strip under a
 * hairline. Hovering or focusing a column lights its ground lot in the scene
 * and its cells together (stage-scene.css); nothing covers the drawing.
 *
 * Below md there is no art: one stage per row with its actions.
 * Each stage link and its action links are siblings, never one inside the other.
 */
"use client";

import type { CSSProperties } from "react";
import type { DashboardOverview } from "@/data-access/dashboard-overview";
import { cn } from "@/lib/utils";
import { ABOVE_STAGE_LINK, StageText } from "./stage-cell";
import { StageActionStack, stageActions } from "./flow-actions";
import { CROP, Scene } from "./scene-landscape";
import { SCENE_GEOMETRY } from "./scene-landscape-kit";
import type { QuickAction } from "./shared";
import "./stage-scene.css";

const { bayPitch: PITCH, leftInset: LEFT, rightInset: RIGHT } = SCENE_GEOMETRY;
const BAY_COUNT = 6;

/** The strip runs edge to edge: the outer cells take the scene's side margins. */
function columnUnits(index: number): number {
  if (index === 0) return LEFT + PITCH;
  if (index === BAY_COUNT - 1) return PITCH + RIGHT;
  return PITCH;
}
const COLUMN_TEMPLATE = Array.from({ length: BAY_COUNT }, (_, index) => `${columnUnits(index)}fr`).join(" ");

/** The cell tint: hovering or focusing anywhere in a stage lights its cell. */
const COLUMN_TINT =
  "transition-colors group-hover/col:bg-[var(--clr-purple-10)] group-focus-within/col:bg-[var(--clr-purple-10)]";
const GRID_STYLE: CSSProperties = { gridTemplateColumns: COLUMN_TEMPLATE };
const HAIRLINE = "border-[var(--color-border-tertiary)]";

interface BandProps {
  data: DashboardOverview;
  actions: QuickAction[];
}

export function StageBand({ data, actions }: BandProps) {
  return (
    <>
      <div className="hidden md:block">
        <SceneWithCells data={data} actions={actions} />
      </div>
      <PhoneCells data={data} actions={actions} />
    </>
  );
}

/** The scene behind; per column the bay, the stage words, then its actions. */
function SceneWithCells({ data, actions }: BandProps) {
  return (
    <div className="stage-band relative">
      <div className="absolute inset-x-0 top-0">
        <Scene />
      </div>
      <ol className="relative grid" style={GRID_STYLE}>
        {data.stations.map((station, index) => (
          <li key={station.key} data-stage={station.key} className="group/col relative flex min-w-0 flex-col">
            {/* The bay: transparent over the scene; the scene answers the hover itself. */}
            <span className="block" style={{ aspectRatio: `${columnUnits(index)} / ${CROP.height}` }} aria-hidden />
            <span className={cn("border-t px-16 pb-12 pt-16", HAIRLINE, COLUMN_TINT, index > 0 && "border-l")}>
              <StageText station={station} />
            </span>
            <div className={cn("flex-1 border-t px-12 pb-16 pt-12", HAIRLINE, COLUMN_TINT, index > 0 && "border-l")}>
              <StageActionStack actions={stageActions(actions, station.key)} className={ABOVE_STAGE_LINK} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Phone: one stage per row, so its actions get the full width and their labels stay on one line. */
function PhoneCells({ data, actions }: BandProps) {
  return (
    <ol className="flex flex-col md:hidden">
      {data.stations.map((station, index) => {
        const own = stageActions(actions, station.key);
        return (
          <li
            key={station.key}
            className={cn(
              "relative flex flex-col gap-12 p-16 hover:bg-[var(--color-surface-medium)]",
              index > 0 && cn("border-t", HAIRLINE),
            )}
          >
            <StageText station={station} />
            {own.length > 0 && <StageActionStack actions={own} className={ABOVE_STAGE_LINK} />}
          </li>
        );
      })}
    </ol>
  );
}
