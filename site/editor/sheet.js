// The CSSV editor: a file's table, rendered by <cssv-table> with a grid drawn
// around it, next to the file's text. It opens from the home (home.js) or
// with ?file=<repository path>. It edits files, not spreadsheets: there are
// no formulas, and a file is one table (SPEC 1.3). The text is the only state:
// every edit, sort or style change produces new text. Row numbers, column
// letters, the selection and the cell editor are drawn around and over the
// table, never inside it, so the table model stays exactly as §7 defines.
//
// New text goes to the table's update(). <cssv-table> changes the table in
// place when the columns and the @imports stay the same (edits, rows, sorts,
// styles, a new locale), and otherwise keeps it on screen until the new one
// is ready. Text that doesn't parse isn't sent, so the last good table stays.
import '../../src/cssv-table.js';
import { classify, parseCssvValue } from '../../src/core.js';
import {
  scan, fieldEdit, recordEdit, applyEdits, rebuildBody, rebuildColumns, blankRecord, readRules, writeRules, cssString, remapRows,
} from './cssv-text.js';
import { DRAFTS, FILES, urlOf } from './files.js';
import { hoistFonts } from './fonts.js';
import { highlightCssv } from '../highlight.js';
import { renderHome } from './home.js';

const $ = (id) => document.getElementById(id);
const els = {
  viewport: $('viewport'), grid: $('grid'), colbar: $('colbar'), rowbar: $('rowbar'), wrap: $('wrap'),
  sel: $('sel'), active: $('active'), editor: $('cell-editor'), empty: $('empty'),
  ref: $('ref'), meta: $('meta'), value: $('value'), hint: $('hint'),
  source: $('source'), sourceHl: $('source-hl'), sourcePanel: $('source-panel'), sourceInfo: $('source-info'),
  size: $('stat-size'), stats: $('stat-sel'), msg: $('stat-msg'), warn: $('stat-warn'), time: $('stat-time'),
  locale: $('locale'), scope: $('scope'), dirty: $('dirty'), fileName: $('file-name'),
  home: $('home'), groups: $('groups'), homeNote: $('home-note'), skip: $('skip'), draft: $('draft'),
};
const front = els.wrap.querySelector('cssv-table');

const state = {
  name: '',
  key: null, // where the draft is kept: the repository path, or "local:" and the file's name
  handle: null, // a FileSystemFileHandle to save to, where the browser has them
  draft: null, // a stored draft that differs from the opened file, while it's offered
  base: document.baseURI, // what the style block's relative URLs resolve against: the file's URL
  original: '',
  text: '',
  scan: null,
  width: 0,
  broken: null, // the error when state.text doesn't parse; the sheet keeps showing the last good text
  locale: 'en-US',
  anchor: { r: 1, c: 0 }, // the active cell
  focus: { r: 1, c: 0 }, // the other corner of the selection
  editing: null, // { r, c, mode } while the cell editor is open
  undo: [],
  redo: [],
  geo: { rows: [], cols: [] },
  timings: [],
};

// --- Text --------------------------------------------------------------------

const unquote = (raw) => (raw.startsWith('"') ? raw.slice(1, raw.endsWith('"') && raw.length > 1 ? -1 : undefined).replaceAll('""', '"') : raw);
const fieldOf = (text, s, r, c) => {
  const f = s?.records[r]?.fields[c];
  return f ? unquote(text.slice(f.start, f.end)) : '';
};
const widthOf = (s) => s.records.reduce((m, r) => Math.max(m, r.fields.length), 0);

/** The field at record r, column c of the current text (record 0 is the header). */
const raw = (r, c) => fieldOf(state.text, state.scan, r, c);
const rowCount = () => state.scan?.records.length ?? 0; // header included
const columnName = (c) => raw(0, c);

function setText(text, { message, fromSource = false, keep = true } = {}) {
  state.text = text;
  try {
    state.scan = scan(text);
    state.width = widthOf(state.scan);
    state.broken = null;
  } catch (error) {
    state.broken = error;
    state.scan = null;
  }
  els.dirty.hidden = text === state.original;
  if (!fromSource && !els.sourcePanel.hidden) showSource(text);
  updateSourceInfo();
  if (keep) keepDraft();
  return show(text, message);
}

/** A change to the file: remembered for undo. */
function change(text, message) {
  if (text === state.text) return Promise.resolve(false);
  state.undo.push(state.text);
  state.redo.length = 0;
  return setText(text, { message });
}

function undo() {
  if (!state.undo.length) return Promise.resolve(false);
  state.redo.push(state.text);
  return setText(state.undo.pop(), { message: 'Undone' });
}

function redo() {
  if (!state.redo.length) return Promise.resolve(false);
  state.undo.push(state.text);
  return setText(state.redo.pop(), { message: 'Redone' });
}

// --- Getting text on screen --------------------------------------------------

const nextFrame = () => new Promise(requestAnimationFrame);
const loadend = (el) => new Promise((resolve) => el.addEventListener('cssv-loadend', resolve, { once: true }));

function show(text, message) {
  if (state.broken) {
    say(`The file doesn't parse: ${state.broken.message} Showing the last version that did.`, 'error');
    return Promise.resolve(false);
  }
  const started = performance.now();
  const table = front.table;
  return front.update(text).then(() => {
    if (text !== state.text) return false; // a later change will report
    measure();
    hoistFonts(front.model, state.base);
    showWarnings();
    if (message) say(message);
    return nextFrame().then(() => {
      timing(front.table === table ? 'update' : 'render', message, started);
      return true;
    });
  });
}

function timing(kind, message, started) {
  const ms = performance.now() - started;
  state.timings.push({ kind, message: message ?? kind, ms });
  els.time.textContent = `${kind === 'render' ? 'rendered' : 'updated'} in ${Math.round(ms)} ms`;
}

function showWarnings() {
  const list = front.errors;
  els.warn.textContent = list.length ? `⚠ ${list.length} warning${list.length > 1 ? 's' : ''}` : '';
  els.warn.title = list.map((e) => `§${e.section}: ${e.message}`).join('\n');
}

document.fonts.addEventListener('loadingdone', () => measure());
new ResizeObserver(() => measure()).observe(els.wrap);

// --- Geometry: bars, selection and editor placed from the rendered cells --

// A style block can lay the table out any way CSS can: a grid of tiles, rows
// turned into columns, a label. Row and column bars only make sense while
// the header cells sit side by side and the rows stack; otherwise they're
// left out and the selection is drawn on the cells alone.
function tabular(table) {
  const head = table.rows[0] ? Array.from(table.rows[0].cells, (th) => th.getBoundingClientRect()) : [];
  if (!head.length || head.some((r) => r.width === 0 || Math.abs(r.top - head[0].top) > 1)) return false;
  const across = [...head].sort((a, b) => a.left - b.left); // either direction, for right-to-left tables
  if (across.some((r, i) => i > 0 && r.left < across[i - 1].right - 1)) return false;
  let bottom = -Infinity;
  for (const tr of table.rows) {
    const r = tr.getBoundingClientRect();
    if (r.height === 0 || r.top < bottom - 1) return false;
    bottom = r.bottom;
  }
  return true;
}

