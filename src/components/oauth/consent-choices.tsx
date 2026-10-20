"use client";

import { ChoiceCardGroup, type ChoiceCardOption } from "@/components/forms/choice-card-group";

export type ConsentPreset = "read" | "write" | "custom";

/** The three first-consent choices. Read and write is left out when the request offers no write. */
export function ConsentChoices({ clientName, readAreas, writeAreas, value, onChange, disabled }: {
  clientName: string;
  readAreas: number;
  writeAreas: number;
  value: ConsentPreset;
  onChange: (value: ConsentPreset) => void;
  disabled: boolean;
}) {
  const options: ChoiceCardOption[] = [
    { value: "read", title: "Read only", description: `${clientName} can look up records in ${readAreas === 1 ? "1 area" : `all ${readAreas} areas`}. It cannot change anything.` },
    ...(writeAreas > 0 ? [{ value: "write", title: "Read and write", description: `${clientName} can also create and change records in ${writeAreas} ${writeAreas === 1 ? "area" : "areas"}. It never deletes.` }] : []),
    { value: "custom", title: "Choose per area", description: "Pick what it can read and write in each area." },
  ];
  return <ChoiceCardGroup legend={`What ${clientName} can do`} options={options} value={value} disabled={disabled}
    onValueChange={(next) => onChange(next as ConsentPreset)} />;
}
