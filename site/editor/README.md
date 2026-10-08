# CSSV Editor

A browser editor for CSSV files, published at https://cssv.dev/editor/: the table, rendered by `<cssv-table>` with a grid drawn around it, next to the file's text, each updating the other. It edits files, not spreadsheets: there are no formulas, and a file is one table (SPEC 1.3). It's part of the website, not the npm package.

```
python3 -m http.server          # from the repository root
open http://localhost:8000/site/editor/
node tools/editor-ledger.js     # regenerates ledger.cssv from ledger-theme.css
```

## Pages and files

- The home uses the website's header (`site/nav.css`) and footer and scrolls like the site's other pages. The editor fills the window with its own header instead: the site's logo, the file's path and state, a menu bar (File, Edit, View, Insert, Format, Data, Help), and the Open, Source, Inspector and Save buttons. Under it are a toolbar of grouped icon buttons, the formula bar, the sheet with its side panes, and the status bar, which has the key column and locale pickers. `sheet.css` copies the color tokens from `site/site.css`; it doesn't load `site.css`, whose class names (`.wrap`, `.card`, `.status`) mean other things here.
- `menu.js` draws the menus: the menu bar's, each column header's (its chevron, or a right-click on the header) and each cell's (a right-click, Shift+F10 or the menu key). Items are built when a menu opens, so they describe the current selection. Arrow keys move through them, Left and Right move along the menu bar, and Escape closes. Ctrl+/ lists the keyboard shortcuts.
- The home shows a card for each file listed in `files.js`, in the gallery's groups (files made for the gallery, real usage examples, the website's own), with the file's title and description from its `cssv:` comments (SPEC 4.6) and its first rows rendered from its own style block. Oslo stands for the three weather files, which share `weather.css`. The budget and paginated ledger examples stay in the gallery but aren't listed. A card opens `?file=<repository path>`, and only listed paths open. Files from the computer open through "Open…" or by dropping them on the page.
- Project files are loaded through the table's `src` first, so relative URLs in the style block (`@import url("ledger.css")`) resolve against the file; `update()` keeps that base for every later change.

## Privacy

- The page's Content-Security-Policy allows nothing from other origins, so a file that imports fonts, stylesheets or images from elsewhere renders without them, and the status bar names the blocked hosts. A meta CSP can't be relaxed at runtime; there is no switch.
- `ledger.cssv` uses web fonts served from `fonts/`: WOFF2 files copied unchanged from the Fontsource npm packages, with each family's OFL license. `fonts.css` says which subsets.
- Chromium ignores `@font-face` inside shadow roots, so the editor copies the style block's web fonts to the document (`fonts.js`), reading only same-origin stylesheets.
- While a file has unsaved changes, a draft is kept in `localStorage` (`cssv-editor:draft:` and the path, or `local:` and the name) and offered when the file is opened again; the home marks those files. Saving deletes the draft. Whether the source pane and the inspector are open is kept there too (`cssv-editor:source`, `cssv-editor:inspector`). `site/privacy.html` describes all of it.

## Editing

