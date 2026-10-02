import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const ctx = setup();
const inline = (cssv) => `<cssv-table id="t"><script type="text/cssv">\n${cssv}\n</script></cssv-table>`;
const prop = (page, name, sel = 'table') => page.evaluate(([n, s]) => {
  const table = document.querySelector('#t').table;
  const el = s === 'table' ? table : table.querySelector(s);
  return getComputedStyle(el).getPropertyValue(n);
}, [name, sel]);

describe('§4.2 Imports', () => {
  it('loads several imports, nested imports and honors media queries and supports()', async () => {
    ctx.server.file('/imp/a.css', '@import "b.css"; table { --a: a; }');
    ctx.server.file('/imp/b.css', 'table { --b: b; }');
    ctx.server.file('/imp/c.css', 'table { --c: c; }');
    ctx.server.file('/imp/print.css', 'table { --p: p; }');
    ctx.server.file('/imp/sup.css', 'table { --s: s; }');
    ctx.server.file('/imp/nosup.css', 'table { --ns: ns; }');
    ctx.server.file('/imp/main.cssv', '---\n@import "a.css";\n@import url(c.css);\n@import "print.css" print;\n'
      + '@import "sup.css" supports(display: grid);\n@import "nosup.css" supports(display: nonsense);\ntable { --own: own; }\n---\nx\n1\n');
    const page = await ctx.open('<cssv-table id="t" src="/imp/main.cssv"></cssv-table>');
    assert.deepEqual(
      await Promise.all(['--a', '--b', '--c', '--p', '--s', '--ns', '--own'].map((n) => prop(page, n))),
      ['a', 'b', 'c', '', 's', '', 'own'],
    );
  });

  it('ignores an @import that comes after other rules', async () => {
    ctx.server.file('/imp/late.css', 'table { --late: late; }');
    ctx.server.file('/imp/late.cssv', '---\ntd { color: red; }\n@import "late.css";\n---\nx\n1\n');
    const page = await ctx.open('<cssv-table id="t" src="/imp/late.cssv"></cssv-table>');
    assert.equal(await prop(page, '--late'), '');
  });

  it('applies layer() on an import as in CSS', async () => {
    ctx.server.file('/imp/layered.css', 'table td.number { color: rgb(255, 0, 0); }');
    ctx.server.file('/imp/layered.cssv', '---\n@import url(layered.css) layer(base);\ntd { color: rgb(0, 0, 255); }\n---\nn\n1\n');
    const page = await ctx.open('<cssv-table id="t" src="/imp/layered.cssv"></cssv-table>');
    assert.equal(await prop(page, 'color', 'td'), 'rgb(0, 0, 255)');
  });

  it('skips a failed import, applies the rest and reports it', async () => {
    ctx.server.file('/imp/ok.css', 'table { --ok: ok; }');
    ctx.server.file('/imp/broken.cssv', '---\n@import "missing.css";\n@import "ok.css";\ntable { --own: own; }\n---\nx\n1\n');
    const page = await ctx.open('<cssv-table id="t" src="/imp/broken.cssv"></cssv-table>');
    assert.equal(await prop(page, '--ok'), 'ok');
    assert.equal(await prop(page, '--own'), 'own');
    const errors = await page.evaluate(() => __cssvErrors);
    assert.deepEqual(errors.map((e) => [e.section, e.fatal]), [['4.2', false]]);
    assert.ok(await page.evaluate(() => document.querySelector('#t').table !== null));
  });
});

describe('§4.3 Relative URLs', () => {
  it('resolves the style block against the CSSV file URL', async () => {
    ctx.server.file('/rel/a/shared.css', 'table { --shared: yes; }');
    ctx.server.file('/rel/a/b/file.cssv', '---\n@import url("../shared.css");\ntd { background-image: url(img/x.png); }\n---\nx\n1\n');
    const page = await ctx.open('<cssv-table id="t" src="/rel/a/b/file.cssv"></cssv-table>');
    assert.equal(await prop(page, '--shared'), 'yes');
    assert.equal(await prop(page, 'background-image', 'td'), `url("${ctx.server.origin}/rel/a/b/img/x.png")`);
  });

  it('resolves against the redirect target, the URL the file came from', async () => {
    ctx.server.file('/moved/style.css', 'table { --moved: yes; }');
    ctx.server.file('/moved/file.cssv', '---\n@import "style.css";\n---\nx\n1\n');
    ctx.server.file('/old/file.cssv', '', { status: 302, headers: { location: '/moved/file.cssv' } });
    const page = await ctx.open('<cssv-table id="t" src="/old/file.cssv"></cssv-table>');
    assert.equal(await prop(page, '--moved'), 'yes');
  });

  it('resolves inline CSSV against the page URL', async () => {
    ctx.server.file('/__pages/inline-import.css', 'table { --inline: yes; }');
    const page = await ctx.open(inline('---\n@import "inline-import.css";\n---\nx\n1'));
    assert.equal(await prop(page, '--inline'), 'yes');
  });

  it('resolves URLs inside imported stylesheets against that stylesheet', async () => {
    ctx.server.file('/deep/css/theme.css', 'td { background-image: url(pattern.png); }');
    ctx.server.file('/deep/data/file.cssv', '---\n@import "../css/theme.css";\n---\nx\n1\n');
    const page = await ctx.open('<cssv-table id="t" src="/deep/data/file.cssv"></cssv-table>');
    assert.equal(await prop(page, 'background-image', 'td'), `url("${ctx.server.origin}/deep/css/pattern.png")`);
  });
});

describe('§4.4 Cascade order', () => {
  it('lets style block rules win over imported rules of equal specificity', async () => {
    ctx.server.file('/cascade/imported.css', 'td { color: rgb(255, 0, 0); }');
    ctx.server.file('/cascade/file.cssv', '---\n@import "imported.css";\ntd { color: rgb(0, 0, 255); }\n---\nx\n1\n');
    const page = await ctx.open('<cssv-table id="t" src="/cascade/file.cssv"></cssv-table>');
    assert.equal(await prop(page, 'color', 'td'), 'rgb(0, 0, 255)');
  });
});

describe('§4.5 What selectors can match', () => {
  it('matches nothing for :root, html, body or page elements', async () => {
    const page = await ctx.open(`<main>${inline('---\n:root, html, body { --cssv-key: name; }\nhtml td, body td, main td { color: rgb(255, 0, 0); }\ntable { color: rgb(0, 0, 255); }\n---\nname\nA')}</main>`);
    assert.equal(await page.evaluate(() => document.querySelector('#t').table.querySelector('tbody tr').hasAttribute('data-key')), false);
    assert.equal(await prop(page, 'color', 'td'), 'rgb(0, 0, 255)');
  });
});