function measure() {
  const table = front.table;
  const base = els.wrap.getBoundingClientRect();
  const free = !!table && !tabular(table);
  els.grid.classList.toggle('free', free);
  $('stat-layout').hidden = !free;
  state.geo.rows = table && !free ? Array.from(table.rows, (tr) => {
    const r = tr.getBoundingClientRect();
    return [r.top - base.top, r.height];
  }) : [];
  state.geo.cols = table && !free && table.rows[0] ? Array.from(table.rows[0].cells, (th) => {
    const r = th.getBoundingClientRect();
    return [r.left - base.left, r.width];
  }) : [];
  els.empty.hidden = !!table;
  els.empty.textContent = table ? '' : 'Nothing to show.';
  drawBars();
  drawSelection();
  els.size.innerHTML = `<b>${Math.max(rowCount() - 1, 0)}</b> rows × <b>${state.width}</b> columns`;
  updateKeyPicker();
}

const letter = (c) => {
  let s = '';
  for (c += 1; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
};
const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

function drawBars() {
  els.colbar.innerHTML = state.geo.cols.map(([x, w], c) => `<div class="cl" data-c="${c}" style="left:${x}px;width:${w}px" title="${esc(columnName(c))}"><b>${letter(c)}</b><span>${esc(columnName(c))}</span></div>`).join('');
  els.rowbar.innerHTML = state.geo.rows.map(([y, h], r) => `<div class="rl" data-r="${r}" style="top:${y}px;height:${h}px">${r + 1}</div>`).join('');
  highlightBars();
}

let lit = { cols: [], rows: [] };
function highlightBars() {
  for (const el of lit.cols) el.classList.remove('on');
  for (const el of lit.rows) el.classList.remove('on');
  const { r1, r2, c1, c2 } = range();
  lit = {
    cols: Array.from(els.colbar.children).slice(c1, c2 + 1),
    rows: Array.from(els.rowbar.children).slice(r1, r2 + 1),
  };
  for (const el of lit.cols) el.classList.add('on');
  for (const el of lit.rows) el.classList.add('on');
}

function cellRect(r, c) {
  const row = front.table?.rows[r];
  const cell = row?.cells[c];
  if (!cell) return null;
  // A cell the file hides has no box; its row stands in for it, if that shows.
  const shown = cell.getClientRects().length ? cell : row.getClientRects().length ? row : null;
  if (!shown) return null;
  const base = els.wrap.getBoundingClientRect();
  const x = shown.getBoundingClientRect();
  return { left: x.left - base.left, top: x.top - base.top, right: x.right - base.left, bottom: x.bottom - base.top };
}

function place(el, rect) {
  el.hidden = !rect;
  if (!rect) return;
  Object.assign(el.style, {
    left: `${rect.left}px`, top: `${rect.top}px`,
    width: `${rect.right - rect.left}px`, height: `${rect.bottom - rect.top}px`,
  });
}

function drawSelection() {
  const { r1, r2, c1, c2 } = range();
  const a = cellRect(r1, c1);
  const b = cellRect(r2, c2);
  const single = r1 === r2 && c1 === c2;
  place(els.sel, a && b && !single ? {
    left: Math.min(a.left, b.left), top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom),
  } : null);
  place(els.active, cellRect(state.anchor.r, state.anchor.c));
  if (state.editing) placeEditor();
  highlightBars();
  updateFormulaBar();
  updateStats();
  announce();
}

// The table is drawn in shadow roots, out of reach of aria-activedescendant,
// so a live region reads out the active cell once arrow keys or a drag settle.
let announceTimer;
function announce() {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    if (document.activeElement !== els.viewport) return;
    const { r1, r2, c1, c2 } = range();
    const { r, c } = state.anchor;
    const shown = r === 0 ? columnName(c) : front.table?.rows[r]?.cells[c]?.textContent ?? '';
    const where = `${letter(c)}${r + 1}, ${r === 0 ? 'column name' : columnName(c) || 'unnamed column'}`;
    const size = (r2 - r1 + 1) * (c2 - c1 + 1);
    $('announce').textContent = `${where}: ${shown.trim() || 'empty'}${size > 1 ? `. ${size} cells selected` : ''}`;
  }, 120);
}

// --- Selection -----------------------------------------------------------------

