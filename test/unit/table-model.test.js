import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse, toHtml } from '../../src/core.js';

const html = (text, opts) => toHtml(parse(text), opts);

describe('§7 Table model (string form, §8.4)', () => {
  it('builds table, colgroup, thead and tbody in order with no extras', () => {
    assert.equal(
      html('item,amount\nRent,-5\n'),
      '<table><colgroup><col data-col="item"><col data-col="amount"></colgroup>'
        + '<thead><tr data-row="1"><th data-col="item">item</th><th data-col="amount" class="number">amount</th></tr></thead>'
        + '<tbody><tr data-row="2"><td data-col="item">Rent</td><td data-col="amount" class="number negative">-5</td></tr></tbody></table>',
    );
  });

  it('§7.2 copies column names exactly into data-col, including empty names', () => {
    assert.match(html(' a ,\n1,2\n'), /<col data-col=" a "><col data-col="">/);
  });

  it('§7.2 numbers rows with the header as 1', () => {
    const out = html('a\nx\ny\n');
    assert.match(out, /<tr data-row="1"><th/);
    assert.match(out, /<tr data-row="2"><td data-col="a">x<\/td><\/tr><tr data-row="3">/);
  });

  it('§7.2 adds data-key only for a set key column and a non-empty field', () => {
    const text = 'id,name\nA1,x\n,y\nA1,z\n';
    assert.doesNotMatch(html(text), /data-key/);
    const out = html(text, { key: 'id' });
    assert.match(out, /<tr data-row="2" data-key="A1">/);
    assert.match(out, /<tr data-row="3">/);
    assert.match(out, /<tr data-row="4" data-key="A1">/);
    assert.doesNotMatch(html(text, { key: 'missing' }), /data-key/);
  });

  it('§7.3 uses only the four classes', () => {
    const out = html('a,b,c,d\n-1,0,1,x\n,,,\n');
    const classes = new Set([...out.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(' ')));
    assert.deepEqual([...classes].sort(), ['negative', 'number', 'positive', 'zero']);
    assert.match(out, /<th data-col="a" class="number">/);
    assert.match(out, /<td data-col="d">x<\/td>/);
  });

  it('§7.4 leaves empty cells without child nodes', () => {
    assert.match(html('a,b\n,x\n'), /<td data-col="a"><\/td>/);
  });

  it('§7.4 shows numbers in their default display', () => {
    assert.match(html('a\n254.50\n', { locale: 'de-DE' }), />254,50</);
  });

  it('§8.1 adds part="table" only when asked', () => {
    assert.match(html('a\n', { part: true }), /^<table part="table">/);
  });

  it('§11.1 escapes content and attribute values', () => {
    const out = html('"<b>""x""&</b>"\n<img src=x onerror=alert(1)>\n', { key: '<b>"x"&</b>' });
    assert.ok(out.includes('<th data-col="&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;">&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;</th>'));
    assert.ok(out.includes('data-key="&lt;img src=x onerror=alert(1)&gt;"'));
    assert.ok(out.includes('>&lt;img src=x onerror=alert(1)&gt;</td>'));
    assert.doesNotMatch(out, /<img|<b>/);
  });
});
