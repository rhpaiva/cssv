// Behavior for the CSSV website. The tables themselves need none of this:
// <cssv-table> renders them. This adds the playground, the inspector, tabs,
// "View source" panels and copy buttons.
import { highlightCssv, highlighters, span } from './highlight.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

await customElements.whenDefined('cssv-table');

// The text a renderer reads from an inline <script type="text/cssv"> (SPEC Appendix C).
const inlineText = (table) =>
  ($(':scope > script[type="text/cssv"]', table)?.textContent ?? '')
    .replace(/^(?:[ \t]*\r?\n)+/, '')
    .trimEnd();

async function sourceOf(table) {
  const src = table.getAttribute('src');
  if (src === null) return { text: inlineText(table), name: 'inline <script type="text/cssv">' };
  const res = await fetch(new URL(src, document.baseURI));
  if (!res.ok) throw new Error(`Could not load ${src} (HTTP ${res.status}).`);
  return { text: await res.text(), name: src.replace(/^(?:\.\.\/)+/, ''), url: res.url };
}

// Tabs ------------------------------------------------------------------

for (const list of $$('[role="tablist"]')) {
  const tabs = $$('[role="tab"]', list);
  const select = (tab, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
    list.dispatchEvent(new CustomEvent('tabchange', { detail: tab }));
  };
  list.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) select(tab);
  });
  list.addEventListener('keydown', (event) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(tabs[(next + tabs.length) % tabs.length], true);
  });
}

// Code blocks: highlighting and copy buttons -----------------------------

function copyButton(getText, label = 'Copy') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy';
  button.textContent = label;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => { button.textContent = label; }, 1400);
  });
  return button;
}

for (const pre of $$('pre.code[data-lang]')) {
  const code = $('code', pre);
  const text = code.textContent;
  code.replaceChildren(highlighters[pre.dataset.lang](text));
  const wrap = document.createElement('div');
  wrap.className = 'code-wrap';
  pre.replaceWith(wrap);
  wrap.append(pre, copyButton(() => text));
}

// "View source" panels ---------------------------------------------------

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>';
let panels = 0;

function sourceToggle(table, container, label = 'View source') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'source-toggle';
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `${ICON}<span>${label}</span>`;
  let panel = null;
  button.addEventListener('click', async () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    button.lastElementChild.textContent = open ? 'Hide source' : label;
    panel ??= buildPanel(table, container);
    const el = await panel;
    button.setAttribute('aria-controls', el.id);
    el.hidden = button.getAttribute('aria-expanded') !== 'true';
  });
  return button;
}

async function buildPanel(table, container) {
  const panel = document.createElement('div');
  panel.className = 'source-panel';
  panel.id = `source-${++panels}`;
  panel.hidden = true;
  const head = document.createElement('div');
  head.className = 'pane-head';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  pre.append(code);
  panel.append(head, pre);
  container.append(panel);
  try {
    const source = await sourceOf(table);
    head.append(span('pane-title', source.name), copyButton(() => source.text));
    code.append(highlightCssv(source.text));
  } catch (error) {
    head.textContent = error.message;
  }
  return panel;
}

for (const figure of $$('figure.dogfood')) {
  const table = $('cssv-table', figure);
  let caption = $('figcaption', figure);
  if (caption) {
    const text = document.createElement('span');
    text.append(...caption.childNodes);
    caption.append(text);
  } else {
    caption = document.createElement('figcaption');
    caption.append(span('', 'A .cssv file, like every table on this page.'));
    figure.append(caption);
  }
  caption.append(sourceToggle(table, figure, 'View .cssv'));
}

for (const example of $$('.example')) {
  $(':scope > header', example).append(sourceToggle($('cssv-table', example), example));
}

// Playground -------------------------------------------------------------

{
  const textarea = $('#pg-text');
  const highlight = $('.editor-hl');
  const table = $('#pg-table');
  const script = $('script', table);
  const status = $('#pg-status');
  const markdown = $('#pg-md');
  const empty = document.createElement('p');
  empty.className = 'pg-empty';
  empty.hidden = true;
  table.after(empty);
  let run = 0;

  async function report() {
    const mine = ++run;
    await new Promise((resolve) => setTimeout(resolve)); // let the element schedule its render
    await table.ready;
    if (mine !== run) return;
    const { model, errors } = table;
    const first = errors[0];
    if (!model) {
      status.className = 'status fail';
      status.textContent = first ? `§${first.section} ${first.message}` : 'Nothing to render';
      empty.textContent = 'Nothing is shown: a malformed file renders no table (SPEC 3.4, 5).';
      empty.hidden = false;
      markdown.textContent = '';
      return;
    }
    empty.hidden = true;
    status.className = first ? 'status warn' : 'status ok';
    status.title = first ? '' : `Delimiter: ${model.delimiter}`;
    if (first) status.textContent = `§${first.section} ${first.message}`;
    else {
      status.textContent = `${model.rows.length} ${model.rows.length === 1 ? 'row' : 'rows'} × ${model.columns.length} columns`;
      // Imported stylesheets open in a new tab, so the whole look can be read.
      for (const [, href] of (model.style ?? '').matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)) {
        const link = document.createElement('a');
        link.href = new URL(href, document.baseURI).href;
        link.target = '_blank';
        link.textContent = href;
        status.append(' · imports ', link);
      }
    }
    markdown.textContent = table.toMarkdown();
  }

  // The table renders a moment after typing stops, so a board flips once per edit.
  let pending;
  function update({ now = false } = {}) {
    const text = textarea.value;
    // A <pre> drops a final newline; add a line so the caret's last line fits.
    highlight.firstElementChild.replaceChildren(highlightCssv(text), '\n ');
    clearTimeout(pending);
    pending = setTimeout(() => {
      script.textContent = text;
      report();
    }, now ? 0 : 250);
  }

  textarea.addEventListener('input', () => update());
  textarea.addEventListener('scroll', () => { highlight.scrollLeft = textarea.scrollLeft; });
  // The hero's file is site/departures.cssv; the editor starts from it.
  fetch('departures.cssv')
    .then((res) => {
      if (!res.ok) throw new Error(`Could not load departures.cssv (HTTP ${res.status}).`);
      return res.text();
    })
    .then((text) => {
      textarea.value = text;
      update({ now: true });
    })
    .catch((error) => {
      status.className = 'status fail';
      status.textContent = error.message;
    });
}

