import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const ctx = setup();
const inline = (cssv, attrs = '') => `<cssv-table id="t" ${attrs}><script type="text/cssv">\n${cssv}\n</script></cssv-table>`;
const keys = (page) => page.evaluate(() => [...document.getElementById('t').table.tBodies[0].rows].map((r) => r.getAttribute('data-key')));
const texts = (page, sel = 'td') => page.evaluate((s) => [...document.getElementById('t').table.querySelectorAll(s)].map((n) => n.textContent), sel);
const errors = (page) => page.evaluate(() => __cssvErrors.map((e) => e.section));

describe('§9.1 Key column', () => {
  it('names rows from --cssv-key and leaves out empty fields', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-key: name; }\ntr[data-key="Total"] { font-weight: 700; }\n---\nname,n\nA,1\n,2\nTotal,3'));
    assert.deepEqual(await keys(page), ['A', null, 'Total']);
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('t').table.tBodies[0].rows[2]).fontWeight), '700');
  });

  it('accepts a quoted column name with CSS escapes', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-key: "unit\\20 price"; }\n---\nunit price,n\n9.5,1'));
    assert.deepEqual(await keys(page), ['9.5']);
  });

  it('copies the key value exactly as written', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-key: id; }\n---\nid\n" A&B ""x"" "'));
    assert.deepEqual(await keys(page), [' A&B "x" ']);
  });

  it('uses the first of several columns with the key name', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-key: id; }\n---\nid,id\nfirst,second'));
    assert.deepEqual(await keys(page), ['first']);
  });

  it('lets the host key attribute win over --cssv-key', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-key: name; }\n---\nname,code\nAlpha,A1', 'key="code"'));
    assert.deepEqual(await keys(page), ['A1']);
  });

  it('reads --cssv-key from the table element only', async () => {
    const page = await ctx.open(inline('---\ntbody, tr { --cssv-key: name; }\n---\nname\nA'));
    assert.deepEqual(await keys(page), [null]);
  });

  it('reports a key column that does not exist', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-key: nope; }\n---\nname\nA'));
    assert.deepEqual(await keys(page), [null]);
    assert.deepEqual(await errors(page), ['9.1']);
  });

  it('ignores and reports an invalid value', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-key: 12px; }\n---\n12px\nA'));
    assert.deepEqual(await keys(page), [null]);
    assert.deepEqual(await errors(page), ['9']);
  });

  it('picks the key column by number with col(), whatever its name', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-key: col(2); }\ntr[data-key="Total"] { font-weight: 700; }\n---\nn,"name (Sept 2026)"\n1,A\n2,\n3,Total'));
    assert.deepEqual(await keys(page), ['A', null, 'Total']);
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('t').table.tBodies[0].rows[2]).fontWeight), '700');
    assert.deepEqual(await errors(page), []);
  });

  it('counts col() from 1, so it can pick any of several columns with one name', async () => {
    const first = await ctx.open(inline('---\ntable { --cssv-key: col(1); }\n---\nid,x,id\nfirst,y,third'));
    assert.deepEqual(await keys(first), ['first']);
    const third = await ctx.open(inline('---\ntable { --cssv-key: COL( 3 ); }\n---\nid,x,id\nfirst,y,third'));
    assert.deepEqual(await keys(third), ['third']);
  });

  it('moves the keys when update() changes a name to col()', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-key: id; }\n---\nid,x,id\nfirst,y,third'));
    const table = await page.evaluate(() => {
      const t = document.getElementById('t');
      window.__table = t.table;
      return t.update('---\ntable { --cssv-key: col(3); }\n---\nid,x,id\nfirst,y,third\n').then(() => t.table === window.__table);
    });
    assert.equal(table, true); // patched, not rebuilt
    assert.deepEqual(await keys(page), ['third']);
  });

  it('reads a quoted "col(2)" as a column name', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-key: "col(2)"; }\n---\na,col(2)\nx,named'));
    assert.deepEqual(await keys(page), ['named']);
  });

  it('reports col() past the last column', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-key: col(3); }\n---\na,b\nx,y'));
    assert.deepEqual(await keys(page), [null]);
    assert.deepEqual(await errors(page), ['9.1']);
  });

  it('ignores and reports col() without a column number from 1', async () => {
    for (const value of ['col(0)', 'col(-1)', 'col(1.5)', 'col(a)']) {
      const page = await ctx.open(inline(`---\ntable { --cssv-key: ${value}; }\n---\na,b\nx,y`));
      assert.deepEqual(await keys(page), [null], value);
      assert.deepEqual(await errors(page), ['9'], value);
    }
  });

  it('reads the host key attribute as a name, never as col()', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-key: a; }\n---\na,b\nx,y', 'key="col(2)"'));
    assert.deepEqual(await keys(page), [null]);
    assert.deepEqual(await errors(page), ['9.1']);
  });
});

