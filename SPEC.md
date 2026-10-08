# CSSV v1 — Comma-Separated Styled Values

Oct 1, 2026 · @Rodrigo Paiva

## Status and abstract

**Status:** version 1, open for review. Breaking changes are possible until v1 is marked stable. The latest version is at [cssv.dev/spec.html](https://cssv.dev/spec.html).

CSSV (Comma-Separated Styled Values) is CSV data with an optional CSS stylesheet at the top of the same file. A CSSV renderer turns the data into an HTML table with the fixed structure defined here, then applies the stylesheet to it. Without its stylesheet a CSSV file is an ordinary CSV file, and most CSV files are valid CSSV files as they are.

## 1. Introduction

CSSV lets code, people and language models write styled tables as plain text, using two languages they already know: CSV for data and CSS for presentation.

### 1.1 Example

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

The lines between the `---` fences are CSS. Everything after the second fence is CSV. A renderer shows the table with `-45.50` in crimson and the Total row in bold, using the fonts and colors from `brand.css`.

### 1.2 Goals

- **Plain text.** Data and styles can be read, diffed and reviewed as text.
- **No new languages.** Data is CSV ([RFC 4180](https://www.rfc-editor.org/rfc/rfc4180)) and styles are CSS. CSSV only defines how they connect.
- **Native rendering.** The output is an ordinary HTML table that browsers display without plugins.
- **Shared styles.** Many files can import one stylesheet, so a change to it restyles all of them.
- **Easy exit.** Deleting the style block leaves a CSV file.

### 1.3 Non-goals

Formulas, computed values, multiple sheets, merged cells and editing are out of scope. CSSV describes how a finished table looks, not how it is calculated.

### 1.4 Design principles

- **The table model is the contract.** Every renderer produces the same HTML structure (section 7), so a stylesheet works in every implementation.
- **CSS does what CSS can do.** CSSV only adds what CSS cannot know on its own: column names, row positions and value types.
- **Names in attributes, fixed words in classes, no copied content.** Attributes hold column names, plus row names when the author asks for them. Classes come from a short fixed list. Cell content is never copied into the markup, so a long value never appears in three places.
- **Extensions stay valid CSS.** Settings such as the key column and number formats are `--cssv-*` custom properties, and facts about the file, such as its title, are `cssv:` comments (section 4.6).

### 1.5 Processing model

```
                        .cssv file
                  (fences split it in two)
                 /                        \
         Style block                  Data section
   (CSS and imports, sec. 4)    (CSV and types, sec. 5–6)
               |                           |
               |                      Table model  ──────►  Server-side HTML
               |                 (fixed HTML, sec. 7)      (before styles, sec. 8.4)
               |                           |
               └──────────────►      Styled table
                            (default and author styles,
                             then keys and formats, 8–10)
                                   /              \
                          Browser display     Markdown or XLSX
                       (what the reader sees) (from computed styles)
```

A renderer splits the file at the fences, builds the table model from the data, then applies the styles and CSSV properties. Display and exports start from the styled table; a server can send the table model before any styles apply (section 8.4).

## 2. Conformance and terminology

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY and OPTIONAL are to be interpreted as described in BCP 14 ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)) when, and only when, they appear in all capitals. Examples, notes and appendices are informative; everything else is normative.

### 2.1 Conformance classes

| Class | What it does | Sections that apply |
| --- | --- | --- |
| CSSV file | A text file that follows the file format | 3 to 6 |
| CSSV processor | Reads a CSSV file into a style block, column names and typed records | 3 to 6 |
| CSSV renderer | A processor that also builds the table model, applies styles, reads CSSV properties and displays numbers | 3 to 11 |

Converters, such as a Markdown or XLSX exporter, are processors. Appendix B describes Markdown conversion.

### 2.2 Terms

- **Fence:** a line that opens or closes the style block (section 3.4).
- **Style block:** the CSS between the two fences.
- **Data section:** the CSV text after the style block, or the whole file when there is no style block.
- **Record:** one row of the data section, as in RFC 4180.
- **Field:** one value in a record.
- **Header record:** the first record of the data section.
- **Column name:** a field of the header record.
- **Table model:** the HTML structure a renderer builds from the data section (section 7).
- **Author stylesheet:** the style block together with every stylesheet it imports.
- **Default stylesheet:** the renderer's built-in styles (section 8.2).
- **CSSV property:** a CSS custom property whose name starts with `--cssv-` (section 9).

## 3. File structure

A CSSV file is UTF-8 text made of an optional style block followed by a data section.

```
---                          opening fence (first line)
@import url("brand.css");    style block: CSS
td { padding: 4px; }
---                          closing fence
item,amount                  data section: header record
Rent,1200                    data section: records
```

### 3.1 Encoding

A CSSV file MUST be encoded as UTF-8. It MAY start with a byte order mark (U+FEFF); processors MUST ignore it.

### 3.2 Line breaks

A line break is LF or CRLF. Processors MUST accept both, including both in one file. A CR that is not followed by LF is not a line break.

### 3.3 File name and media type

CSSV files SHOULD use the extension `.cssv`. No media type is registered yet. Until one is, servers SHOULD serve CSSV files as `text/plain; charset=utf-8`, and processors MUST NOT rely on the media type to recognize a CSSV file.

### 3.4 Fences and the style block

- A **fence** is a line made of exactly three hyphen-minus characters (`---`), optionally followed by spaces or tabs, and nothing else.
- If the first line of the file (after any byte order mark) is a fence, the file has a style block. The style block is every line between that fence and the next fence. The data section starts on the line after the closing fence.
- If the first line is not a fence, the file has no style block and the whole file is the data section.
- If an opening fence has no closing fence, the file is malformed. Processors MUST report an error and MUST NOT treat any part of the file as data.
- Processors find fences by reading lines, not by parsing CSS. A style block MUST NOT contain a line that is a fence, including inside CSS comments and strings.
- An empty style block (two fences on consecutive lines) is allowed.

> **Note:** A marker is needed because a CSV header such as `item,amount` is also a valid CSS selector list, so the end of the CSS cannot be found by parsing it. The `---` fence follows the front-matter convention of Markdown and CSVY.

## 4. Style block

The style block is a CSS stylesheet with exactly the syntax and meaning of a standalone `.css` file.

### 4.1 Parsing

Renderers MUST parse the style block as a stylesheet as defined by [CSS Syntax Level 3](https://www.w3.org/TR/css-syntax-3/). An `@charset` rule in the style block has no effect; the encoding is always UTF-8.

### 4.2 Imports

- The style block MAY contain any number of `@import` rules. As in CSS, they MUST come before all other rules except `@charset` and `@layer` statements; an `@import` after other rules is ignored.
- Imported stylesheets MAY import further stylesheets.
- Media queries, `supports()` and `layer()` on an `@import` work as in CSS.
- If an import fails to load, it is skipped as in CSS and the rest of the author stylesheet still applies. Renderers SHOULD report the failure.

### 4.3 Relative URLs

- Relative URLs in the style block, in `@import` rules and in `url()` values, resolve against the URL of the CSSV file.
- When the CSSV text has no URL of its own (for example, when it is embedded in an HTML page), they resolve against the base URL of the embedding document.
- Relative URLs inside an imported stylesheet resolve against that stylesheet's URL, as in CSS.

### 4.4 Cascade order

The author stylesheet cascades like a single CSS file. Rules from imported stylesheets come before the style block's own rules, so a style block rule wins over an imported rule of equal specificity. The default stylesheet sits in a cascade layer, so every unlayered author rule wins over it (section 8.2).

### 4.5 What selectors can match

The author stylesheet is matched against the table model only (section 7). The `table` element is the topmost element it can match. Selectors for `:root`, `html`, `body` or elements of an embedding page match nothing. Authors SHOULD set inherited custom properties on `table` instead of `:root`.

### 4.6 Metadata

A style block can start with metadata comments, which say what the file is without changing how it renders:

```
---
/* cssv:title Office move */
/* cssv:description What the move to the new office cost,
   item by item, in euros. */
/* Colors and fonts come from the brand stylesheet. */
@import url("brand.css");
---
item,amount
Movers,1800
Deposit refund,-450
```

This file's title is `Office move` and its description is `What the move to the new office cost, item by item, in euros.` The third comment is an ordinary comment.

- A **metadata comment** is a CSS comment whose text, after any white space, is `cssv:` and a name, followed by white space or the end of the comment. A name is one or more lowercase ASCII letters, digits and hyphens. Any other comment, such as `/* cssv:Title … */` or `/* cssv:title: … */`, is an ordinary comment.
- Only comments at the start of the style block count, with nothing but white space and other comments before them. The first other character, such as the `@` of an `@import`, ends the start; so does a comment with no closing `*/`.
- The value is the rest of the comment's text, with each run of white space replaced by one space and the white space at both ends removed. It can be empty. If a name appears more than once, the first one counts. White space here is space, tab, line feed, carriage return and form feed, as in CSS.
- This version defines two names:
  - `title`: a short name for the table, for example for a window title or a list of files.
  - `description`: a sentence or two saying what the table is, for example for a preview.
- Processors MAY show metadata values. The values are plain text: processors MUST NOT interpret them as markup. Metadata is not part of the table model (section 7.5).
- Every name after `cssv:` is reserved. Authors MUST NOT use names that this specification does not define, and processors MUST ignore names they do not know.

> **Note:** Metadata is written in comments, not in CSSV properties, so any program can read it from the start of the file without a CSS parser, and an imported stylesheet cannot change it. Ordinary comments, such as notes on how the styles work, can follow it.

## 5. Data section

The data section is CSV as defined by [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180), with these differences:

1. The encoding is UTF-8 (section 3.1).
2. The delimiter is `,` or `;`, detected from the header record (section 5.1).
3. Line breaks are LF or CRLF (section 3.2).
4. The first record is always the header record (section 5.2).
5. Records MAY have different numbers of fields (section 5.3).
6. Empty lines outside quoted fields are ignored.

Quoting follows RFC 4180. A field that contains the delimiter, a double quote or a line break MUST be enclosed in double quotes, and a double quote inside a quoted field is written as two (`""`). Fields are never trimmed: spaces are part of the value.

An unterminated quoted field makes the file malformed, and processors MUST report an error. A double quote inside an unquoted field is malformed input; processors SHOULD treat it as a literal character.

### 5.1 Delimiter detection

Processors MUST detect the delimiter with this algorithm:

1. Scan the data section from its first character. Every `"` switches between inside and outside quotes.
2. Stop at the first line break found outside quotes. This is the end of the header record.
3. Count the `,` and `;` characters found outside quotes.
4. If there are more `;` than `,`, the delimiter is `;`. Otherwise it is `,`.

The delimiter applies to the whole data section. It does not change how numbers are written (section 6.1).

### 5.2 Header record and column names

- The first record is the header record. Each of its fields is a column name.
- Column names are used exactly as written, with no trimming or case change. A column name MAY be empty, and several columns MAY share a name.

> **v1 decision, may change:** RFC 4180 makes the header optional. CSSV v1 requires it, because the table model names every column after it. Files without a header may be allowed in a later version (Appendix D).

### 5.3 Records and columns

- The number of columns is the largest number of fields in any record, including the header record.
- A record with fewer fields is padded with empty fields at the end.
- A column beyond the header's last field has an empty column name.
- Records are numbered by position: the header record is 1, the next record 2, and so on. Ignored empty lines are not counted. This number becomes `data-row` (section 7.2).
- A data section with no records produces a table model with no columns and no rows. A data section with only a header record produces no body rows.

## 6. Value types

Every field in a non-header record is a number, empty, or text. Only numbers get classes in the table model.

### 6.1 Numbers

A field is a number when the whole field matches this grammar ([ABNF, RFC 5234](https://www.rfc-editor.org/rfc/rfc5234)):

```
number   = [ "-" ] integer [ "." fraction ]
integer  = "0" / ( %x31-39 *DIGIT )
fraction = 1*DIGIT
DIGIT    = %x30-39
```

| Field | Type | Reason |
| --- | --- | --- |
| `1200` | number |  |
| `-45.50` | number |  |
| `0.5` | number |  |
| `007` | text | Leading zero, so IDs and postal codes stay text |
| `1,200` | text | Grouping separator |
| `1200,50` | text | Comma decimal, not supported in v1 |
| `+5` | text | Plus sign |
| `1e6` | text | Exponent |
| `  12 ` | text | Leading space |
| `.5` | text | No integer part |

Numbers are always written this way, whatever the delimiter or the reader's locale. Renderers localize them for display (section 10).

### 6.2 Sign

- A number whose digits are all zero (`0`, `0.00`, `-0`) is **zero**.
- Any other number that starts with `-` is **negative**.
- Every other number is **positive**.

### 6.3 Empty and text

- A field with no characters is **empty**. A field holding only spaces is text, not empty.
- Every other field is **text**.

### 6.4 Number columns

A column is a **number column** when every non-empty field below its header is a number and at least one such field exists. Empty fields do not prevent a column from being a number column.

## 7. Table model

A renderer MUST turn the data section into exactly this HTML structure. It is the only structure an author stylesheet may rely on.

```html
<table>
  <colgroup>
    <col data-col="NAME">                          <!-- one per column -->
  </colgroup>
  <thead>
    <tr data-row="1">
      <th data-col="NAME" class="number">NAME</th>  <!-- class only on number columns -->
    </tr>
  </thead>
  <tbody>
    <tr data-row="2" data-key="KEY">              <!-- data-key only with a key column -->
      <td data-col="NAME" class="number negative">DISPLAYED VALUE</td>
    </tr>
  </tbody>
</table>
```

### 7.1 Elements

- One `table` element contains, in this order, one `colgroup`, one `thead` and one `tbody`. There is no `caption` and no `tfoot`.
- `colgroup` has one `col` per column, in column order.
- `thead` has one `tr` for the header record, with one `th` per column.
- `tbody` has one `tr` per remaining record, in file order, each with one `td` per column.

### 7.2 Attributes

| Attribute | On | Value | Present |
| --- | --- | --- | --- |
| `data-col` | `col`, `th`, `td` | The column name, exactly as written (may be empty) | Always |
| `data-row` | `tr` | The record number, with the header record as 1 (section 5.3) | Always |
| `data-key` | `tr` in `tbody` | The row's field in the key column, exactly as written | Only when a key column is set (section 9.1) and that field is not empty |

### 7.3 Classes

| Class | On | When |
| --- | --- | --- |
| `number` | `th` | The column is a number column (section 6.4) |
| `number` | `td` | The field is a number (section 6.1) |
| `negative`, `zero`, `positive` | `td` | The field is a number with that sign (section 6.2) |

These four classes are a closed list. Text and empty fields get no class.

### 7.4 Content

- A `th` contains its column name as text.
- A `td` contains its displayed value (section 10) as a single text node. An empty field produces a `td` with no child nodes, so the `:empty` selector matches it.
- Renderers MUST insert column names and field values as text. They MUST NOT parse them as HTML.

### 7.5 Nothing else

Renderers MUST NOT add other elements, attributes or classes to the table model. The one exception is `part="table"` on the `table` element (section 8.1).

> **Note:** This rule keeps the model identical across implementations, so a stylesheet written against one renderer works in all of them. Apart from key values (section 9.1), cell content is deliberately never copied into an attribute (section 1.4).

## 8. Rendering

Renderers isolate each table, apply the default stylesheet below the author stylesheet, and read CSSV properties only after every stylesheet has loaded.

### 8.1 Isolation

- The author stylesheet MUST apply only to its own table model. It MUST NOT affect the embedding page or other tables.
- The embedding page's styles SHOULD NOT apply to the table model. Inherited properties such as `font` and `color` SHOULD still inherit from the embedding context.
- Renderers MUST contain painting to the table's area (section 11.4).

> **Note:** Shadow DOM provides both kinds of isolation. A renderer that uses shadow DOM SHOULD set `part="table"` on the `table` element, so the embedding page can still style it through `::part(table)`.

### 8.2 Default stylesheet

Renderers MUST apply a stylesheet equivalent to this one, placed before the author stylesheet:

```css
@layer cssv-defaults {
  table   { border-collapse: collapse; }
  th, td  { text-align: start; vertical-align: top; padding: 0.25em 0.5em; white-space: pre-wrap; }
  th      { font-weight: bold; }
  .number { text-align: end; font-variant-numeric: tabular-nums; }
}
```

- **The layer:** unlayered author rules always win over layered rules, so any author rule overrides a default regardless of specificity. Layers the author declares come after `cssv-defaults` and win over it too.
- **`white-space: pre-wrap`:** a quoted field can contain line breaks, and they must show as line breaks in the cell.
- **`start` and `end`:** logical alignment mirrors correctly in right-to-left languages, where numbers align to the left.
- **No colors or borders:** the defaults inherit the embedding page's colors, so they work in light and dark themes.

### 8.3 Processing order

1. Parse the file into a style block and records (sections 3 to 6).
2. Build the table model (section 7) without `data-key`, with numbers in their default display (section 10.2).
3. Apply the default stylesheet and the author stylesheet. Wait until every stylesheet, including nested imports, has loaded or failed.
4. Read `--cssv-key` from the `table` element and set `data-key` on body rows (section 9.1). It is read once and not re-evaluated after the attributes are set.
5. Read `--cssv-format` from each number cell and replace its text with the formatted value (section 9.2).
6. Display the table.

Renderers SHOULD NOT display the table before step 6, to avoid a flash of unstyled or unformatted content.

### 8.4 Renderers without a style engine

Steps 4 and 5 need computed styles. A processor that cannot compute styles, such as a server or a command-line converter, produces the table model from step 2. A browser renderer MAY later take over that output and finish steps 3 to 6.

## 9. CSSV properties

CSSV v1 defines two CSS custom properties, `--cssv-key` and `--cssv-format`. Renderers read them from computed styles, so the usual cascade and inheritance apply.

A CSSV property's value is either a CSS string (`"..."` or `'...'`) or a single CSS identifier, and `--cssv-key` also takes `col()` (section 9.1). Renderers MUST remove the quotes and resolve CSS escapes in strings. Any other value is invalid; renderers MUST ignore it and SHOULD report it.

### 9.1 Key column: `--cssv-key`

| | |
| --- | --- |
| Read from | The `table` element |
| Value | A column name, or `col()` with a column number |
| Default | None (no `data-key` attributes) |

The key column gives body rows a name: each `tr` in `tbody` gets `data-key` set to its field in that column, exactly as written. The attribute is left out when that field is empty.

```css
table { --cssv-key: category; }
table { --cssv-key: "unit price"; }   /* a name with a space needs quotes */
table { --cssv-key: col(2); }         /* the second column, whatever its name */
```

`col(n)` picks the key column by position: n is a whole number of 1 or more, written with digits only, and columns are counted from 1, as `:nth-child()` counts cells and `data-row` counts records. Whitespace may surround n, and `col` is ASCII case-insensitive, like CSS function names. Any other argument makes the value invalid (section 9). Use it when a column's name changes between exports, such as a name that carries a date, or to pick one of several columns that share a name. A quoted `"col(2)"` is a column name.

The key column can be set in two places:

1. **In the stylesheet**, with `--cssv-key` as above.
2. **By the host.** Renderers SHOULD let the embedding context set the key column, for example with a `key` attribute on a web component. A host setting takes precedence over `--cssv-key`.

A file whose stylesheet selects on `data-key` SHOULD set `--cssv-key` itself, so it renders the same in every host. If several columns share the key column's name, the first one is used. If no column has that name, or the table has fewer than n columns, no row gets `data-key`, and renderers SHOULD report it.

> **Note:** Key values are copied into an attribute. Authors should choose a column of short names or codes, not free text.

### 9.2 Number format: `--cssv-format`

| | |
| --- | --- |
| Read from | Each `td` with the class `number` |
| Value | A CSS string of Intl.NumberFormat options |
| Default | None (default display, section 10.2) |

```
format = option *( "," option )
option = name ":" value
name   = "minimumIntegerDigits" / "minimumFractionDigits"
       / "maximumFractionDigits" / "useGrouping"
value  = 1*DIGIT / "true" / "false"
```

The names and defaults are those of `Intl.NumberFormat` for decimal numbers. v1 allows four options:

| Option | Values | Default when omitted |
| --- | --- | --- |
| `minimumIntegerDigits` | 1 to 21 | 1 |
| `minimumFractionDigits` | 0 to 100 | 0 |
| `maximumFractionDigits` | 0 to 100, not below the minimum | the larger of `minimumFractionDigits` and 3 |
| `useGrouping` | `true`, `false` | `true` |

- Whitespace around `:` and `,` is ignored. Names are case-sensitive. An unknown option, a repeated option or an out-of-range value makes the whole string invalid.
- A browser renderer passes the options straight to `new Intl.NumberFormat(locale, options)`, adding two fixed options: `roundingMode: "halfExpand"` (half away from zero, as in spreadsheets) and `signDisplay: "negative"`. Other renderers MUST produce the same text.
- With `signDisplay: "negative"`, a value that rounds to zero is shown without a minus sign. Its sign class still follows the field as written (section 6.2).
- The locale decides the decimal separator, group separator and group size (section 10).

A converter that writes spreadsheet number formats builds the format code from the options: `#,##` in front when grouping is on, `minimumIntegerDigits` zeros, then `minimumFractionDigits` zeros and the remaining fraction digits as `#`. Two fraction digits with grouping becomes `#,##0.00`.

| `--cssv-format` | `1234.5` in en-US | `1234.5` in de-DE |
| --- | --- | --- |
| `"maximumFractionDigits: 0, useGrouping: false"` | 1235 | 1235 |
| `"maximumFractionDigits: 0"` | 1,235 | 1.235 |
| `"minimumFractionDigits: 2, maximumFractionDigits: 2"` | 1,234.50 | 1.234,50 |
| `"minimumFractionDigits: 1, maximumFractionDigits: 2, useGrouping: false"` | 1234.5 | 1234,5 |
| `"minimumIntegerDigits: 6, maximumFractionDigits: 0, useGrouping: false"` | 001235 | 001235 |

Because custom properties inherit, `table { --cssv-format: "minimumFractionDigits: 2, maximumFractionDigits: 2"; }` formats every number cell in the table. An invalid format string is ignored, the cell keeps its default display, and renderers SHOULD report it. `--cssv-format` on any element other than a number cell has no effect.

> **v1 decision, may change:** `--cssv-format` uses `Intl.NumberFormat` option names, so web developers already know them and browser renderers need no format parser. The cost is longer values than spreadsheet patterns; XLSX export keeps working through the mapping above. Percent, currency and scientific formats are not in v1 (Appendix D).

### 9.3 Reserved names and forward compatibility

Every custom property whose name starts with `--cssv-` is reserved. Authors MUST NOT define CSSV properties that this specification does not list, and renderers MUST ignore CSSV properties they do not know. Later versions may add classes to the closed list in section 7.3, such as `date`, so authors SHOULD NOT select on other class names. A v1 file has no version marker. Later versions will keep v1 files valid, and a v1 renderer that reads a newer file renders what it understands.

## 10. Number display and localization

Files store numbers in one fixed form (section 6.1). Renderers display them in the reader's locale.

### 10.1 Display locale

- The display locale is the language of the embedding context, such as the nearest `lang` attribute around the rendered table. Without one, it is the user agent's locale.
- Renderers MAY let the embedding context set the locale directly. Renderers that produce static output MUST let the caller choose it.
- The locale decides the decimal separator, the group separator and group size, the minus sign, and the digits used.

### 10.2 Default display

A number cell without a valid `--cssv-format`:

- uses the locale's decimal separator,
- keeps exactly the fraction digits written in the file (`254.50` keeps two),
- uses no grouping,
- shows a value equal to zero without a minus sign.

| Field | en-US | de-DE |
| --- | --- | --- |
| `254.50` | 254.50 | 254,50 |
| `-1200` | -1200 | -1200 |
| `0.5` | 0.5 | 0,5 |
| `-0` | 0 | 0 |

### 10.3 Exact values

Processors MUST display the exact decimal value written in the file. They MUST NOT round it through binary floating point; `9007199254740993` displays all its digits.

> **Note:** ECMAScript's `Intl.NumberFormat` accepts decimal strings and formats them exactly, which meets this requirement when the field is passed as a string.

### 10.4 Headers and styles by language

Column names in `th` are text and are never formatted. Authors can vary styles by locale with `:lang()`, for example `:lang(de) .number { ... }`, in renderers whose table inherits the embedding context's language.

## 11. Security and privacy considerations

A CSSV file cannot run scripts, but its stylesheet can load remote resources and change what the reader sees. Renderers should treat it like a stylesheet from an untrusted web page.

### 11.1 Injection

Column names and field values MUST be inserted as text (section 7.4). A renderer that builds HTML as a string MUST escape `&`, `<` and `>` in content, and `&` and `"` in attribute values.

### 11.2 Remote resources

`@import` and `url()` can fetch from any server when a file is opened, which tells that server the file was opened. Renderers MAY restrict remote loads, for example to the file's own origin, and SHOULD document what they allow.

### 11.3 Data leaking through selectors

A stylesheet can match column names and key values with attribute selectors and load a different URL for each match, which sends those values to another server. Any stylesheet, including an imported one, can set `--cssv-key` and so choose which column's values become key values; a host that sets the key column takes that choice away (section 9.1). Authors should import only stylesheets they trust. This is one reason no other cell content is copied into attributes (section 1.4).

### 11.4 Drawing outside the table

CSS can place content anywhere on the screen, for example with `position: fixed`, and could cover the embedding page with fake content. Renderers MUST apply paint containment (`contain: paint`) or an equivalent to the element that holds the table, so author styles can only draw inside that element's box. If that box grows with the table, a wide table still covers what is beside it, so renderers SHOULD also clip or scroll what doesn't fit in the space the embedding page gives the table.

### 11.5 What the reader sees

CSS can add text that is not in the data (`td::after { content: "approved" }`) and can hide text that is (`color: transparent`). A rendered table is not proof of what the data contains. Converters use field values, never generated content.

### 11.6 Resource limits

Large files and deep import chains use memory and time. Renderers MAY limit file size, row count or import depth, and SHOULD report when a limit is reached.

## 12. Complete example

This section is informative. It shows one file, the table model a renderer builds from it in en-US, and what each rule does.

### 12.1 The file: `budget.cssv`

```
---
/* cssv:title Team budget */
/* cssv:description Planned and actual spending per category, with the difference and whether it's paid. */
@import url("brand.css");

table   { --cssv-key: category; --cssv-format: "minimumFractionDigits: 2, maximumFractionDigits: 2"; }
thead th { background: #1f2937; color: #fff; }

[data-col="diff"].negative { color: #15803d; }
[data-col="diff"].positive { color: #b91c1c; }

tr[data-key="Total"] { font-weight: bold; border-top: 2px solid; }
td:empty::after      { content: "—"; color: #9ca3af; }
---
category,owner,planned,actual,diff,status
Rent,Ana,1200,1200,0,paid
Software,Ben,300,254.50,-45.50,paid
Travel,Ana,800,1130,330,over
Marketing,Caro,500,410,-90,pending
Total,,2800,2994.50,194.50,
```

### 12.2 The table model (excerpt)

```html
<table>
  <colgroup>
    <col data-col="category"><col data-col="owner"><col data-col="planned">
    <col data-col="actual"><col data-col="diff"><col data-col="status">
  </colgroup>
  <thead>
    <tr data-row="1">
      <th data-col="category">category</th>
      <th data-col="owner">owner</th>
      <th data-col="planned" class="number">planned</th>
      <th data-col="actual" class="number">actual</th>
      <th data-col="diff" class="number">diff</th>
      <th data-col="status">status</th>
    </tr>
  </thead>
  <tbody>
    <!-- rows 2 and 3 omitted -->
    <tr data-row="4" data-key="Travel">
      <td data-col="category">Travel</td>
      <td data-col="owner">Ana</td>
      <td data-col="planned" class="number positive">800.00</td>
      <td data-col="actual" class="number positive">1,130.00</td>
      <td data-col="diff" class="number positive">330.00</td>
      <td data-col="status">over</td>
    </tr>
    <!-- row 5 omitted -->
    <tr data-row="6" data-key="Total">
      <td data-col="category">Total</td>
      <td data-col="owner"></td>
      <td data-col="planned" class="number positive">2,800.00</td>
      <td data-col="actual" class="number positive">2,994.50</td>
      <td data-col="diff" class="number positive">194.50</td>
      <td data-col="status"></td>
    </tr>
  </tbody>
</table>
```

### 12.3 What each rule does

- The two comments at the top give the file a title and a description that a list of files can show (section 4.6). They change nothing in the table.
- `brand.css` supplies fonts and colors shared with other reports.
- `--cssv-key: category` names each body row after its category, so the Total row can be styled by name.
- `--cssv-format` on `table` is inherited by every number cell, so all amounts show two decimals with grouping.
- The `diff` column shows negative values in green and positive values in red. Zero (Rent) keeps the default color.
- The Total row is bold with a heavy rule above it, wherever it sits in the file.
- Empty cells (Total's owner and status) show a grey dash. The dash is generated by CSS and is not part of the data.
- The defaults right-align the number columns, including their headers, and line up the digits.

## Appendix A. Selector cookbook (informative)

Every common target is reachable with standard CSS selectors on the table model.

| To style | Selector |
| --- | --- |
| The header row | `thead th` |
| A column | `[data-col="amount"]` |
| A column's width | `col[data-col="amount"] { width: 8rem; }` |
| A column by position | `:is(th, td):nth-child(3)` |
| A row by position | `tr[data-row="4"]` |
| A row by name | `tr[data-key="Total"]` (needs a key column) |
| One cell | `tr[data-row="4"] > [data-col="diff"]` |
| The last row | `tbody tr:last-child` |
| Every other row | `tbody tr:nth-child(even)` |
| All numbers | `.number` |
| Negative numbers in one column | `[data-col="diff"].negative` |
| Rows that contain a negative number | `tbody tr:has(.negative)` |
| Empty cells | `td:empty` |
| Printed output only | `@media print { ... }` |
| Dark theme only | `@media (prefers-color-scheme: dark) { ... }` |
| Sticky header | `thead th { position: sticky; top: 0; }` |

## Appendix B. Converting to Markdown (informative)

A converter can turn a rendered table into a GitHub Flavored Markdown table by reading each cell's computed style. Styles with a Markdown equivalent carry over; everything else is dropped.

| Computed style | Markdown |
| --- | --- |
| Every body cell in a column has `text-align` left (or `start` in left-to-right text) | `:--` in the separator row |
| Every body cell in a column has `text-align` center | `:-:` |
| Every body cell in a column has `text-align` right (or `end` in left-to-right text) | `--:` |
| `font-weight` of 600 or more | `**value**` |
| `font-style` italic or oblique | `*value*` |
| `text-decoration-line` includes `line-through` | `~~value~~` |
| `font-family` starts with `monospace` | `` `value` `` |

- The header row holds the column names, not wrapped, because Markdown renderers already show headers in bold.
- Cells use the displayed value, which is formatted and localized.
- `|` is escaped as `\|`, line breaks become `<br>`, and Markdown syntax characters in values are escaped with a backslash.
- In a table, a backslash before a `|` escapes the backslash, even in a code span, so the `|` would end the cell. Monospace text with a backslash before a `|` is written as `<code>value</code>`, escaped like other text, instead of as a code span.
- Alignment is per column in Markdown, so a column whose cells differ gets `---`.
- Colors, backgrounds, borders, widths and CSS-generated content are lost.

The example in section 12 converts to:

```markdown
| category | owner | planned | actual | diff | status |
|:--|:--|--:|--:|--:|:--|
| Rent | Ana | 1,200.00 | 1,200.00 | 0.00 | paid |
| Software | Ben | 300.00 | 254.50 | -45.50 | paid |
| Travel | Ana | 800.00 | 1,130.00 | 330.00 | over |
| Marketing | Caro | 500.00 | 410.00 | -90.00 | pending |
| **Total** |  | **2,800.00** | **2,994.50** | **194.50** |  |
```

## Appendix C. Embedding in HTML (informative)

This specification does not define an element name. Implementations are encouraged to use a `cssv-table` custom element, so pages can switch implementations without changing markup.

**From a file:**

```html
<cssv-table src="budget.cssv"></cssv-table>
<cssv-table src="export.csv" key="category"></cssv-table>   <!-- host sets the key column -->
```

**Inline:** a `script` element with type `text/cssv` keeps the text exactly as written, because browsers neither run it nor parse it as HTML. Relative URLs in it resolve against the page (section 4.3). Implementations should drop leading empty lines and trailing whitespace from inline text, because the first line must be the fence. They should then remove the first line's indentation from every line, so the text can be indented like the markup around it; a line indented less loses only the indentation it has. The text cannot contain `</script`.

```html
<cssv-table>
  <script type="text/cssv">
    ---
    table { --cssv-key: item; }
    ---
    item,amount
    Rent,1200
  </script>
</cssv-table>
```

**Server-side rendering:** a server can send the table model from section 8.3 step 2 inside a declarative shadow root (`<template shadowrootmode="open">`), so the table appears before scripts run. A browser renderer then completes the remaining steps (section 8.4).

**Markdown documents:** a fenced code block with the language `cssv` is the suggested way to embed CSSV in Markdown. Tools that understand it render the table; others show the source as a code block.

## Appendix D. Not in v1 (informative)

These topics were considered and left out of v1. Later versions may add the ones marked as candidates.

| Topic | Status | Notes |
| --- | --- | --- |
| Files without a header record | Candidate | Columns would need generated names. |
| Comma decimals (`1200,50`) | Candidate | Common in `;`-delimited files. A declaration modeled on CSVW's `decimalChar` and `groupChar` is one option. |
| Dates and times | Candidate | ISO 8601 in the file, localized for display; a `date` class. |
| Percent, currency and scientific formats | Candidate | Extensions of the `--cssv-format` options (Intl.NumberFormat's style, currency and notation). |
| Styling by text content | Candidate | An opt-in list of values in the stylesheet (for example `--cssv-tag: over pending`) that the renderer turns into classes on matching cells. |
| Numeric conditions (value above 1000) | Open | CSS cannot compare numbers in selectors. |
| Tab and other delimiters | Candidate | Detection would need to cover them. |
| Column combinator (`col \|\| td`) | Waiting on browsers | Would let selectors find cells through their `col`, so column names need not repeat on every cell. |
| XLSX export | Candidate | Same computed-style approach as Appendix B; `--cssv-format` options map to spreadsheet format codes as in section 9.2. |
| Registered media type | Candidate | Until then, `text/plain` (section 3.3). |
| Version marker in the file | Not needed yet | Section 9.3. |
| Formulas, merged cells, multiple sheets | Out of scope | See the non-goals in section 1.3. |

## References

**Normative**

- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174): key words for requirement levels (BCP 14)
- [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180): Common Format and MIME Type for CSV Files
- [RFC 5234](https://www.rfc-editor.org/rfc/rfc5234): Augmented BNF for Syntax Specifications
- [CSS Syntax Module Level 3](https://www.w3.org/TR/css-syntax-3/)
- [CSS Cascading and Inheritance Level 5](https://www.w3.org/TR/css-cascade-5/) (cascade layers)
- [CSS Custom Properties for Cascading Variables Level 1](https://www.w3.org/TR/css-variables-1/)
- [CSS Containment Module Level 1](https://www.w3.org/TR/css-contain-1/) (paint containment)
- [HTML Living Standard: tabular data](https://html.spec.whatwg.org/multipage/tables.html)

**Informative**

- [ECMAScript Internationalization API (ECMA-402)](https://tc39.es/ecma402/): `Intl.NumberFormat`
- [Selectors Level 4](https://www.w3.org/TR/selectors-4/): the column combinator
- [W3C Model for Tabular Data and Metadata on the Web (CSVW)](https://www.w3.org/TR/tabular-data-model/)
- [CSVY](https://csvy.org/): YAML front matter for CSV