function range() {
  const { anchor: a, focus: f } = state;
  return { r1: Math.min(a.r, f.r), r2: Math.max(a.r, f.r), c1: Math.min(a.c, f.c), c2: Math.max(a.c, f.c) };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lastRow = () => Math.max(state.geo.rows.length, rowCount()) - 1;
const lastCol = () => Math.max(state.geo.cols.length, state.width) - 1;

function select(r, c, extend = false) {
  const cell = { r: clamp(r, 0, lastRow()), c: clamp(c, 0, lastCol()) };
  state.focus = cell;
  if (!extend) state.anchor = { ...cell };
  drawSelection();
  scrollIntoView(cell);
}

function scrollIntoView({ r, c }) {
  const rect = cellRect(r, c);
  if (!rect) return;
  const vp = els.viewport;
  const gutter = els.rowbar.offsetWidth;
  const bar = els.colbar.offsetHeight;
  if (rect.top < vp.scrollTop) vp.scrollTop = rect.top;
  else if (rect.bottom + bar > vp.scrollTop + vp.clientHeight) vp.scrollTop = rect.bottom + bar - vp.clientHeight;
  if (rect.left < vp.scrollLeft) vp.scrollLeft = rect.left;
  else if (rect.right + gutter > vp.scrollLeft + vp.clientWidth) vp.scrollLeft = rect.right + gutter - vp.clientWidth;
}

function cellFromEvent(e) {
  for (const node of e.composedPath()) {
    if (node === els.wrap || node === els.editor) break;
    if (node.tagName === 'TD' || node.tagName === 'TH') return { r: node.parentElement.rowIndex, c: node.cellIndex };
  }
  return null;
}

let dragging = false;
els.wrap.addEventListener('mousedown', (e) => {
  const cell = cellFromEvent(e);
  if (!cell || e.button !== 0) return;
  e.preventDefault();
  els.viewport.focus({ preventScroll: true }); // commits an open editor first
  select(cell.r, cell.c, e.shiftKey);
  dragging = true;
});
els.wrap.addEventListener('mousemove', (e) => {
  if (!dragging || !(e.buttons & 1)) return;
  const cell = cellFromEvent(e);
  if (cell && (cell.r !== state.focus.r || cell.c !== state.focus.c)) select(cell.r, cell.c, true);
});
addEventListener('mouseup', () => { dragging = false; });
els.wrap.addEventListener('dblclick', (e) => {
  const cell = cellFromEvent(e);
  if (!cell) return;
  select(cell.r, cell.c);
  openEditor();
});

els.colbar.addEventListener('mousedown', (e) => {
  const c = Number(e.target.closest('.cl')?.dataset.c);
  if (Number.isNaN(c)) return;
  e.preventDefault();
  els.viewport.focus({ preventScroll: true });
  if (!e.shiftKey) state.anchor = { r: 0, c };
  state.focus = { r: lastRow(), c };
  drawSelection();
});
els.rowbar.addEventListener('mousedown', (e) => {
  const r = Number(e.target.closest('.rl')?.dataset.r);
  if (Number.isNaN(r)) return;
  e.preventDefault();
  els.viewport.focus({ preventScroll: true });
  if (!e.shiftKey) state.anchor = { r, c: 0 };
  state.focus = { r, c: lastCol() };
  drawSelection();
});

// --- Values: normalizing, the formula bar, the cell editor -------------------

const NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

// Typed numbers in the reader's locale become the file's fixed form (6.1):
// "1.234,5" in de-DE is saved as 1234.5. A leading apostrophe keeps the text
// exactly as typed, as in spreadsheets. Leading zeros are never removed, so
// "007" stays text, as the format intends.
function normalize(input, locale) {
  if (input.startsWith("'")) {
    const value = input.slice(1);
    return { value, note: NUMBER.test(value) ? `still a number: CSSV reads ${value} as one` : 'kept as text' };
  }
  const parts = new Intl.NumberFormat(locale).formatToParts(-1234567.5);
  const group = parts.find((p) => p.type === 'group')?.value ?? ',';
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  const ints = parts.filter((p) => p.type === 'integer');
  const lakh = ints.length > 2 && ints[1].value.length === 2; // hi-IN groups 12,34,567
  const plain = new Intl.NumberFormat(locale, { useGrouping: false });
  const digits = Array.from({ length: 10 }, (_, d) => plain.format(d));
  const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let s = input.trim().replace(/[‎‏؜]/g, '').replace(/^\+/, '').replace(/^[−‒–]/, '-');
  s = s.replace(/[^\x00-\x7f]/g, (ch) => (digits.includes(ch) ? String(digits.indexOf(ch)) : ch));
  const g = /\s/.test(group) ? '\\s' : escRe(group);
  const grouped = lakh ? `\\d{1,2}(?:${g}\\d{2})*${g}\\d{3}` : `\\d{1,3}(?:${g}\\d{3})+`;
  const localized = new RegExp(`^-?(?:${grouped}|\\d+)(?:${escRe(decimal)}\\d+)?$`);
  const canonical = () => s.replace(new RegExp(g, 'g'), '').replace(decimal, '.');
  const result = (v) => (v === input ? { value: input } : { value: v, note: `${input} → ${v}` });
  // Where "." is not the decimal separator, the locale's reading comes first: "1.500" in de-DE is 1500.
  if (decimal !== '.' && localized.test(s) && NUMBER.test(canonical())) return result(canonical());
  if (NUMBER.test(input)) return { value: input };
  if (localized.test(s) && NUMBER.test(canonical())) return result(canonical());
  return { value: input };
}

function describe(r, c) {
  if (r === 0) return 'column name';
  const t = classify(raw(r, c));
  const shown = front.table?.rows[r]?.cells[c]?.textContent ?? '';
  const type = t.type === 'number' ? `number, ${t.sign}` : t.type;
  return t.type === 'number' && shown !== raw(r, c) ? `${type} · shown as ${shown}` : type;
}

function updateFormulaBar() {
  const { r1, r2, c1, c2 } = range();
  const { r, c } = state.anchor;
  els.ref.textContent = r1 === r2 && c1 === c2 ? `${letter(c)}${r + 1}` : `${letter(c1)}${r1 + 1}:${letter(c2)}${r2 + 1}`;
  els.meta.textContent = `${columnName(c) || '(no name)'} · ${describe(r, c)}`;
  if (document.activeElement !== els.value && !state.editing) {
    els.value.value = raw(r, c);
    els.hint.textContent = '';
  }
}

function hintFor(r, value) {
  if (r === 0) return 'renaming a column changes which data-col rules match';
  if (keyedRows() && columnName(state.anchor.c) === currentKey()) return "this row's key: the editor's styles for the row follow a new value";
  const n = normalize(value, state.locale);
  const t = classify(n.value);
  return (n.note ? `${n.note} · ` : '') + (t.type === 'number' ? 'number' : t.type);
}

function commitValue(r, c, typed) {
  if (state.broken) {
    say('Fix the source first: the file does not parse.', 'error');
    return Promise.resolve(false);
  }
  const n = r === 0 ? { value: typed } : normalize(typed, state.locale);
  if (n.value === raw(r, c)) return Promise.resolve(false);
  const ref = `${letter(c)}${r + 1}`;
  let text = applyEdits(state.text, [fieldEdit(state.scan, r, c, n.value)]);
  if (r === 0) text = renameRules(text, raw(0, c), n.value);
  else if (columnName(c) === currentKey()) text = rekeyRules(text, raw(r, c), n.value);
  return change(text, n.note ? `${ref}: saved ${n.note}` : `${ref} edited`);
}

// The editor's own rules name columns by data-col, so they follow a renamed
// column, unless another column still has the old name. Rules the author
// wrote are left as they are.
function renameRules(text, from, to) {
  const s = scan(text);
  const rules = readRules(text, s);
  const names = s.records[0].fields.map((f) => unquote(text.slice(f.start, f.end)));
  if (!rules.size || names.includes(from)) return text;
  const a = `[data-col=${cssString(from)}]`;
  const b = `[data-col=${cssString(to)}]`;
  return writeRules(text, s, new Map([...rules].map(([selector, decls]) => [selector.replaceAll(a, b), decls])));
}

// The formula bar edits the active cell too.
els.value.addEventListener('input', () => { els.hint.textContent = hintFor(state.anchor.r, els.value.value); });
els.value.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    commitValue(state.anchor.r, state.anchor.c, els.value.value);
    els.viewport.focus({ preventScroll: true });
    if (e.key === 'Enter') select(state.anchor.r + (e.shiftKey ? -1 : 1), state.anchor.c);
    else select(state.anchor.r, state.anchor.c + (e.shiftKey ? -1 : 1));
  } else if (e.key === 'Escape') {
    e.preventDefault();
    els.value.value = raw(state.anchor.r, state.anchor.c);
    els.viewport.focus({ preventScroll: true });
    updateFormulaBar();
  }
});
els.value.addEventListener('blur', () => {
  commitValue(state.anchor.r, state.anchor.c, els.value.value);
  els.hint.textContent = '';
});

// The cell editor: a text field over the cell, in the cell's own font, with
// the raw value. Typing starts it in "replace" mode, where arrow keys commit
// and move, as in spreadsheets; double-click, Enter and F2 start "edit" mode,
// where Left and Right move the caret, and Up and Down move it between lines
// and commit and move from the first or last line.
function openEditor(initial, mode = 'edit') {
  if (state.broken) return say('Fix the source first: the file does not parse.', 'error');
  const { r, c } = state.anchor;
  const cell = front.table?.rows[r]?.cells[c];
  if (!cell) return;
  scrollIntoView(state.anchor);
  // The cell's font, so the text sits where it did, but the editor's own
  // colors: what shows behind a cell can come from the row, the table or an
  // image, so the cell's text color may be unreadable on any one background.
  const cs = getComputedStyle(cell);
  Object.assign(els.editor.style, {
    fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle,
    letterSpacing: cs.letterSpacing, lineHeight: cs.lineHeight, textAlign: cs.textAlign,
    padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
  });
  state.editing = { r, c, mode };
  els.editor.value = initial ?? raw(r, c);
  els.editor.hidden = false;
  placeEditor();
  els.editor.focus({ preventScroll: true });
  els.editor.setSelectionRange(els.editor.value.length, els.editor.value.length);
  syncEditor();
}

function placeEditor() {
  const rect = cellRect(state.editing.r, state.editing.c);
  if (!rect) return;
  const ed = els.editor;
  ed.style.left = `${rect.left}px`;
  ed.style.top = `${rect.top}px`;
  ed.style.width = `${rect.right - rect.left}px`;
  ed.style.height = `${rect.bottom - rect.top}px`;
  // Grow with the text: wider for long lines, taller for line breaks.
  if (ed.scrollWidth > ed.clientWidth) ed.style.width = `${ed.scrollWidth + 4}px`;
  if (ed.scrollHeight > ed.clientHeight) ed.style.height = `${ed.scrollHeight + 2}px`;
}

