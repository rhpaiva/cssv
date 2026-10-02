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
