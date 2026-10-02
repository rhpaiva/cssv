import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classify, parse } from '../../src/core.js';

describe('§6.1 Numbers', () => {
  it('accepts the grammar and nothing else', () => {
    for (const f of ['0', '7', '-7', '1200', '-45.50', '0.5', '-0.000', '9007199254740993', '1.0000000001']) {
      assert.equal(classify(f).type, 'number', f);
    }
    for (const f of ['00', '01', '-01', '1.', '.5', '-', '-.5', '1.2.3', '1e6', '1E6', '+5', '1,200', '0x1F', ' 1', '1 ', '١٢', 'NaN', 'Infinity', '--1']) {
      assert.equal(classify(f).type, 'text', JSON.stringify(f));
    }
  });
});

describe('§6.2 Sign', () => {
  it('classifies zero, negative and positive', () => {
    assert.equal(classify('0').sign, 'zero');
    assert.equal(classify('0.00').sign, 'zero');
    assert.equal(classify('-0').sign, 'zero');
    assert.equal(classify('-0.000').sign, 'zero');
    assert.equal(classify('-0.01').sign, 'negative');
    assert.equal(classify('-45.50').sign, 'negative');
    assert.equal(classify('0.5').sign, 'positive');
    assert.equal(classify('10').sign, 'positive');
  });
});

describe('§6.3 Empty and text', () => {
  it('treats only a zero-length field as empty', () => {
    assert.deepEqual(classify(''), { type: 'empty' });
    assert.deepEqual(classify(' '), { type: 'text' });
    assert.deepEqual(classify('paid'), { type: 'text' });
  });
});

describe('§6.4 Number columns', () => {
  it('needs every non-empty field to be a number and at least one number', () => {
    const model = parse('a,b,c,d\n1,1,x,\n,two,3,\n2,3,,\n');
    assert.deepEqual(model.numberColumns, [true, false, false, false]);
  });

  it('does not count the header as a field', () => {
    assert.deepEqual(parse('2024\n1\n').numberColumns, [true]);
    assert.deepEqual(parse('a\n').numberColumns, [false]);
  });
});
