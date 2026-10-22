import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityFeed } from "./activity-feed";

const TIME_ZONE = "Africa/Dar_es_Salaam";

describe("dashboard activity dates", () => {
  it("uses the facility day for physical instants", () => {
    const activity = [{ id: "delivery-1", title: "Delivery", code: "DL-1", href: "/deliveries", dateIso: "2026-10-21T21:30:00Z" }];
    const markup = renderToStaticMarkup(<ActivityFeed activity={activity} timeZone={TIME_ZONE} />);
    expect(markup).toContain("Oct 22, 2026");
  });
  it("keeps a business date on its persisted calendar", () => {
    const activity = [{ id: "feedstock-1", title: "Feedstock", code: "FS-1", href: "/feedstocks", dateIso: "2026-10-21T00:00:00Z", calendarDay: true }];
    expect(renderToStaticMarkup(<ActivityFeed activity={activity} timeZone="America/Los_Angeles" />)).toContain("Oct 21, 2026");
  });
});
