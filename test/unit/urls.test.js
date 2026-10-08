import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteCssUrls } from '../../src/core.js';

const base = 'https://example.org/reports/q3/budget.cssv';
const rw = (css) => rewriteCssUrls(css, base);

describe('§4.3 Relative URLs resolve against the CSSV file', () => {
  it('rewrites @import strings and url() in @import', () => {
    assert.equal(rw('@import "brand.css";'), '@import "https://example.org/reports/q3/brand.css";');
    assert.equal(rw("@import '../shared.css' print;"), '@import "https://example.org/reports/shared.css" print;');
    assert.equal(rw('@import url(a.css) layer(x);'), '@import url("https://example.org/reports/q3/a.css") layer(x);');
    assert.equal(rw('@IMPORT /* c */ "a.css";'), '@IMPORT /* c */ "https://example.org/reports/q3/a.css";');
    assert.equal(rw('/* cssv:title Budget */\n@import "brand.css";'), '/* cssv:title Budget */\n@import "https://example.org/reports/q3/brand.css";');
  });

  it('rewrites only the URL right after @import', () => {
    const css = '@import; td::after { content: "b.css" }';
    assert.equal(rw(css), css);
  });

  it('rewrites url() values, quoted or not', () => {
    assert.equal(rw('td { background: url(img/x.png) }'), 'td { background: url("https://example.org/reports/q3/img/x.png") }');
    assert.equal(rw('td { background: URL( "x y.png" ) }'), 'td { background: url("https://example.org/reports/q3/x%20y.png") }');
    assert.equal(rw('td { background: url(/root.png) }'), 'td { background: url("https://example.org/root.png") }');
    assert.equal(rw("td { background: url('x.png') }"), 'td { background: url("https://example.org/reports/q3/x.png") }');
    assert.equal(rw('td { background: url(x.png'), 'td { background: url("https://example.org/reports/q3/x.png")');
  });

  it('finds url() among other names, slashes and comments', () => {
    assert.equal(
      rw('td > * { font: 12px/1.5 serif; text-decoration: underline; background: url(x.png) }'),
      'td > * { font: 12px/1.5 serif; text-decoration: underline; background: url("https://example.org/reports/q3/x.png") }',
    );
    for (const css of ['/*/ url(x.png) */', 'td {} /* url(x.png)']) assert.equal(rw(css), css);
  });

  it('leaves url() as written when it is empty, invalid, broken by a line break or has modifiers', () => {
    for (const css of ['a{b:url("")}', 'a{b:url()}', 'a{b:url("http://[x")}', 'a{b:url("x\ny.png")}', 'a{b:url("x.png" crossorigin(anonymous))}']) {
      assert.equal(rw(css), css);
    }
  });

  it('ends a string broken by a line break at the line break', () => {
    assert.equal(rw('td::after { content: "a\n} td { background: url(x.png) }'), 'td::after { content: "a\n} td { background: url("https://example.org/reports/q3/x.png") }');
  });

  it('escapes quotes and backslashes that a resolved URL keeps', () => {
    assert.equal(rw('a{b:url(\'data:,"x"\\\\y\')}'), 'a{b:url("data:,\\"x\\"\\\\y")}');
    assert.equal(rw('@import \'data:text/css,a{b:"c"}\';'), '@import "data:text/css,a{b:\\"c\\"}";');
  });

  it('leaves absolute, data and fragment URLs as they resolve to themselves', () => {
    assert.equal(rw('a{b:url(https://cdn.example/x.css)}'), 'a{b:url("https://cdn.example/x.css")}');
    assert.equal(rw('a{b:url(#clip)}'), 'a{b:url(#clip)}');
    assert.equal(rw('a{b:url("data:image/png;base64,AA==")}'), 'a{b:url("data:image/png;base64,AA==")}');
  });

  it('does not touch strings, comments or names that only look like URLs', () => {
    const css = 'td::after { content: "url(x.png)" } /* url(y.png) @import "z.css"; */ .myurl(x) {} --url: 1;';
    assert.equal(rw(css), css);
    assert.equal(rw('td::after { content: "brand.css" }'), 'td::after { content: "brand.css" }');
  });

  it('resolves CSS escapes in URLs', () => {
    assert.equal(rw('a{b:url(x\\(1\\).png)}'), 'a{b:url("https://example.org/reports/q3/x(1).png")}');
    assert.equal(rw('a{b:url(x\\'), 'a{b:url("https://example.org/reports/q3/x%EF%BF%BD")'); // an escape at the end is U+FFFD
  });
});
