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
  });

  it('rewrites url() values, quoted or not', () => {
    assert.equal(rw('td { background: url(img/x.png) }'), 'td { background: url("https://example.org/reports/q3/img/x.png") }');
    assert.equal(rw('td { background: URL( "x y.png" ) }'), 'td { background: url("https://example.org/reports/q3/x%20y.png") }');
    assert.equal(rw('td { background: url(/root.png) }'), 'td { background: url("https://example.org/root.png") }');
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
  });
});
