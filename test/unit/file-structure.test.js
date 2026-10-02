import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitFile, parse, CssvError } from '../../src/core.js';

describe('§3.1 Encoding', () => {
  it('ignores a leading byte order mark', () => {
    assert.deepEqual(splitFile('﻿---\na{}\n---\nx\n'), { style: 'a{}\n', data: 'x\n' });
    assert.deepEqual(parse('﻿item\n1\n').columns, ['item']);
  });
});

describe('§3.2 Line breaks', () => {
  it('accepts LF, CRLF and both in one file', () => {
    const model = parse('---\r\na{}\n---\r\nitem,amount\r\nRent,1200\nTax,5\r\n');
    assert.deepEqual(model.columns, ['item', 'amount']);
    assert.deepEqual(model.rows.map((r) => r.fields), [['Rent', '1200'], ['Tax', '5']]);
  });

  it('does not treat a lone CR as a line break', () => {
    const model = parse('a,b\r1,2\n');
    assert.deepEqual(model.columns, ['a', 'b\r1', '2']);
    assert.equal(model.rows.length, 0);
  });
});

describe('§3.4 Fences and the style block', () => {
  it('reads the style block between the first two fences', () => {
    assert.deepEqual(splitFile('---\nth { color: red }\n---\nitem\n'), {
      style: 'th { color: red }\n',
      data: 'item\n',
    });
  });

  it('accepts trailing spaces and tabs on a fence line', () => {
    assert.deepEqual(splitFile('--- \t\na{}\n---  \nitem\n'), { style: 'a{}\n', data: 'item\n' });
  });

  it('treats a file whose first line is not a fence as all data', () => {
    assert.deepEqual(splitFile('item,amount\n---\n'), { style: null, data: 'item,amount\n---\n' });
    assert.equal(splitFile(' ---\na\n').style, null);
    assert.equal(splitFile('----\na\n').style, null);
    assert.equal(splitFile('--- x\na\n').style, null);
  });

  it('reports a missing closing fence as an error and returns no data', () => {
    assert.throws(() => parse('---\ntd { color: red }\nitem\n1\n'), (e) => e instanceof CssvError && e.section === '3.4');
  });

  it('finds fences by line, even inside a CSS comment', () => {
    // The style block MUST NOT contain a fence line; a processor ends it there.
    const { style, data } = splitFile('---\n/*\n---\n*/\n---\nitem\n');
    assert.equal(style, '/*\n');
    assert.equal(data, '*/\n---\nitem\n');
  });

  it('allows an empty style block', () => {
    assert.deepEqual(splitFile('---\n---\nitem\n'), { style: '', data: 'item\n' });
  });

  it('handles a closing fence at the very end of the file', () => {
    assert.deepEqual(splitFile('---\na{}\n---'), { style: 'a{}\n', data: '' });
    assert.deepEqual(parse('---\na{}\n---').columns, []);
  });
});
