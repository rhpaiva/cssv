// CSSV v1 core: everything a CSSV processor does without a style engine.
// Section numbers in comments refer to SPEC.md.

export const DEFAULT_CSS = `@layer cssv-defaults {
  table   { border-collapse: collapse; }
  th, td  { text-align: start; vertical-align: top; padding: 0.25em 0.5em; white-space: pre-wrap; }
  th      { font-weight: bold; }
  .number { text-align: end; font-variant-numeric: tabular-nums; }
}`;

export class CssvError extends Error {
  constructor(message, section) {
    super(message);
    this.name = 'CssvError';
    this.section = section;
  }
}

// --- 3. File structure -----------------------------------------------------

const FENCE = /^---[ \t]*$/;

// Yields lines with their positions. Only LF and CRLF end a line (3.2).
function* lines(text) {
  let start = 0;
  while (start <= text.length) {
    const lf = text.indexOf('\n', start);
    if (lf === -1) {
      yield { text: text.slice(start), start, next: text.length + 1 };
      return;
    }
    const end = lf > start && text[lf - 1] === '\r' ? lf - 1 : lf;
    yield { text: text.slice(start, end), start, next: lf + 1 };
    start = lf + 1;
  }
}

// 3.1, 3.4: strips a BOM and splits the file at the fences.
export function splitFile(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const it = lines(text);
  const first = it.next().value;
  if (!FENCE.test(first.text)) return { style: null, data: text };
  for (const line of it) {
    if (FENCE.test(line.text)) {
      return {
        style: text.slice(first.next, line.start),
        data: text.slice(Math.min(line.next, text.length)),
      };
    }
  }
  throw new CssvError('The opening fence has no closing fence.', '3.4');
}

// --- 5. Data section -------------------------------------------------------

// 5.1: every quote toggles; count delimiters outside quotes up to the first
// line break outside quotes. Leading empty lines are skipped first, since
// empty lines are ignored and the header record starts after them.
export function detectDelimiter(data) {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (const ch of data.replace(/^(\r?\n)+/, '')) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '\n') break;
    else if (!quoted && ch === ',') commas++;
    else if (!quoted && ch === ';') semicolons++;
  }
  return semicolons > commas ? ';' : ',';
}

