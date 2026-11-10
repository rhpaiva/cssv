import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const ctx = setup();
const inline = (cssv, id = 't', attrs = '') => `<cssv-table id="${id}" ${attrs}><script type="text/cssv">\n${cssv}\n</script></cssv-table>`;
const cellStyle = (page, id, prop, sel = 'td') => page.evaluate(([i, p, s]) => {
  const table = document.getElementById(i).table;
  return getComputedStyle(s === 'table' ? table : table.querySelector(s))[p];
}, [id, prop, sel]);

describe('§8.1 Isolation', () => {
  it('keeps page styles out but inherits font and color', async () => {
    const page = await ctx.open(
      `<style>td { color: rgb(255, 0, 0) !important; background: rgb(255, 0, 0); } table { border: 5px solid red; }</style>
       <div style="color: rgb(0, 128, 0); font-family: monospace">${inline('a\n1')}</div>`,
    );
    assert.equal(await cellStyle(page, 't', 'color'), 'rgb(0, 128, 0)');
    assert.equal(await cellStyle(page, 't', 'fontFamily'), 'monospace');
    assert.equal(await cellStyle(page, 't', 'backgroundColor'), 'rgba(0, 0, 0, 0)');
    assert.equal(await cellStyle(page, 't', 'borderTopWidth', 'table'), '0px');
  });

  it('keeps author styles away from the page and other tables', async () => {
    const page = await ctx.open(
      `<p id="p">page</p>${inline('---\np, body { color: rgb(255, 0, 0); background: rgb(255, 0, 0); }\ntd { color: rgb(0, 0, 255); }\n---\na\n1', 'one')}${inline('a\n1', 'two')}`,
    );
    const page2 = await page.evaluate(() => ({
      p: getComputedStyle(document.getElementById('p')).color,
      body: getComputedStyle(document.body).backgroundColor,
    }));
    assert.deepEqual(page2, { p: 'rgb(0, 0, 0)', body: 'rgba(0, 0, 0, 0)' });
    assert.equal(await cellStyle(page, 'one', 'color'), 'rgb(0, 0, 255)');
    assert.equal(await cellStyle(page, 'two', 'color'), 'rgb(0, 0, 0)');
  });

  it('exposes the table as part "table" to the page', async () => {
    const page = await ctx.open(`<style>cssv-table::part(table) { outline: 3px solid rgb(255, 0, 0); }</style>${inline('a\n1')}`);
    assert.equal(await cellStyle(page, 't', 'outlineStyle', 'table'), 'solid');
    assert.equal(await cellStyle(page, 't', 'outlineWidth', 'table'), '3px');
  });
});

describe('§11.4 Drawing outside the table', () => {
  it('keeps fixed-position author content inside the table area', async () => {
    const page = await ctx.open(
      `<p id="above" style="height: 100px; margin: 0">page</p>
       ${inline('---\n:host { position: fixed !important; inset: 0 !important; z-index: 99 !important; }\ntable { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: red; z-index: 99; }\n---\na\n1')}
       <p id="below" style="height: 100px; margin: 0">page</p>`,
    );
    const hits = await page.evaluate(() => {
      const box = document.getElementById('t').getBoundingClientRect();
      return {
        above: document.elementFromPoint(10, 50).id,
        below: document.elementFromPoint(10, box.bottom + 50).id,
      };
    });
    assert.deepEqual(hits, { above: 'above', below: 'below' });
  });

  it('keeps a table wider than the element inside the element', async () => {
    const page = await ctx.open(
      `<div style="display: grid; grid-template-columns: 200px 200px">
         ${inline('---\ntable { width: 600px; height: 100px; background: red; }\n---\na\n1')}
         <p id="beside" style="height: 100px; margin: 0">page</p>
       </div>`,
    );
    const hit = await page.evaluate(() => document.elementFromPoint(300, 50).id);
    assert.equal(hit, 'beside');
  });
});