- The file's text is the only state. Edits, sorts, row and column changes and styles each produce new text, changing only the characters involved (`cssv-text.js`). Undo keeps text snapshots.
- The editor adds nothing to the table model. Row numbers, column letters, the selection and the cell editor are drawn around and over it, positioned from the rendered cells.
- A style block can lay the table out its own way: `elements.cssv` makes it a grid of tiles, `forecast.cssv` turns rows into columns, `nutrition.cssv` makes each row a line of a label. Row and column bars only make sense while the header cells sit side by side and the rows stack, so otherwise they're left out ("Free layout" in the status bar), and the table gets the pane's full width instead of its content's, so a style block that sizes the table to its container (`width: 100%` with `contain: inline-size`) fills the pane. The selection is drawn on the cells themselves, a hidden cell is marked by its row, and arrow keys still move by record and field. When rows are drawn over each other (`stadium.cssv` makes each row a layer over the whole bowl), a hidden cell is marked by its row's cells that show instead. A click on what a row draws itself, such as a stadium section (a row's `::before`), selects the row's nearest cell that shows.
- New text goes to the table's `update()`. When the columns and the `@import`s stay the same, `<cssv-table>` changes the table in place: edits and style changes (~45 ms), inserted or deleted rows (~160 ms), sorts (~385 ms, every cell changes) and a new locale. Anything else renders in full, with the old table on screen until the new one is ready.
- Text that doesn't parse isn't sent to the table, so the last good table stays on screen with the error.
- The source pane colors the text with `site/highlight.js`, under a transparent textarea. Files under 20,000 characters are colored as you type; longer ones show plain text while you type and their colors when typing pauses. The inspector is open by default in windows at least 1100px wide, and the source pane in windows at least 1600px wide, since both together leave the sheet little room; each choice is remembered.
- Double-click, Enter or F2 edits a cell in place, in the cell's font and the editor's colors. Typing replaces the value, and arrow keys then commit and move. In edit mode, Left and Right move the caret, and Up and Down commit and move from the first or last line. Alt+Enter adds a line break, Escape cancels. A cell the style block hides has no box to type over, so Enter, F2 and typing edit it in the formula bar.
- Typed and pasted numbers are read in the selected locale and saved in the file's fixed form (`1.234,5` in de-DE becomes `1234.5`). A leading `'` keeps text as typed.
- Paste takes tab-separated values, as Excel, Numbers and Google Sheets copy them, from the active cell; one value fills the selection. Rows and columns are added when the values reach past the last ones. New columns are named "new column", "new column 2" and so on, since names are what `data-col` rules select.
- Rows can be inserted above or below the active cell. Columns can be inserted left or right, deleted and moved. Renaming a column (editing its header) renames the editor's own `data-col` rules; deleting one removes them. Rules the author wrote are left as they are.
- File → "Download the data as CSV" saves the data section alone, for tools that don't know CSSV, and "Copy the table as Markdown" uses the table's `toMarkdown()`.
- Save (Ctrl+S) writes back to the opened file where the browser has the File System Access API (Chromium), and asks where to save a file it has no handle for. Elsewhere, such as Firefox, it downloads the file.

## Styles and the key column

- Style tools write rules into a section marked `/* cssv-editor: ... */` at the end of the style block, then count the cells where each rule actually shows.
- The selection decides which rule, as in spreadsheets: whole columns (selected from their letters, or every body row of them) get `td[data-col="…"]`, whole rows a rule per row, everything (Ctrl+A) the `table` rule, and anything else a rule per cell. The `table` rule also holds the key column's declaration, so clearing the table's style keeps the key. The status bar and the Format menu say what a style went to.
- "Style every row with key …", in the cell menu and the Format menu, sends styles to `tr[data-key="…"] td` for the active row's key instead, until it's turned off; the status bar shows it while it's on.
- The tools: font (the file's own web fonts, then stacks every system has), size in pixels, bold, italic, underline and strikethrough (words of one `text-decoration-line`, so they combine), text color, fill, borders (all, bottom, none), alignment (`text-align: start`, `center` or `end`, so right-to-left tables mirror), vertical alignment and wrapping (`white-space: pre-wrap` or `nowrap`). The bold, italic, underline, strikethrough and alignment buttons show as pressed when the editor's rule for the selection sets them.
- Number formats are styles too: `--cssv-format` (9.2). The toolbar's `.0` and `.00` buttons show one decimal place fewer or more than the active number cell, and `1,000` turns grouping on or off. The inspector has presets, steppers for each of the four options and a preview in every locale the editor offers, and says which rule it writes. "As written" removes the editor's format, or writes `initial` when the author's rules set one.

## Find and replace

- Ctrl+F opens a box over the sheet's corner, and Ctrl+H opens it with replace. The toolbar's search button opens it too, shows as pressed while it's open, and closes it, as Escape does. It searches the values as the file has them (what the formula bar shows, column names included), not the formatted text, with options for case and whole cells. The matched text is marked on the table, not the whole cell, so a cell laid across its row doesn't light up the row; a cell that shows its value otherwise, such as a formatted number, or a whole-cell search, marks all of the cell's text. Enter and Shift+Enter move between them. In the source pane, Ctrl+F stays the browser's own find.
- Replace writes the new value as typed, without reading it as a localized number. Like an edit, a replaced column name renames the editor's `data-col` rules, and a replaced key value moves the editor's rules for that row. As in spreadsheets, the first Replace goes to the match and the next one replaces it.

## Printing

- Printing prints the table alone, as it shows, with its backgrounds (`print-color-adjust: exact`): the print styles in `sheet.css` hide the bars, panes and menus, and stop the sheet scrolling, since a scroll box prints only what's in view.
- Ctrl+P, the print button and File → Print open a preview first, as spreadsheets do; Ctrl+P there prints. It has paper (A4, or Letter where the browser's language says US, Canada, Mexico or the Philippines), orientation, scale (fit to the page width, or actual size), margins and background colors. The settings become an `@page` rule, `--print-zoom` and a class on `<html>`, which the print styles read. Fitting uses `zoom`, which paginates, rather than a transform. Settings last for the page; they aren't stored.
- The preview renders a second `<cssv-table>` from a copy of the file in which the style block's `@media print` rules apply and its `screen` rules don't (`print` becomes `all`, `screen` becomes `print`), with relative URLs made absolute, so it shows a file's own print styles. Width-based media queries still see the window, not the paper.
- Each page of the preview is a sheet of paper. The table runs through CSS columns the size of a page's printable box (`column-height`, with `column-wrap: wrap` stacking one column per row), so the browser splits it between pages as it splits printed pages, and the number of fragments is the page count; the ledger comes out at 20 pages on A4, as its PDF does. Printing repeats the header row on every page, but columns only repeat a header that can't break, so the copy adds `thead { break-inside: avoid }` in a layer of its own, which the file's rules override. Browsers without `column-wrap` show the pages side by side.
- Escape closes the preview, wherever the focus is.

## The inspector

- The inspector shows the active cell: its classes and attributes from the table model (§7), its value in the file and as shown, its number format, and the rules that style it.
- The rules come from the table's own stylesheets as the browser parsed them: the CSSOM of the inner shadow root, walking into `@import`, `@media` and `@supports` rules that apply, and `@layer` and `@container` rules (`rules.js`). A rule is listed when one of its selectors matches the cell, or the cell with `::before` or `::after`. They're ordered as the cascade orders them, most specific first: unlayered rules before the layered §8.2 defaults, then specificity, then source order. Rules on the row and the table follow, folded, since custom properties and many others inherit. Overridden declarations aren't struck out: that needs the whole cascade, shorthands included, and a wrong mark is worse than none.
- Each rule from the style block shows its line in the file; clicking it selects that line in the source pane. Lines come from scanning the style block for rule selectors and pairing them, in order, with the CSSOM's rules by their selector text, so rules the browser dropped don't shift the rest. The editor's own rules are marked. Imported rules show their file's name, and the defaults "§8.2".
- It renders at most once a frame, after the selection or the table changes; on the 1,000-row ledger that takes about 5 ms.
- When every body row has a different key (`--cssv-key`, 9.1), styles for single rows and cells name the row by `data-key`, so they stay with the row in any order, including after edits to the text. Changing a key value in the grid moves the editor's rules for that row along. Otherwise rows are named by `data-row`, which the editor renumbers when it sorts, inserts or deletes rows; rows moved by hand-editing the text keep their numbers, so their styles stay behind. "Every row with this key" uses `data-key` and reaches all rows that share the value.
- The Key picker writes `table { --cssv-key: "…" }` into the editor's section, after the author's rules, so the cascade picks it; "none" writes `initial` when the author's styles set a key. The editor's row rules move to the new keys, or to row numbers when the new column doesn't tell every row apart.

## Accessibility

- The table is drawn in shadow roots, out of reach of `aria-activedescendant`, so a polite live region reads out the active cell ("B3, company: Quantum Bits") once the selection settles. The sheet's description lists the keys.

## Browsers

- Checked in Chrome and Firefox. Safari isn't checked yet.