function syncEditor() {
  placeEditor();
  els.value.value = els.editor.value;
  els.hint.textContent = hintFor(state.editing.r, els.editor.value);
}

function closeEditor(commit) {
  const editing = state.editing;
  if (!editing) return Promise.resolve(false);
  state.editing = null;
  const value = els.editor.value;
  // Move focus before hiding: hiding the focused editor drops focus to the
  // body, where arrow keys no longer reach the sheet.
  if (document.activeElement === els.editor) els.viewport.focus({ preventScroll: true });
  els.editor.hidden = true;
  els.hint.textContent = '';
  const done = commit ? commitValue(editing.r, editing.c, value) : Promise.resolve(false);
  updateFormulaBar();
  return done;
}

els.editor.addEventListener('input', syncEditor);
els.editor.addEventListener('keydown', (e) => {
  const { r, c, mode } = state.editing ?? {};
  if (r === undefined) return;
  const go = (dr, dc) => {
    e.preventDefault();
    closeEditor(true);
    select(r + dr, c + dc);
  };
  if (e.key === 'Enter' && e.altKey) {
    e.preventDefault();
    els.editor.setRangeText('\n', els.editor.selectionStart, els.editor.selectionEnd, 'end');
    syncEditor();
  } else if (e.key === 'Enter') go(e.shiftKey ? -1 : 1, 0);
  else if (e.key === 'Tab') go(0, e.shiftKey ? -1 : 1);
  else if (e.key === 'Escape') {
    e.preventDefault();
    closeEditor(false);
  } else if (mode === 'replace' && e.key.startsWith('Arrow')) {
    const [dr, dc] = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    go(dr, dc);
  } else if (e.key === 'ArrowUp' && !e.shiftKey && !els.editor.value.slice(0, els.editor.selectionStart).includes('\n')) {
    go(-1, 0);
  } else if (e.key === 'ArrowDown' && !e.shiftKey && !els.editor.value.slice(els.editor.selectionEnd).includes('\n')) {
    go(1, 0);
  }
});
els.editor.addEventListener('blur', () => closeEditor(true));

// --- Keyboard ------------------------------------------------------------------

