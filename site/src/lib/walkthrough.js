// Walkthrough request submission. PROTOTYPE STUB: nothing is sent.
// Slice 3 replaces the body with a POST to site/src/pages/api/walkthrough.ts (Zod, honeypot, Resend).
// Keep the signature: resolve on success, reject (throw) on failure; the form shows its error state on rejection.
const STUB_DELAY_MS = 900;

export async function submitWalkthrough(data) {
  void data;
  await new Promise((resolve) => setTimeout(resolve, STUB_DELAY_MS));
  // Prototype only: lets the error state be inspected by opening the page with ?walkthrough=error.
  if (new URLSearchParams(location.search).get("walkthrough") === "error") throw new Error("stub failure");
  return { ok: true };
}
