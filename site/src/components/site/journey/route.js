// Journey page: the URL hash, as pure functions. The hash names the selected record, so a reload or a
// shared link opens the same card whether it was picked on the chain, in a branch, or on the map/graph:
//   #[graph]-[low|full]-[summary]-<chain name>    a record on the main chain, e.g. #graph-field
//   #[graph]-[low|full]-[summary]-r.<record id>   any other record, e.g. #r.PR-26-008 (the id is last)
// Older links also hold a branch token (b1, b0x3); they are read as the record they pointed at.
import { CHAIN, HASH, HOME, R } from "./model.js";

const REC_PREFIX = "r.";
const REC_PATTERN = /(?:^|-)r\.(.+)$/;
const BRANCH_PATTERN = /^b(\d+)(?:x(\d+))?$/;

/** Hash for the view flags and the selected record. `snap` is "" when the sheet snap is not recorded. */
export function buildHash({ mode, snap, summary, recordId }) {
  const t = [];
  if (mode === "graph") t.push("graph");
  if (snap && snap !== "mid") t.push(snap);
  if (summary) t.push("summary");
  const ci = CHAIN.indexOf(recordId);
  t.push(ci >= 0 ? HASH[ci] : R[recordId] ? `${REC_PREFIX}${recordId}` : HASH[HOME]);
  return `#${t.join("-")}`;
}

/** What a hash asks for: view flags, the chain card to start on, and an off-chain record to open from there. */
export function parseHash(hash) {
  let rest = hash.replace(/^#/, "");
  let selected = null;
  const m = rest.match(REC_PATTERN);
  if (m) { selected = m[1]; rest = rest.slice(0, m.index); }
  const t = rest.split("-").filter(Boolean);
  let chainIdx = HOME;
  t.forEach((x) => { const i = HASH.indexOf(x); if (i >= 0) chainIdx = i; });
  const bt = t.map((x) => x.match(BRANCH_PATTERN)).find(Boolean);
  if (!selected && bt) selected = R[CHAIN[chainIdx]].br[+bt[1]]?.ids[+(bt[2] || 0)] ?? null;
  const ci = CHAIN.indexOf(selected);
  if (ci >= 0) chainIdx = ci;
  return {
    mode: t.includes("graph") ? "graph" : "map",
    snap: t.includes("full") ? "full" : t.includes("low") ? "low" : "mid",
    summary: t.includes("summary") || t.includes("batch"), // "batch" was a chain step before
    chainIdx,
    recordId: ci < 0 && R[selected] ? selected : null,
  };
}
