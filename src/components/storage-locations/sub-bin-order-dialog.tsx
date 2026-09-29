/**
 * The Change dialog for a split-bin draw: tick the sub-bins the load came
 * from and put them in the order they were emptied. Drag a row by its grip,
 * or use the arrow buttons from the keyboard or on touch. Readings are not
 * entered here; they stay on the form, one row per sub-bin the load reaches.
 */
"use client";

import { ArrowDownIcon, ArrowUpIcon, DotsSixVerticalIcon } from "@phosphor-icons/react/dist/ssr";
import { useId, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { formatFacilityDateTime } from "@/lib/format-utils";
import { moveSubBin } from "@/lib/output-stock/sub-bin-draw";
import type { OutputSubBin } from "@/types/output-stock";
import { SubBinInfo, subBinMoistureText, subBinWetText } from "./sub-bin-card";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** All sub-bins in the bin, oldest first. */
  subBins: OutputSubBin[];
  /** Null means oldest first, every sub-bin ticked. */
  order: string[] | null;
  onApply: (order: string[] | null) => void;
  timeZone: string;
}

/** Oldest first is every sub-bin ticked in its original order; anything else is the operator's order. */
function isOldestFirst(order: readonly string[], subBins: readonly OutputSubBin[]) {
  return order.length === subBins.length && order.every((id, index) => id === subBins[index].layerId);
}