describe('§8.3 Processing order', () => {
  it('waits for nested imports before reading CSSV properties and hides the table until then', async () => {
    ctx.server.file('/slow/outer.css', '@import "inner.css";', { delay: 300 });
    ctx.server.file('/slow/inner.css', 'table { --cssv-key: name; --cssv-format: "minimumFractionDigits: 2"; }', { delay: 300 });
    ctx.server.file('/slow/file.cssv', '---\n@import "outer.css";\n---\nname,n\nA,1\n');
    const page = await ctx.open('<cssv-table id="t" src="/slow/file.cssv"></cssv-table>', { wait: false });
    const clip = () => page.evaluate(() => getComputedStyle(document.getElementById('t').shadowRoot.querySelector('.clip')).opacity);
    await page.waitForFunction(() => document.getElementById('t').table !== null);
    assert.equal(await clip(), '0');
    await page.evaluate(() => document.getElementById('t').ready);
    assert.equal(await clip(), '1');
    const row = await page.evaluate(() => {
      const tr = document.getElementById('t').table.tBodies[0].rows[0];
      return { key: tr.getAttribute('data-key'), n: tr.cells[1].textContent };
    });
    assert.deepEqual(row, { key: 'A', n: '1.00' });
  });

  it('re-renders when src changes', async () => {
    ctx.server.file('/swap/one.cssv', 'a\n1\n');
    ctx.server.file('/swap/two.cssv', 'b\n2\n');
    const page = await ctx.open('<cssv-table id="t" src="/swap/one.cssv"></cssv-table>');
    await page.evaluate(async () => {
      const t = document.getElementById('t');
      t.setAttribute('src', '/swap/two.cssv');
      await t.ready;
    });
    assert.equal(await page.evaluate(() => document.getElementById('t').table.querySelector('th').textContent), 'b');
  });

  it('keeps the previous table on screen until the next one is ready', async () => {
    ctx.server.file('/next/slow.css', 'td { color: rgb(0, 128, 0); }', { delay: 400 });
    const page = await ctx.open(inline('a\n1'));
    const state = () => page.evaluate(() => {
      const t = document.getElementById('t');
      return {
        header: t.table.querySelector('th').textContent,
        opacity: getComputedStyle(t.shadowRoot.querySelector('.clip')).opacity,
        frames: t.shadowRoot.querySelectorAll('.frame').length,
      };
    });
    await page.evaluate(() => { document.getElementById('t').update('---\n@import url("/next/slow.css");\n---\nb\n2'); });
    while (!ctx.server.requests.includes('/next/slow.css')) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(await state(), { header: 'a', opacity: '1', frames: 2 }); // the next table is built out of sight
    await page.evaluate(() => document.getElementById('t').ready);
    assert.deepEqual(await state(), { header: 'b', opacity: '1', frames: 1 });
  });

  it('leaves no hidden table behind when a render is replaced or fails', async () => {
    ctx.server.file('/next/slower.css', 'td { color: red; }', { delay: 300 });
    const page = await ctx.open(inline('a\n1'));
    const frames = await page.evaluate(async () => {
      const t = document.getElementById('t');
      const count = () => t.shadowRoot.querySelectorAll('.frame').length;
      t.update('---\n@import url("/next/slower.css");\n---\nb\n2');
      await new Promise((r) => setTimeout(r, 50));
      await t.update('c,d\n3,4'); // replaces the render that waits for its import
      await new Promise((r) => setTimeout(r, 400));
      const replaced = [count(), t.table.querySelector('th').textContent];
      t.update('---\n@import url("/next/slower.css");\n---\ne\n5');
      await new Promise((r) => setTimeout(r, 50));
      await t.update('---\nunclosed');
      return { replaced, failed: [count(), t.table] };
    });
    assert.deepEqual(frames, { replaced: [1, 'c'], failed: [1, null] });
  });

  it('keeps the previous table visible while the next file loads', async () => {
    ctx.server.file('/keep/one.cssv', 'a\n1\n');
    ctx.server.file('/keep/two.cssv', 'b\n2\n', { delay: 400 });
    const page = await ctx.open('<cssv-table id="t" src="/keep/one.cssv"></cssv-table>');
    const shown = () => page.evaluate(() => {
      const t = document.getElementById('t');
      return [t.table.querySelector('th').textContent, getComputedStyle(t.shadowRoot.querySelector('.clip')).opacity];
    });
    await page.evaluate(() => { document.getElementById('t').setAttribute('src', '/keep/two.cssv'); });
    while (!ctx.server.requests.includes('/keep/two.cssv')) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(await shown(), ['a', '1']);
    await page.evaluate(() => document.getElementById('t').ready);
    assert.deepEqual(await shown(), ['b', '1']);
  });
});

