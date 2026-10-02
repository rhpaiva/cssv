// <cssv-table>: a CSSV v1 renderer for browsers. Section numbers refer to SPEC.md.
//
// Structure (both shadow roots are open, for inspection and tests):
//
//   <cssv-table>                      host, in the page
//     #shadow-root (outer)            renderer-owned: the page and the file can't style .clip
//       <div class="clip">            contain: paint (11.4), hidden until step 6 (8.3)
//         <div class="frame">         host of the inner root
//           #shadow-root (inner)      the file's styles live here (8.1)
//             <style> defaults (8.2)
//             <style> style block (4)
//             <table part="table">    the table model (7)
//
// The second shadow root keeps paint containment out of reach of the author
// stylesheet: it can match its own :host (.frame) but never .clip.

import {
  parse, DEFAULT_CSS, rewriteCssUrls, parseCssvValue, parseFormat, formatNumber,
  display, keyIndex, toMarkdown, CssvError,
} from './core.js';

const OUTER_CSS = `
:host { display: block; }
:host([hidden]) { display: none; }
.clip { display: block; contain: paint; width: max-content; min-width: 100%; }
.clip.pending { opacity: 0; }
`;

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

// 8.3 step 2: the table model with numbers in their default display.
function buildTable(model, locale) {
  const el = (tag, attrs = {}, text = '') => {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    if (text !== '') node.textContent = text; // 7.4: always text, never HTML
    return node;
  };
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
  for (const row of model.rows) {
    const tr = el('tr', { 'data-row': String(row.number) });
    row.fields.forEach((field, c) => {
      const { type, sign } = row.types[c];
      const attrs = { 'data-col': model.columns[c] };
      if (type === 'number') attrs.class = `number ${sign}`;
      tr.append(el('td', attrs, display(field, type, locale)));
    });
    tbody.append(tr);
  }
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
  #inner;
  #run = 0;
  #queued = false;
  #abort = null;
  #observer = null;
  #ready = this.#deferred();

  constructor() {
    super();
    const outer = this.attachShadow({ mode: 'open' });
    this.#clip = document.createElement('div');
    this.#clip.className = 'clip pending';
    const frame = document.createElement('div');
    frame.className = 'frame';
    frame.setAttribute('exportparts', 'table');
    this.#clip.append(frame);
    outer.append(styleElement(OUTER_CSS), this.#clip);
    this.#inner = frame.attachShadow({ mode: 'open' });
  }

  /** Resolves when the latest render has finished (successfully or not). */
  get ready() {
    return this.#ready.promise;
  }

  /** The rendered table element, or null. */
  get table() {
    return this.#inner.querySelector('table');
  }

  /** The src attribute, or null when the element reads inline text. */
  get src() {
    return this.getAttribute('src');
  }

  set src(value) {
    if (value === null || value === undefined) this.removeAttribute('src');
    else this.setAttribute('src', value);
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
      if (!this.hasAttribute('src')) this.#schedule();
    });
    this.#observer.observe(this, { childList: true, subtree: true, characterData: true });
    this.#schedule();
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#abort?.abort();
  }

  attributeChangedCallback() {
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
    if (document.readyState === 'loading' && !this.hasAttribute('src')) {
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
    const src = this.getAttribute('src');
    if (src !== null) {
      const url = new URL(src, document.baseURI);
      const res = await fetch(url, { signal });
      if (!res.ok) throw new CssvError(`Could not load ${url.href} (HTTP ${res.status}).`, 'load');
      return { text: await res.text(), base: res.url }; // text() always decodes UTF-8 (3.1)
    }
    const script = this.querySelector(':scope > script[type="text/cssv"]');
    if (!script) return { text: null };
    // Appendix C: drop leading empty lines and trailing whitespace.
    const text = script.textContent.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
    return { text, base: document.baseURI };
  }

  async #render() {
    const run = ++this.#run;
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
        this.#inner.replaceChildren();
        return;
      }
      const model = parse(text); // 8.3 step 1
      const locale = this.#locale();
      const table = buildTable(model, locale); // step 2
      const author = styleElement(model.style === null ? '' : rewriteCssUrls(model.style, base));
      const loaded = settled(author);
      // The previous table stays visible while the file loads; the new one is
      // hidden from here until step 6.
      this.#clip.classList.add('pending');
      this.#inner.replaceChildren(styleElement(DEFAULT_CSS), author, table); // step 3
      const ok = await loaded;
      if (!current()) return;
      if (!ok) this.#report('4.2', 'An imported stylesheet failed to load; the rest of the styles still apply.');
      this.model = model;
      this.#applyKey(table, model); // step 4
      this.#applyFormats(table, model, locale); // step 5
      this.dispatchEvent(new CustomEvent('cssv-load'));
    } catch (error) {
      if (!current() || error.name === 'AbortError') return;
      this.model = null;
      this.#inner.replaceChildren(); // 3.4, 5: no part of a malformed file is shown
      this.#report(error.section ?? 'load', error.message, true);
    } finally {
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

  // 9.1: the host's key attribute wins over --cssv-key.
  #applyKey(table, model) {
    let key;
    if (this.hasAttribute('key')) {
      key = this.getAttribute('key');
    } else {
      const raw = getComputedStyle(table).getPropertyValue('--cssv-key');
      key = parseCssvValue(raw);
      if (key === null) return this.#report('9', `--cssv-key has an invalid value: ${raw.trim()}`);
      if (key === undefined) return;
    }
    const k = keyIndex(model, key);
    if (k < 0) return this.#report('9.1', `No column is named "${key}", so rows get no data-key.`);
    [...table.tBodies[0].rows].forEach((tr, i) => {
      const value = model.rows[i].fields[k];
      if (value !== '') tr.setAttribute('data-key', value);
    });
  }

  // 9.2: each number cell's computed --cssv-format. All reads happen before
  // any write: changing a cell's text invalidates styles, so interleaving
  // them would recompute styles once per cell.
  #applyFormats(table, model, locale) {
    const parsed = new Map();
    const updates = [];
    [...table.tBodies[0].rows].forEach((tr, i) => {
      [...tr.cells].forEach((td, c) => {
        if (model.rows[i].types[c].type !== 'number') return;
        const raw = getComputedStyle(td).getPropertyValue('--cssv-format').trim();
        if (raw === '') return;
        if (!parsed.has(raw)) {
          const value = parseCssvValue(raw);
          const options = typeof value === 'string' ? parseFormat(value) : null;
          parsed.set(raw, options);
          if (!options) this.#report('9.2', `--cssv-format has an invalid value: ${raw}`);
        }
        const options = parsed.get(raw);
        if (options) updates.push([td, model.rows[i].fields[c], options]);
      });
    });
    for (const [td, field, options] of updates) td.textContent = formatNumber(field, options, locale);
  }
}

if (globalThis.customElements && !customElements.get('cssv-table')) customElements.define('cssv-table', CssvTable);
