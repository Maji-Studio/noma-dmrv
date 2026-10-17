/**
 * ProtocolsInUse — read-only list of the Isometric protocol and modules noma
 * is built against. The pin lives in `docs/isometric/versions.json`; nothing
 * here is stored per project or editable.
 */
"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import { ISOMETRIC_PROTOCOL_PINS } from "@/config/isometric-protocols";

export function ProtocolsInUse() {
  return (
    <div className="flex flex-col gap-12 border-t-[1px] border-[var(--clr-dark-purple-10)] pt-16">
      <div className="flex flex-col gap-4">
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Protocols in use
        </p>
        <p className="body-small text-[var(--color-text-secondary)]">
          noma is built against these Isometric versions. They are fixed in the
          app and the same for every facility.
        </p>
      </div>
      <ul className="flex flex-col">
        {ISOMETRIC_PROTOCOL_PINS.map((pin) => (
          <li
            key={pin.slug}
            className="flex items-baseline justify-between gap-16 border-b-[1px] border-[var(--clr-dark-purple-10)] py-8 last:border-b-0"
          >
            <span className="flex flex-col">
              <span className="body-medium text-[var(--color-text-primary)]">
                {pin.name}
              </span>
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {pin.kind === "protocol" ? "Protocol" : "Module"}
              </span>
            </span>
            <span className="flex items-center gap-12">
              <span className="body-small text-[var(--color-text-primary)]">
                v{pin.version}
              </span>
              {pin.registryUrl && (
                <a
                  href={pin.registryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="body-small inline-flex items-center gap-4 underline"
                  aria-label={`${pin.name} on the Isometric registry`}
                >
                  Registry
                  <ArrowSquareOutIcon size={14} aria-hidden />
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
