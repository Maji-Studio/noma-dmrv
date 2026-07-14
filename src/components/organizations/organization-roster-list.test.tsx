import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  OrganizationRosterList,
  OrganizationRosterRow,
} from "./organization-roster-list";

describe("OrganizationRosterList", () => {
  it("preserves semantic rows, accessible actions, and nested details", () => {
    const html = renderToStaticMarkup(
      <OrganizationRosterList>
        <OrganizationRosterRow
          primary="Member"
          secondary="member@example.com"
          actions={<select aria-label="Role for member@example.com" />}
        />
        <OrganizationRosterRow
          primary="Organization"
          secondary="organization-slug"
          actions={<button type="button">Enter</button>}
          details={<section>Credential settings</section>}
        />
      </OrganizationRosterList>,
    );

    expect(html).toContain("<ul");
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Role for member@example.com"');
    expect(html).toContain("Credential settings");
    expect(html).toContain(">Enter</button>");
  });
});
