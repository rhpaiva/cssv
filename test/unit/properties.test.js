import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCssvValue, parseFormat } from '../../src/core.js';

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

  it('returns undefined when unset', () => {
    assert.equal(parseCssvValue(''), undefined);
    assert.equal(parseCssvValue('   '), undefined);
    assert.equal(parseCssvValue(undefined), undefined);
  });

  it('rejects anything else as invalid', () => {
    for (const v of ['12px', '2024', 'a b', '"a" b', 'a "b"', '"a" "b"', 'calc(1)', '#fff', '"a\nb"', '1.5', '-1']) {
      assert.equal(parseCssvValue(v), null, v);
    }
  });
});

describe('§9.2 --cssv-format options', () => {
  it('fills in Intl defaults', () => {
    assert.deepEqual(parseFormat('useGrouping: false'), {
      minimumIntegerDigits: 1, minimumFractionDigits: 0, maximumFractionDigits: 3, useGrouping: false,
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
      'minimumIntegerDigits 2', 'minimumIntegerDigits: 2 3', 'useGrouping: TRUE',
    ]) {
      assert.equal(parseFormat(s), null, s);
    }
  });
});