// 5: RFC 4180 records with LF/CRLF line breaks; empty lines are ignored.
export function parseRecords(data, delimiter) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false; // inside a quoted field
  let fieldStart = true; // no character of the current field read yet
  let lineHasContent = false;
  let i = 0;

  const endField = () => {
    record.push(field);
    field = '';
    fieldStart = true;
  };
  const endRecord = () => {
    if (lineHasContent) {
      endField();
      records.push(record);
    }
    record = [];
    field = '';
    fieldStart = true;
    lineHasContent = false;
  };

  while (i < data.length) {
    const ch = data[i];
    if (quoted) {
      if (ch === '"') {
        if (data[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '\n' || (ch === '\r' && data[i + 1] === '\n')) {
      endRecord();
      i += ch === '\r' ? 2 : 1;
      continue;
    }
    lineHasContent = true;
    if (ch === delimiter) {
      endField();
    } else if (ch === '"' && fieldStart) {
      quoted = true; // a quote that starts a field opens a quoted field
      fieldStart = false;
    } else {
      field += ch; // a quote anywhere else is a literal character
      fieldStart = false;
    }
    i++;
  }
  if (quoted) throw new CssvError('A quoted field is not terminated.', '5');
  endRecord();
  return records;
}

// --- 6. Value types --------------------------------------------------------

const NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export function classify(field) {
  if (field === '') return { type: 'empty' };
  if (!NUMBER.test(field)) return { type: 'text' };
  let sign;
  if (/^-?[0.]+$/.test(field)) sign = 'zero';
  else sign = field[0] === '-' ? 'negative' : 'positive';
  return { type: 'number', sign };
}

// --- Parsing a whole file (sections 3 to 6) --------------------------------

export function parse(text) {
  const { style, data } = splitFile(text);
  const delimiter = detectDelimiter(data);
  const records = parseRecords(data, delimiter);
  const width = records.reduce((max, r) => Math.max(max, r.length), 0);
  const pad = (r) => r.concat(Array(width - r.length).fill(''));

  const columns = records.length ? pad(records[0]) : [];
  const rows = records.slice(1).map((r, i) => {
    const fields = pad(r);
    return { number: i + 2, fields, types: fields.map(classify) };
  });
  const numberColumns = columns.map((_, c) => {
    const kinds = rows.map((r) => r.types[c].type).filter((t) => t !== 'empty');
    return kinds.length > 0 && kinds.every((t) => t === 'number');
  });
  return { style, delimiter, columns, numberColumns, rows };
}

// --- 9. CSSV property values -----------------------------------------------

const HEX = /[0-9a-fA-F]/;
const WS = /[ \t\n\r\f]/;

// Reads one CSS escape starting after the backslash. Returns [text, nextIndex].
function readEscape(s, i) {
  if (i >= s.length) return ['\uFFFD', i];
  if (HEX.test(s[i])) {
    let hex = '';
    while (hex.length < 6 && i < s.length && HEX.test(s[i])) hex += s[i++];
    if (s[i] === '\r' && s[i + 1] === '\n') i += 2;
    else if (i < s.length && WS.test(s[i])) i++;
    const cp = parseInt(hex, 16);
    const bad = cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff);
    return [bad ? '\uFFFD' : String.fromCodePoint(cp), i];
  }
  const cp = s.codePointAt(i);
  const ch = String.fromCodePoint(cp);
  return [ch, i + ch.length];
}

// Parses a CSS string token starting at a quote. Returns [value, nextIndex]
// or null when the string contains an unescaped line break.
export function readCssString(s, i) {
  const quote = s[i++];
  let value = '';
  while (i < s.length) {
    const ch = s[i];
    if (ch === quote) return [value, i + 1];
    if (ch === '\n' || ch === '\r' || ch === '\f') return null;
    if (ch === '\\') {
      if (s[i + 1] === '\n' || s[i + 1] === '\f') { i += 2; continue; }
      if (s[i + 1] === '\r') { i += s[i + 2] === '\n' ? 3 : 2; continue; }
      const [text, next] = readEscape(s, i + 1);
      value += text;
      i = next;
      continue;
    }
    value += ch;
    i++;
  }
  return [value, i]; // EOF closes a string in CSS
}

const NAME_START = /[a-zA-Z_\u0080-\u{10FFFF}]/u;
const NAME_CHAR = /[a-zA-Z0-9_\-\u0080-\u{10FFFF}]/u;

function readIdentifier(s) {
  let i = 0;
  let value = '';
  const startsEscape = (j) => s[j] === '\\' && j + 1 < s.length && s[j + 1] !== '\n';
  if (s[0] === '-') {
    if (s[1] === '-') { value = '--'; i = 2; }
    else if (NAME_START.test(s[1] ?? '') || startsEscape(1)) { value = '-'; i = 1; }
    else return null;
  } else if (!(NAME_START.test(s[0] ?? '') || startsEscape(0))) {
    return null;
  }
  while (i < s.length) {
    const ch = String.fromCodePoint(s.codePointAt(i));
    if (NAME_CHAR.test(ch)) { value += ch; i += ch.length; }
    else if (startsEscape(i)) { const [t, n] = readEscape(s, i + 1); value += t; i = n; }
    else return null;
  }
  return value;
}

// 9: a CSSV property value is a CSS string or a single identifier.
// Returns undefined when unset, null when invalid, otherwise the value.
export function parseCssvValue(raw) {
  const s = (raw ?? '').trim();
  if (s === '') return undefined;
  if (s[0] === '"' || s[0] === "'") {
    const read = readCssString(s, 0);
    if (!read || read[1] !== s.length) return null;
    return read[0];
  }
  return readIdentifier(s);
}

// 9.1: --cssv-key is a column name, as a CSSV property value (9), or col(n),
// the nth column counted from 1. Returns undefined when unset, null when
// invalid, otherwise the name as a string or the column number.
const COL = /^col\([ \t\n\r\f]*([0-9]+)[ \t\n\r\f]*\)$/i;

export function parseKey(raw) {
  const s = (raw ?? '').trim();
  const col = COL.exec(s);
  if (!col) return parseCssvValue(s);
  const n = Number(col[1]);
  return n >= 1 ? n : null;
}

// 9.2: the --cssv-format option string.
const FORMAT_LIMITS = {
  minimumIntegerDigits: [1, 21],
  minimumFractionDigits: [0, 100],
  maximumFractionDigits: [0, 100],
};

export function parseFormat(str) {
  if (typeof str !== 'string') return null;
  const options = {};
  for (const part of str.split(',')) {
    const m = /^\s*([A-Za-z]+)\s*:\s*([0-9]+|true|false)\s*$/.exec(part);
    if (!m) return null;
    const [, name, value] = m;
    if (name in options) return null;
    if (name === 'useGrouping') {
      if (value !== 'true' && value !== 'false') return null;
      options.useGrouping = value === 'true';
    } else if (name in FORMAT_LIMITS) {
      if (!/^[0-9]+$/.test(value)) return null;
      const n = Number(value);
      const [lo, hi] = FORMAT_LIMITS[name];
      if (n < lo || n > hi) return null;
      options[name] = n;
    } else {
      return null;
    }
  }
  const min = options.minimumFractionDigits ?? 0;
  const max = options.maximumFractionDigits ?? Math.max(min, 3);
  if (max < min) return null;
  return {
    minimumIntegerDigits: options.minimumIntegerDigits ?? 1,
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    useGrouping: options.useGrouping ?? true,
  };
}

// --- 10. Number display ----------------------------------------------------

const FIXED = { roundingMode: 'halfExpand', signDisplay: 'negative' };

// Creating an Intl.NumberFormat costs about 45 times more than using one, so
// formatters are shared per locale and options. The keys are few: one per
// fraction-digit count and per distinct --cssv-format.
const formatters = new Map();

function formatter(locale, options) {
  const key = `${locale}|${options.minimumIntegerDigits}|${options.minimumFractionDigits}|`
    + `${options.maximumFractionDigits}|${options.useGrouping}`;
  let nf = formatters.get(key);
  if (!nf) {
    if (formatters.size >= 1000) formatters.clear();
    nf = new Intl.NumberFormat(locale, { ...options, ...FIXED });
    formatters.set(key, nf);
  }
  return nf;
}

// 9.2: formats a number field with parsed --cssv-format options. The field
// is passed to Intl as a string so the exact decimal value is used (10.3).
export function formatNumber(field, options, locale) {
  return formatter(locale, options).format(field);
}

// 10.2: localized symbols, the fraction digits as written, no grouping.
export function defaultDisplay(field, locale) {
  const digits = field.includes('.') ? field.length - field.indexOf('.') - 1 : 0;
  if (digits <= 100) {
    return formatNumber(field, {
      useGrouping: false,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }, locale);
  }
  // Intl allows at most 100 fraction digits: build the text from the
  // locale's symbols instead.
  const nf = new Intl.NumberFormat(locale, { useGrouping: false });
  const parts = nf.formatToParts(-1.5);
  const symbol = (type, fallback) => parts.find((p) => p.type === type)?.value ?? fallback;
  const digit = (d) => nf.format(Number(d));
  const [int, frac] = field.replace('-', '').split('.');
  const negative = field.startsWith('-') && /[1-9]/.test(field);
  return (negative ? symbol('minusSign', '-') : '') + int.replace(/\d/g, digit)
    + symbol('decimal', '.') + frac.replace(/\d/g, digit);
}

export function display(field, type, locale, options) {
  if (type !== 'number') return field;
  return options ? formatNumber(field, options, locale) : defaultDisplay(field, locale);
}

// --- 7. Table model as an HTML string (8.4, 11.1) ---------------------------

export function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// 9.1: the key column's index, or -1. A name picks the first column of that
// name, a number n the nth column.
export function keyIndex(model, key) {
  if (typeof key === 'number') return Number.isInteger(key) && key >= 1 && key <= model.columns.length ? key - 1 : -1;
  return typeof key === 'string' ? model.columns.indexOf(key) : -1;
}

// Builds the step-2 table model of 8.3. `key` is a host-set key column (9.1):
// a column name, or a column number counted from 1.
export function toHtml(model, { locale = 'en-US', key, part = false } = {}) {
  const k = keyIndex(model, key);
  const attr = (name, value) => ` ${name}="${escapeHtml(String(value))}"`;
  let html = `<table${part ? ' part="table"' : ''}><colgroup>`;
  for (const name of model.columns) html += `<col${attr('data-col', name)}>`;
  html += '</colgroup><thead><tr data-row="1">';
  model.columns.forEach((name, c) => {
    html += `<th${attr('data-col', name)}${model.numberColumns[c] ? ' class="number"' : ''}>${escapeHtml(name)}</th>`;
  });
  html += '</tr></thead><tbody>';
  for (const row of model.rows) {
    const keyValue = k >= 0 ? row.fields[k] : '';
    html += `<tr${attr('data-row', row.number)}${keyValue !== '' ? attr('data-key', keyValue) : ''}>`;
    row.fields.forEach((field, c) => {
      const t = row.types[c];
      const cls = t.type === 'number' ? ` class="number ${t.sign}"` : '';
      html += `<td${attr('data-col', model.columns[c])}${cls}>${escapeHtml(display(field, t.type, locale))}</td>`;
    });
    html += '</tr>';
  }
  return html + '</tbody></table>';
}

// --- 4.3 Relative URLs in the style block ----------------------------------

function serializeUrl(url) {
  return `url("${url.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\a ')}")`;
}

function resolveUrl(value, base) {
  if (value === '' || value.startsWith('#')) return null;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

const isNameChar = (ch) => ch !== undefined && /[a-zA-Z0-9_\-\u0080-￿\\]/.test(ch);

// Rewrites relative URLs in @import rules and url() values to absolute URLs,
// so a style block resolves against the CSSV file's URL instead of the page.
export function rewriteCssUrls(css, base) {
  let out = '';
  let i = 0;
  let expectImport = false; // just saw @import; the next string is a URL
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const read = readCssString(css, i);
      const stop = read ? read[1] : css.indexOf('\n', i) === -1 ? css.length : css.indexOf('\n', i);
      const resolved = read && expectImport ? resolveUrl(read[0], base) : null;
      out += resolved ? `"${resolved.replace(/[\\"]/g, '\\$&')}"` : css.slice(i, stop);
      expectImport = false;
      i = stop;
      continue;
    }
    if (ch === '@' && /^@import\b/i.test(css.slice(i, i + 8)) && !isNameChar(css[i - 1])) {
      out += css.slice(i, i + 7);
      i += 7;
      expectImport = true;
      continue;
    }
    if ((ch === 'u' || ch === 'U') && /^url\(/i.test(css.slice(i, i + 4)) && !isNameChar(css[i - 1])) {
      let j = i + 4;
      while (j < css.length && WS.test(css[j])) j++;
      let value;
      let stop;
      if (css[j] === '"' || css[j] === "'") {
        const read = readCssString(css, j);
        if (!read) { out += ch; i++; continue; }
        let k = read[1];
        while (k < css.length && WS.test(css[k])) k++;
        if (css[k] !== ')') { out += ch; i++; continue; } // url() with modifiers: leave as is
        value = read[0];
        stop = k + 1;
      } else {
        let k = j;
        value = '';
        while (k < css.length && css[k] !== ')') {
          if (css[k] === '\\') { const [t, n] = readEscape(css, k + 1); value += t; k = n; }
          else value += css[k++];
        }
        value = value.trimEnd();
        stop = k + 1;
      }
      const resolved = resolveUrl(value, base);
      out += resolved ? serializeUrl(resolved) : css.slice(i, stop);
      expectImport = false;
      i = stop;
      continue;
    }
    if (expectImport && !WS.test(ch)) expectImport = false;
    out += ch;
    i++;
  }
  return out;
}

// --- Appendix B: Markdown ----------------------------------------------------

function mdAlign(align, direction) {
  const rtl = direction === 'rtl';
  switch (align) {
    case 'left': case '-webkit-left': return 'left';
    case 'right': case '-webkit-right': return 'right';
    case 'center': case '-webkit-center': return 'center';
    case 'start': return rtl ? 'right' : 'left';
    case 'end': return rtl ? 'left' : 'right';
    default: return null;
  }
}

function escapeMarkdown(text) {
  return text.replace(/[\\`*_~[\]<&|]/g, '\\$&').replace(/\r\n|\r|\n/g, '<br>');
}

function codeSpan(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return fence + pad + text.replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ') + pad + fence;
}

function mdCell(cell) {
  if (cell.text === '') return '';
  let s = cell.mono ? codeSpan(cell.text) : escapeMarkdown(cell.text);
  if (cell.strike) s = `~~${s}~~`;
  if (cell.italic) s = `*${s}*`;
  if (cell.bold) s = `**${s}**`;
  return s;
}

// Serializes a grid read from computed styles. `header` is a list of column
// names; each body cell is {text, align, bold, italic, strike, mono}.
export function toMarkdown({ header, rows }, { direction = 'ltr' } = {}) {
  const sep = header.map((_, c) => {
    const aligns = rows.map((r) => mdAlign(r[c].align, direction));
    const a = aligns.length && aligns.every((x) => x && x === aligns[0]) ? aligns[0] : null;
    return { left: ':--', center: ':-:', right: '--:' }[a] ?? '---';
  });
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [
    line(header.map(escapeMarkdown)),
    `|${sep.join('|')}|`,
    ...rows.map((r) => line(r.map(mdCell))),
  ].join('\n');
}

// --- Appendix C: inline text -----------------------------------------------

// The text of an inline <script type="text/cssv">. Drops leading empty lines
// and trailing whitespace, then removes the first line's indentation from every
// line, so the text can be indented like the markup around it. A line indented
// less loses only what it has.
export function inlineText(text) {
  text = text.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
  const indent = /^[ \t]*/.exec(text)[0];
  if (indent === '') return text;
  return text.split('\n').map((line) => {
    let i = 0;
    while (i < indent.length && line[i] === indent[i]) i++;
    return line.slice(i);
  }).join('\n');
}
