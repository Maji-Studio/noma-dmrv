import { describe, expect, it } from "vitest";
import { queueArrivalToast, takeArrivalToast } from "./arrival-toast";

describe("arrival toast", () => {
  it("hands the message over only on the destination path, once", () => {
    queueArrivalToast("/credit-batches", "Credit batch deleted.");
    expect(takeArrivalToast("/credit-batches")).toBe("Credit batch deleted.");
    expect(takeArrivalToast("/credit-batches")).toBeNull();
  });

  it("drops the message when the route changes to anywhere else", () => {
    queueArrivalToast("/credit-batches", "Credit batch deleted.");
    expect(takeArrivalToast("/dashboard")).toBeNull();
    expect(takeArrivalToast("/credit-batches")).toBeNull();
  });

  it("answers nothing when nothing is queued, and the newest message wins", () => {
    expect(takeArrivalToast("/credit-batches")).toBeNull();
    queueArrivalToast("/credit-batches", "old");
    queueArrivalToast("/credit-batches", "new");
    expect(takeArrivalToast("/credit-batches")).toBe("new");
  });
});
