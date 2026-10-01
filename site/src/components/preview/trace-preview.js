// Reuses the prototype's stage glyphs, graph renderer and directional traversal.
// Both sizes share the SAME primary records; expansion reveals contextual records.
import { makeGraph, drawGraph, highlight, walk, esc, STAGES } from '../../visuals/core.js';

const LAYOUT = { width: 1080, height: 300, smallSize: 36, largeSize: 17,
  x: [65, 218, 372, 526, 680, 834, 1000], upper: 85, lower: 205,
  contextY: [18, 51, 116, 242, 277], extraShift: 14 };
const DEFAULT_RECORD = 'field-coffee';
const base = [
  ['source-a', 'sup', 0, 85, 'Sawmill A', 'Wood residues', 'Supplier record', 'Feedstock source recorded'],
  ['source-b', 'sup', 0, 205, 'Sawmill B', 'Wood residues', 'Supplier record', 'Feedstock source recorded'],
  ['intake-a', 'fd', 1, 85, 'FD-001', '1,000 kg received', 'Weighbridge ticket', '800 kg dry feedstock at 20% moisture'],
  ['intake-b', 'fd', 1, 205, 'FD-002', '1,000 kg received', 'Weighbridge ticket', '800 kg dry feedstock at 20% moisture'],
  ['run-a', 'run', 2, 85, 'PR-001', '270 kg dry biochar', 'Production record', '300 kg biochar at 10% moisture'],
  ['run-b', 'run', 2, 205, 'PR-002', '270 kg dry biochar', 'Production record', '300 kg biochar at 10% moisture'],
  ['mix', 'bbin', 3, 145, 'Mix bin', '540 kg dry biochar', 'Bin movements', 'Two production runs, origins retained'],
  ['product', 'prod', 4, 145, 'Biochar product', '540 kg dry biochar', 'Product record', 'Pure biochar drawn from the mix bin'],
  ['delivery-a', 'del', 5, 85, 'DL-001', '270 kg dry biochar', 'Bill of lading', 'Delivered to the coffee field'],
  ['delivery-b', 'del', 5, 205, 'DL-002', '270 kg dry biochar', 'Bill of lading', 'Delivered to the maize field'],
  ['field-coffee', 'app', 6, 85, 'Coffee field', '270 kg dry biochar', 'Application record', '135 kg from each production run'],
  ['field-maize', 'app', 6, 205, 'Maize field', '270 kg dry biochar', 'Application record', '135 kg from each production run'],
];
const primaryNodes = base.map(([id, st, col, y, code, quantity, evidence, note]) =>
  ({ id, st, col, x: LAYOUT.x[col], y, code, quantity, evidence, note, short: STAGES[st].label }));
const primaryEdges = [ ['source-a','intake-a'], ['source-b','intake-b'], ['intake-a','run-a'],
  ['intake-b','run-b'], ['run-a','mix'], ['run-b','mix'], ['mix','product'],
  ['product','delivery-a'], ['product','delivery-b'], ['delivery-a','field-coffee'], ['delivery-b','field-maize'] ];
const smallGraph = makeGraph(primaryNodes.map(n => ({...n})), primaryEdges);
const largeNodes = primaryNodes.map(n => ({...n}));
const largeEdges = primaryEdges.map(e => [...e]);
const contextStages = ['fd', 'run', 'bbin', 'prod', 'del', 'app'];
for (let row = 0; row < LAYOUT.contextY.length; row++) {
  let previous = row % 2 ? 'source-b' : 'source-a';
  contextStages.forEach((st, index) => {
    const id = `context-${row}-${st}`;
    largeNodes.push({ id, st, col: index + 1, x: LAYOUT.x[index + 1] + LAYOUT.extraShift,
      y: LAYOUT.contextY[row], code: `${STAGES[st].label} ${row + 3}`,
      quantity: 'Additional operation records', evidence: `${STAGES[st].label} record`,
      note: 'Part of the larger illustrative operation' });
    largeEdges.push([previous, id]); previous = id;
  });
}
const largeGraph = makeGraph(largeNodes, largeEdges);
const root = document.querySelector('[data-preview-trace]');
if (root) {
  const svg = root.querySelector('svg');
  const select = root.querySelector('[data-trace-select]');
  const detail = root.querySelector('[data-record-detail]');
  let scale = 'simple';
  let selected = DEFAULT_RECORD;
  let graph = smallGraph;
  function display(id) {
    selected = id;
    highlight(svg, graph, id);
    select.value = id || '';
    if (!id) {
      detail.innerHTML = '<div><span class="pv-muted">The connected record</span><h3>Every step has a source.</h3></div><p>Select a source to see where its biochar went. Select a field to trace back to the production runs behind it.</p><p class="pv-muted">Example data, not a live operation.</p>';
      return;
    }
    const n = graph.byId.get(id);
    const upstream = [...walk(graph, id, 'up')].filter(k => graph.byId.get(k).st === 'sup').length;
    const downstream = [...walk(graph, id, 'down')].filter(k => graph.byId.get(k).st === 'app').length;
    detail.innerHTML = `<div><span class="pv-muted">${esc(STAGES[n.st].label)}</span><h3>${esc(n.code)}</h3><p>${esc(n.quantity)}</p></div><div><span class="pv-muted">The connection</span><p>${esc(n.note)}</p><small>${upstream ? `${upstream} sources upstream` : 'Source of the selected chain'}${downstream ? ` · ${downstream} applications downstream` : ''}</small></div><div class="pv-evidence"><span class="pv-muted">Supporting evidence</span><strong>${esc(n.evidence)}</strong><small>Illustrative record</small></div>`;
  }
  function render() {
    graph = scale === 'simple' ? smallGraph : largeGraph;
    root.dataset.size = scale;
    drawGraph(svg, graph, { size: scale === 'simple' ? LAYOUT.smallSize : LAYOUT.largeSize,
      glyphs: true, labels: scale === 'simple', focusable: scale === 'simple' });
    select.innerHTML = '<option value="">All connections</option>' + graph.nodes.map(n => `<option value="${esc(n.id)}">${esc(n.code)}</option>`).join('');
    if (selected && !graph.byId.has(selected)) selected = DEFAULT_RECORD;
    display(selected);
  }
  root.querySelectorAll('[data-scale]').forEach(button => button.addEventListener('click', () => {
    scale = button.dataset.scale;
    root.querySelectorAll('[data-scale]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    render();
  }));
  svg.addEventListener('click', event => {
    const node = event.target.closest('[data-id]');
    if (node) display(node.dataset.id);
  });
  svg.addEventListener('keydown', event => {
    const id = event.target.closest('[data-id]')?.dataset.id;
    if (!id) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); display(id); }
    if (event.key === 'Escape') display(null);
    const adjacency = event.key === 'ArrowLeft' ? graph.inn : event.key === 'ArrowRight' ? graph.out : null;
    const next = adjacency?.get(id)?.[0];
    if (next) { event.preventDefault(); graph.nodeEls.get(next).focus(); display(next); }
  });
  select.addEventListener('change', () => display(select.value || null));
  root.querySelector('[data-clear-trace]').addEventListener('click', () => display(null));
  render();
}