// How it works: source, live table model, inspector ----------------------

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// Indented HTML for a rendered table, read from the live DOM.
function serialize(table) {
  const attrs = (el) => [...el.attributes].map((a) => ` ${a.name}="${escapeAttr(a.value)}"`).join('');
  const lines = [`<table${attrs(table)}>`, '  <colgroup>'];
  for (const col of table.querySelectorAll('col')) lines.push(`    <col${attrs(col)}>`);
  lines.push('  </colgroup>');
  for (const section of [table.tHead, table.tBodies[0]]) {
    lines.push(`  <${section.localName}>`);
    for (const tr of section.rows) {
      lines.push(`    <tr${attrs(tr)}>`);
      for (const cell of tr.cells) {
        lines.push(`      <${cell.localName}${attrs(cell)}>${escapeHtml(cell.textContent)}</${cell.localName}>`);
      }
      lines.push('    </tr>');
    }
    lines.push(`  </${section.localName}>`);
  }
  lines.push('</table>');
  return lines.join('\n');
}

{
  const table = $('#how-table');
  const stage = $('#how-stage');
  const box = $('#inspect-box');
  const inspector = $('#inspector');
  const idle = inspector.innerHTML;

  sourceOf(table)
    .then(({ text }) => $('#how-source').replaceChildren(highlightCssv(text)))
    .catch((error) => { $('#how-source').textContent = error.message; });

  table.ready.then(() => {
    if (table.table) $('#how-model').replaceChildren(highlighters.html(serialize(table.table)));
  });

  // One selector that reaches the cell, using only the table model's hooks.
  function selectorFor(cell) {
    const out = document.createDocumentFragment();
    const attr = (name, value) => out.append(span('t-q', '['), span('t-hook', name), span('t-q', `="${value}"]`));
    const tr = cell.parentElement;
    if (cell.localName === 'th') out.append('thead th');
    else {
      out.append('tr');
      attr('data-row', tr.dataset.row);
      if (tr.dataset.key !== undefined) attr('data-key', tr.dataset.key);
      out.append(' > td');
    }
    attr('data-col', cell.dataset.col);
    for (const cls of cell.classList) out.append(span('t-hook', `.${cls}`));
    return out;
  }

  const code = (text) => {
    const el = document.createElement('code');
    el.textContent = text;
    return el;
  };

  function describe(cell) {
    const line = document.createElement('div');
    line.className = 'facts-line';
    if (cell.localName === 'th') {
      line.append(cell.classList.contains('number')
        ? 'The header of a number column: every value below it is a number.'
        : 'A column header. It holds the column name as written.');
      return line;
    }
    const field = table.model.rows[Number(cell.parentElement.dataset.row) - 2].fields[cell.cellIndex];
    if (field === '') {
      line.append('An empty field. The cell has no child nodes, so ', code('td:empty'), ' matches it.');
      return line;
    }
    line.append('In the file: ', code(field), ' · Shown: ', code(cell.textContent));
    if (field !== cell.textContent) line.append(' (formatted for the reader)');
    return line;
  }

  let current = null;
  function inspect(cell) {
    if (cell === current) return;
    current = cell;
    const s = stage.getBoundingClientRect();
    const r = cell.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left - s.left}px`, top: `${r.top - s.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    box.hidden = false;
    const sel = document.createElement('div');
    sel.className = 'sel';
    sel.append(selectorFor(cell));
    inspector.replaceChildren(sel, describe(cell));
  }

  // pointerover would only reach the host when the pointer enters from outside
  // the table: moving between cells inside the shadow tree is hidden from it.
  // pointermove and pointerdown always reach it, and the shadow roots are open,
  // so the composed path leads to the cell.
  const onPointer = (event) => {
    const cell = event.composedPath().find((n) => n.localName === 'td' || n.localName === 'th');
    if (cell) inspect(cell);
  };
  table.addEventListener('pointermove', onPointer);
  table.addEventListener('pointerdown', onPointer);
  stage.addEventListener('pointerleave', () => {
    current = null;
    box.hidden = true;
    inspector.innerHTML = idle;
  });
}

// Localization -----------------------------------------------------------

{
  const table = $('#locale-table');
  $('#locale-source').replaceChildren(highlightCssv(inlineText(table)));
  $('#locale-picker').addEventListener('change', (event) => table.setAttribute('lang', event.target.value));
}

// AI agents: the skill file, shown and copied from the same file as the download.
async function showSkill() {
  const code = $('#skill-source');
  const copy = $('#skill-copy');
  try {
    const res = await fetch('../skills/cssv/SKILL.md');
    if (!res.ok) throw new Error(`Could not load SKILL.md (HTTP ${res.status}).`);
    const text = await res.text();
    code.replaceChildren(highlighters.md(text));
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Copy failed';
      }
      setTimeout(() => { copy.textContent = 'Copy it'; }, 1400);
    });
  } catch (error) {
    code.textContent = error.message;
    copy.disabled = true;
  }
}
showSkill();
