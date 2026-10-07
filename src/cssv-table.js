// <cssv-table>: a CSSV v1 renderer for browsers. Section numbers refer to SPEC.md.
//
// Structure (both shadow roots are open, for inspection and tests):
//
//   <cssv-table>                      host, in the page
//     #shadow-root (outer)            renderer-owned: the page and the file can't style .clip
//       <div class="clip">            contain: paint (11.4); hidden until the first step 6 (8.3)
//         <div class="frame">         host of the inner root
//           #shadow-root (inner)      the file's styles live here (8.1)
//             <style> defaults (8.2)
//             <style> style block (4)
//             <table part="table">    the table model (7)
//         <div class="frame next">    while a table is shown, the next one is built here, out of sight
//
// The second shadow root keeps paint containment out of reach of the author
// stylesheet: it can match its own :host (.frame) but never .clip.
//
// When a new render keeps the shown table's columns, and its style block
// differs only in rules that need no loading, the shown table is updated in
// place instead of rebuilt: changed rules (through the CSSOM), changed cells,
// added and removed rows, then keys and formats again. The result is the
// table a full render would build.

import {
  parse, inlineText, DEFAULT_CSS, rewriteCssUrls, parseCssvValue, parseKey, parseFormat, formatNumber,
  defaultDisplay, display, keyIndex, toMarkdown, CssvError,
} from './core.js';

const OUTER_CSS = `
:host { display: block; }
:host([hidden]) { display: none; }
.clip { display: block; contain: paint; width: max-content; min-width: 100%; }
.clip.pending { opacity: 0; }
.frame.next { content-visibility: hidden; } /* no size, no paint; styles still compute for steps 4 and 5 */
`;

const IMPORT_FAILED = 'An imported stylesheet failed to load; the rest of the styles still apply.';

function styleElement(css) {
  const el = document.createElement('style');
  el.textContent = css;
  return el;
}

// Resolves true on load, false when any import failed. A <style> element
// fires load or error once its imports, including nested ones, are done.
function settled(style) {
  return new Promise((resolve) => {
    style.addEventListener('load', () => resolve(true), { once: true });
    style.addEventListener('error', () => resolve(false), { once: true });
  });
}

function el(tag, attrs = {}, text = '') {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text !== '') node.textContent = text; // 7.4: always text, never HTML
  return node;
}

// A host for an inner shadow root, which holds one table and its styles.
function frameElement() {
  const frame = el('div', { class: 'frame', exportparts: 'table' });
  frame.attachShadow({ mode: 'open' });
  return frame;
}

// 8.3 step 2: a body row, with numbers in their default display.
function buildRow(row, columns, locale) {
  const tr = el('tr', { 'data-row': String(row.number) });
  row.fields.forEach((field, c) => {
    const { type, sign } = row.types[c];
    const attrs = { 'data-col': columns[c] };
    if (type === 'number') attrs.class = `number ${sign}`;
    tr.append(el('td', attrs, display(field, type, locale)));
  });
  return tr;
}

// 8.3 step 2: the table model with numbers in their default display.
function buildTable(model, locale) {
  const table = el('table', { part: 'table' });
  const colgroup = el('colgroup');
  const headRow = el('tr', { 'data-row': '1' });
  model.columns.forEach((name, c) => {
    colgroup.append(el('col', { 'data-col': name }));
    headRow.append(el('th', model.numberColumns[c] ? { 'data-col': name, class: 'number' } : { 'data-col': name }, name));
  });
  const thead = el('thead');
  thead.append(headRow);
  const tbody = el('tbody');
  for (const row of model.rows) tbody.append(buildRow(row, model.columns, locale));
  table.append(colgroup, thead, tbody);
  return table;
}

// Without a DOM (server-side rendering) the module still loads, so frameworks
// can import it on the server; the element is only defined in browsers.
const Base = globalThis.HTMLElement ?? class {};

