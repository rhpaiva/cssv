import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const ctx = setup();
const inline = (cssv, attrs = '') => `<cssv-table id="t" ${attrs}><script type="text/cssv">\n${cssv}\n</script></cssv-table>`;

describe('§7 Table model in the browser', () => {
  it('§7.1 builds one table with colgroup, thead and tbody in order', async () => {
    const page = await ctx.open(inline('a,b\n1,x\n2,y'));
    const shape = await page.evaluate(() => {
      const table = document.querySelector('#t').table;
      return {
        children: [...table.children].map((n) => n.tagName),
        cols: table.querySelectorAll('colgroup > col').length,
        headRows: table.tHead.rows.length,
        headCells: [...table.tHead.rows[0].children].map((n) => n.tagName),
        bodyRows: [...table.tBodies[0].rows].map((r) => [...r.children].map((n) => n.tagName).join()),
      };
    });
    assert.deepEqual(shape, {
      children: ['COLGROUP', 'THEAD', 'TBODY'],
      cols: 2,
      headRows: 1,
      headCells: ['TH', 'TH'],
      bodyRows: ['TD,TD', 'TD,TD'],
    });
  });

  it('§7.2 §7.3 §7.5 uses only the defined attributes and classes', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-key: name; }\n---\nname,n,"we ird",\nA,-1,x\n,0,,\nC,2.5,"multi\nline",z'));
    const found = await page.evaluate(() => {
      const table = document.querySelector('#t').table;
      return [table, ...table.querySelectorAll('*')].map((n) => ({
        tag: n.tagName.toLowerCase(),
        attrs: [...n.attributes].map((a) => a.name),
        classes: [...n.classList],
      }));
    });
    const allowed = {
      table: ['part'], colgroup: [], thead: [], tbody: [],
      col: ['data-col'], th: ['data-col', 'class'], td: ['data-col', 'class'], tr: ['data-row', 'data-key'],
    };
    for (const { tag, attrs, classes } of found) {
      assert.ok(tag in allowed, `unexpected element ${tag}`);
      for (const a of attrs) assert.ok(allowed[tag].includes(a), `unexpected attribute ${a} on ${tag}`);
      for (const c of classes) assert.ok(['number', 'negative', 'zero', 'positive'].includes(c), `unexpected class ${c}`);
    }
  });

  it('§7.2 sets data-col and data-row exactly', async () => {
    const page = await ctx.open(inline(' Item ,""\nx,1\n\ny,2'));
    const attrs = await page.evaluate(() => {
      const table = document.querySelector('#t').table;
      return {
        cols: [...table.querySelectorAll('col')].map((c) => c.getAttribute('data-col')),
        rows: [...table.querySelectorAll('tr')].map((r) => r.getAttribute('data-row')),
        cells: [...table.querySelectorAll('td')].map((c) => c.getAttribute('data-col')),
      };
    });
    assert.deepEqual(attrs, { cols: [' Item ', ''], rows: ['1', '2', '3'], cells: [' Item ', '', ' Item ', ''] });
  });

  it('§7.3 classes numbers, number columns and signs', async () => {
    const page = await ctx.open(inline('a,b,c\n-1,x,\n0,1,\n2.5,y,'));
    const classes = await page.evaluate(() => {
      const table = document.querySelector('#t').table;
      return [...table.querySelectorAll('th, td')].map((n) => n.className);
    });
    assert.deepEqual(classes, ['number', '', '', 'number negative', '', '', 'number zero', 'number positive', '', 'number positive', '', '']);
  });

  it('§7.4 puts content in a single text node and leaves empty cells empty', async () => {
    const page = await ctx.open(inline('a,b\nx,'));
    const cells = await page.evaluate(() => [...document.querySelector('#t').table.querySelectorAll('td')]
      .map((td) => ({ nodes: td.childNodes.length, text: td.firstChild?.nodeType, empty: td.matches(':empty') })));
    assert.deepEqual(cells, [{ nodes: 1, text: 3, empty: false }, { nodes: 0, text: undefined, empty: true }]);
  });

  it('§7.4 §11.1 inserts names and values as text, never HTML', async () => {
    // Served as a file: inline text cannot contain </script (Appendix C).
    ctx.server.file('/inject.cssv', '"<b>h</b>",x\n"<img src=x onerror=""window.__pwned=1"">","<script>window.__pwned=2</script>"\n');
    const page = await ctx.open('<cssv-table id="t" src="/inject.cssv"></cssv-table>');
    await page.waitForTimeout(100);
    const result = await page.evaluate(() => {
      const table = document.querySelector('#t').table;
      return {
        elements: table.querySelectorAll('img, b, script').length,
        header: table.querySelector('th').textContent,
        cells: [...table.querySelectorAll('td')].map((td) => td.textContent),
        pwned: window.__pwned,
      };
    });
    assert.deepEqual(result, {
      elements: 0,
      header: '<b>h</b>',
      cells: ['<img src=x onerror="window.__pwned=1">', '<script>window.__pwned=2</script>'],
      pwned: undefined,
    });
  });
});

describe('§8.2 Default stylesheet', () => {
  it('applies the defaults', async () => {
    const page = await ctx.open(inline('name,n\nx,1'));
    const styles = await page.evaluate(() => {
      const table = document.querySelector('#t').table;
      const cs = (sel, prop) => getComputedStyle(table.querySelector(sel))[prop];
      return {
        collapse: getComputedStyle(table).borderCollapse,
        textCell: cs('td:not(.number)', 'textAlign'),
        numberCell: cs('td.number', 'textAlign'),
        textHeader: cs('th:not(.number)', 'textAlign'),
        numberHeader: cs('th.number', 'textAlign'),
        headerWeight: cs('th', 'fontWeight'),
        valign: cs('td', 'verticalAlign'),
        padding: cs('td', 'padding'),
        whiteSpace: cs('td', 'whiteSpace'),
        numeric: cs('td.number', 'fontVariantNumeric'),
      };
    });
    assert.deepEqual(styles, {
      collapse: 'collapse',
      textCell: 'start',
      numberCell: 'end',
      textHeader: 'start',
      numberHeader: 'end',
      headerWeight: '700',
      valign: 'top',
      padding: '4px 8px',
      whiteSpace: 'pre-wrap',
      numeric: 'tabular-nums',
    });
  });

  it('lets any unlayered author rule win, whatever its specificity', async () => {
    const page = await ctx.open(inline('---\ntd { text-align: left; }\n---\nn\n1'));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#t').table.querySelector('td')).textAlign), 'left');
  });

  it('lets author layers win over cssv-defaults', async () => {
    const page = await ctx.open(inline('---\n@layer mine { td { text-align: center; } }\n---\nn\n1'));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#t').table.querySelector('td')).textAlign), 'center');
  });

  it('shows line breaks inside a field as line breaks', async () => {
    const page = await ctx.open(inline('note\n"first\nsecond"'));
    const lines = await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('#t').table.querySelector('td'));
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    });
    assert.equal(lines, 2);
  });
});
