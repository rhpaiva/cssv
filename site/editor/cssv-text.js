// Edits on the text of a CSSV file. The editor never rebuilds the file from
// the parsed model: every change replaces only the characters it touches, so
// quoting, line endings and untouched rows stay byte for byte as they were.
// The scanner mirrors splitFile and parseRecords in src/core.js, keeping the
// position of every record and field.
import { detectDelimiter } from '../../src/core.js';

const FENCE = /^---[ \t]*$/;
const BEGIN = '/* cssv-editor: rules added by the editor */';
const END = '/* cssv-editor: end */';

function readLine(text, start) {
  const lf = text.indexOf('\n', start);
  if (lf === -1) return { end: text.length, next: text.length + 1 };
  return { end: lf > start && text[lf - 1] === '\r' ? lf - 1 : lf, next: lf + 1 };
}

// Where the style block and the data section are (3.4), as offsets into text.
function locate(text) {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const first = readLine(text, start);
  if (!FENCE.test(text.slice(start, first.end))) return { style: null, dataStart: start };
  for (let pos = first.next; pos <= text.length;) {
    const line = readLine(text, pos);
    if (FENCE.test(text.slice(pos, line.end))) {
      return { style: { start: first.next, end: pos }, dataStart: Math.min(line.next, text.length) };
    }
    pos = line.next;
  }
  throw new Error('The opening fence has no closing fence (3.4).');
}

/**
 * Records with field positions: { start, end, fields: [{ start, end }] }.
 * Record 0 is the header record; record i is model.rows[i - 1].
 */
export function scan(text) {
  const { style, dataStart } = locate(text);
  const data = text.slice(dataStart);
  const delimiter = detectDelimiter(data);
  const firstBreak = /\r?\n/.exec(data);
  const eol = firstBreak ? firstBreak[0] : '\n';
  const records = [];
  let fields = [];
  let fieldStart = dataStart;
  let recordStart = dataStart;
  let quoted = false;
  let atFieldStart = true;
  let hasContent = false;

  const endRecord = (end) => {
    if (hasContent) {
      fields.push({ start: fieldStart, end });
      records.push({ start: recordStart, end, fields });
    }
    fields = [];
    hasContent = false;
    atFieldStart = true;
  };

  let i = dataStart;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          i += 2;
          continue;
        }
        quoted = false;
      }
      i++;
      continue;
    }
    if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
      endRecord(i);
      i += ch === '\r' ? 2 : 1;
      recordStart = fieldStart = i;
      continue;
    }
    hasContent = true;
    if (ch === delimiter) {
      fields.push({ start: fieldStart, end: i });
      fieldStart = i + 1;
      atFieldStart = true;
    } else if (ch === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else {
      atFieldStart = false;
    }
    i++;
  }
  if (quoted) throw new Error('A quoted field is not terminated (5).');
  endRecord(text.length);
  return { style, dataStart, delimiter, eol, records };
}

