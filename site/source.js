// "View source" on the examples pages: a button that opens the files a
// card's tables render, highlighted, each under a bar with its name, its
// size, Copy and Open file. Styles are in source.css.
import { highlightCss, highlightCssv } from './highlight.js';
import { inlineText, parse } from '../src/core.js';

const FENCE = /^﻿?---[ \t]*$/; // SPEC 3.4
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>';
const files = new Map();

export function read(path) {
  if (!files.has(path)) {
    files.set(path, fetch(path).then((res) => {
      if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status}).`);
      return res.text();
    }));
  }
  return files.get(path);
}

// A table's file: its src, or its inline script, normalized the way the
// renderer normalizes it (SPEC Appendix C).
export async function sourceOf(table) {
  const src = table.getAttribute('src');
  if (src !== null) return { name: src, text: await read(src), url: new URL(src, document.baseURI).href };
  const script = table.querySelector(':scope > script[type="text/cssv"]');
  return { name: 'inline <script type="text/cssv">', text: inlineText(script?.textContent ?? ''), url: null };
}

// The style block and the data section, split at the fences.
export function split(text) {
  const lines = text.split('\n');
  if (!FENCE.test(lines[0])) return { style: '', data: text };
  const end = lines.findIndex((line, i) => i > 0 && FENCE.test(line));
  return { style: lines.slice(1, end).join('\n'), data: lines.slice(end + 1).join('\n') };
}

// Lines of CSS, not counting comments or blank lines.
export function cssLines(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => line.trim()).length;
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// One file in a source panel: a bar with its name, its size and the
// actions, then its text. The size is the file's, not the table's: a page
// may have handed the table other records with update() since.
function pane(source) {
  const css = source.name.endsWith('.css');
  const bar = document.createElement('div');
  bar.className = 'source-bar';
  const info = document.createElement('div');
  info.className = 'meta';
  const name = document.createElement('strong');
  name.textContent = source.name;
  info.append(name);
  let model = null;
  try {
    if (!css) model = parse(source.text);
  } catch {
    // The table reports the file's errors; the panel shows the text anyway.
  }
  if (model) {
    const size = document.createElement('span');
    size.textContent = `${plural(model.rows.length, 'record')} × ${plural(model.columns.length, 'column')}`;
    info.append(size);
    if (model.delimiter === ';') {
      const delimiter = document.createElement('span');
      delimiter.textContent = 'semicolon-delimited';
      info.append(delimiter);
    }
  }
  const actions = document.createElement('div');
  actions.className = 'actions';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(source.text);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Copy failed';
    }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1400);
  });
  actions.append(copy);
  if (source.url) {
    const open = document.createElement('a');
    open.className = 'open';
    open.href = source.url;
    open.target = '_blank';
    open.textContent = 'Open file';
    actions.append(open);
  }
  bar.append(info, actions);
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.append(css ? highlightCss(source.text) : highlightCssv(source.text));
  pre.append(code);
  return [bar, pre];
}

// A card's source panel: every file its tables render, then the
// stylesheet they share.
let panels = 0;
async function buildPanel(tables, shared) {
  const panel = document.createElement('div');
  panel.className = 'source';
  panel.id = `source-${++panels}`;
  const jobs = tables.map(async (table) => pane(await sourceOf(table)));
  if (shared) jobs.push(read(shared).then((text) => pane({ name: shared, text, url: new URL(shared, document.baseURI).href })));
  for (const job of jobs) {
    try {
      panel.append(...await job);
    } catch (error) {
      const bar = document.createElement('div');
      bar.className = 'source-bar';
      bar.textContent = error.message;
      panel.append(bar);
    }
  }
  return panel;
}

// The "View source" button for a card's tables. The panel is built on the
// first click and handed to insert(), which puts it in the card. When a
// table's src changes (the paginated card), it is built again for the new
// file. Other renders, such as update() on every frame of a film, leave it.
export function sourceButton(tables, { shared, insert }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'source-toggle';
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `${ICON}<span>View source</span>`;

  let panel = null;
  let shown = '';
  let building = null;
  const srcs = () => tables.map((table) => table.getAttribute('src')).join('\n');
  async function sync() {
    const open = button.getAttribute('aria-expanded') === 'true';
    const now = srcs();
    if (panel && shown !== now) {
      panel.remove();
      panel = null;
      button.removeAttribute('aria-controls');
    }
    if (panel || !open) {
      if (panel) panel.hidden = !open;
      return;
    }
    if (building === now) return;
    building = now;
    const el = await buildPanel(tables, shared);
    if (building !== now) return;
    building = null;
    panel = el;
    shown = now;
    insert(el);
    button.setAttribute('aria-controls', el.id);
    sync();
  }
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    button.lastElementChild.textContent = open ? 'Hide source' : 'View source';
    sync();
  });
  for (const table of tables) table.addEventListener('cssv-load', sync);
  return button;
}