export function SubBinOrderDialog({ isOpen, onClose, subBins, order, onApply, timeZone }: Props) {
  const titleId = useId();
  const [draft, setDraft] = useState<string[]>([]);
  const [dragged, setDragged] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const ticked = draft.flatMap(id => subBins.find(s => s.layerId === id) ?? []);
  const unticked = subBins.filter(s => !draft.includes(s.layerId));
  const codeOf = (id: string) => subBins.find(s => s.layerId === id)?.code ?? id;
  const controlId = (control: "tick" | "up" | "down", layerId: string) => `${titleId}-${control}-${layerId}`;
  // A row that moves between the lists, or an arrow that becomes disabled at
  // an end, loses focus; put it back on the same row once React has rendered.
  const refocus = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());
  const move = (id: string, step: -1 | 1 | { to: number }) => {
    const next = moveSubBin(draft, id, step);
    const index = next.indexOf(id);
    setDraft(next);
    setAnnouncement(`${codeOf(id)} is now number ${index + 1} of ${next.length}.`);
    if (typeof step === "number") refocus(controlId(index === 0 ? "down" : index === next.length - 1 ? "up" : step === -1 ? "up" : "down", id));
  };
  const toggle = (id: string) => {
    const adding = !draft.includes(id);
    const next = adding ? [...draft, id] : draft.filter(d => d !== id);
    setDraft(next);
    setAnnouncement(adding ? `${codeOf(id)} added to the load as number ${next.length}.` : `${codeOf(id)} taken out of the load.`);
    refocus(controlId("tick", id));
  };
  const apply = () => {
    onApply(isOldestFirst(draft, subBins) ? null : draft);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      // Only sub-bins held at the entry's time: an earlier time can hide some of the saved order.
      onOpen={() => { setDraft(order?.filter(id => subBins.some(s => s.layerId === id)) ?? subBins.map(s => s.layerId)); setAnnouncement(""); }}
      ariaLabelledBy={titleId}
      width="md"
      dismissOnClickOutside={false}
    >
      <div className="space-y-16">
        <h2 id={titleId} className="body-large font-medium">Sub-bins in this load</h2>
        <p className="body-small text-[var(--color-text-secondary)]">
          Tick the sub-bins the load came from and put them in the order they were emptied.
        </p>
        <ol aria-label="Sub-bins in the load, in the order they were emptied" className="space-y-8">
          {ticked.map((subBin, index) => (
            <li
              key={subBin.layerId}
              onDragOver={(event) => { if (dragged) event.preventDefault(); }}
              onDrop={(event) => { event.preventDefault(); if (dragged) move(dragged, { to: index }); setDragged(null); }}
              className={`flex items-center gap-8 border px-8 py-6 ${dragged === subBin.layerId ? "opacity-40" : ""} border-[var(--color-interaction)] bg-[var(--panel-bg)]`}
            >
              <span
                draggable
                onDragStart={(event) => { setDragged(subBin.layerId); event.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => setDragged(null)}
                aria-hidden="true"
                className="cursor-grab text-[var(--color-text-tertiary)]"
              >
                <DotsSixVerticalIcon size={16} weight="bold" />
              </span>
              <span aria-hidden="true" className="inline-flex size-24 shrink-0 items-center justify-center border border-[var(--color-interaction)] body-caption tabular-nums">
                {index + 1}
              </span>
              <SubBinChoice id={controlId("tick", subBin.layerId)} subBin={subBin} checked onToggle={toggle} timeZone={timeZone} />
              <SubBinInfo subBin={subBin} timeZone={timeZone} />
              <Button id={controlId("up", subBin.layerId)} type="button" size="icon" variant="noOutline" aria-label={`Move ${subBin.code} up`} disabled={index === 0} onClick={() => move(subBin.layerId, -1)}>
                <ArrowUpIcon size={14} weight="bold" />
              </Button>
              <Button id={controlId("down", subBin.layerId)} type="button" size="icon" variant="noOutline" aria-label={`Move ${subBin.code} down`} disabled={index === ticked.length - 1} onClick={() => move(subBin.layerId, 1)}>
                <ArrowDownIcon size={14} weight="bold" />
              </Button>
            </li>
          ))}
        </ol>
        {unticked.length > 0 && (
          <ul aria-label="Sub-bins not in the load" className="space-y-8">
            {unticked.map((subBin) => (
              <li key={subBin.layerId} className="flex items-center gap-8 border border-[var(--color-border-primary)] px-8 py-6">
                <span aria-hidden="true" className="inline-flex size-24 shrink-0" />
                <span aria-hidden="true" className="inline-flex size-24 shrink-0" />
                <SubBinChoice id={controlId("tick", subBin.layerId)} subBin={subBin} checked={false} onToggle={toggle} timeZone={timeZone} />
                <SubBinInfo subBin={subBin} timeZone={timeZone} />
                <span aria-hidden="true" className="inline-flex w-[72px] shrink-0" />
              </li>
            ))}
          </ul>
        )}
        {draft.length === 0 && <p role="alert" className="body-caption text-[var(--color-status-error)]">Tick at least one sub-bin.</p>}
        <p aria-live="polite" className="sr-only">{announcement}</p>
        <div className="flex flex-wrap items-center justify-between gap-8">
          <Button type="button" variant="noOutline" disabled={isOldestFirst(draft, subBins)} onClick={() => { setDraft(subBins.map(s => s.layerId)); setAnnouncement("Every sub-bin is back in the load, oldest first."); }}>Reset to oldest first</Button>
          <div className="flex gap-8">
            <Button type="button" variant="weak" onClick={onClose}>Cancel</Button>
            <Button type="button" variant="primary" disabled={draft.length === 0} onClick={apply}>Use this order</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** The part of a row that ticks it: the checkbox and the sub-bin's figures, wet first. */
function SubBinChoice({ id, subBin, checked, onToggle, timeZone }: { id: string; subBin: OutputSubBin; checked: boolean; onToggle: (id: string) => void; timeZone: string }) {
  return (
    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-8">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(subBin.layerId)}
        className="h-[18px] w-[18px] shrink-0 accent-[var(--clr-dark-purple)] cursor-pointer"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-8">
          <span className="body-small font-medium">{subBin.code}</span>
          <span className="body-small tabular-nums">{subBinWetText(subBin)}</span>
          <span className="body-caption text-[var(--color-text-secondary)] tabular-nums">{subBinMoistureText(subBin)} moisture</span>
        </span>
        <span className="block body-caption text-[var(--color-text-tertiary)] tabular-nums">Added {formatFacilityDateTime(subBin.placedAt, timeZone)}</span>
      </span>
    </label>
  );
}