// 5: quote when the field holds the delimiter, a quote or a line break. In
// the header record, either delimiter is quoted, since an unquoted one would
// change what delimiter detection finds (5.1).
export function encodeField(value, delimiter, header = false) {
  const special = header ? /[",;\r\n]/ : delimiter === ',' ? /[",\r\n]/ : /[";\r\n]/;
  return special.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** An edit { start, end, insert } that sets record r, field c; or null. */
export function fieldEdit(s, r, c, value) {
  const record = s.records[r];
  const insert = encodeField(value, s.delimiter, r === 0);
  if (c < record.fields.length) {
    const f = record.fields[c];
    // A one-field record with an empty value would be an empty line, which
    // processors skip (5); a quoted empty field keeps the record.
    return { start: f.start, end: f.end, insert: record.fields.length === 1 && insert === '' ? '""' : insert };
  }
  if (value === '') return null; // a missing field already reads as empty (5.3)
  return { start: record.end, end: record.end, insert: s.delimiter.repeat(c - record.fields.length + 1) + insert };
}

/**
 * An edit that sets several fields of record r at once, from a
 * Map(column → value); fields past the record's end are added.
 */
export function recordEdit(text, s, r, values) {
  const record = s.records[r];
  const fields = record.fields.map((f) => text.slice(f.start, f.end));
  for (const [c, value] of values) {
    while (fields.length <= c) fields.push('');
    fields[c] = encodeField(value, s.delimiter, r === 0);
  }
  const insert = fields.join(s.delimiter);
  return { start: record.start, end: record.end, insert: insert === '' ? '""' : insert };
}

export function applyEdits(text, edits) {
  for (const e of edits.filter(Boolean).sort((a, b) => b.start - a.start)) {
    text = text.slice(0, e.start) + e.insert + text.slice(e.end);
  }
  return text;
}

/**
 * Replaces the body records with `items`, in order: a number keeps that
 * record's text exactly, a string is a new record. Sorting, inserting and
 * deleting rows all go through here. Empty lines between records are dropped.
 */
export function rebuildBody(text, s, items) {
  const body = s.records.slice(1);
  const parts = items.map((item) => typeof item === 'number'
    ? text.slice(s.records[item].start, s.records[item].end)
    : item);
  if (body.length === 0) {
    const header = s.records[0];
    return text.slice(0, header.end) + parts.map((p) => s.eol + p).join('') + text.slice(header.end);
  }
  return text.slice(0, body[0].start) + parts.join(s.eol) + text.slice(body.at(-1).end);
}

/**
 * Rearranges the columns of every record. `columns` lists the new columns in
 * order: a number keeps that column's field text exactly, and { name } is a
 * new column, empty in the body. A record keeps no trailing fields that it
 * didn't have (5.3 pads them), and one that would become an empty line,
 * which processors skip (5), keeps a quoted empty field instead.
 */
export function rebuildColumns(text, s, columns) {
  const edits = s.records.map((record, r) => {
    const parts = columns.map((col) => {
      if (typeof col !== 'number') return { text: r === 0 ? encodeField(col.name, s.delimiter, true) : '', had: r === 0 };
      const f = record.fields[col];
      return f ? { text: text.slice(f.start, f.end), had: true } : { text: '', had: false };
    });
    while (parts.length > 1 && !parts.at(-1).had && parts.at(-1).text === '') parts.pop();
    const insert = parts.map((p) => p.text).join(s.delimiter);
    return { start: record.start, end: record.end, insert: insert === '' ? '""' : insert };
  });
  return applyEdits(text, edits);
}

/** A record of `width` empty fields that processors don't skip as empty. */
export function blankRecord(s, width) {
  return width > 1 ? s.delimiter.repeat(width - 1) : '""';
}

// --- Style rules the sheet writes into the style block ----------------------

/** Rules in the sheet's section of the style block: Map(selector → Map(property → value)). */
export function readRules(text, s) {
  const rules = new Map();
  if (!s.style) return rules;
  const style = text.slice(s.style.start, s.style.end);
  const from = style.indexOf(BEGIN);
  const to = style.indexOf(END);
  if (from < 0 || to < from) return rules;
  for (const line of style.slice(from + BEGIN.length, to).split(/\r?\n/)) {
    const brace = line.lastIndexOf('{');
    if (brace < 0 || !line.trimEnd().endsWith('}')) continue;
    const decls = new Map();
    for (const decl of line.slice(brace + 1, line.lastIndexOf('}')).split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) decls.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
    rules.set(line.slice(0, brace).trim(), decls);
  }
  return rules;
}

/** Writes the sheet's section, at the end of the style block; adds a block if there is none. */
export function writeRules(text, s, rules) {
  const lines = [...rules].filter(([, d]) => d.size > 0)
    .map(([sel, d]) => `${sel} { ${[...d].map(([k, v]) => `${k}: ${v};`).join(' ')} }`);
  const section = lines.length ? [BEGIN, ...lines, END].join(s.eol) + s.eol : '';
  if (!s.style) {
    if (!section) return text;
    return text.slice(0, s.dataStart) + `---${s.eol}${section}---${s.eol}` + text.slice(s.dataStart);
  }
  const style = text.slice(s.style.start, s.style.end);
  const from = style.indexOf(BEGIN);
  const to = style.indexOf(END);
  if (from >= 0 && to > from) {
    let stop = to + END.length;
    if (style.startsWith(s.eol, stop)) stop += s.eol.length;
    return text.slice(0, s.style.start + from) + section + text.slice(s.style.start + stop);
  }
  const needsBreak = style !== '' && !style.endsWith('\n');
  return text.slice(0, s.style.end) + (needsBreak && section ? s.eol : '') + section + text.slice(s.style.end);
}

/** A CSS string for an attribute selector value. */
export function cssString(value) {
  return `"${value.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\a ').replace(/\r/g, '\\d ')}"`;
}

const ROW_RULE = /^tr\[data-row="(\d+)"\]/;

/**
 * Renumbers the sheet's per-row rules after rows move, so a cell's style
 * follows its data. `rows` maps an old data-row to its new one; a row that
 * is missing from it was deleted, and its rules go with it.
 */
export function remapRows(rules, rows) {
  const out = new Map();
  for (const [selector, decls] of rules) {
    const m = ROW_RULE.exec(selector);
    if (!m) {
      out.set(selector, decls);
      continue;
    }
    const to = rows.get(Number(m[1]));
    if (to !== undefined) out.set(`tr[data-row="${to}"]${selector.slice(m[0].length)}`, decls);
  }
  return out;
}
