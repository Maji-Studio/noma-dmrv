"use client";

/**
 * Throwaway: the "Platform Admin view" toggle for prototype variants A, B and
 * D. Kept in `?as=` so the sidebar chrome follows it too. Drawn with a dashed
 * border so it never reads as product UI.
 */
import { SegmentedControl } from "@/components/forms";
import {
  VIEWER_PARAM,
  viewerFromParam,
  type PrototypeViewer,
} from "./abd-fixtures";
import { useSettingsPrototypeParam } from "./use-settings-prototype-variant";

const OPTIONS = [
  { value: "member", label: "Owner" },
  { value: "platform-admin", label: "Platform Admin" },
] as const;

export function usePrototypeViewer(): [
  PrototypeViewer,
  (viewer: PrototypeViewer) => void,
] {
  const [value, set] = useSettingsPrototypeParam(VIEWER_PARAM);
  return [
    viewerFromParam(value),
    (viewer) => set(viewer === "member" ? null : viewer),
  ];
}

export function PrototypeViewerToggle() {
  const [viewer, setViewer] = usePrototypeViewer();
  return (
    <div className="flex flex-wrap items-center gap-8 border border-dashed border-[var(--color-border-secondary)] px-8 py-4">
      <span className="body-caption text-[var(--color-text-tertiary)]">
        Prototype: view as
      </span>
      <SegmentedControl
        legend="Prototype: view as"
        options={OPTIONS}
        value={viewer}
        onValueChange={(next) => setViewer(viewerFromParam(next))}
        className="min-w-[240px]"
      />
    </div>
  );
}
