import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown } from '../../src/core.js';

const cell = (text, style = {}) => ({ text, align: 'start', ...style });

describe('Appendix B: Markdown serialization', () => {
  it('maps column alignment when every body cell agrees', () => {
    const md = toMarkdown({
      header: ['a', 'b', 'c', 'd'],
      rows: [
        [cell('1', { align: 'end' }), cell('x', { align: 'center' }), cell('y'), cell('p', { align: 'left' })],
        [cell('2', { align: 'right' }), cell('z', { align: 'center' }), cell('w', { align: 'end' }), cell('q')],
      ],
    });
    assert.equal(md.split('\n')[1], '|--:|:-:|---|:--|');
  });

  it('maps the -webkit- alignments too', () => {
    const md = toMarkdown({
      header: ['a', 'b', 'c'],
      rows: [[cell('1', { align: '-webkit-left' }), cell('2', { align: '-webkit-center' }), cell('3', { align: '-webkit-right' })]],
    });
    assert.equal(md.split('\n')[1], '|:--|:-:|--:|');
  });

  it('mirrors start and end in right-to-left tables', () => {
    const md = toMarkdown({ header: ['a', 'b'], rows: [[cell('1', { align: 'end' }), cell('x')]] }, { direction: 'rtl' });
    assert.equal(md.split('\n')[1], '|:--|--:|');
  });

  it('uses --- for a column without body rows', () => {
    assert.equal(toMarkdown({ header: ['a'], rows: [] }), '| a |\n|---|');
  });

  it('wraps bold, italic, strikethrough and monospace', () => {
    const md = toMarkdown({
      header: ['a'],
      rows: [[cell('b', { bold: true })], [cell('i', { italic: true })], [cell('s', { strike: true })], [cell('m', { mono: true })],
        [cell('all', { bold: true, italic: true, strike: true })]],
    });
    assert.deepEqual(md.split('\n').slice(2), ['| **b** |', '| *i* |', '| ~~s~~ |', '| `m` |', '| ***~~all~~*** |']);
  });

  it('does not wrap empty cells or header names', () => {
    const md = toMarkdown({ header: ['name'], rows: [[cell('', { bold: true })]] });
    assert.equal(md, '| name |\n|:--|\n|  |');
  });

  it('escapes |, Markdown syntax characters and line breaks', () => {
    const md = toMarkdown({ header: ['a|b'], rows: [[cell('*x* _y_ [l](u) <b> `c` \\ ~s~ &amp;\nnext')]] });
    assert.equal(md.split('\n')[0], '| a\\|b |');
    assert.equal(md.split('\n')[2], '| \\*x\\* \\_y\\_ \\[l\\](u) \\<b> \\`c\\` \\\\ \\~s\\~ \\&amp;<br>next |');
  });

  it('keeps numbers and dashes readable', () => {
    const md = toMarkdown({ header: ['n'], rows: [[cell('-45.50', { align: 'end' })]] });
    assert.equal(md.split('\n')[2], '| -45.50 |');
  });

  it('builds code spans that survive backticks and pipes', () => {
    const md = toMarkdown({ header: ['c'], rows: [[cell('a`b|c', { mono: true })]] });
    assert.equal(md.split('\n')[2], '| ``a`b\\|c`` |');
    const code = (text) => toMarkdown({ header: ['c'], rows: [[cell(text, { mono: true })]] }).split('\n')[2];
    assert.equal(code('a``b'), '| ```a``b``` |');
    assert.equal(code('`a'), '| `` `a `` |');
    assert.equal(code('a`'), '| `` a` `` |');
    assert.equal(code('a\nb'), '| `a b` |');
  });

  it('writes monospace text with a backslash before a | as escaped <code>, so the cell stays one cell', () => {
    const md = toMarkdown({ header: ['c', 'd'], rows: [[cell('x\\|<img src=x>', { mono: true }), cell('ok')]] });
    assert.equal(md.split('\n')[2], '| <code>x\\\\\\|\\<img src=x></code> | ok |');
  });
});