export class CssvTable extends Base {
  static observedAttributes = ['src', 'key', 'lang'];

  /** Problems found during the last render: {section, message, fatal}. */
  errors = [];
  /** The parsed file of the last render, or null. */
  model = null;

  #clip;
  #frame; // holds the shown table
  #next = null; // holds the table a pending render builds while #frame is shown
  #run = 0;
  #queued = false;
  #abort = null;
  #observer = null;
  #ready = this.#deferred();
  #text = null; // set by update(); shown instead of src or the inline text until either changes
  #base = null; // the URL relative URLs resolve against: the last file loaded, or the page
  #shown = null; // what the table shows: { model, locale, css, author, importFailed }, or null
  #formats = new WeakMap(); // number cell → the --cssv-format value its text was made with

  constructor() {
    super();
    const outer = this.attachShadow({ mode: 'open' });
    this.#clip = el('div', { class: 'clip pending' });
    this.#frame = frameElement();
    this.#clip.append(this.#frame);
    outer.append(styleElement(OUTER_CSS), this.#clip);
  }

  /** Resolves when the latest render has finished (successfully or not). */
  get ready() {
    return this.#ready.promise;
  }

  /** The rendered table element, or null. */
  get table() {
    return this.#frame.shadowRoot.querySelector('table');
  }

  /** The src attribute, or null when the element reads inline text. */
  get src() {
    return this.getAttribute('src');
  }

  set src(value) {
    if (value === null || value === undefined) this.removeAttribute('src');
    else this.setAttribute('src', value);
  }

  /**
   * Shows `text`, a whole CSSV file, in place of the current content, and
   * returns `ready`. The text stays the content (also across key and lang
   * changes) until src or the inline text changes; src keeps its value.
   * Relative URLs resolve against the last file loaded, or the page.
   */
  update(text) {
    this.#text = String(text);
    if (this.isConnected) this.#schedule();
    return this.ready;
  }

  connectedCallback() {
    // A src set before the element was defined is an own property that hides
    // the accessor; move it to the attribute.
    if (Object.hasOwn(this, 'src')) {
      const value = this.src;
      delete this.src;
      this.src = value;
    }
    this.#observer = new MutationObserver(() => {
      if (this.hasAttribute('src')) return;
      this.#text = null;
      this.#schedule();
    });
    this.#observer.observe(this, { childList: true, subtree: true, characterData: true });
    this.#schedule();
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#abort?.abort();
  }

  attributeChangedCallback(name) {
    if (name === 'src') this.#text = null;
    if (this.isConnected) this.#schedule();
  }

  /** Appendix B: the rendered table as GitHub Flavored Markdown. */
  toMarkdown() {
    const table = this.table;
    if (!table) return '';
    const header = [...table.tHead.rows[0].cells].map((th) => th.textContent);
    // text-decoration is not inherited, so a cell is struck through when it
    // or any ancestor up to the table has line-through.
    const struck = (n) => getComputedStyle(n).textDecorationLine.includes('line-through');
    const tableStruck = struck(table) || struck(table.tBodies[0]);
    const rows = [...table.tBodies[0].rows].map((tr) => {
      const rowStruck = tableStruck || struck(tr);
      return [...tr.cells].map((td) => {
        const cs = getComputedStyle(td);
        return {
          text: td.textContent,
          align: cs.textAlign,
          bold: Number(cs.fontWeight) >= 600,
          italic: /^(italic|oblique)/.test(cs.fontStyle),
          strike: rowStruck || cs.textDecorationLine.includes('line-through'),
          mono: /^monospace\b/.test(cs.fontFamily),
        };
      });
    });
    return toMarkdown({ header, rows }, { direction: getComputedStyle(table).direction });
  }

  #deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve, done: false };
  }

  #schedule() {
    if (document.readyState === 'loading' && !this.hasAttribute('src') && this.#text === null) {
      // Wait for an inline <script type="text/cssv"> to be fully parsed.
      document.addEventListener('DOMContentLoaded', () => this.#schedule(), { once: true });
      return;
    }
    if (this.#queued) return;
    this.#queued = true;
    if (this.#ready.done) this.#ready = this.#deferred();
    queueMicrotask(() => {
      this.#queued = false;
      this.#render();
    });
  }

  #report(section, message, fatal = false) {
    const detail = { section, message, fatal };
    this.errors.push(detail);
    console.warn(`[cssv §${section}] ${message}`);
    this.dispatchEvent(new CustomEvent('cssv-error', { detail, bubbles: true, composed: true }));
  }

  #locale() {
    const lang = this.closest('[lang]')?.getAttribute('lang');
    for (const candidate of [lang, ...navigator.languages, 'en-US']) {
      if (!candidate) continue;
      try {
        return Intl.getCanonicalLocales(candidate)[0];
      } catch {
        // not a valid language tag; try the next one
      }
    }
    return 'en-US';
  }

  async #source(signal) {
    if (this.#text !== null) return { text: this.#text, base: this.#base ?? document.baseURI };
    const src = this.getAttribute('src');
    if (src !== null) {
      const url = new URL(src, document.baseURI);
      const res = await fetch(url, { signal });
      if (!res.ok) throw new CssvError(`Could not load ${url.href} (HTTP ${res.status}).`, 'load');
      this.#base = res.url;
      return { text: await res.text(), base: res.url }; // text() always decodes UTF-8 (3.1)
    }
    this.#base = null;
    const script = this.querySelector(':scope > script[type="text/cssv"]');
    if (!script) return { text: null };
    return { text: inlineText(script.textContent), base: document.baseURI }; // Appendix C
  }

  async #render() {
    const run = ++this.#run;
    let next = null; // the frame this render builds a table in
    this.#next?.remove(); // a render this one replaces will never show its table
    this.#next = null;
    const current = () => run === this.#run;
    this.#abort?.abort();
    const abort = (this.#abort = new AbortController());
    this.errors = [];
    this.dispatchEvent(new CustomEvent('cssv-loadstart'));
    try {
      const { text, base } = await this.#source(abort.signal);
      if (!current()) return;
      if (text === null) {
        this.model = null;
        this.#shown = null;
        this.#frame.shadowRoot.replaceChildren();
        return;
      }
      const model = parse(text); // 8.3 step 1
      const locale = this.#locale();
      if (this.#patch(model, locale, base)) {
        this.model = model;
        this.dispatchEvent(new CustomEvent('cssv-load'));
        return;
      }
      const table = buildTable(model, locale); // step 2
      const css = model.style === null ? '' : rewriteCssUrls(model.style, base);
      const author = styleElement(css);
      const loaded = settled(author);
      // A shown table stays on screen until the new one is ready (step 6):
      // the new one is built in a second frame, out of sight. With nothing
      // shown, the clip is hidden instead.
      if (this.table) {
        next = this.#next = frameElement();
        next.classList.add('next');
        this.#clip.append(next);
      } else {
        next = this.#frame;
        this.#clip.classList.add('pending');
      }
      next.shadowRoot.replaceChildren(styleElement(DEFAULT_CSS), author, table); // step 3
      const ok = await loaded;
      if (!current()) return;
      if (!ok) this.#report('4.2', IMPORT_FAILED);
      this.model = model;
      this.#applyKey(table, model); // step 4
      this.#applyFormats(table, model, locale); // step 5
      if (next !== this.#frame) {
        this.#frame.remove();
        next.classList.remove('next');
        this.#frame = next;
        this.#next = null;
      }
      this.#shown = { model, locale, css, author, importFailed: !ok };
      this.dispatchEvent(new CustomEvent('cssv-load'));
    } catch (error) {
      if (!current() || error.name === 'AbortError') return;
      this.model = null;
      this.#shown = null;
      this.#frame.shadowRoot.replaceChildren(); // 3.4, 5: no part of a malformed file is shown
      this.#report(error.section ?? 'load', error.message, true);
    } finally {
      if (next && next !== this.#frame) next.remove(); // replaced, aborted or failed
      if (current()) {
        this.#clip.classList.remove('pending'); // step 6
        this.#ready.done = true;
        this.#ready.resolve();
        // Replaced renders end silently, so the last cssv-loadstart is always
        // followed by exactly one cssv-loadend.
        this.dispatchEvent(new CustomEvent('cssv-loadend'));
      }
    }
  }

  // Brings the shown table in line with `model` without rebuilding it, when
  // that gives the table a full render would build. Changes nothing and
  // returns false when it can't: no table, other columns, or a style block
  // whose change needs loading.
  #patch(model, locale, base) {
    const shown = this.#shown;
    const table = this.table;
    if (!shown || !table) return false;
    const old = shown.model;
    if (old.columns.length !== model.columns.length) return false;
    if (old.columns.some((name, c) => name !== model.columns[c])) return false; // names are on every cell
    const css = model.style === null ? '' : rewriteCssUrls(model.style, base);
    if (css !== shown.css) {
      const restyle = this.#planStyle(css);
      if (!restyle) return false;
      try {
        restyle();
      } catch {
        return false; // the full render replaces the stylesheet anyway
      }
    }
    // Rows that match at the start and at the end stay as they are. Between
    // them, rows are changed cell by cell, and the remainder is added or
    // removed: one inserted row becomes one new <tr>.
    const tbody = table.tBodies[0];
    const rows = tbody.rows;
    const n = old.rows.length;
    const m = model.rows.length;
    const same = (a, b) => a.fields.every((field, c) => field === b.fields[c]);
    let top = 0;
    while (top < n && top < m && same(old.rows[top], model.rows[top])) top++;
    let bottom = 0;
    while (bottom < n - top && bottom < m - top && same(old.rows[n - 1 - bottom], model.rows[m - 1 - bottom])) bottom++;
    const end = Math.min(n, m) - bottom; // rows in [top, end) are in both, changed
    for (let i = top; i < end; i++) {
      const before = old.rows[i].fields;
      model.rows[i].fields.forEach((field, c) => {
        if (field === before[c]) return;
        const td = rows[i].cells[c];
        const { type, sign } = model.rows[i].types[c];
        if (type === 'number') td.className = `number ${sign}`;
        else td.removeAttribute('class');
        td.textContent = display(field, type, locale); // 7.4; formats follow below
        this.#formats.delete(td);
      });
    }
    for (let i = n; i > m; i--) rows[end].remove();
    if (m > n) {
      const added = document.createDocumentFragment();
      for (let i = end; i < end + m - n; i++) added.append(buildRow(model.rows[i], model.columns, locale));
      tbody.insertBefore(added, rows[end] ?? null);
    }
    if (m !== n) {
      // 5.3: the rows after the change move, and their record numbers with them.
      for (let i = end; i < m; i++) {
        const number = String(i + 2);
        if (rows[i].getAttribute('data-row') !== number) rows[i].setAttribute('data-row', number);
      }
    }
    const head = table.tHead.rows[0].cells;
    model.numberColumns.forEach((number, c) => {
      if (number === old.numberColumns[c]) return;
      if (number) head[c].className = 'number';
      else head[c].removeAttribute('class');
    });
    this.#shown = { ...shown, model, locale, css };
    if (shown.importFailed) this.#report('4.2', IMPORT_FAILED);
    this.#applyKey(table, model);
    this.#applyFormats(table, model, locale, locale !== shown.locale);
    return true;
  }

  // The CSSOM edits that turn the author stylesheet into `css`: the rules
  // between the unchanged ones at both ends are replaced. Returns null when
  // an @import would be added or removed, since imports need loading.
  #planStyle(css) {
    const sheet = this.#shown.author.sheet;
    if (!sheet) return null;
    // A document without a browsing context parses rules but loads nothing.
    const doc = document.implementation.createHTMLDocument('');
    const probe = doc.createElement('style');
    probe.textContent = css;
    doc.head.append(probe);
    if (!probe.sheet) return null;
    const prev = [...sheet.cssRules];
    const next = [...probe.sheet.cssRules];
    let start = 0;
    while (start < prev.length && start < next.length && prev[start].cssText === next[start].cssText) start++;
    let end = 0;
    while (end < prev.length - start && end < next.length - start
      && prev[prev.length - 1 - end].cssText === next[next.length - 1 - end].cssText) end++;
    const removed = prev.slice(start, prev.length - end);
    const added = next.slice(start, next.length - end);
    if ([...removed, ...added].some((rule) => rule instanceof CSSImportRule)) return null;
    return () => {
      for (let i = 0; i < removed.length; i++) sheet.deleteRule(start);
      added.forEach((rule, i) => sheet.insertRule(rule.cssText, start + i));
    };
  }

  // 9.1: the host's key attribute, always a column name, wins over
  // --cssv-key, which may also be col(n). Sets, changes or removes data-key
  // on every row, so it also brings an updated table in line.
  #applyKey(table, model) {
    let key;
    if (this.hasAttribute('key')) {
      key = this.getAttribute('key');
    } else {
      const raw = getComputedStyle(table).getPropertyValue('--cssv-key');
      key = parseKey(raw);
      if (key === null) this.#report('9', `--cssv-key has an invalid value: ${raw.trim()}`);
    }
    const k = keyIndex(model, key);
    if (typeof key === 'string' && k < 0) this.#report('9.1', `No column is named "${key}", so rows get no data-key.`);
    if (typeof key === 'number' && k < 0) this.#report('9.1', `col(${key}) is past the last column (${model.columns.length}), so rows get no data-key.`);
    [...table.tBodies[0].rows].forEach((tr, i) => {
      const value = k < 0 ? '' : model.rows[i].fields[k];
      if (value === '') tr.removeAttribute('data-key');
      else if (tr.getAttribute('data-key') !== value) tr.setAttribute('data-key', value);
    });
  }

  // 9.2: each number cell's computed --cssv-format. All reads happen before
  // any write: changing a cell's text invalidates styles, so interleaving
  // them would recompute styles once per cell. A cell is only formatted again
  // when its format, its field or the locale changed: #formats remembers the
  // format each cell's text was made with, and a cell missing from it shows
  // its default display for `locale`.
  #applyFormats(table, model, locale, localeChanged = false) {
    const parsed = new Map();
    const updates = [];
    [...table.tBodies[0].rows].forEach((tr, i) => {
      [...tr.cells].forEach((td, c) => {
        if (model.rows[i].types[c].type !== 'number') return;
        const raw = getComputedStyle(td).getPropertyValue('--cssv-format').trim();
        if (raw !== '' && !parsed.has(raw)) {
          const value = parseCssvValue(raw);
          const options = typeof value === 'string' ? parseFormat(value) : null;
          parsed.set(raw, options);
          if (!options) this.#report('9.2', `--cssv-format has an invalid value: ${raw}`);
        }
        const options = raw === '' ? null : parsed.get(raw);
        const format = options ? raw : ''; // an invalid format leaves the default display
        if (!localeChanged && (this.#formats.get(td) ?? '') === format) return;
        const field = model.rows[i].fields[c];
        const text = options ? formatNumber(field, options, locale) : defaultDisplay(field, locale);
        updates.push([td, text, format]);
      });
    });
    for (const [td, text, format] of updates) {
      if (td.textContent !== text) td.textContent = text;
      if (format) this.#formats.set(td, format);
      else this.#formats.delete(td);
    }
  }
}

if (globalThis.customElements && !customElements.get('cssv-table')) customElements.define('cssv-table', CssvTable);
