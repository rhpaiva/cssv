# CSSV

[![CI](https://img.shields.io/github/actions/workflow/status/rhpaiva/cssv/ci.yml?branch=main&label=CI)](https://github.com/rhpaiva/cssv/actions/workflows/ci.yml) [![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fcssv.dev%2Fcoverage.json)](https://github.com/rhpaiva/cssv/actions/workflows/ci.yml)

**CSSV (Comma-Separated Styled Values)** keeps a table's data and its look in one plain-text file: CSV for the data, with a CSS style block on top for the presentation. A renderer turns the CSV into an HTML table and applies the file's own styles, so the table carries its look to every page that shows it.

This repository holds the specification, [SPEC.md](SPEC.md), and its reference implementation: the `<cssv-table>` element and a processor that runs in Node.

[Website and live editor](https://cssv.dev/) · [npm package](https://www.npmjs.com/package/@rhpaiva/cssv) · [Skill for AI agents](skills/cssv/SKILL.md)

![A plain CSV file of flights, captioned "This is a CSV.", flies line by line into a split-flap departures board: "This is also a CSV." So are a resume, the periodic table, a WhatsApp chat and an airplane seat map, each line landing on the row it becomes. Every one is a CSV with CSS on top: the board turns over to show its style block above the data, and deleting the CSS gives the plain CSV back.](https://cssv.dev/intro.svg)

```
---
@import url("brand.css");
table { --cssv-key: item; }
.negative { color: crimson; }
tr[data-key="Total"] { font-weight: bold; }
---
item,amount
Rent,1200
Refund,-45.50
Total,1154.50
```

## When to use it

Use CSSV when the styles belong with the data: a report that a script or a language model writes complete with its look, a file shown on several pages or sites that should bring its styles along, or a table reviewed as a text diff. Many files can import one shared stylesheet, so a change to it restyles all of them.

If you only need to show a CSV file and your page's CSS styles it, a CSV parser and a few lines that build a table are enough. Existing CSV files are already valid CSSV files, though, so you can start from an export and add a style block above it.

## Install

```
npm install @rhpaiva/cssv
```

Or load it in a page from a CDN, with no install or build step:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@rhpaiva/cssv@0.5/src/cssv-table.js"></script>
```

The package has no dependencies and two entry points: `@rhpaiva/cssv/cssv-table.js` defines the `<cssv-table>` element, and `@rhpaiva/cssv` is the processor, which needs no DOM. Versions are 0.x, so pin the minor version (`@0.5`) to get fixes without breaking changes.

## Use in a page

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@rhpaiva/cssv@0.5/src/cssv-table.js"></script>

<cssv-table src="budget.cssv"></cssv-table>
<cssv-table src="export.csv" key="category"></cssv-table>

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

| Attribute | Meaning |
| --- | --- |
| `src` | URL of a `.cssv` (or plain `.csv`) file. Without it, the element reads a child `<script type="text/cssv">`. |
| `key` | Key column set by the host, by name (never `col()`); wins over `--cssv-key` (SPEC §9.1). |
| `lang` | Display locale; otherwise the nearest `lang` around the element, then the browser's locale (§10.1). |

| Property, method or event | Meaning |
| --- | --- |
| `src` | The `src` attribute, or `null` when the element reads inline text. Setting it loads the new file; setting `null` removes the attribute. |
| `ready` | Promise that resolves when the latest render has finished. |
| `table` | The rendered `<table>` (the table model, §7), or `null`. |
| `model` | The parsed file: `{ style, delimiter, columns, numberColumns, rows }`. |
| `errors` | Problems from the last render: `{ section, message, fatal }`. |
| `toMarkdown()` | The rendered table as GitHub Flavored Markdown (Appendix B). |
| `update(text)` | Shows `text`, a whole CSSV file, instead of the current content, and returns `ready`. The text stays until `src` or the inline text changes; `src` keeps its value. See [Updating in place](#updating-in-place). |
| `cssv-loadstart` event | Fired at the start of every render (on connection, on `update()`, and when `src`, `key`, `lang` or the inline text changes), even when there is nothing to load. |
| `cssv-load` event | Fired after a successful render. |
| `cssv-error` event | Fired for each problem; bubbles and crosses shadow roots. `detail` is `{ section, message, fatal }`. |
| `cssv-loadend` event | Fired when the latest render finishes, whether it succeeded or failed. A render replaced by a newer one ends without events, so the last `cssv-loadstart` is always followed by one `cssv-loadend`. |

With a bundler, `import '@rhpaiva/cssv/cssv-table.js';` defines the element instead of the script tag.

### Loading new data

Set `src` to load another file, for example the next page of results. The current table stays on screen while the file and its styles load, and the new one replaces it once it is ready. A loading indicator can follow the two loading events:

```js
table.addEventListener('cssv-loadstart', () => { spinner.hidden = false; });
table.addEventListener('cssv-loadend', () => { spinner.hidden = true; });
table.src = '/api/orders.cssv?page=2';
```

To send credentials or custom headers, or to read pagination details from the response, fetch the file yourself and pass the text to `update()`:

```js
const res = await fetch('/api/orders.cssv?page=2', { headers: { Authorization: `Bearer ${token}` } });
await document.querySelector('#orders').update(await res.text());
```

`update()` uses the text exactly as given. Relative URLs in it resolve against the last file the element loaded with `src`, or against the page if there was none, so a server that sends text for `update()` should write absolute or root-relative imports such as `@import url("/styles/orders.css")`. Writing the text into a `<script type="text/cssv">` inside the element also works, but inline text is dedented and trimmed (SPEC Appendix C).

### Updating in place

If a new text has the same columns, and its style block changes only in rules that need nothing loaded, the element doesn't build a new table. It replaces the changed style rules and changes the table on screen: rows that match at the start and at the end stay as they are, rows between them are changed cell by cell, and the rest are added or removed, so inserting one row adds one `<tr>`. Then it applies `--cssv-key` and `--cssv-format` again. The result is the table a full render would build, and `table` stays the same element. This suits editing values, rows or styles, live data such as a dashboard's numbers, and pages of results. It applies to every render, including a change of `src`, `key` or `lang`. Changing the columns or an `@import` renders in full.

With 1,000 records and a heavy stylesheet, a one-cell change takes about a tenth as long as a full render until painted, and with 10,000 records about a twentieth. Inserting or deleting a row takes from a third to a sixth as long: rows below it move, so selectors that depend on position, such as `:nth-child()`, apply to them again. The rest is the browser laying the table out again, since one cell can change the column widths.

The page can style the table with `cssv-table::part(table)`. A table wider than the element is cut off at the element's edge (§11.4); add `cssv-table { overflow-x: auto; }` to scroll it instead.

## Use without a browser

The processor (`src/core.js`) has no DOM dependencies and runs in Node:

```js
import { parse, metadata, toHtml, defaultDisplay, parseFormat, parseCssvValue, parseKey, formatNumber } from '@rhpaiva/cssv';

const model = parse(text);                                  // SPEC §3–6
const html = toHtml(model, { locale: 'de-DE', key: 'id' }); // the §8.3 step 2 table model
// key is a column name, or a column number counted from 1, as parseKey() reads col(2)
const { title, description } = metadata(text);              // SPEC §4.6, plain text; either may be missing
```

## Tests

```
npm install
npx playwright install chromium   # once, for the browser tests
npm test                          # unit + browser
CHROME_PATH=/path/to/chrome npm test   # with a Chrome or Chromium you already have, instead of the install
npm run test:unit                 # no browser needed
npm run test:browser
npm run coverage                  # npm test under c8: line coverage of src/, from Node and the browser together
npm run mutate                    # mutation tests of src/core.js against the unit tests; report in reports/mutation/
```

- `test/unit/`: the processor (core.js), one file per spec area. Test names start with the spec section.
- `test/browser/`: the renderer in headless Chromium through Playwright, with a local server for imports, redirects, slow and missing files.
- `test/spec-examples/`: every example printed in SPEC.md, asserted literally. Another implementation can reuse these to check itself against the spec.

[CONFORMANCE.md](CONFORMANCE.md) maps each requirement in the spec to the tests that cover it.

`npm run mutate` runs [Stryker](https://stryker-mutator.io/), which changes `src/core.js` one small edit at a time (a `<` for a `<=`, a removed line) and checks that the unit tests fail for each change. A change they miss is a gap in the tests. It fails below the score set in `stryker.config.json`. The renderer, `src/cssv-table.js`, isn't mutated, because each mutant would need a full browser run.

`.github/workflows/ci.yml` runs `npm run coverage` and `npm run mutate` on every push to `main` and every pull request.

## Performance

`npm run bench [-- 100 500 5000]` renders generated 6-column tables (3 numeric) in headless Chromium. Median times on an i7-11800H, Chromium 153, with a style block, `--cssv-key` and `--cssv-format`:

| Records | `parse()` | Until `ready` | Until painted | `toMarkdown()` |
| --- | --- | --- | --- | --- |
| 100 | 0.1 ms | 5 ms | 15 ms (one frame) | 1.2 ms |
| 500 | 0.5 ms | 31 ms | 51 ms | 6.7 ms |
| 5,000 | 4.7 ms | 333 ms | 467 ms | 67 ms |

Parsing is a small share. Most of the time is creating the DOM and computing styles for every cell, which grows linearly with the number of cells.

## Website and demo

```
python3 -m http.server   # from the repository root: website at http://localhost:8000/site/, demo at /examples/, editor at /site/editor/
```

The website lives in `site/`. Like the demo, it loads `../src/` and `../examples/`, so any static server at the repository root works, and every table on it is a `<cssv-table>`. `.github/workflows/ci.yml` publishes it to [cssv.dev](https://cssv.dev/) on each push to `main` once the tests pass, with `site/` as the root.

Two scripts make animations from the real renderer. Each renders its tables with `<cssv-table>` in Chromium and embeds them, with their stylesheets, in an SVG that has no script and also animates as an `<img>`. `node tools/intro.js` makes `site/intro.svg`, the animation at the top of this README, and with `--mp4 intro.mp4` also records it as a 1080p video (this needs ffmpeg). `node tools/demo-svg.js` makes `site/demo.svg`, in which a file is typed next to the table it renders. Run them again after changing the renderer, its default styles or the files they show.

## Desktop viewer

[CSSV Viewer](https://github.com/rhpaiva/cssv-viewer) is an app that opens `.cssv` files from disk: a [Tauri](https://tauri.app/) window around `<cssv-table>`, with a tab for each file, find, a plain and a source view, copying, saving as CSV, PNG or SVG, and printing. It lives in its own repository and takes the renderer from this package on npm.

## Use with AI agents

[skills/cssv/SKILL.md](skills/cssv/SKILL.md) is a Claude Code skill that teaches Claude to write correct CSSV files: the format rules, the table model's hooks, the CSSV properties, a checklist and a script that checks a file. Save it as `~/.claude/skills/cssv/SKILL.md` for every project, or as `.claude/skills/cssv/SKILL.md` in one:

```
curl --create-dirs -o ~/.claude/skills/cssv/SKILL.md https://cssv.dev/skills/cssv/SKILL.md
```

[cssv.dev/llms.txt](https://cssv.dev/llms.txt) lists the docs and examples for language models and the tools that index sites for them.

## Implementation notes

- **Two shadow roots.** The table lives in a shadow root inside a second, renderer-owned shadow root. Paint containment (§11.4) sits on an element the file's stylesheet cannot select, so even `:host { position: fixed !important }` stays inside the table's box. That box is as wide as the table, so the element itself has `overflow-x: clip`: a table wider than the element can't cover what is beside it. A page can set `overflow-x` on the element to override it.
- **Waiting for styles.** A `<style>` element fires `load` (or `error`) only after all its imports, including nested ones, have finished, so the renderer waits on that single event before reading `--cssv-key` and `--cssv-format` (§8.3). When a new file replaces the table, the old table stays visible while the file loads and is swapped out only when the new one is inserted, which is then hidden until its styles have loaded.
- **Relative URLs.** The style block's `@import` and `url()` references are rewritten to absolute URLs based on the file's final URL after redirects (§4.3). URLs inside `image-set()` strings are not rewritten.
- **Remote loads (§11.2).** This renderer does not restrict them: a style block can load anything the browser allows. To restrict them, give the page a Content Security Policy such as `default-src 'self'; style-src 'self' 'unsafe-inline'`, which blocks `@import` and `url()` loads from other origins; a blocked import is reported like any failed import. `style-src` needs `'unsafe-inline'`, because the renderer adds its styles as `<style>` elements, and without it no styles apply.
- **Fatal errors.** A malformed file, or one that cannot be loaded, renders nothing and fires `cssv-error` with `fatal: true`.
- **Limits (§11.6).** `parse()` refuses a table of more than 1,000,000 cells (records × columns, `MAX_CELLS`) with a §11.6 error, so the element renders nothing and reports it. A file of a few kilobytes can otherwise describe millions of cells: one long record pads every other one. Rendering takes about 11 seconds per million cells in Chromium. `parse(text, { maxCells })` changes the limit. There is no limit on file size, rows or import depth.
- **Server-side rendering.** `toHtml()` produces the step 2 table model. `cssv-table.js` can be imported where there is no DOM; it defines the element only in browsers. The component does not yet take over server-rendered output (§8.4 makes that optional).
- **Browsers.** Tested in Chromium only.

### Known deviations

- **§4.5.** In the inner shadow root the author stylesheet can also match `:host` (the inner frame element) and the two `<style>` elements, not only the table model. Neither can affect the page or escape containment.
- **§8.3 step 4, when updating in place.** `--cssv-key` is read while the rows still carry their previous `data-key`s. A stylesheet whose `--cssv-key` depends on `data-key`, for example through `table:has(tr[data-key="Total"])`, can therefore pick a different key column than a full render would. Removing every `data-key` before the read would restyle all rows on every update.
