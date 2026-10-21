/**
 * The organization's view of the Platform Admin API access switch (Q7): one
 * read-only line on Settings, Developers. When it is off, API keys and
 * connected apps cannot act for the organization, whatever their permissions.
 */
import { CheckCircleIcon, ProhibitIcon } from "@phosphor-icons/react/dist/ssr";

export const API_ACCESS_ON_TEXT = "On";
export const API_ACCESS_OFF_TEXT = "Off, set by noma";

export function ApiAccessLine({ enabled }: { enabled: boolean }) {
  const Icon = enabled ? CheckCircleIcon : ProhibitIcon;
  return (
    <p className="body-medium flex items-center gap-8">
      <Icon
        size={16}
        weight="fill"
        aria-hidden
        className={enabled ? "shrink-0 text-[var(--st-ok)]" : "shrink-0 text-[var(--st-off)]"}
      />
      <span>
        API access: <span className="font-medium">{enabled ? API_ACCESS_ON_TEXT : API_ACCESS_OFF_TEXT}</span>
      </span>
    </p>
  );
}
