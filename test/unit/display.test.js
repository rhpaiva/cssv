import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDisplay, formatNumber, parseFormat } from '../../src/core.js';

const fmt = (field, s, locale = 'en-US') => formatNumber(field, parseFormat(s), locale);

describe('§10.2 Default display', () => {
  it('keeps the fraction digits as written and uses no grouping', () => {
    assert.equal(defaultDisplay('254.50', 'en-US'), '254.50');
    assert.equal(defaultDisplay('1234567.1', 'en-US'), '1234567.1');
    assert.equal(defaultDisplay('0.000', 'en-US'), '0.000');
    assert.equal(defaultDisplay('12', 'de-DE'), '12');
  });

  it('localizes the decimal separator and digits', () => {
    assert.equal(defaultDisplay('254.50', 'de-DE'), '254,50');
    assert.equal(defaultDisplay('254.50', 'ar-EG'), new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, useGrouping: false }).format(254.5));
  });

  it('shows zero without a minus sign', () => {
    assert.equal(defaultDisplay('-0', 'en-US'), '0');
    assert.equal(defaultDisplay('-0.00', 'de-DE'), '0,00');
  });

  it('§10.3 keeps every digit of the exact decimal value', () => {
    assert.equal(defaultDisplay('9007199254740993', 'en-US'), '9007199254740993');
    assert.equal(defaultDisplay('0.1000000000000000055511151231257827', 'en-US'), '0.1000000000000000055511151231257827');
    assert.equal(defaultDisplay('-123456789012345678901234567890.5', 'en-US'), '-123456789012345678901234567890.5');
  });

  it('§10.3 keeps more than 100 fraction digits', () => {
    const field = `-1.${'7'.repeat(120)}`;
    assert.equal(defaultDisplay(field, 'en-US'), field);
    assert.equal(defaultDisplay(field, 'de-DE'), field.replace('.', ','));
    assert.equal(defaultDisplay(`-0.${'0'.repeat(101)}`, 'en-US'), `0.${'0'.repeat(101)}`);
    assert.equal(defaultDisplay(field.slice(1), 'en-US'), field.slice(1));
  });

  it('§10.3 localizes symbols and digits past 100 fraction digits too', () => {
    const sevens = '7'.repeat(120);
    assert.equal(defaultDisplay(`-1.${sevens}`, 'sv-SE'), `\u22121,${sevens}`);
    assert.equal(defaultDisplay(`12.${sevens}`, 'ar-EG'), `١٢٫${'٧'.repeat(120)}`);
  });
});

describe('§9.2 Formatted display', () => {
  it('rounds half away from zero', () => {
    assert.equal(fmt('2.5', 'maximumFractionDigits: 0'), '3');
    assert.equal(fmt('-2.5', 'maximumFractionDigits: 0'), '-3');
    assert.equal(fmt('0.125', 'maximumFractionDigits: 2'), '0.13');
    assert.equal(fmt('1.005', 'maximumFractionDigits: 2'), '1.01'); // exact decimal, not binary 1.00499...
  });

  it('shows a value that rounds to zero without a minus sign', () => {
    assert.equal(fmt('-0.004', 'maximumFractionDigits: 2'), '0');
    assert.equal(fmt('-0.004', 'minimumFractionDigits: 2, maximumFractionDigits: 2'), '0.00');
  });

  it('groups by default and lets the locale pick group size and separator', () => {
    assert.equal(fmt('1234567.5', 'maximumFractionDigits: 0'), '1,234,568');
    assert.equal(fmt('1234567.5', 'maximumFractionDigits: 0', 'de-DE'), '1.234.568');
    assert.equal(fmt('1234567', 'maximumFractionDigits: 0', 'en-IN'), '12,34,567');
  });

  it('keeps exactness for large values', () => {
    assert.equal(fmt('9007199254740993', 'useGrouping: false'), '9007199254740993');
  });
});