els.viewport.addEventListener('keydown', (e) => {
  if (e.target !== els.viewport) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const { r, c } = e.shiftKey ? state.focus : state.anchor;
  const page = Math.max(1, Math.floor(els.viewport.clientHeight / 30));
  const moves = {
    ArrowUp: [mod ? 0 : r - 1, c], ArrowDown: [mod ? lastRow() : r + 1, c],
    ArrowLeft: [r, mod ? 0 : c - 1], ArrowRight: [r, mod ? lastCol() : c + 1],
    PageUp: [r - page, c], PageDown: [r + page, c],
    Home: [mod ? 0 : r, 0], End: [mod ? lastRow() : r, lastCol()],
  };
  if (moves[key]) {
    e.preventDefault();
    select(...moves[key], e.shiftKey);
  } else if (mod && key === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (mod && key === 'y') {
    e.preventDefault();
    redo();
  } else if (mod && key === 'b') {
    e.preventDefault();
    toggleStyle('font-weight', 'bold');
  } else if (mod && key === 'i') {
    e.preventDefault();
    toggleStyle('font-style', 'italic');
  } else if (mod && key === 'a') {
    e.preventDefault();
    state.anchor = { r: 0, c: 0 };
    state.focus = { r: lastRow(), c: lastCol() };
    drawSelection();
  } else if (key === 'Tab') {
    e.preventDefault();
    select(state.anchor.r, state.anchor.c + (e.shiftKey ? -1 : 1));
  } else if (key === 'Enter' || key === 'F2') {
    e.preventDefault();
    openEditor();
  } else if (key === 'Delete' || key === 'Backspace') {
    e.preventDefault();
    clearSelection();
  } else if (e.key.length === 1 && !mod && !e.altKey) {
    e.preventDefault();
    openEditor(e.key, 'replace');
  }
});

addEventListener('keydown', (e) => {
  // Undo and redo also work from the toolbar's focus, but not inside text fields.
  if (e.target === els.viewport || e.target.closest?.('input, textarea, select')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  }
});

function clearSelection() {
  if (state.broken) return Promise.resolve(false);
  const { r1, r2, c1, c2 } = range();
  const edits = [];
  for (let r = Math.max(1, r1); r <= r2; r++) for (let c = c1; c <= c2; c++) edits.push(fieldEdit(state.scan, r, c, ''));
  const n = (r2 - Math.max(1, r1) + 1) * (c2 - c1 + 1);
  return change(applyEdits(state.text, edits), `Cleared ${n} cell${n === 1 ? '' : 's'}`);
}

// --- Copy -----------------------------------------------------------------------

function selectionTsv() {
  const { r1, r2, c1, c2 } = range();
  const cell = (v) => (/[\t\n\r"]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const lines = [];
  for (let r = r1; r <= r2; r++) {
    const row = [];
    for (let c = c1; c <= c2; c++) row.push(cell(raw(r, c)));
    lines.push(row.join('\t'));
  }
  return lines.join('\n');
}
document.addEventListener('copy', (e) => {
  if (document.activeElement !== els.viewport) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', selectionTsv());
  say('Copied as tab-separated values');
});
document.addEventListener('cut', (e) => {
  if (document.activeElement !== els.viewport) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', selectionTsv());
  clearSelection();
});

// Excel, Numbers and Google Sheets copy tab-separated values, quoting a cell
// that holds a tab, a quote or a line break.
function parseTsv(input) {
  const text = input.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') field += text[++i];
      else quoted = false;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === '\t') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

document.addEventListener('paste', (e) => {
  if (document.activeElement !== els.viewport || state.editing) return;
  const text = e.clipboardData.getData('text/plain');
  if (!text) return;
  e.preventDefault();
  pasteValues(parseTsv(text));
});

// Pasted values go in from the active cell, read in the selected locale like
// typed ones. One value fills the whole selection. Rows and columns are added
// when the values reach past the file's last ones.
function pasteValues(values) {
  if (state.broken) {
    say('Fix the source first: the file does not parse.', 'error');
    return Promise.resolve(false);
  }
  const { r1, r2, c1, c2 } = range();
  let rows = values;
  if (rows.length === 1 && rows[0].length === 1 && (r2 > r1 || c2 > c1)) {
    rows = Array.from({ length: r2 - r1 + 1 }, () => Array(c2 - c1 + 1).fill(values[0][0]));
  }
  const height = rows.length;
  const width = Math.max(...rows.map((row) => row.length));
  let text = state.text;
  let s = state.scan;
  const addCols = c1 + width - state.width;
  if (addCols > 0) {
    const names = newColumnNames(addCols);
    text = rebuildColumns(text, s, [...columnIndexes(), ...names.map((name) => ({ name: r1 === 0 ? '' : name }))]);
    s = scan(text);
  }
  const addRows = r1 + height - s.records.length;
  if (addRows > 0) {
    const items = Array.from({ length: s.records.length - 1 }, (_, i) => i + 1);
    for (let i = 0; i < addRows; i++) items.push(blankRecord(s, widthOf(s)));
    text = rebuildBody(text, s, items);
    s = scan(text);
  }
  const edits = rows.map((row, i) => {
    const r = r1 + i;
    return recordEdit(text, s, r, new Map(row.map((value, j) => [c1 + j, r === 0 ? value : normalize(value, state.locale).value])));
  });
  const n = rows.reduce((sum, row) => sum + row.length, 0);
  const added = [addRows > 0 && plural(addRows, 'row'), addCols > 0 && plural(addCols, 'column')].filter(Boolean);
  return change(applyEdits(text, edits), `Pasted ${plural(n, 'cell')}${added.length ? `, adding ${added.join(' and ')}` : ''}`)
    .then(() => {
      state.anchor = { r: r1, c: c1 };
      state.focus = { r: r1 + height - 1, c: c1 + width - 1 };
      drawSelection();
    });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(selectionTsv());
    say('Copied as tab-separated values');
  } catch {
    say('The browser blocked clipboard access; use Ctrl+C in the sheet.', 'warn');
  }
});

// --- Rows -------------------------------------------------------------------------

function compareDecimal(a, b) {
  const neg = (s) => s.startsWith('-') && /[1-9]/.test(s);
  if (neg(a) !== neg(b)) return neg(a) ? -1 : 1;
  const sign = neg(a) ? -1 : 1;
  const [ai, af = ''] = a.replace('-', '').split('.');
  const [bi, bf = ''] = b.replace('-', '').split('.');
  if (ai.length !== bi.length) return (ai.length - bi.length) * sign;
  if (ai !== bi) return (ai < bi ? -1 : 1) * sign;
  const n = Math.max(af.length, bf.length);
  const x = af.padEnd(n, '0');
  const y = bf.padEnd(n, '0');
  return x === y ? 0 : (x < y ? -1 : 1) * sign;
}

// New body order: a number keeps that record, a string is a new record. The
// sheet's per-row style rules are renumbered so they stay with their rows.
function reorder(items, message) {
  const rows = new Map();
  items.forEach((item, p) => { if (typeof item === 'number') rows.set(item + 1, p + 2); });
  let text = state.text;
  let s = state.scan;
  const rules = readRules(text, s);
  if (rules.size) {
    text = writeRules(text, s, remapRows(rules, rows));
    s = scan(text);
  }
  return change(rebuildBody(text, s, items), message);
}

const bodyRows = () => Array.from({ length: rowCount() - 1 }, (_, i) => i + 1);

function sortRows(dir) {
  if (state.broken) return Promise.resolve(false);
  const c = state.anchor.c;
  const coll = new Intl.Collator(state.locale, { numeric: true });
  const rows = bodyRows();
  const vals = new Map(rows.map((r) => [r, { v: raw(r, c), type: classify(raw(r, c)).type }]));
  rows.sort((p, q) => {
    const a = vals.get(p);
    const b = vals.get(q);
    if (a.type === 'empty' || b.type === 'empty') return (a.type === 'empty') - (b.type === 'empty'); // empty last either way
    if (a.type !== b.type) return (a.type === 'number' ? -1 : 1) * dir;
    return (a.type === 'number' ? compareDecimal(a.v, b.v) : coll.compare(a.v, b.v)) * dir;
  });
  return reorder(rows, `Sorted by ${columnName(c)}, ${dir > 0 ? 'ascending' : 'descending'}`);
}

function addRow() {
  if (state.broken) return Promise.resolve(false);
  const after = state.anchor.r;
  const items = bodyRows();
  items.splice(after, 0, blankRecord(state.scan, state.width));
  return reorder(items, `Inserted row ${after + 2}`).then(() => select(after + 1, state.anchor.c));
}

function deleteRows() {
  if (state.broken) return Promise.resolve(false);
  const { r1, r2 } = range();
  const from = Math.max(1, r1);
  if (from > r2) {
    say('The header row is the column names; it cannot be deleted.', 'warn');
    return Promise.resolve(false);
  }
  const n = r2 - from + 1;
  return reorder(bodyRows().filter((r) => r < from || r > r2), `Deleted ${n} row${n === 1 ? '' : 's'}`)
    .then(() => select(Math.min(from, lastRow()), state.anchor.c));
}

// A new key value takes the editor's rules for that row along, unless
// another row still has the old value.
function rekeyRules(text, from, to) {
  const s = scan(text);
  const rules = readRules(text, s);
  const keyed = keyedRows();
  if (!rules.size || !keyed || to === '' || keyed.filter((k) => k === from).length > 1) return text;
  const a = `tr[data-key=${cssString(from)}]`;
  const b = `tr[data-key=${cssString(to)}]`;
  return writeRules(text, s, new Map([...rules].map(([selector, decls]) => [selector.replaceAll(a, b), decls])));
}

// --- The key column (9.1) ------------------------------------------------------------

/** The key column the table was rendered with, or null. */
function currentKey() {
  const table = front.table;
  if (!table) return null;
  const key = parseCssvValue(getComputedStyle(table).getPropertyValue('--cssv-key'));
  return typeof key === 'string' && columnIndexes().some((c) => columnName(c) === key) ? key : null;
}

/** The body rows' keys, when every row has one and no two are the same; else null. */
function keyedRows() {
  const rows = front.table?.tBodies[0]?.rows;
  if (!rows?.length) return null;
  const keys = Array.from(rows, (tr) => tr.getAttribute('data-key'));
  return keys.every((k) => k !== null) && new Set(keys).size === keys.length ? keys : null;
}

const keyPicker = $('key');
function updateKeyPicker() {
  const names = [...new Set(columnIndexes().map(columnName))].filter(Boolean);
  const options = ['', ...names];
  if (options.join('\n') !== Array.from(keyPicker.options, (o) => o.value).join('\n')) {
    keyPicker.replaceChildren(...options.map((name) => new Option(name || 'none', name)));
  }
  keyPicker.value = currentKey() ?? '';
}

// The editor sets the key in its own section, after the author's rules, so
// the cascade picks it. "none" writes initial, which leaves the property
// without a value (no key), when the author's styles set one.
function setKey(name) {
  if (state.broken) return Promise.resolve(false);
  const rules = rekeyRows(readRules(state.text, state.scan), keyedRows(), keysOf(name));
  const decls = new Map(rules.get('table') ?? []);
  const author = state.scan.style ? state.text.slice(state.scan.style.start, state.scan.style.end).includes('--cssv-key') : false;
  if (name) decls.set('--cssv-key', cssString(name));
  else if (author) decls.set('--cssv-key', 'initial');
  else decls.delete('--cssv-key');
  rules.set('table', decls);
  return change(writeRules(state.text, state.scan, rules), name ? `Key column: ${name}` : 'No key column')
    .then((ok) => {
      const keys = keyedRows();
      if (ok && name && !keys) say(`Key column: ${name}. Some rows share a key or have none, so styles for single rows and cells still use row numbers.`, 'warn');
      return ok;
    });
}
keyPicker.addEventListener('change', () => setKey(keyPicker.value));

/** What keyedRows() will be with `name` as the key column: its fields, when all differ. */
function keysOf(name) {
  const c = columnIndexes().find((i) => columnName(i) === name); // the first one (9.1)
  if (c === undefined) return null;
  const keys = Array.from({ length: rowCount() - 1 }, (_, i) => raw(i + 1, c));
  return keys.every((k) => k !== '') && new Set(keys).size === keys.length ? keys : null;
}

const ROW_PART = /^tr\[data-(?:key|row)="(?:[^"\\]|\\.)*"\]/; // as cssString() writes it

