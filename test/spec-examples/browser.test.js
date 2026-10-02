// Every example in SPEC.md that needs a renderer, asserted literally.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../browser/harness.js';

const ctx = setup();
const compact = (html) => html.replace(/<!--.*?-->/g, '').replace(/>\s+</g, '><').trim();

// SPEC.md §12.2, as printed (the omitted rows are checked separately below).
const SPEC_12_2 = {
  colgroup: `<colgroup>
    <col data-col="category"><col data-col="owner"><col data-col="planned">
    <col data-col="actual"><col data-col="diff"><col data-col="status">
  </colgroup>`,
  thead: `<thead>
    <tr data-row="1">
      <th data-col="category">category</th>
      <th data-col="owner">owner</th>
      <th data-col="planned" class="number">planned</th>
      <th data-col="actual" class="number">actual</th>
      <th data-col="diff" class="number">diff</th>
      <th data-col="status">status</th>
    </tr>
  </thead>`,
  travel: `<tr data-row="4" data-key="Travel">
      <td data-col="category">Travel</td>
      <td data-col="owner">Ana</td>
      <td data-col="planned" class="number positive">800.00</td>
      <td data-col="actual" class="number positive">1,130.00</td>
      <td data-col="diff" class="number positive">330.00</td>
      <td data-col="status">over</td>
    </tr>`,
  total: `<tr data-row="6" data-key="Total">
      <td data-col="category">Total</td>
      <td data-col="owner"></td>
      <td data-col="planned" class="number positive">2,800.00</td>
      <td data-col="actual" class="number positive">2,994.50</td>
      <td data-col="diff" class="number positive">194.50</td>
      <td data-col="status"></td>
    </tr>`,
};

// SPEC.md Appendix B, as printed.
const SPEC_APPENDIX_B = `| category | owner | planned | actual | diff | status |
|:--|:--|--:|--:|--:|:--|
| Rent | Ana | 1,200.00 | 1,200.00 | 0.00 | paid |
| Software | Ben | 300.00 | 254.50 | -45.50 | paid |
| Travel | Ana | 800.00 | 1,130.00 | 330.00 | over |
| Marketing | Caro | 500.00 | 410.00 | -90.00 | pending |
| **Total** |  | **2,800.00** | **2,994.50** | **194.50** |  |`;

describe('Spec examples (renderer)', () => {
  it('§12.2 the complete example renders the printed table model', async () => {
    const page = await ctx.open('<cssv-table id="t" src="/test/fixtures/budget.cssv"></cssv-table>');
    const html = await page.evaluate(() => {
      const table = document.getElementById('t').table;
      return {
        table: table.outerHTML.replace(/^<table part="table">/, '<table>'),
        colgroup: table.querySelector('colgroup').outerHTML,
        thead: table.tHead.outerHTML,
        travel: table.tBodies[0].rows[2].outerHTML,
        total: table.tBodies[0].rows[4].outerHTML,
        rows: table.tBodies[0].rows.length,
      };
    });
    for (const part of ['colgroup', 'thead', 'travel', 'total']) assert.equal(html[part], compact(SPEC_12_2[part]), part);
    assert.equal(html.rows, 5);
    assert.ok(html.table.startsWith(`<table>${compact(SPEC_12_2.colgroup)}${compact(SPEC_12_2.thead)}<tbody>`));
    assert.deepEqual(page.errors, []);
    assert.deepEqual(await page.evaluate(() => __cssvErrors), []);
  });

  it('§12.3 each rule does what the spec says', async () => {
    const page = await ctx.open('<div style="color: rgb(17, 17, 17)"><cssv-table id="t" src="/test/fixtures/budget.cssv"></cssv-table></div>');
    const s = await page.evaluate(() => {
      const table = document.getElementById('t').table;
      const row = (key) => table.querySelector(`tr[data-key="${key}"]`);
      const cs = (el, pseudo) => getComputedStyle(el, pseudo);
      return {
        brandFont: cs(table).fontFamily,
        headBackground: cs(table.querySelector('thead th')).backgroundColor,
        softwareDiff: cs(row('Software').cells[4]).color,
        travelDiff: cs(row('Travel').cells[4]).color,
        rentDiff: cs(row('Rent').cells[4]).color,
        totalWeight: cs(row('Total')).fontWeight,
        totalBorder: [cs(row('Total')).borderTopWidth, cs(row('Total')).borderTopStyle],
        emptyAfter: cs(row('Total').cells[1], '::after').content,
        emptyText: row('Total').cells[1].textContent,
        numberAlign: [...table.querySelectorAll('.number')].map((n) => cs(n).textAlign),
        formatted: [...row('Software').cells].slice(2, 5).map((n) => n.textContent),
      };
    });
    assert.deepEqual(s, {
      brandFont: 'Georgia, serif',
      headBackground: 'rgb(31, 41, 55)',
      softwareDiff: 'rgb(21, 128, 61)',
      travelDiff: 'rgb(185, 28, 28)',
      rentDiff: 'rgb(17, 17, 17)',
      totalWeight: '700',
      totalBorder: ['2px', 'solid'],
      emptyAfter: '"—"',
      emptyText: '',
      numberAlign: Array(18).fill('end'),
      formatted: ['300.00', '254.50', '-45.50'],
    });
  });

  it('Appendix B the complete example converts to the printed Markdown', async () => {
    const page = await ctx.open('<cssv-table id="t" src="/test/fixtures/budget.cssv"></cssv-table>');
    assert.equal(await page.evaluate(() => document.getElementById('t').toMarkdown()), SPEC_APPENDIX_B);
  });

  it('§1.1 the introduction example: crimson negative, bold Total', async () => {
    ctx.server.file('/intro/brand.css', 'table { font-family: serif; }');
    ctx.server.file('/intro/example.cssv', '---\n@import url("brand.css");\n\ntable { --cssv-key: item; }\n.negative { color: crimson; }\ntr[data-key="Total"] { font-weight: bold; }\n---\nitem,amount\nRent,1200\nRefund,-45.50\nTotal,1154.50\n');
    const page = await ctx.open('<cssv-table id="t" src="/intro/example.cssv"></cssv-table>');
    const s = await page.evaluate(() => {
      const table = document.getElementById('t').table;
      return {
        refund: getComputedStyle(table.querySelector('tr[data-key="Refund"] .negative')).color,
        total: getComputedStyle(table.querySelector('tr[data-key="Total"]')).fontWeight,
        font: getComputedStyle(table).fontFamily,
      };
    });
    assert.deepEqual(s, { refund: 'rgb(220, 20, 60)', total: '700', font: 'serif' });
  });

  it('Appendix C the inline example renders', async () => {
    const page = await ctx.open(`<cssv-table id="t">
  <script type="text/cssv">
    ---
    table { --cssv-key: item; }
    ---
    item,amount
    Rent,1200
  </script>
</cssv-table>`);
    assert.equal(await page.evaluate(() => document.getElementById('t').table.tBodies[0].rows[0].getAttribute('data-key')), 'Rent');
  });
});
