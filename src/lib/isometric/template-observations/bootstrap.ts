import type { LineContract } from "./line-sources";

// Component IDs are the identity. Names below are documentation only.
// Legacy miscellaneous overhead is forbidden. Sampling and travel lines have
// no automatic source, except a template's single sample shipping line. No runtime fixture imports.
export const BOOTSTRAP_LINE_SOURCES: Readonly<Record<string, Readonly<LineContract>>> = {

  // sandbox-template-2026-10-15.json
  // Biomass transportations to processing site via truck
  rtc_1KVDDYT90SBX77NP: { scope: "operating", automaticSource: "feedstock-transport", entryPolicy: "additive", origin: "bootstrap" },
  // Metered electricity use emissions
  rtc_1KVFZ1MY9SBXFWVN: { scope: "operating", automaticSource: "run-electricity", entryPolicy: "additive", origin: "bootstrap" },
  // Generator diesel usage
  rtc_1KWHFRM4GSBX5Y7A: { scope: "operating", automaticSource: "run-genset-diesel", entryPolicy: "additive", origin: "bootstrap" },
  // Startup diesel usage
  rtc_1KWP4Y13JSBXV8FB: { scope: "operating", automaticSource: "run-startup-diesel", entryPolicy: "additive", origin: "bootstrap" },
  // Pyrolyzer CH₄ emissions
  rtc_1M4ZRBJ4GSBXWASX: { scope: "operating", entryPolicy: "single", origin: "bootstrap" },
  // Pyrolyzer CO emissions
  rtc_1M4ZREMX2SBXAY8H: { scope: "operating", entryPolicy: "single", origin: "bootstrap" },
  // Biochar transportation to storage site via truck
  rtc_1KVDECAX5SBXEHD0: { scope: "operating", automaticSource: "delivery-transport", entryPolicy: "additive", origin: "bootstrap" },
  // Biochar sequestration, 1000 year durability
  rtc_1M006YZ5CSBXJSWD: { scope: "operating", automaticSource: "sequestration", entryPolicy: "none", origin: "bootstrap" },
  // Mass-distance-based CI emissions samples to EU
  rtc_1M4ZRPH1RSBXADG2: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Sampling consumables
  rtc_1M4ZRTZFXSBXS0YP: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Laboratory analysis electricity use EU
  rtc_1M4ZRJ7EFSBXD6JT: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Laboratory analysis electricity use India
  rtc_1M4ZRNBB7SBXVT1E: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Mass-distance-based CI emissions samples to India
  rtc_1M4ZRRN6PSBXHQ7C: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Staff travel flights
  rtc_1M4ZRY1PRSBX7MDA: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Staff travel local
  rtc_1M4ZRZWZCSBXH6EX: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },

  // cula-template-2026-10-15.json
  // Biomass transportation to processing site via truck
  rtc_1M2QJGQS21S0XCMB: { scope: "operating", automaticSource: "feedstock-transport", entryPolicy: "additive", origin: "bootstrap" },
  // Metered electricity use emissions
  rtc_1M2QJGQS21S04PBN: { scope: "operating", entryPolicy: "single", origin: "bootstrap" },
  // Startup diesel usage
  rtc_1M2QJGQS21S0RB7A: { scope: "operating", automaticSource: "run-startup-diesel", entryPolicy: "additive", origin: "bootstrap" },
  // Generator diesel usage
  rtc_1M2QJGQS21S0H1G0: { scope: "operating", automaticSource: "run-genset-diesel", entryPolicy: "additive", origin: "bootstrap" },
  // Pyrolyzer CO emissions
  rtc_1M2QJGQS21S0C02Z: { scope: "operating", entryPolicy: "single", origin: "bootstrap" },
  // Pyrolyzer CH₄ emissions
  rtc_1M2QJGQS21S0ZMYM: { scope: "operating", entryPolicy: "single", origin: "bootstrap" },
  // Biochar transportation to storage site via truck
  rtc_1M2QJGQS21S0K9T9: { scope: "operating", automaticSource: "delivery-transport", entryPolicy: "additive", origin: "bootstrap" },
  // CO₂ stored from biochar application
  rtc_1M2QJGQS21S06YNY: { scope: "operating", automaticSource: "sequestration", entryPolicy: "none", origin: "bootstrap" },
  // Laboratory analysis electricity use EU
  rtc_1M2QJGQS21S0TKHK: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Sampling consumables
  rtc_1M2QJGQS21S0E8D8: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Mass-distance-based CI emissions samples to EU
  rtc_1M2QJGQS21S01X8X: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Mass-distance-based CI emissions samples to India
  rtc_1M2QJGQS21S0NJ4J: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Laboratory analysis electricity use India
  rtc_1M2QJGQS21S09707: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Staff travel local
  rtc_1M2QJGQS21S0WVVW: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Staff travel flights
  rtc_1M2QJGQS21S0GGQH: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },

  // production-template-2026-07-03.json
  // Biomass transportation to processing site via truck
  rtc_1KWKNGJZY1S0D548: { scope: "operating", automaticSource: "feedstock-transport", entryPolicy: "additive", origin: "bootstrap" },
  // Generator diesel usage
  rtc_1KWKNGJZY1S00SZX: { scope: "operating", automaticSource: "run-genset-diesel", entryPolicy: "additive", origin: "bootstrap" },
  // Metered electricity use emissions
  rtc_1KWKNGJZY1S0MEVJ: { scope: "operating", entryPolicy: "single", origin: "bootstrap" },
  // Startup diesel usage
  rtc_1KWKNGJZY1S083Q7: { scope: "operating", automaticSource: "run-startup-diesel", entryPolicy: "additive", origin: "bootstrap" },
  // Pyrolyzer CO emissions
  rtc_1KWKNGJZY1S0VRJW: { scope: "operating", entryPolicy: "single", origin: "bootstrap" },
  // Pyrolyzer CH4 emissions
  rtc_1KWKNGJZY1S0FDEH: { scope: "operating", entryPolicy: "single", origin: "bootstrap" },
  // Biochar transportation to storage site via truck
  rtc_1KWKNGJZY1S032A6: { scope: "operating", automaticSource: "delivery-transport", entryPolicy: "additive", origin: "bootstrap" },
  // CO2 stored from biochar application
  rtc_1KWKNGJZY1S0PQ5V: { scope: "operating", automaticSource: "sequestration", entryPolicy: "none", origin: "bootstrap" },
  // Laboratory analysis electricity use
  rtc_1KWKNGJZY1S0AC1G: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Sampling consumables
  rtc_1KWKNGJZY1S0Y0X5: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Mass-distance-based CI emissions samples to EU. The only sample line here,
  // so sample legs feed it. Retirement is tracked in docs/open-questions-isometric.md
  // under template-component-source-wizard (plan §4.5).
  rtc_1KWKNGJZY1S0HNRT: { scope: "operating", automaticSource: "sample-transport", entryPolicy: "additive", origin: "bootstrap" },
  // Staff travel flights
  rtc_1KWKNGJZY1S05AMF: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Staff travel local
  rtc_1KWKNGJZY1S0RZG4: { scope: "operating", entryPolicy: "additive", origin: "bootstrap" },
  // Mass-based CI emissions
  rtc_1KWKNGJZY1S0CMBS: { scope: "forbidden", entryPolicy: "none", origin: "bootstrap" },
};