describe('§3.4 §5 Malformed files', () => {
  it('shows nothing and reports a missing closing fence', async () => {
    const page = await ctx.open(inline('---\ntd { color: red; }\nitem\n1'));
    assert.equal(await page.evaluate(() => document.getElementById('t').table), null);
    assert.deepEqual(await page.evaluate(() => __cssvErrors.map((e) => [e.section, e.fatal])), [['3.4', true]]);
  });

  it('shows nothing and reports an unterminated quoted field', async () => {
    const page = await ctx.open(inline('a\n"open'));
    assert.equal(await page.evaluate(() => document.getElementById('t').table), null);
    assert.deepEqual(await page.evaluate(() => __cssvErrors.map((e) => [e.section, e.fatal])), [['5', true]]);
  });

  it('reports a file that cannot be loaded', async () => {
    const page = await ctx.open('<cssv-table id="t" src="/nowhere.cssv"></cssv-table>');
    assert.deepEqual(await page.evaluate(() => __cssvErrors.map((e) => [e.section, e.fatal])), [['load', true]]);
  });
});

describe('§11.6 Resource limits', () => {
  it('reports the cell limit as a fatal error and shows nothing', async () => {
    ctx.server.file('/limits/wide.cssv', `h\n${','.repeat(1000)}\n${'a\n'.repeat(1199)}`);
    const page = await ctx.open('<cssv-table id="t" src="/limits/wide.cssv"></cssv-table>');
    assert.equal(await page.evaluate(() => document.getElementById('t').table), null);
    assert.deepEqual(await page.evaluate(() => __cssvErrors.map((e) => [e.section, e.fatal])), [['11.6', true]]);
  });
});

describe('§3.3 File name and media type', () => {
  it('does not rely on the media type', async () => {
    ctx.server.file('/types/data.txt', '---\ntable { --x: y; }\n---\na\n1\n', { type: 'application/octet-stream' });
    const page = await ctx.open('<cssv-table id="t" src="/types/data.txt"></cssv-table>');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('t').table).getPropertyValue('--x')), 'y');
  });
});