describe('§9.2 Number format', () => {
  it('formats every number cell through inheritance from table', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-format: "minimumFractionDigits: 2, maximumFractionDigits: 2"; }\n---\na,b,c\n1234.5,x,-0.004\n7,,'));
    assert.deepEqual(await texts(page), ['1,234.50', 'x', '0.00', '7.00', '', '']);
  });

  it('keeps the sign class of the field as written', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-format: "maximumFractionDigits: 2"; }\n---\na\n-0.004'));
    assert.deepEqual(await page.evaluate(() => {
      const td = document.getElementById('t').table.querySelector('td');
      return [td.textContent, td.className];
    }), ['0', 'number negative']);
  });

  it('applies per column and after data-key is set', async () => {
    const page = await ctx.open(inline(`---
table { --cssv-key: name; }
[data-col="b"] { --cssv-format: "maximumFractionDigits: 0"; }
tr[data-key="Total"] [data-col="a"] { --cssv-format: "minimumFractionDigits: 3"; }
---
name,a,b
x,1.5,1.5
Total,2.5,2.5`));
    assert.deepEqual(await texts(page), ['x', '1.5', '2', 'Total', '2.500', '3']);
  });

  it('has no effect on headers or text cells', async () => {
    const page = await ctx.open(inline('---\nth, td { --cssv-format: "minimumFractionDigits: 2"; }\n---\n2024,t\n5,1.5x'));
    assert.deepEqual(await texts(page, 'th, td'), ['2024', 't', '5.00', '1.5x']);
  });

  it('ignores and reports an invalid format once', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-format: "maximumFractionDigits: 2, style: percent"; }\n---\na\n0.125\n2'));
    assert.deepEqual(await texts(page), ['0.125', '2']);
    assert.deepEqual(await errors(page), ['9.2']);
  });

  it('rejects an identifier instead of a string', async () => {
    const page = await ctx.open(inline('---\ntable { --cssv-format: useGrouping; }\n---\na\n1000'));
    assert.deepEqual(await texts(page), ['1000']);
    assert.deepEqual(await errors(page), ['9.2']);
  });
});

describe('§9.3 Reserved names', () => {
  it('ignores unknown CSSV properties without reporting them', async () => {
    const page = await ctx.open(inline('---\ntable, td { --cssv-color: red; --cssv-tag: over; }\n---\na\n1'));
    assert.deepEqual(await texts(page), ['1']);
    assert.deepEqual(await errors(page), []);
  });
});

describe('§10 Number display and localization', () => {
  it('uses the nearest lang attribute', async () => {
    const page = await ctx.open(`<div lang="de-DE">${inline('---\n[data-col="g"] { --cssv-format: "minimumFractionDigits: 2"; }\n---\nd,g\n254.50,1234.5')}</div>`);
    assert.deepEqual(await texts(page), ['254,50', '1.234,50']);
  });

  it('uses a lang attribute on the element itself', async () => {
    const page = await ctx.open(inline('a\n0.5', 'lang="fr-FR"'));
    assert.deepEqual(await texts(page), ['0,5']);
  });

  it('falls back to the browser locale', async () => {
    const page = await ctx.open(`<div lang="">${inline('a\n0.5')}</div>`);
    const expected = await page.evaluate(() => new Intl.NumberFormat(navigator.language, { minimumFractionDigits: 1 }).format(0.5));
    assert.deepEqual(await texts(page), [expected]);
  });

  it('keeps every digit of large values', async () => {
    const page = await ctx.open(inline('---\n[data-col="f"] { --cssv-format: "useGrouping: false"; }\n---\nd,f\n9007199254740993,9007199254740993'));
    assert.deepEqual(await texts(page), ['9007199254740993', '9007199254740993']);
  });

  it('never formats column names', async () => {
    const page = await ctx.open(inline('1234.5\n1'));
    assert.deepEqual(await texts(page, 'th'), ['1234.5']);
  });

  it('lets :lang() match the embedding language', async () => {
    const page = await ctx.open(`<div lang="de">${inline('---\n:lang(de) td { --probe: de; }\n---\na\n1')}</div>`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('t').table.querySelector('td')).getPropertyValue('--probe')), 'de');
  });
});

describe('Appendix B Markdown', () => {
  it('reads bold, italic, strikethrough and monospace from computed styles', async () => {
    const page = await ctx.open(inline(`---
[data-col="b"] { font-weight: 600; }
[data-col="i"] { font-style: italic; }
tr:last-child { text-decoration: line-through; }
[data-col="m"] { font-family: monospace; }
[data-col="c"] { text-align: center; }
---
b,i,m,c,n
x,y,z,w,1
p,q,r,s,2`));
    assert.equal(await page.evaluate(() => document.getElementById('t').toMarkdown()), [
      '| b | i | m | c | n |',
      '|:--|:--|:--|:-:|--:|',
      '| **x** | *y* | `z` | w | 1 |',
      '| **~~p~~** | *~~q~~* | ~~`r`~~ | ~~s~~ | ~~2~~ |',
    ].join('\n'));
  });

  it('mirrors alignment in right-to-left tables', async () => {
    const page = await ctx.open(inline('a,n\nx,1', 'dir="rtl"'));
    assert.equal((await page.evaluate(() => document.getElementById('t').toMarkdown())).split('\n')[1], '|--:|:--|');
  });
});