// The editor's rules for single rows move with a new key column: from the
// old keys, or row numbers, to the new keys, or row numbers when the new
// column doesn't tell every row apart.
function rekeyRows(rules, from, to) {
  const name = (keys, i) => (keys ? `tr[data-key=${cssString(keys[i])}]` : `tr[data-row="${i + 2}"]`);
  const moves = new Map(Array.from({ length: rowCount() - 1 }, (_, i) => [name(from, i), name(to, i)]));
  return new Map([...rules].map(([selector, decls]) => {
    const head = ROW_PART.exec(selector)?.[0];
    return [moves.has(head) ? moves.get(head) + selector.slice(head.length) : selector, decls];
  }));
}

// --- Columns ------------------------------------------------------------------------

const columnIndexes = () => Array.from({ length: state.width }, (_, i) => i);

// Column names are the hooks for styles (data-col), so new ones get distinct names.
function newColumnNames(count) {
  const taken = new Set(columnIndexes().map(columnName));
  const names = [];
  for (let i = 1; names.length < count; i++) {
    const name = i === 1 ? 'new column' : `new column ${i}`;
    if (!taken.has(name)) names.push(name);
  }
  return names;
}

function insertColumn() {
  if (state.broken) return Promise.resolve(false);
  const at = state.anchor.c + 1;
  const [name] = newColumnNames(1);
  const columns = columnIndexes();
  columns.splice(at, 0, { name });
  return change(rebuildColumns(state.text, state.scan, columns), `Inserted column ${letter(at)}, "${name}"; edit its header to rename it`)
    .then(() => select(0, at));
}

function deleteColumns() {
  if (state.broken) return Promise.resolve(false);
  const { c1, c2 } = range();
  if (c2 - c1 + 1 >= state.width) {
    say('A file keeps at least one column.', 'warn');
    return Promise.resolve(false);
  }
  const keep = columnIndexes().filter((c) => c < c1 || c > c2);
  let text = rebuildColumns(state.text, state.scan, keep);
  // The editor's rules for these columns go too, unless another column has the name.
  const s = scan(text);
  const left = new Set(keep.map(columnName));
  const gone = columnIndexes().filter((c) => c >= c1 && c <= c2).map(columnName).filter((name) => !left.has(name));
  const rules = readRules(text, s);
  for (const selector of rules.keys()) {
    if (gone.some((name) => selector.includes(`[data-col=${cssString(name)}]`))) rules.delete(selector);
  }
  text = writeRules(text, s, rules);
  const n = c2 - c1 + 1;
  return change(text, `Deleted ${n === 1 ? `column ${columnName(c1) || letter(c1)}` : plural(n, 'column')}`)
    .then(() => select(state.anchor.r, Math.min(c1, lastCol())));
}

function moveColumns(dir) {
  if (state.broken) return Promise.resolve(false);
  const { c1, c2 } = range();
  if (dir < 0 ? c1 === 0 : c2 >= state.width - 1) return Promise.resolve(false);
  const columns = columnIndexes();
  const block = columns.splice(c1, c2 - c1 + 1);
  columns.splice(c1 + dir, 0, ...block);
  const what = c1 === c2 ? `column ${columnName(c1) || letter(c1)}` : plural(c2 - c1 + 1, 'column');
  return change(rebuildColumns(state.text, state.scan, columns), `Moved ${what} ${dir < 0 ? 'left' : 'right'}`)
    .then(() => {
      state.anchor.c += dir;
      state.focus.c += dir;
      drawSelection();
    });
}

// --- Styles: rules in the style block, checked against computed styles ---------

const MAX_STYLED_CELLS = 2000;

// The rules a style applies to. Rows are named by their key when every row
// has a different one, so the style stays with the row in any order and
// through edits to the text; otherwise by data-row, which the editor
// renumbers when it moves rows. "Every row with this key" deliberately
// reaches every row sharing a key value.
function targets(scope) {
  const { r1, r2, c1, c2 } = range();
  const col = (c) => `td[data-col=${cssString(columnName(c))}]`;
  const cols = Array.from({ length: c2 - c1 + 1 }, (_, i) => c1 + i);
  const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  if (scope === 'columns') {
    return { selectors: cols.map(col), label: cols.length === 1 ? `column ${columnName(c1)}` : n(cols.length, 'column') };
  }
  if (scope === 'key') {
    const key = front.table?.rows[state.anchor.r]?.getAttribute('data-key');
    if (state.anchor.r === 0 || key === null || key === undefined) {
      return { error: 'This row has no key: the file sets no --cssv-key, or this row leaves it empty.' };
    }
    return { selectors: [`tr[data-key=${cssString(key)}] td`], label: `every row with key ${key}`, shared: true };
  }
  const rows = [];
  for (let r = Math.max(1, r1); r <= r2; r++) rows.push(r);
  if (!rows.length) return { error: 'Select cells below the header; the header is styled by the file.' };
  const keys = keyedRows();
  const row = (r) => (keys ? `tr[data-key=${cssString(keys[r - 1])}]` : `tr[data-row="${r + 1}"]`);
  if (scope === 'rows') {
    return { selectors: rows.map((r) => `${row(r)} td`), label: rows.length === 1 ? `row ${rows[0] + 1}` : n(rows.length, 'row') };
  }
  if (rows.length * cols.length > MAX_STYLED_CELLS) return { error: `Style at most ${MAX_STYLED_CELLS} cells at a time, or use a row or column scope.` };
  const selectors = rows.flatMap((r) => cols.map((c) => `${row(r)} ${col(c)}`));
  return { selectors, label: selectors.length === 1 ? `${letter(c1)}${rows[0] + 1}` : n(selectors.length, 'cell') };
}

function setStyle(property, value, verb, target = targets(els.scope.value)) {
  if (state.broken) return Promise.resolve(false);
  if (target.error) {
    say(target.error, 'warn');
    return Promise.resolve(false);
  }
  const rules = readRules(state.text, state.scan);
  for (const selector of target.selectors) {
    const decls = new Map(rules.get(selector) ?? []);
    if (value === null) decls.delete(property);
    else decls.set(property, value);
    rules.set(selector, decls);
  }
  return change(writeRules(state.text, state.scan, rules), `${verb}: ${target.label}`)
    .then((ok) => {
      if (ok && value !== null) verifyStyle(target, property, value, verb);
      return ok;
    });
}

function toggleStyle(property, value) {
  const target = targets(els.scope.value);
  if (target.error) {
    say(target.error, 'warn');
    return Promise.resolve(false);
  }
  const rules = readRules(state.text, state.scan);
  const on = target.selectors.every((s) => rules.get(s)?.get(property) === value);
  return setStyle(property, on ? null : value, on ? `Removed ${value}` : value[0].toUpperCase() + value.slice(1), target);
}

function unstyle() {
  if (state.broken) return Promise.resolve(false);
  const target = targets(els.scope.value);
  if (target.error) {
    say(target.error, 'warn');
    return Promise.resolve(false);
  }
  const rules = readRules(state.text, state.scan);
  let removed = 0;
  for (const s of target.selectors) if (rules.delete(s)) removed++;
  if (!removed) {
    say(`The sheet has no style for ${target.label}.`, 'warn');
    return Promise.resolve(false);
  }
  return change(writeRules(state.text, state.scan, rules), `Removed the style of ${target.label}`);
}

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};

