import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseCssvValue, parseKey, keyIndex, parseFormat, toHtml } from '../../src/core.js';

describe('§9 CSSV property values', () => {
  it('accepts a single identifier', () => {
    assert.equal(parseCssvValue('category'), 'category');
    assert.equal(parseCssvValue('  category  '), 'category');
    assert.equal(parseCssvValue('unit-price_2'), 'unit-price_2');
    assert.equal(parseCssvValue('-x'), '-x');
    assert.equal(parseCssvValue('--x'), '--x');
    assert.equal(parseCssvValue('größe'), 'größe');
  });

  it('removes quotes from strings and resolves CSS escapes', () => {
    assert.equal(parseCssvValue('"unit price"'), 'unit price');
    assert.equal(parseCssvValue("'unit price'"), 'unit price');
    assert.equal(parseCssvValue('"unit\\20 price"'), 'unit price');
    assert.equal(parseCssvValue('"\\22quoted\\22"'), '"quoted"');
    assert.equal(parseCssvValue('"a\\"b"'), 'a"b');
    assert.equal(parseCssvValue('"\\1F600"'), '😀');
    assert.equal(parseCssvValue('"\\0"'), '\uFFFD');
    assert.equal(parseCssvValue('""'), '');
    assert.equal(parseCssvValue('unit\\ price'), 'unit price');
  });

  it('reads hex escapes as CSS does', () => {
    // At most six hex digits, then one white space, a CRLF counting as one.
    assert.equal(parseCssvValue('"\\0000410"'), 'A0');
    assert.equal(parseCssvValue('"\\41\r\nB"'), 'AB');
    assert.equal(parseCssvValue('"\\41\rB"'), 'AB');
    assert.equal(parseCssvValue('"\\41 \nB"'), null);
    // Surrogates and code points past U+10FFFF become U+FFFD.
    assert.equal(parseCssvValue('"\\D7FF\\D800\\DFFF\\E000"'), '\uD7FF\uFFFD\uFFFD\uE000');
    assert.equal(parseCssvValue('"\\10FFFF\\110000"'), '\u{10FFFF}\uFFFD');
  });

  it('skips an escaped line break in a string', () => {
    for (const lineBreak of ['\n', '\r\n', '\r', '\f']) {
      assert.equal(parseCssvValue(`"a\\${lineBreak}b"`), 'ab', JSON.stringify(lineBreak));
    }
  });

  it('closes a string at the end of the value, as CSS does', () => {
    assert.equal(parseCssvValue('"unit price'), 'unit price');
    assert.equal(parseCssvValue('"\\41'), 'A');
  });

  it('returns undefined when unset', () => {
    assert.equal(parseCssvValue(''), undefined);
    assert.equal(parseCssvValue('   '), undefined);
    assert.equal(parseCssvValue(undefined), undefined);
  });

  it('rejects anything else as invalid', () => {
    for (const v of ['12px', '2024', 'a b', '"a" b', 'a "b"', '"a" "b"', 'calc(1)', 'col(2)', '#fff', '"a\nb"', '"a\rb"', '"a\fb"', 'a\\\nb', '1.5', '-1', '-']) {
      assert.equal(parseCssvValue(v), null, v);
    }
  });
});

describe('§9.1 --cssv-key values', () => {
  it('reads col(n) as the nth column, counted from 1', () => {
    assert.equal(parseKey('col(2)'), 2);
    assert.equal(parseKey('  col(1)  '), 1);
    assert.equal(parseKey('col( 12 )'), 12);
    assert.equal(parseKey('col(\t3\n)'), 3);
    assert.equal(parseKey('COL(2)'), 2);
    assert.equal(parseKey('Col(02)'), 2);
  });

  it('reads anything else as a column name, like every CSSV property', () => {
    assert.equal(parseKey('category'), 'category');
    assert.equal(parseKey('"unit price"'), 'unit price');
    assert.equal(parseKey('"col(2)"'), 'col(2)');
    assert.equal(parseKey('col-2'), 'col-2');
    assert.equal(parseKey(''), undefined);
    assert.equal(parseKey(undefined), undefined);
  });

  it('rejects col() without a column number from 1', () => {
    for (const v of ['col(0)', 'col(-1)', 'col(+2)', 'col(1.5)', 'col(2px)', 'col(x)', 'col()', 'col(1, 2)', 'col (2)', 'col(2', 'col(2) x', 'xcol(2)', '2']) {
      assert.equal(parseKey(v), null, v);
    }
  });

  it('finds the key column by name or by number', () => {
    const model = parse('id,name,id\n1,a,2');
    assert.equal(keyIndex(model, 'id'), 0);
    assert.equal(keyIndex(model, 1), 0);
    assert.equal(keyIndex(model, 'nope'), -1);
    assert.equal(keyIndex(model, 3), 2);
    assert.equal(keyIndex(model, 4), -1);
    assert.equal(keyIndex(model, 0), -1);
    assert.equal(keyIndex(model, -1), -1);
    assert.equal(keyIndex(model, 1.5), -1);
    assert.equal(keyIndex(model, undefined), -1);
    assert.match(toHtml(model, { key: 3 }), /<tr data-row="2" data-key="2">/);
  });
});

describe('§9.2 --cssv-format options', () => {
  it('fills in Intl defaults', () => {
    assert.deepEqual(parseFormat('useGrouping: false'), {
      minimumIntegerDigits: 1, minimumFractionDigits: 0, maximumFractionDigits: 3, useGrouping: false,
    });
    assert.deepEqual(parseFormat('useGrouping: true'), {
      minimumIntegerDigits: 1, minimumFractionDigits: 0, maximumFractionDigits: 3, useGrouping: true,
    });
    assert.deepEqual(parseFormat('minimumFractionDigits: 5'), {
      minimumIntegerDigits: 1, minimumFractionDigits: 5, maximumFractionDigits: 5, useGrouping: true,
    });
  });

  it('ignores whitespace around : and ,', () => {
    assert.deepEqual(
      parseFormat('  minimumFractionDigits :2 ,maximumFractionDigits:   2  '),
      parseFormat('minimumFractionDigits: 2, maximumFractionDigits: 2'),
    );
  });

  it('accepts the range limits', () => {
    assert.ok(parseFormat('minimumIntegerDigits: 1'));
    assert.ok(parseFormat('minimumIntegerDigits: 21'));
    assert.ok(parseFormat('minimumFractionDigits: 100, maximumFractionDigits: 100'));
    assert.ok(parseFormat('maximumFractionDigits: 0'));
  });

  it('makes the whole string invalid on any bad option', () => {
    for (const s of [
      '', ' ', ',', 'maximumFractionDigits: 2,', 'maximumfractiondigits: 2', 'style: 1',
      'currency: 1', 'maximumFractionDigits: 2, maximumFractionDigits: 3', 'minimumIntegerDigits: 0',
      'minimumIntegerDigits: 22', 'minimumFractionDigits: 101', 'maximumFractionDigits: 101',
      'minimumFractionDigits: 3, maximumFractionDigits: 2', 'useGrouping: 1', 'useGrouping: yes',
      'minimumIntegerDigits: true', 'minimumIntegerDigits: -1', 'minimumIntegerDigits: 1.5',
      'minimumIntegerDigits 2', 'minimumIntegerDigits: 2 3', 'useGrouping: TRUE', '-maximumFractionDigits: 2',
    ]) {
      assert.equal(parseFormat(s), null, s);
    }
  });

  it('reads an unset or invalid value as no format', () => {
    assert.equal(parseFormat(undefined), null);
    assert.equal(parseFormat(null), null);
  });
});
