// Every example in SPEC.md that a processor can check without a browser,
// asserted literally. Section numbers match SPEC.md.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, metadata, classify, parseFormat, formatNumber, defaultDisplay, toHtml } from '../../src/core.js';

describe('Spec examples (processor)', () => {
  it('§1.1 the introduction example', () => {
    const model = parse(`---
@import url("brand.css");

table { --cssv-key: item; }
.negative { color: crimson; }
tr[data-key="Total"] { font-weight: bold; }
---
item,amount
Rent,1200
Refund,-45.50
Total,1154.50
`);
    assert.equal(model.style, '@import url("brand.css");\n\ntable { --cssv-key: item; }\n.negative { color: crimson; }\ntr[data-key="Total"] { font-weight: bold; }\n');
    assert.deepEqual(model.columns, ['item', 'amount']);
    assert.deepEqual(model.rows.map((r) => r.types[1].sign), ['positive', 'negative', 'positive']);
  });

  it('§3 the file structure example', () => {
    const model = parse('---\n@import url("brand.css");\ntd { padding: 4px; }\n---\nitem,amount\nRent,1200\n');
    assert.equal(model.style, '@import url("brand.css");\ntd { padding: 4px; }\n');
    assert.deepEqual(model.columns, ['item', 'amount']);
    assert.deepEqual(model.rows[0].fields, ['Rent', '1200']);
  });

  it('§4.6 the metadata example', () => {
    const text = `---
/* cssv:title Office move */
/* cssv:description What the move to the new office cost,
   item by item, in euros. */
/* Colors and fonts come from the brand stylesheet. */
@import url("brand.css");
---
item,amount
Movers,1800
Deposit refund,-450
`;
    assert.deepEqual(metadata(text), {
      title: 'Office move',
      description: 'What the move to the new office cost, item by item, in euros.',
    });
    assert.deepEqual(parse(text).columns, ['item', 'amount']);
  });

  it('§6.1 the number table', () => {
    const table = [
      ['1200', 'number'], ['-45.50', 'number'], ['0.5', 'number'], ['007', 'text'], ['1,200', 'text'],
      ['1200,50', 'text'], ['+5', 'text'], ['1e6', 'text'], [' 12', 'text'], ['.5', 'text'],
    ];
    for (const [field, type] of table) assert.equal(classify(field).type, type, field);
  });

  it('§6.2 the sign examples', () => {
    for (const f of ['0', '0.00', '-0']) assert.equal(classify(f).sign, 'zero', f);
  });

  it('§9.2 the format table', () => {
    const table = [
      ['maximumFractionDigits: 0, useGrouping: false', '1235', '1235'],
      ['maximumFractionDigits: 0', '1,235', '1.235'],
      ['minimumFractionDigits: 2, maximumFractionDigits: 2', '1,234.50', '1.234,50'],
      ['minimumFractionDigits: 1, maximumFractionDigits: 2, useGrouping: false', '1234.5', '1234,5'],
      ['minimumIntegerDigits: 6, maximumFractionDigits: 0, useGrouping: false', '001235', '001235'],
    ];
    for (const [format, enUS, deDE] of table) {
      const options = parseFormat(format);
      assert.equal(formatNumber('1234.5', options, 'en-US'), enUS, format);
      assert.equal(formatNumber('1234.5', options, 'de-DE'), deDE, format);
    }
  });

  it('§10.2 the default display table', () => {
    const table = [['254.50', '254.50', '254,50'], ['-1200', '-1200', '-1200'], ['0.5', '0.5', '0,5'], ['-0', '0', '0']];
    for (const [field, enUS, deDE] of table) {
      assert.equal(defaultDisplay(field, 'en-US'), enUS, field);
      assert.equal(defaultDisplay(field, 'de-DE'), deDE, field);
    }
  });

  it('§10.3 9007199254740993 displays all its digits', () => {
    assert.equal(defaultDisplay('9007199254740993', 'en-US'), '9007199254740993');
  });

  it('§12.1 the complete example parses into the §12.2 model (step 2, before styles)', () => {
    const text = readFileSync(new URL('../fixtures/budget.cssv', import.meta.url), 'utf8');
    assert.deepEqual(metadata(text), {
      title: 'Team budget',
      description: "Planned and actual spending per category, with the difference and whether it's paid.",
    });
    const model = parse(text);
    assert.deepEqual(model.columns, ['category', 'owner', 'planned', 'actual', 'diff', 'status']);
    assert.deepEqual(model.numberColumns, [false, false, true, true, true, false]);
    const html = toHtml(model, { key: 'category' });
    assert.ok(html.includes(
      '<thead><tr data-row="1"><th data-col="category">category</th><th data-col="owner">owner</th>'
      + '<th data-col="planned" class="number">planned</th><th data-col="actual" class="number">actual</th>'
      + '<th data-col="diff" class="number">diff</th><th data-col="status">status</th></tr></thead>',
    ));
    // Before --cssv-format applies, numbers show as written (§10.2).
    assert.ok(html.includes(
      '<tr data-row="6" data-key="Total"><td data-col="category">Total</td><td data-col="owner"></td>'
      + '<td data-col="planned" class="number positive">2800</td><td data-col="actual" class="number positive">2994.50</td>'
      + '<td data-col="diff" class="number positive">194.50</td><td data-col="status"></td></tr>',
    ));
    assert.ok(html.includes('<td data-col="diff" class="number zero">0</td>'));
  });
});
