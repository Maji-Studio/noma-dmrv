// Walkthrough form copy for /get-started (components/site/get-started/WalkthroughForm.astro).
// Claim rules: never "live", "integrated", "certified", "only", "first"; no en or em dashes.
export const copy = {
  walkthrough: {
    title: "Book a walkthrough.",
    lead: "We'll walk through the trace, the bins and the registry mapping on a plant like yours. Tell us a little about it.",
    fields: { name: "Name", email: "Work email", company: "Company", size: "Plant size", message: "Anything we should know (optional)" },
    sizes: ["Not producing yet", "Under 500 t a year", "500 to 2,000 t a year", "Over 2,000 t a year"],
    submit: "Request a walkthrough",
    sent: "Thanks. We'll be in touch.",
  },
};
