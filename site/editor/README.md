# CSSV Editor

A browser editor for CSSV files, published at https://cssv.dev/editor/: the table, rendered by `<cssv-table>` with a grid drawn around it, next to the file's text, each updating the other. It edits files, not spreadsheets: there are no formulas, and a file is one table (SPEC 1.3). It's part of the website, not the npm package.

```
python3 -m http.server          # from the repository root
open http://localhost:8000/site/editor/
node tools/editor-ledger.js     # regenerates ledger.cssv from ledger-theme.css
```

## Pages and files

- The page uses the website's header (`site/nav.css`) and copies its color tokens from `site/site.css` into `sheet.css`. It doesn't load `site.css`, whose class names (`.wrap`, `.card`, `.status`) mean other things here. The home scrolls like the site's other pages, with their footer; the editor fills the window below the header.
- The home shows a card for each file listed in `files.js`, the ones that best show what a style block can do, with the file's first rows rendered from its own style block. The budget and paginated ledger examples stay in the gallery but aren't listed. A card opens `?file=<repository path>`, and only listed paths open. Files from the computer open through "Open…" or by dropping them on the page.
- Project files are loaded through the table's `src` first, so relative URLs in the style block (`@import url("ledger.css")`) resolve against the file; `update()` keeps that base for every later change.

## Privacy

- The page's Content-Security-Policy allows nothing from other origins, so a file that imports fonts, stylesheets or images from elsewhere renders without them, and the status bar names the blocked hosts. A meta CSP can't be relaxed at runtime; there is no switch.
- `ledger.cssv` uses web fonts served from `fonts/`: WOFF2 files copied unchanged from the Fontsource npm packages, with each family's OFL license. `fonts.css` says which subsets.
- Chromium ignores `@font-face` inside shadow roots, so the editor copies the style block's web fonts to the document (`fonts.js`), reading only same-origin stylesheets.
- While a file has unsaved changes, a draft is kept in `localStorage` (`cssv-editor:draft:` and the path, or `local:` and the name) and offered when the file is opened again; the home marks those files. Saving deletes the draft. The source pane's open state is kept there too. `site/privacy.html` describes both.

## Editing

- The file's text is the only state. Edits, sorts, row and column changes and styles each produce new text, changing only the characters involved (`cssv-text.js`). Undo keeps text snapshots.
- The editor adds nothing to the table model. Row numbers, column letters, the selection and the cell editor are drawn around and over it, positioned from the rendered cells.
- A style block can lay the table out its own way: `elements.cssv` makes it a grid of tiles, `forecast.cssv` turns rows into columns, `nutrition.cssv` makes each row a line of a label. Row and column bars only make sense while the header cells sit side by side and the rows stack, so otherwise they're left out ("Free layout" in the status bar). The selection is drawn on the cells themselves, a hidden cell is marked by its row, and arrow keys still move by record and field.
- New text goes to the table's `update()`. When the columns and the `@import`s stay the same, `<cssv-table>` changes the table in place: edits and style changes (~45 ms), inserted or deleted rows (~160 ms), sorts (~385 ms, every cell changes) and a new locale. Anything else renders in full, with the old table on screen until the new one is ready.
- Text that doesn't parse isn't sent to the table, so the last good table stays on screen with the error.
- The source pane colors the text with `site/highlight.js`, under a transparent textarea. Files under 20,000 characters are colored as you type; longer ones show plain text while you type and their colors when typing pauses. It's open by default in windows at least 1200px wide.
- Double-click, Enter or F2 edits a cell in place, in the cell's font and the editor's colors. Typing replaces the value, and arrow keys then commit and move. In edit mode, Left and Right move the caret, and Up and Down commit and move from the first or last line. Alt+Enter adds a line break, Escape cancels.
- Typed and pasted numbers are read in the selected locale and saved in the file's fixed form (`1.234,5` in de-DE becomes `1234.5`). A leading `'` keeps text as typed.
- Paste takes tab-separated values, as Excel, Numbers and Google Sheets copy them, from the active cell; one value fills the selection. Rows and columns are added when the values reach past the last ones. New columns are named "new column", "new column 2" and so on, since names are what `data-col` rules select.
- Columns can be inserted, deleted and moved. Renaming a column (editing its header) renames the editor's own `data-col` rules; deleting one removes them. Rules the author wrote are left as they are.
- Save (Ctrl+S) writes back to the opened file where the browser has the File System Access API (Chromium), and asks where to save a file it has no handle for. Elsewhere, such as Firefox, it downloads the file.

## Styles and the key column

- Style tools write rules into a section marked `/* cssv-editor: ... */` at the end of the style block, then count the cells where each rule actually shows.
- When every body row has a different key (`--cssv-key`, 9.1), styles for single rows and cells name the row by `data-key`, so they stay with the row in any order, including after edits to the text. Changing a key value in the grid moves the editor's rules for that row along. Otherwise rows are named by `data-row`, which the editor renumbers when it sorts, inserts or deletes rows; rows moved by hand-editing the text keep their numbers, so their styles stay behind. "Every row with this key" uses `data-key` and reaches all rows that share the value.
- The Key picker writes `table { --cssv-key: "…" }` into the editor's section, after the author's rules, so the cascade picks it; "none" writes `initial` when the author's styles set a key. The editor's row rules move to the new keys, or to row numbers when the new column doesn't tell every row apart.

## Accessibility

- The table is drawn in shadow roots, out of reach of `aria-activedescendant`, so a polite live region reads out the active cell ("B3, company: Quantum Bits") once the selection settles. The sheet's description lists the keys.

## Browsers

- Checked in Chrome and Firefox. Safari isn't checked yet.
