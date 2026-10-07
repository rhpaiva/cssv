# Conformance matrix

Each normative requirement in [SPEC.md](SPEC.md), with the tests that cover it. Test names start with the section number, so `npm test` output reads in spec order.

Files: **U** = `test/unit/`, **B** = `test/browser/`, **S** = `test/spec-examples/`.

| § | Requirement | Level | Covered by |
| --- | --- | --- | --- |
| 3.1 | Processors ignore a byte order mark | MUST | U `file-structure`: ignores a leading byte order mark |
| 3.2 | Accept LF, CRLF and both in one file; a lone CR is not a line break | MUST | U `file-structure`: §3.2 tests |
| 3.3 | Do not rely on the media type | MUST NOT | B `rendering`: does not rely on the media type |
| 3.4 | Fence syntax, style block between the first two fences, no fence means all data | — | U `file-structure`: §3.4 tests |
| 3.4 | Missing closing fence: report an error, treat nothing as data | MUST | U `file-structure`; B `rendering`: shows nothing and reports a missing closing fence |
| 3.4 | Fences are found by line, not by parsing CSS | — | U `file-structure`: finds fences by line, even inside a CSS comment |
| 4.1 | Parse the style block as a CSS stylesheet | MUST | Native: the style block is a `<style>` element; B `style-block` |
| 4.2 | Any number of imports; imports after other rules are ignored; nested imports | MAY / MUST | B `style-block`: §4.2 tests |
| 4.2 | Media queries, `supports()` and `layer()` work as in CSS | — | B `style-block`: honors media queries and supports(); applies layer() |
| 4.2 | A failed import is skipped, the rest applies; report it | — / SHOULD | B `style-block`: skips a failed import, applies the rest and reports it |
| 4.3 | Relative URLs resolve against the CSSV file (after redirects), the page for inline text, the stylesheet for imported sheets | — | U `urls`; B `style-block`: §4.3 tests |
| 4.4 | Style block rules win over imported rules of equal specificity | — | B `style-block`: §4.4 |
| 4.5 | Selectors match only the table model; `:root`, `html`, `body` and page elements match nothing | — | B `style-block`: §4.5 (see the known deviation in README.md) |
| 5 | RFC 4180 quoting, no trimming, empty lines ignored | MUST | U `data-section`: §5 tests |
| 5 | Unterminated quoted field: report an error | MUST | U `data-section`; B `rendering`: unterminated quoted field |
| 5 | A quote inside an unquoted field is literal | SHOULD | U `data-section`: treats a quote inside an unquoted field as a literal character |
| 5.1 | Delimiter detection algorithm | MUST | U `data-section`: §5.1 tests |
| 5.2 | Header record always present; column names used exactly as written | — | U `data-section`: §5.2; B `table-model`: sets data-col and data-row exactly |
| 5.3 | Column count, padding, record numbering, empty data | — | U `data-section`: §5.3 tests |
| 6.1–6.4 | Number grammar, sign, empty and text, number columns | — | U `value-types`; S `core`: §6.1 and §6.2 tables |
| 7 | Exactly the table model structure | MUST | B `table-model`: §7.1; S `browser`: §12.2 table model |
| 7.2 | `data-col`, `data-row`, `data-key` values and presence | — | U `table-model`; B `table-model`, `properties` |
| 7.3 | Closed list of four classes | — | U `table-model`; B `table-model`: §7.3 |
| 7.4 | Content as a single text node; empty cells have no child nodes | — | B `table-model`: §7.4 |
| 7.4, 11.1 | Insert names and values as text, never HTML; escape in HTML strings | MUST | U `table-model`: §11.1; B `table-model`: inserts names and values as text |
| 7.5 | No other elements, attributes or classes (except `part="table"`) | MUST NOT | B `table-model`: uses only the defined attributes and classes |
| 8.1 | Author styles apply only to their own table, never the page or other tables | MUST | B `rendering`: keeps author styles away from the page and other tables |
| 8.1 | Page styles stay out; inherited properties still inherit | SHOULD | B `rendering`: keeps page styles out but inherits font and color |
| 8.1 | `part="table"` with shadow DOM | SHOULD | B `rendering`: exposes the table as part "table" |
| 8.2 | Default stylesheet in layer `cssv-defaults`, before author styles | MUST | B `table-model`: §8.2 tests |
| 8.3 | Wait for every stylesheet, including nested imports, before steps 4 and 5 | — | B `rendering`: waits for nested imports before reading CSSV properties |
| 8.3 | Do not display the table before step 6 | SHOULD NOT | B `rendering`: …and hides the table until then; keeps the previous table on screen until the next one is ready |
| 8.3 | `--cssv-key` is read once | — | By construction (`#applyKey` runs once per render); not tested |
| 8.4 | Processors without a style engine produce the step 2 table model | — | U `table-model`; S `core`: §12.1 parses into the §12.2 model |
| 9 | Unquote strings and resolve CSS escapes | MUST | U `properties`; B `properties`: accepts a quoted column name with CSS escapes |
| 9 | Ignore invalid values | MUST | U `properties`; B `properties`: ignores and reports an invalid value |
| 9 | Report invalid values | SHOULD | B `properties`: ignores and reports…; ignores and reports an invalid format once |
| 9.1 | Key column from `--cssv-key` on `table`; first column of that name; empty fields get no `data-key` | — | B `properties`: §9.1 tests |
| 9.1 | `col(n)` picks the nth column, counted from 1, whatever its name; any other argument is invalid; a quoted `"col(2)"` is a name | — | U `properties`: §9.1 --cssv-key values; B `properties`: picks the key column by number with col()…; counts col() from 1…; ignores and reports col() without a column number from 1; reads a quoted "col(2)" as a column name |
| 9.1 | Host can set the key column and wins | SHOULD | B `properties`: lets the host key attribute win over --cssv-key; reads the host key attribute as a name, never as col() |
| 9.1 | Report a key column that does not exist | SHOULD | B `properties`: reports a key column that does not exist; reports col() past the last column |
| 9.2 | Option grammar, ranges, defaults, invalid strings | — | U `properties`: §9.2 |
| 9.2 | Intl formatting with `halfExpand` and `signDisplay: "negative"`; sign class follows the field | MUST | U `display`; B `properties`: §9.2 tests; S `core`: §9.2 table |
| 9.2 | No effect outside number cells | — | B `properties`: has no effect on headers or text cells |
| 9.3 | Ignore unknown CSSV properties | MUST | B `properties`: ignores unknown CSSV properties without reporting them |
| 10.1 | Locale from the nearest `lang`, else the browser | — | B `properties`: §10 tests |
| 10.1 | Static output lets the caller choose the locale | MUST | U `table-model`: shows numbers in their default display (`locale` option) |
| 10.2 | Default display | — | U `display`; S `core`: §10.2 table |
| 10.3 | Exact decimal values | MUST | U `display`: §10.3 tests; B `properties`: keeps every digit of large values |
| 10.4 | Column names are never formatted; `:lang()` works | — | B `properties`: never formats column names; lets :lang() match |
| 11.2 | Document the remote-load policy | SHOULD | README.md, Implementation notes |
| 11.4 | Paint containment | MUST | B `rendering`: keeps fixed-position author content inside the table area |
| 11.5 | Converters never use generated content | — | S `browser`: Appendix B (the `—` from `::after` is absent) |
| 11.6 | Limits | MAY | Not implemented |
| App. B | Markdown conversion | informative | U `markdown`; B `properties`: Appendix B; S `browser`: printed Markdown |
| App. C | Inline text, leading empty lines, indentation, page-relative URLs | informative | U `embedding`; B `rendering`: Appendix C; S `browser`: Appendix C |

## Checking that the tests can fail

Each of these deliberate breaks to `src/` made at least one browser test fail (run on 2026-10-01):

| Break | Requirement |
| --- | --- |
| Remove `contain: paint` | §11.4 |
| Use a single shadow root | §11.4 |
| Don't wait for imports before reading properties | §8.3 |
| Show the table before step 6 | §8.3 |
| Ignore the host `key` attribute | §9.1 |
| Set `data-key` on empty fields | §7.2 |
| Insert content with `innerHTML` | §7.4, §11.1 |
| Put the defaults outside a cascade layer | §8.2 |
| Skip URL rewriting | §4.3 |
| Show a minus sign on values that round to zero | §9.2 |
