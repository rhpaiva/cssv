---
name: cssv
description: Write CSSV files (.cssv), plain-text CSV data with a CSS style block on top that renders as a styled HTML table. Use when the user mentions CSSV, .cssv or <cssv-table>, or the project already has .cssv files; or when the user wants a styled table (a report, comparison, leaderboard or status board) as one plain-text file that stays editable as text, including CSV, spreadsheet or query output turned into one. Not for tables an app renders from its own components or templates.
license: MIT
---

# Writing CSSV files

CSSV (Comma-Separated Styled Values) is a CSV file with an optional CSS stylesheet at the top. A renderer such as the `<cssv-table>` element turns the CSV into an HTML table with a fixed structure, then applies the stylesheet to it. Without its stylesheet the file is ordinary CSV.

```
---
/* cssv:title Monthly costs */
/* cssv:description What each item cost this month, with the refund and the total. */
table { --cssv-key: item; --cssv-format: "minimumFractionDigits: 2, maximumFractionDigits: 2"; }
.negative { color: crimson; }
tr[data-key="Total"] td { font-weight: bold; border-top: 1px solid; }
---
item,amount
Rent,1200
Refund,-45.50
Total,1154.50
```

Write the data as plain CSV and the presentation as CSS. The renderer adds the classes, attributes and number formatting, so never format values by hand. This skill covers what you need to write files; the full [specification](https://cssv.dev/SPEC.md) has the rest.

## File structure

- The first line is `---` (the opening fence). Every line up to the next `---` line is CSS; everything after that line is CSV.
- A file with no style block starts directly with the CSV header. Any CSV file is a valid CSSV file.
- A line holding only `---` must never appear inside the CSS, not even in a comment or a string.
- Open the style block with a title and a description, each in its own comment, before any other rule: `/* cssv:title Team budget */` and `/* cssv:description Planned and actual spending per category. */`. Programs that list or preview files show them. Write `cssv:`, the lowercase name and a space exactly like that. The title is a few words; the description says in a sentence or two what the table is. Notes on how the styles work go in ordinary comments after them. Those two are the only `cssv:` names.
- Encoding is UTF-8. Use the extension `.cssv`.

## The CSV part

- The first record is always the header. Column names are used exactly as written: case and spaces matter in selectors. Several columns may share a name, as in exports that repeat a column per label; `[data-col="…"]` then selects all of them, and a key column uses the first.
- The delimiter is `,` or `;`, whichever the header uses more. Use `,` unless the source data uses `;`.
- Quote a field that contains the delimiter, a `"` or a line break, and double any `"` inside it (`""`). Fields are never trimmed, so write `a,b`, not `a, b`.
- Give every row as many fields as the header. Shorter rows are padded with empty fields.
- Empty lines are ignored. There are no comments in the CSV part.

### Numbers

A field is a number only when the whole field matches `-?(0|[1-9][0-9]*)(\.[0-9]+)?`.

| In the file | Type | Why |
| --- | --- | --- |
| `1200`, `-45.50`, `0.5` | number | |
| `1.200` | number: 1.2 | the dot is always the decimal point, so a thousand grouped with a dot is read as 1.2, with no error |
| `"1,200"`, and `1200,50` in a `;` file | text | no group separators or comma decimals |
| `+5`, `1e6`, `.5`, ` 12` | text | no plus sign, exponent, missing zero or spaces |
| `007` | text | leading zeros keep IDs and postal codes as text |
| `12%`, `$5`, `3 kg` | text | put units in the column name or in CSS |

In a `,` file an unquoted `1,200` is two fields, and `1.200,50` becomes the numbers 1.2 and 50.

Store raw values such as `1234.5`, even in `;`-delimited files. The renderer shows them in the reader's locale. A value written as `"1,234.50"` becomes text: it loses its alignment, its sign class and localization. When the source writes `1.234,50`, drop the dots and turn the comma into a dot: `1234.50`.

A column whose non-empty fields are all numbers is a number column. Empty fields don't change that.

## The table model

Every renderer builds exactly this structure, and selectors can rely on nothing else:

```html
<table>
  <colgroup><col data-col="NAME"> …</colgroup>
  <thead>
    <tr data-row="1"><th data-col="NAME" class="number">NAME</th> …</tr>
  </thead>
  <tbody>
    <tr data-row="2" data-key="KEY"><td data-col="NAME" class="number negative">VALUE</td> …</tr>
  </tbody>
</table>
```

| Hook | On | Meaning |
| --- | --- | --- |
| `data-col` | `col`, `th`, `td` | The column name, exactly as written |
| `data-row` | `tr` | The record number: the header is 1, the first data row is 2 |
| `data-key` | body `tr` | The row's value in the key column; only with `--cssv-key`, and left out when that value is empty |
| `.number` | `td`; `th` | The field is a number; on a `th`, the whole column is |
| `.negative`, `.zero`, `.positive` | `td` | The sign of a number; `0`, `0.00` and `-0` are zero |
| `:empty` | `td` | The field is empty |

There are no other classes or attributes, and no `caption` or `tfoot`. Apart from the key column, cell values never appear in attributes, so CSS cannot select a cell by its text and cannot compare numbers ("over 1000" is not expressible).

## CSSV properties

Two custom properties, read from computed styles after every stylesheet has loaded:

- **`--cssv-key`**, set on `table`, names each body row after its value in that column, which enables `tr[data-key="…"]`. Pick a column of short, unique names or codes. Quote names that are not CSS identifiers: `--cssv-key: "unit price";`. `--cssv-key: col(2);` picks the second column, counted from 1, whatever its name: use it when the name changes between exports, such as a header with a date in it, or when several columns share the name.
- **`--cssv-format`**, read from each number cell, is a CSS string of up to four `Intl.NumberFormat` options. It inherits, so set it on `table`, a column, a row or a cell.
  - `minimumIntegerDigits` 1–21, `minimumFractionDigits` 0–100, `maximumFractionDigits` 0–100 and not below the minimum, `useGrouping` `true` or `false`.
  - `"minimumFractionDigits: 2, maximumFractionDigits: 2"` shows `1234.5` as 1,234.50 in en-US and 1.234,50 in de-DE.
  - Any other option, such as currency or percent, makes the whole value invalid and the cell keeps its default display.
  - Without a format, a number keeps the digits written in the file, with no grouping. Rounding is half away from zero.

Every other `--cssv-*` name is reserved, so don't invent one. Your own custom properties, such as `--accent`, are fine.

## Styling

| To style | Selector |
| --- | --- |
| A column | `[data-col="amount"]`, or `td[data-col="amount"]` for body cells only |
| A column's width | `col[data-col="notes"] { width: 20rem; }` |
| A row by name | `tr[data-key="Total"]` (needs `--cssv-key`) |
| Rows whose key field is empty | `tbody tr:not([data-key])`, such as summary or system rows |
| A run of rows with the same key | `tr[data-key="Ana"] + tr[data-key="Ana"]` |
| A row by position | `tr[data-row="4"]`, `tbody tr:last-child`, `tbody tr:nth-child(even)` |
| One cell | `tr[data-key="Travel"] > [data-col="diff"]` |
| Good and bad numbers | `[data-col="diff"].negative`, `[data-col="diff"].positive` |
| Rows with a negative number | `tbody tr:has(.negative)` |
| Empty cells | `td:empty::after { content: "—"; }` |
| Units and symbols | `td[data-col="price"].number::before { content: "€"; }` |
| The first line of a two-line field | `td[data-col="item"]::first-line` |
| Sticky header | `thead th { position: sticky; top: 0; }` |
| Dark theme | `table { color-scheme: light dark; color: light-dark(#222, #eee); }`, or `@media (prefers-color-scheme: dark) { table { … } }` |
| Printed output | `@media print { … }` |
| One language | `table:lang(de) …` |

- Set fonts, colors and your own custom properties on `table`. Selectors match only the table model, so `:root`, `html` and `body` match nothing.
- The renderer's defaults are `border-collapse: collapse`, small cell padding, bold `th`, `white-space: pre-wrap` and number cells aligned to the end with tabular digits. They sit in a cascade layer, so any rule of yours overrides them.
- The table inherits the page's font and color. For lines and tints, prefer `currentColor` and `color-mix(in srgb, currentColor 12%, transparent)` so the table works on light and dark pages. Set explicit colors when the design brings its own background.
- `@import url("…")` must come before every other rule. Relative URLs resolve against the `.cssv` file. Import only stylesheets you trust: an imported stylesheet can send column names and key values to its server (spec §11.3).
- Painting is clipped to the table's box: give the table a margin when it has an outer `box-shadow`. A table wider than the element is cut off at the element's edge unless the page sets `cssv-table { overflow-x: auto; }`.
- To lay the table out as cards, a board or a calendar, change `display` on its parts. With `table { display: grid; }` and `thead, tbody, tr { display: contents; }`, every cell is a grid item. Hide the column group with `colgroup { display: none; }`, or it takes the first grid cell and shifts every cell after it by one.
- Text from `::before` and `::after` is decoration. Exports such as Markdown use the field values.

When a style depends on something CSS can't see, put it in the data:

- **By category** (status, team, priority): make that column the key and select `tr[data-key="…"]`, or add a short code column and key on it.
- **By threshold**: add a column that is negative or positive on either side of the threshold, such as `over = actual - budget`, and style it with the sign classes. Compute such values before writing the file. CSSV has no formulas.

## Embedding

In a web page, load the renderer from a CDN; no build step is needed. With npm, run `npm install @rhpaiva/cssv` and `import '@rhpaiva/cssv/cssv-table.js'` instead of the script tag.

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@rhpaiva/cssv@0.4/src/cssv-table.js"></script>

<cssv-table src="report.cssv"></cssv-table>

<cssv-table>
  <script type="text/cssv">
    ---
    .negative { color: crimson; }
    ---
    item,amount
    Refund,-45.50
  </script>
</cssv-table>
```

- A `key="column"` attribute sets the key column and wins over `--cssv-key`. `lang="de-DE"` sets the display locale; otherwise it comes from the nearest `lang` around the element.
- Inline text can be indented like the markup around it: the renderer removes the first line's indentation from every line. It can't contain `</script`.
- To show new data, set the element's `src`, or pass a whole CSSV text to `update(text)`, for example one fetched with credentials. The shown table stays until the new one is ready, and when the columns and imports are the same it's changed in place, so this suits live data and pages of results.
- `await el.ready` waits for the latest render; `el.errors` then lists its problems as `{ section, message, fatal }`. Each one is also logged with `console.warn` and fired as a `cssv-error` event.
- Serve `.cssv` files as `text/plain; charset=utf-8`.
- In Markdown, use a fenced code block with the language `cssv`.

The processor also runs in Node without a DOM: `import { parse, toHtml } from '@rhpaiva/cssv'`. `parse(text)` returns `{ style, delimiter, columns, numberColumns, rows }`, `metadata(text)` returns `{ title, description }` from the `cssv:` comments, and `toHtml(model, { locale, key })` returns the table model as HTML.

## Before you finish

1. The file starts with a `---` line and has exactly one closing `---` line, or it has no style block at all.
2. A style block, if the file has one, opens with `/* cssv:title … */` and `/* cssv:description … */`.
3. Every name in `data-col`, `--cssv-key` and `key` matches a header field character for character, and a `col(n)` key is no higher than the number of columns.
4. Every row has as many fields as the header, and fields containing the delimiter, quotes or line breaks are quoted.
5. Numbers are raw: no group separators, currency symbols, percent signs or plus signs.
6. Selectors use only the hooks above, and every `--cssv-format` uses only the four options.
7. Run the checks below when you can.

## Checking a file

When Node and a POSIX shell such as bash are available, check the file with the `@rhpaiva/cssv` package (`npm install @rhpaiva/cssv` in the directory you run it from). `parse()` throws on a missing closing fence or an unterminated quoted field. The rest of the script warns about rows with more fields than the header, columns that mix numbers with text such as `1,200`, and `data-col`, `--cssv-key` and `--cssv-format` values in the style block that don't match the data. It doesn't read imported stylesheets. An export kept unchanged on purpose may have warnings that are fine.

```
node --input-type=module - report.cssv <<'EOF'
import { parse, parseCssvValue, parseKey, parseFormat } from '@rhpaiva/cssv';
import { readFileSync } from 'node:fs';

const m = parse(readFileSync(process.argv[2], 'utf8'));
const css = (m.style ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
const problems = new Set();
for (const r of m.rows) {
  if (r.fields.some((f, c) => f !== '' && m.columns[c] === '')) {
    problems.add(`row ${r.number} has more fields than the header: quote fields that contain "${m.delimiter}"`);
  }
}
m.columns.forEach((name, c) => {
  const text = m.rows.find((r) => r.types[c].type === 'text' && /\d/.test(r.fields[c]));
  if (text && m.rows.some((r) => r.types[c].type === 'number')) {
    problems.add(`column "${name}" mixes numbers with text such as "${text.fields[c]}" (row ${text.number})`);
  }
});
for (const [, name] of css.matchAll(/\[data-col\s*=\s*["']([^"']*)["']/g)) {
  if (!m.columns.includes(name)) problems.add(`no column is named "${name}"`);
}
for (const [, raw] of css.matchAll(/--cssv-key\s*:([^;}]*)/g)) {
  const key = parseKey(raw);
  if (key === null) problems.add(`invalid --cssv-key: ${raw.trim()}`);
  else if (typeof key === 'number' && key > m.columns.length) problems.add(`--cssv-key: col(${key}) is past the last column (${m.columns.length})`);
  else if (typeof key === 'string' && !m.columns.includes(key)) problems.add(`--cssv-key names no column: "${key}"`);
}
for (const [, raw] of css.matchAll(/--cssv-format\s*:([^;}]*)/g)) {
  if (!parseFormat(parseCssvValue(raw))) problems.add(`invalid --cssv-format: ${raw.trim()}`);
}
console.log(m.columns, `${m.rows.length} rows`);
console.log([...problems].join('\n') || 'No problems found.');
EOF
```

When you can open a page in a browser, for example with Playwright, render the file in a `<cssv-table>` and read `el.errors` after `await el.ready`. The renderer also reports invalid CSSV properties set in imported stylesheets, a key column that doesn't exist, and imports that failed to load.