describe('Appendix C Embedding', () => {
  it('drops leading empty lines and trailing whitespace from inline text', async () => {
    const page = await ctx.open('<cssv-table id="t">\n  <script type="text/cssv">\n\n   \n---\ntable { --x: y; }\n---\nitem,amount\nRent,1200\n  </script>\n</cssv-table>');
    const result = await page.evaluate(() => ({
      x: getComputedStyle(document.getElementById('t').table).getPropertyValue('--x'),
      rows: document.getElementById('t').table.tBodies[0].rows.length,
    }));
    assert.deepEqual(result, { x: 'y', rows: 1 });
  });

  it('reads inline text indented like the markup around it', async () => {
    const page = await ctx.open(`<main>
      <cssv-table id="t">
        <script type="text/cssv">
          ---
          table { --cssv-key: item; }
          ---
          item,amount
          Rent,1200
        </script>
      </cssv-table>
    </main>`);
    const result = await page.evaluate(() => {
      const table = document.getElementById('t').table;
      return {
        cols: [...table.querySelectorAll('col')].map((c) => c.dataset.col),
        key: table.tBodies[0].rows[0].dataset.key,
        number: table.querySelector('td[data-col="amount"]').className,
      };
    });
    assert.deepEqual(result, { cols: ['item', 'amount'], key: 'Rent', number: 'number positive' });
  });

  it('renders inline text that is added after the page loads', async () => {
    const page = await ctx.open('<cssv-table id="t"></cssv-table>');
    await page.evaluate(async () => {
      const t = document.getElementById('t');
      const s = document.createElement('script');
      s.type = 'text/cssv';
      s.textContent = 'late\n1';
      t.append(s);
      await new Promise((r) => setTimeout(r, 0));
      await t.ready;
    });
    assert.equal(await page.evaluate(() => document.getElementById('t').table.querySelector('th').textContent), 'late');
  });

  it('renders again when the inline text changes', async () => {
    const page = await ctx.open(inline('first\n1'));
    await page.evaluate(async () => {
      const t = document.getElementById('t');
      t.querySelector('script').textContent = 'second\n2';
      await new Promise((r) => t.addEventListener('cssv-loadend', r, { once: true }));
    });
    assert.equal(await page.evaluate(() => document.getElementById('t').table.querySelector('th').textContent), 'second');
  });
});

describe('Element API', () => {
  it('reflects src as a property', async () => {
    ctx.server.file('/prop/one.cssv', 'a\n1\n');
    ctx.server.file('/prop/two.cssv', 'b\n2\n');
    const page = await ctx.open('<cssv-table id="t" src="/prop/one.cssv"></cssv-table>');
    const result = await page.evaluate(async () => {
      const t = document.getElementById('t');
      const before = t.src;
      t.src = '/prop/two.cssv';
      const attribute = t.getAttribute('src');
      await t.ready;
      const header = t.table.querySelector('th').textContent;
      t.src = null;
      return { before, attribute, header, removed: !t.hasAttribute('src') && t.src === null };
    });
    assert.deepEqual(result, { before: '/prop/one.cssv', attribute: '/prop/two.cssv', header: 'b', removed: true });
  });

  it('keeps a src property set before the element was defined', async () => {
    ctx.server.file('/prop/early.cssv', 'early\n1\n');
    // The component's module script runs after parsing, so this script runs first.
    const page = await ctx.open('<cssv-table id="t"></cssv-table><script>document.getElementById("t").src = "/prop/early.cssv";</script>');
    assert.deepEqual(await page.evaluate(() => {
      const t = document.getElementById('t');
      return [t.getAttribute('src'), t.table.querySelector('th').textContent];
    }), ['/prop/early.cssv', 'early']);
  });

  it('fires one cssv-loadend after the last cssv-loadstart, even when a render is replaced', async () => {
    ctx.server.file('/events/one.cssv', 'a\n1\n', { delay: 200 });
    ctx.server.file('/events/two.cssv', 'b\n2\n', { delay: 200 });
    const page = await ctx.open('<cssv-table id="t"></cssv-table>');
    const events = await page.evaluate(async () => {
      const t = document.getElementById('t');
      const log = [];
      for (const type of ['cssv-loadstart', 'cssv-load', 'cssv-error', 'cssv-loadend']) t.addEventListener(type, () => log.push(type));
      t.src = '/events/one.cssv';
      await new Promise((r) => setTimeout(r, 50)); // the first file is still loading
      t.src = '/events/two.cssv';
      await new Promise((r) => t.addEventListener('cssv-loadend', r, { once: true }));
      return log;
    });
    assert.deepEqual(events, ['cssv-loadstart', 'cssv-loadstart', 'cssv-load', 'cssv-loadend']);
  });

  it('fires cssv-loadend after a file that cannot be loaded', async () => {
    const page = await ctx.open('<cssv-table id="t"></cssv-table>');
    const events = await page.evaluate(async () => {
      const t = document.getElementById('t');
      const log = [];
      for (const type of ['cssv-loadstart', 'cssv-load', 'cssv-error', 'cssv-loadend']) t.addEventListener(type, () => log.push(type));
      t.src = '/events/missing.cssv';
      await new Promise((r) => t.addEventListener('cssv-loadend', r, { once: true }));
      return log;
    });
    assert.deepEqual(events, ['cssv-loadstart', 'cssv-error', 'cssv-loadend']);
  });
});