// The new rule joins the author's cascade, so a more specific rule in the
// style block can still win. Count the cells where it actually shows.
function verifyStyle(target, property, value, verb) {
  const cells = front.table ? front.table.querySelectorAll(target.selectors.join(',')) : [];
  const test = {
    'font-weight': (s) => Number(s.fontWeight) >= 700,
    'font-style': (s) => s.fontStyle === 'italic',
    color: (s) => s.color === rgb(value),
    background: (s) => s.backgroundColor === rgb(value) && s.backgroundImage === 'none',
  }[property];
  let shown = 0;
  for (const cell of cells) if (test(getComputedStyle(cell))) shown++;
  const rows = new Set(Array.from(cells, (c) => c.parentElement)).size;
  const where = `${verb}: ${target.label}${target.shared ? ` (${rows} rows)` : ''}`;
  if (shown === cells.length) say(`${where}.`);
  else if (cells.length === 1) say(`${where}: a more specific rule in the style block wins on this cell.`, 'warn');
  else say(`${where}: shows on ${shown} of ${cells.length} cells; more specific rules in the style block win on the rest.`, 'warn');
  state.lastVerify = { selectors: target.selectors.length, property, shown, total: cells.length };
}

// --- Status bar --------------------------------------------------------------------

// Exact decimal arithmetic on the fields as written (10.3): no binary floats.
const toScaled = (s) => {
  const [i, f = ''] = s.replace('-', '').split('.');
  return { n: BigInt((s.startsWith('-') ? '-' : '') + i + f), scale: f.length };
};
const fromScaled = (n, scale) => {
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString().padStart(scale + 1, '0');
  return (neg ? '-' : '') + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits);
};

function updateStats() {
  const { r1, r2, c1, c2 } = range();
  let count = 0;
  const nums = [];
  for (let r = Math.max(1, r1); r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const v = raw(r, c);
      if (v === '') continue;
      count++;
      if (NUMBER.test(v)) nums.push(toScaled(v));
    }
  }
  if (count <= 1 && nums.length <= 1) {
    els.stats.textContent = '';
    return;
  }
  if (!nums.length) {
    els.stats.innerHTML = `Count <b>${count}</b>`;
    return;
  }
  const scale = Math.max(...nums.map((x) => x.scale));
  const scaled = nums.map((x) => x.n * 10n ** BigInt(scale - x.scale));
  const sum = scaled.reduce((a, b) => a + b, 0n);
  const q = sum * 100n;
  const k = BigInt(nums.length);
  const avg = (q + (q >= 0n ? k / 2n : -k / 2n)) / k; // two more digits, half away from zero
  const min = scaled.reduce((a, b) => (b < a ? b : a));
  const max = scaled.reduce((a, b) => (b > a ? b : a));
  const nf = new Intl.NumberFormat(state.locale, { maximumFractionDigits: 20 });
  const fmt = (n, s) => nf.format(fromScaled(n, s));
  els.stats.innerHTML = `Sum <b>${fmt(sum, scale)}</b> · Average <b>${fmt(avg, scale + 2)}</b> · Min <b>${fmt(min, scale)}</b> · Max <b>${fmt(max, scale)}</b> · Count <b>${count}</b>`;
}

let sayTimer;
function say(text, kind = '') {
  els.msg.textContent = text;
  els.msg.className = kind;
  els.msg.title = text;
  clearTimeout(sayTimer);
  if (kind !== 'error') sayTimer = setTimeout(() => { els.msg.textContent = ''; }, 9000);
}

// --- Source panel, files, locale -------------------------------------------------

function updateSourceInfo() {
  if (els.sourcePanel.hidden) return;
  const lines = state.text.split('\n').length;
  els.sourceInfo.textContent = `${lines.toLocaleString()} lines · ${state.text.length.toLocaleString()} characters`;
}

// Coloring the 100 KB ledger takes about 80 ms with layout, too slow for
// every keystroke, so longer files are colored when typing pauses.
const COLOR_AS_YOU_TYPE = 20000;

function highlightSource() {
  // A <pre> drops a final newline; add a line so the caret's last line fits.
  els.sourceHl.replaceChildren(highlightCssv(els.source.value), '\n ');
  els.sourcePanel.classList.remove('typing');
}

function showSource(text) {
  if (els.source.value !== text) els.source.value = text;
  highlightSource();
}

let sourceTimer;
els.source.addEventListener('input', () => {
  if (els.source.value.length < COLOR_AS_YOU_TYPE) highlightSource();
  else els.sourcePanel.classList.add('typing');
  clearTimeout(sourceTimer);
  sourceTimer = setTimeout(() => {
    highlightSource();
    if (els.source.value === state.text) return;
    state.undo.push(state.text);
    state.redo.length = 0;
    setText(els.source.value, { message: 'Source edited', fromSource: true });
  }, 350);
});

// The grid and the text side by side is the point of the editor, so the
// source is open by default where there's room; the choice is remembered.
const SOURCE_KEY = 'cssv-editor:source';
function setSourceOpen(open, remember = true) {
  els.sourcePanel.hidden = !open;
  $('toggle-source').setAttribute('aria-pressed', String(open));
  if (open) {
    showSource(state.text);
    updateSourceInfo();
  }
  if (remember) {
    try {
      localStorage.setItem(SOURCE_KEY, open ? 'open' : 'closed');
    } catch {
      // storage is off; the choice lasts for this page
    }
  }
}
$('toggle-source').addEventListener('click', () => setSourceOpen(els.sourcePanel.hidden));
{
  let saved = null;
  try {
    saved = localStorage.getItem(SOURCE_KEY);
  } catch {
    // storage is off
  }
  setSourceOpen(saved ? saved === 'open' : innerWidth >= 1200, false);
}

// `label` is what the app bar shows: the repository path, or the file's name.
function load(text, name, { base = document.baseURI, label = name, key = `local:${name}`, handle = null } = {}) {
  showEditor();
  state.name = name;
  state.key = key;
  state.handle = handle;
  state.base = base;
  state.original = text;
  state.undo.length = 0;
  state.redo.length = 0;
  els.fileName.textContent = label;
  els.sourcePanel.querySelector('strong').textContent = name;
  document.title = `${name} · CSSV Editor`;
  state.anchor = { r: 1, c: 0 };
  state.focus = { r: 1, c: 0 };
  offerDraft(text);
  return setText(text, { message: `Opened ${label}`, keep: false });
}

// A file from the site. <cssv-table> loads it through src first, so that the
// style block's relative URLs resolve against the file; the text then goes
// to update() as with every change, and update() keeps that base.
async function openFile(path) {
  if (!FILES.includes(path)) return showHome(`There's no file ${path} on this site.`);
  showEditor();
  const url = new URL(urlOf(path), location.href).href;
  let text;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (error) {
    return showHome(`Could not load ${path} (${error.message}).`);
  }
  front.src = url;
  await front.ready;
  return load(text, path.slice(path.lastIndexOf('/') + 1), { base: url, label: path, key: path });
}

// A file from the computer. Its relative URLs can't reach the files next to
// it, so they resolve against this page. The address goes back to the home,
// which a reload then shows.
async function openLocal(file, handle = null) {
  if (location.search) history.replaceState(null, '', './');
  return load(await file.text(), file.name, { handle });
}

