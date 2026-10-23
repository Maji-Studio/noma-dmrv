/**
 * Touch targets on a phone (390px): the customer edit sheet stays inside the
 * screen and a saved location's Edit button owns the 5px just outside it
 * (its 44px hit area around the 32px button).
 */
import { test, expect } from "./fixtures";
import { deleteLocation, openCustomerSheet, seedSecondLocation } from "./fixtures/customer-sheet-helpers";

const PHONE = { width: 390, height: 844 };
const OUTSIDE_PX = 5;

test.describe("Touch targets on a phone", () => {
  test("the customer sheet fits the screen and a location's Edit button has a 44px hit area", async ({ adminPage: page, seededData }) => {
    const { customer, customerLocation, facility } = seededData;
    const secondId = await seedSecondLocation(customer.id);
    try {
      await page.setViewportSize(PHONE);
      const sheet = await openCustomerSheet(page, facility.id, customer.code);
      const edit = sheet.getByRole("button", { name: `Edit ${customerLocation.name}` });
      await expect(edit).toBeVisible();

      const overflow = await sheet.evaluate((dialog) => {
        let scroller: Element | null = dialog.querySelector("form");
        while (scroller && getComputedStyle(scroller).overflowY !== "auto") scroller = scroller.parentElement;
        return scroller ? { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth } : null;
      });
      expect(overflow).not.toBeNull();
      expect(overflow!.scrollWidth).toBeLessThanOrEqual(overflow!.clientWidth);

      await edit.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const owners = await edit.evaluate((el, outside) => {
        const box = el.getBoundingClientRect();
        const midX = box.x + box.width / 2;
        const midY = box.y + box.height / 2;
        const owns = (x: number, y: number) => el.contains(document.elementFromPoint(x, y));
        return {
          width: box.width,
          height: box.height,
          left: owns(box.x - outside, midY),
          right: owns(box.right + outside, midY),
          top: owns(midX, box.y - outside),
          bottom: owns(midX, box.bottom + outside),
        };
      }, OUTSIDE_PX);
      expect(owners).toMatchObject({ width: 32, height: 32, left: true, right: true, top: true, bottom: true });
    } finally {
      await deleteLocation(secondId);
    }
  });
});
