import type { ReactNode } from "react";

export function MultilineDetail({ children }: { children: ReactNode }) {
  if (typeof children !== "string" || !children.includes("\n")) return children;
  const [lead, ...lines] = children.split("\n");
  return (
    <>
      {lead}
      <ul className="list-disc pl-16">
        {lines.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
    </>
  );
}