describe('update()', () => {
  const BASE = `---
table { --cssv-key: item; }
td.negative { color: rgb(200, 0, 0); }
tr[data-key="Total"] td { font-weight: 700; }
td[data-col="amount"] { --cssv-format: "minimumFractionDigits: 2, maximumFractionDigits: 2"; }
---
item,amount,code
Rent,1200,7
Refund,-45.5,8
Total,1154.5,9`;

  // Updates #t to each text in turn. For each: did the table stay the same
  // element, and does it match a new element given the same text (markup,
  // computed styles, errors)?
  const updates = (page, texts) => page.evaluate(async (list) => {
    const t = document.getElementById('t');
    const styles = (table) => JSON.stringify([...table.querySelectorAll('th, td')].map((cell) => {
      const s = getComputedStyle(cell);
      return [s.color, s.fontWeight, s.backgroundColor];
    }));
    const results = [];
    for (const text of list) {
      const before = t.table;
      await t.update(text);
      const fresh = document.createElement('cssv-table');
      for (const name of ['lang', 'key']) if (t.hasAttribute(name)) fresh.setAttribute(name, t.getAttribute(name));
      fresh.update(text);
      document.body.append(fresh);
      await fresh.ready;
      results.push({
        same: t.table === before,
        html: t.table.outerHTML === fresh.table.outerHTML,
        styles: styles(t.table) === styles(fresh.table),
        errors: JSON.stringify(t.errors) === JSON.stringify(fresh.errors),
      });
      fresh.remove();
    }
    return results;
  }, texts);
  const patched = { same: true, html: true, styles: true, errors: true };

  it('updates changed cells in place, as a full render would', async () => {
    const page = await ctx.open(inline(BASE));
    // Each change applies on top of the previous ones.
    const changes = [
      ['Rent,1200', 'Rent,1300'], // a number
      ['Refund,-45.5', 'Refund,45.5'], // its sign
      ['Total,', 'Sum,'], // a key: data-key changes, the bold rule stops matching
      ['Sum,', ','], // an empty key: no data-key
      [',9', ',x9'], // a number column that becomes text: the th loses its class
      [',x9', ',9'], // and a number column again: the th gets it back
      ['Rent,1300', 'Rent,'], // an empty cell
    ];
    let text = BASE;
    const texts = changes.map(([from, to]) => (text = text.replace(from, to)));
    assert.deepEqual(await updates(page, texts), texts.map(() => patched));
  });

  it('updates changed style rules in place, then keys and formats again', async () => {
    const page = await ctx.open(inline(BASE));
    const texts = [
      BASE.replace('"minimumFractionDigits: 2, maximumFractionDigits: 2"', '"maximumFractionDigits: 0"'),
      BASE.replace('--cssv-key: item', '--cssv-key: code'),
      BASE.replace('---\nitem', 'td[data-col="item"] { color: rgb(0, 0, 255); }\n---\nitem'),
      BASE.replace('"minimumFractionDigits: 2, maximumFractionDigits: 2"', '"precision: 2"'), // invalid: reported, default display
      BASE,
    ];
    assert.deepEqual(await updates(page, texts), texts.map(() => patched));
  });

  it('updates in place when lang or key changes', async () => {
    const page = await ctx.open(inline(BASE));
    const result = await page.evaluate(async () => {
      const t = document.getElementById('t');
      const before = t.table;
      t.setAttribute('lang', 'de-DE');
      await new Promise((r) => t.addEventListener('cssv-loadend', r, { once: true }));
      const amount = t.table.tBodies[0].rows[1].cells[1].textContent;
      t.setAttribute('key', 'code');
      await new Promise((r) => t.addEventListener('cssv-loadend', r, { once: true }));
      return { same: t.table === before, amount, key: t.table.tBodies[0].rows[0].dataset.key };
    });
    assert.deepEqual(result, { same: true, amount: '-45,50', key: '7' });
  });

  it('fires the usual events and returns ready', async () => {
    const page = await ctx.open(inline(BASE));
    const result = await page.evaluate(async (text) => {
      const t = document.getElementById('t');
      const log = [];
      for (const type of ['cssv-loadstart', 'cssv-load', 'cssv-error', 'cssv-loadend']) t.addEventListener(type, () => log.push(type));
      const returned = t.update(text);
      const isReady = returned === t.ready;
      await returned;
      return { log, isReady };
    }, BASE.replace('Rent', 'Lease'));
    assert.deepEqual(result, { log: ['cssv-loadstart', 'cssv-load', 'cssv-loadend'], isReady: true });
  });

  it('renders in full when an import changes, and waits for it', async () => {
    ctx.server.file('/update/import.css', 'td { color: rgb(0, 128, 0); }', { delay: 150 });
    const page = await ctx.open(inline(BASE));
    const result = await page.evaluate(async (text) => {
      const t = document.getElementById('t');
      const before = t.table;
      await t.update(text);
      return { same: t.table === before, color: getComputedStyle(t.table.querySelector('td')).color };
    }, BASE.replace('---\ntable', '---\n@import url("/update/import.css");\ntable'));
    assert.deepEqual(result, { same: false, color: 'rgb(0, 128, 0)' });
  });

  it('renders in full for escaped and case-insensitive @import at-keywords', async () => {
    ctx.server.file('/update/escaped-import.css', 'td { color: rgb(0, 128, 0); }');
    ctx.server.file('/update/uppercase-import.css', 'td { color: rgb(1, 2, 3); }');
    const page = await ctx.open(inline(BASE));
    const result = await page.evaluate(async ({ escapedText, uppercaseText }) => {
      const t = document.getElementById('t');
      const initial = t.table;
      await t.update(escapedText);
      const escaped = { same: t.table === initial, color: getComputedStyle(t.table.querySelector('td')).color };
      const escapedTable = t.table;
      await t.update(uppercaseText);
      return [escaped, { same: t.table === escapedTable, color: getComputedStyle(t.table.querySelector('td')).color }];
    }, {
      escapedText: BASE.replace('---\ntable', '---\n@\\69mport url("/update/escaped-import.css");\ntable'),
      uppercaseText: BASE.replace('---\ntable', '---\n@IMPORT url("/update/uppercase-import.css");\ntable'),
    });
    assert.deepEqual(result, [
      { same: false, color: 'rgb(0, 128, 0)' },
      { same: false, color: 'rgb(1, 2, 3)' },
    ]);
  });

  it('ignores @import text in comments and strings when updating in place', async () => {
    const page = await ctx.open(inline(BASE));
    const result = await page.evaluate(async (text) => {
      const t = document.getElementById('t');
      const before = t.table;
      await t.update(text);
      return { same: t.table === before, color: getComputedStyle(t.table.querySelector('td')).color };
    }, BASE.replace('---\ntable', '---\n/* @import "comment.css"; */\ntd::before { content: "@IMPORT string.css"; }\ntd { color: rgb(1, 2, 3); }\ntable'));
    assert.deepEqual(result, { same: true, color: 'rgb(1, 2, 3)' });
  });

  it('adds and removes rows in place', async () => {
    const page = await ctx.open(inline(BASE));
    const [head, body] = [BASE.slice(0, BASE.indexOf('Rent')), BASE.slice(BASE.indexOf('Rent')).split('\n')];
    const texts = [
      head + [body[0], 'Deposit,-500,4', ...body.slice(1)].join('\n'), // inserted in the middle: the rows after it are renumbered
      head + [body[0], ...body.slice(1)].join('\n'), // and removed again
      head + [...body, 'Fee,12.5,10', 'Tip,0,11'].join('\n'), // appended
      head + ['Opening,0,1', ...body].join('\n'), // prepended
      head + ['Page,2,1', 'Two,-3,2'].join('\n'), // a different, shorter page
      head.trimEnd(), // no body rows
      BASE, // and back
    ];
    assert.deepEqual(await updates(page, texts), texts.map(() => patched));
  });

  it('renders in full when the columns change', async () => {
    const page = await ctx.open(inline(BASE));
    const texts = [BASE.replace('item,amount,code', 'item,amount,code,note'), BASE.replace('item,amount,code', 'item,total,code')];
    const full = { ...patched, same: false };
    assert.deepEqual(await updates(page, texts), [full, full]);
  });

  it('keeps showing the text until src or the inline text changes', async () => {
    ctx.server.file('/update/file.cssv', 'from-src\n1\n');
    const page = await ctx.open(inline('first\n1'));
    const result = await page.evaluate(async () => {
      const t = document.getElementById('t');
      const header = () => t.table.querySelector('th').textContent;
      const loadend = () => new Promise((r) => t.addEventListener('cssv-loadend', r, { once: true }));
      const seen = [];
      await t.update('updated\n2');
      seen.push(header());
      t.setAttribute('lang', 'fr-FR');
      await loadend();
      seen.push(header());
      t.querySelector('script').textContent = 'inline\n3';
      await loadend();
      seen.push(header());
      await t.update('updated again\n4');
      seen.push(header(), t.src);
      t.src = '/update/file.cssv';
      await t.ready;
      seen.push(header());
      return seen;
    });
    assert.deepEqual(result, ['updated', 'updated', 'inline', 'updated again', null, 'from-src']);
  });

  it('replaces a render that is still loading', async () => {
    ctx.server.file('/update/slow.cssv', 'slow\n1\n', { delay: 300 });
    const page = await ctx.open('<cssv-table id="t"></cssv-table>');
    const result = await page.evaluate(async () => {
      const t = document.getElementById('t');
      const log = [];
      for (const type of ['cssv-loadstart', 'cssv-load', 'cssv-error', 'cssv-loadend']) t.addEventListener(type, () => log.push(type));
      t.src = '/update/slow.cssv';
      await new Promise((r) => setTimeout(r, 50));
      await t.update('fast\n2');
      await new Promise((r) => setTimeout(r, 400)); // the slow file would have arrived by now
      return { log, header: t.table.querySelector('th').textContent };
    });
    assert.deepEqual(result, { log: ['cssv-loadstart', 'cssv-loadstart', 'cssv-load', 'cssv-loadend'], header: 'fast' });
  });

  it('shows nothing and reports a malformed text', async () => {
    const page = await ctx.open(inline(BASE));
    const result = await page.evaluate(async () => {
      const t = document.getElementById('t');
      await t.update('---\ntd {}\nitem\n1');
      return { table: t.table, fatal: t.errors.map((e) => [e.section, e.fatal]) };
    });
    assert.deepEqual(result, { table: null, fatal: [['3.4', true]] });
  });

  it('resolves relative URLs against the last file loaded', async () => {
    ctx.server.file('/update/dir/table.cssv', 'a\n1\n');
    ctx.server.file('/update/dir/near.css', 'td { color: rgb(1, 2, 3); }');
    const page = await ctx.open('<cssv-table id="t" src="/update/dir/table.cssv"></cssv-table>');
    const color = await page.evaluate(async () => {
      const t = document.getElementById('t');
      await t.update('---\n@import url("near.css");\n---\na\n1');
      return getComputedStyle(t.table.querySelector('td')).color;
    });
    assert.equal(color, 'rgb(1, 2, 3)');
  });
});