function showEditor() {
  document.body.classList.remove('home');
  els.home.hidden = true;
  $('main').hidden = false;
  els.skip.href = '#viewport';
}

function showHome(note = '') {
  document.body.classList.add('home');
  els.home.hidden = false;
  $('main').hidden = true;
  els.skip.href = '#home';
  document.title = 'CSSV Editor';
  els.homeNote.textContent = note;
  els.homeNote.hidden = !note;
  renderHome(els.groups);
  return Promise.resolve(false);
}

// Where the browser offers file handles (Chromium), Save can later write back
// to the opened file; elsewhere the file input opens it.
async function pickFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await showOpenFilePicker({ types: [{ description: 'CSSV or CSV file', accept: { 'text/plain': ['.cssv', '.csv', '.txt'] } }] });
      return openLocal(await handle.getFile(), handle);
    } catch (error) {
      if (error.name === 'AbortError') return false;
      // the picker failed; use the file input
    }
  }
  $('file').click();
  return false;
}
$('open').addEventListener('click', pickFile);
$('open-local').addEventListener('click', pickFile);
$('file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) openLocal(file);
  e.target.value = '';
});
addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('Files')) e.preventDefault();
});
addEventListener('drop', (e) => {
  const item = [...e.dataTransfer.items].find((i) => i.kind === 'file');
  if (!item) return;
  e.preventDefault();
  const file = item.getAsFile();
  // Chromium also gives a handle to save to; it must be asked for during the event.
  const handle = item.getAsFileSystemHandle?.();
  Promise.resolve(handle).catch(() => null).then((h) => openLocal(file, h?.kind === 'file' ? h : null));
});

// The page's Content-Security-Policy blocks whatever an opened file loads
// from other services (11.2); say so once per host.
const blockedHosts = new Set();
document.addEventListener('securitypolicyviolation', (e) => {
  let host = e.blockedURI;
  try {
    host = new URL(e.blockedURI).host;
  } catch {
    // "inline" or "eval": not something a file loads
  }
  if (!host.includes('.') || blockedHosts.has(host)) return;
  blockedHosts.add(host);
  say(`Blocked ${[...blockedHosts].join(', ')}: the editor loads nothing from other services, so the file shows without what it imports from there. The file itself is unchanged.`, 'warn');
});

// Leaving the page (a card, the home link, a reload) loses unsaved edits.
addEventListener('beforeunload', (e) => {
  if (state.text !== state.original) e.preventDefault();
});

// --- Drafts and saving -----------------------------------------------------------

// While a file differs from what was opened or last saved, its text is kept
// in this browser's storage, so a reload or a crash doesn't lose the work.
// Saving deletes the draft. Nothing leaves the browser.
function readDraft(key) {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS + key));
  } catch {
    return null;
  }
}

let draftTimer;
let draftFailed = false;
function keepDraft() {
  clearTimeout(draftTimer);
  const { key, text, original } = state;
  draftTimer = setTimeout(() => {
    if (!key) return;
    try {
      if (text === original) localStorage.removeItem(DRAFTS + key);
      else localStorage.setItem(DRAFTS + key, JSON.stringify({ text, original, saved: Date.now() }));
    } catch {
      if (!draftFailed) say('This browser keeps no draft (its storage is off or full). Save the file to keep your changes.', 'warn');
      draftFailed = true;
    }
  }, 400);
}

function offerDraft(text) {
  const draft = readDraft(state.key);
  state.draft = draft?.text !== undefined && draft.text !== text ? draft : null;
  els.draft.hidden = !state.draft;
  if (!state.draft) return;
  const when = new Date(draft.saved).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  $('draft-when').textContent = draft.original === text ? when : `${when} (the file has changed since)`;
}

$('draft-restore').addEventListener('click', () => {
  const { draft } = state;
  state.draft = null;
  els.draft.hidden = true;
  if (draft) change(draft.text, 'Restored your unsaved changes');
});
$('draft-discard').addEventListener('click', () => {
  state.draft = null;
  els.draft.hidden = true;
  keepDraft(); // stores the current text, or removes the draft when it matches the file
  say('Discarded the unsaved changes');
});

function download(text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = state.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Saving writes back to the opened file where the browser can (Chromium's
// File System Access API) and asks where to save a file it has no handle
// for. Browsers without the API, such as Firefox, download the file.
async function save() {
  if (state.editing) await closeEditor(true);
  if (els.source.value !== state.text && !els.sourcePanel.hidden) {
    clearTimeout(sourceTimer);
    await change(els.source.value, 'Source edited');
  }
  const text = state.text;
  try {
    if (!state.handle && window.showSaveFilePicker) {
      state.handle = await showSaveFilePicker({ suggestedName: state.name, types: [{ description: 'CSSV file', accept: { 'text/plain': ['.cssv', '.csv', '.txt'] } }] });
    }
    let message;
    if (state.handle) {
      const writable = await state.handle.createWritable();
      await writable.write(text);
      await writable.close();
      message = `Saved ${state.handle.name}`;
    } else {
      download(text);
      message = `Downloaded ${state.name}`;
    }
    state.original = text;
    els.dirty.hidden = state.text === state.original;
    keepDraft();
    say(message);
    return true;
  } catch (error) {
    if (error.name !== 'AbortError') say(`Could not save: ${error.message}`, 'error');
    return false;
  }
}
$('save').addEventListener('click', save);
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !document.body.classList.contains('home')) {
    e.preventDefault();
    save();
  }
}, true);

// A new lang re-renders the same text, which <cssv-table> does in place.
els.locale.addEventListener('change', async () => {
  state.locale = els.locale.value;
  const started = performance.now();
  const done = loadend(front);
  front.setAttribute('lang', state.locale);
  await done;
  measure();
  say(`Locale ${state.locale}: numbers are shown the ${state.locale} way; the file is unchanged`);
  nextFrame().then(() => timing('update', 'locale', started));
});

$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('sort-asc').addEventListener('click', () => sortRows(1));
$('sort-desc').addEventListener('click', () => sortRows(-1));
$('row-add').addEventListener('click', addRow);
$('row-del').addEventListener('click', deleteRows);
$('col-add').addEventListener('click', insertColumn);
$('col-del').addEventListener('click', deleteColumns);
$('col-left').addEventListener('click', () => moveColumns(-1));
$('col-right').addEventListener('click', () => moveColumns(1));
$('bold').addEventListener('click', () => toggleStyle('font-weight', 'bold'));
$('italic').addEventListener('click', () => toggleStyle('font-style', 'italic'));
$('unstyle').addEventListener('click', unstyle);
for (const [id, property, verb] of [['color', 'color', 'Text color'], ['fill', 'background', 'Fill']]) {
  const input = $(id);
  input.addEventListener('input', () => input.parentElement.style.setProperty('--swatch', input.value));
  input.addEventListener('change', () => setStyle(property, input.value, `${verb} ${input.value}`));
}

// For the browser checks in the scratchpad.
window.sheet = {
  state, select, sortRows, addRow, deleteRows, insertColumn, deleteColumns, moveColumns, pasteValues, parseTsv,
  undo, redo, setStyle, toggleStyle, normalize, openEditor, closeEditor,
  edit: (value) => commitValue(state.anchor.r, state.anchor.c, value),
  get front() { return front; },
  get geo() { return state.geo; },
};

state.locale = els.locale.value;
const file = new URLSearchParams(location.search).get('file');
window.sheet.loaded = file === null ? showHome() : openFile(file);
