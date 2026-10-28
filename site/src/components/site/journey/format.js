// Journey page: formatting helpers. Every visible number goes through these so units and
// missing values read the same everywhere (docs/ux-writing.md: "Not recorded").
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const NOT_RECORDED = "Not recorded";

/** "2026-10-17" to "17 Oct 2026". */
export const dt = (s) => {
  if (!s) return NOT_RECORDED;
  const [y, m, d] = s.split("-");
  return `${+d} ${MON[+m - 1]} ${y}`;
};
/** "4 to 26 Feb 2026" from two ISO dates; keeps month and year only where they differ. */
export function dtRange(a, b) {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  if (ya === yb && ma === mb) return `${da} to ${db} ${MON[mb - 1]} ${yb}`;
  if (ya === yb) return `${da} ${MON[ma - 1]} to ${db} ${MON[mb - 1]} ${yb}`;
  return `${dt(a)} to ${dt(b)}`;
}
export const monthYear = (iso) => `${MONTH[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
export const nf = (v, d = 0) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const kg = (v) => `${v < 100 && v % 1 ? nf(v, 1) : nf(Math.round(v))} kg`;
export const tn = (v) => `${nf(v / 1000, 1)} t`;
export const pc = (v, d = 1) => `${nf(v, d)} %`;
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pad2 = (n) => String(n).padStart(2, "0");
