import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectDelimiter, parseRecords, parse, CssvError, MAX_CELLS } from '../../src/core.js';

describe('§5 Data section: RFC 4180 with differences', () => {
  it('reads quoted fields with delimiters, escaped quotes and line breaks', () => {
    const records = parseRecords('name,note\n"Smith, J.","said ""hi""\nthen left"\n', ',');
    assert.deepEqual(records, [['name', 'note'], ['Smith, J.', 'said "hi"\nthen left']]);
  });

  it('never trims fields', () => {
    assert.deepEqual(parseRecords(' a , b \n', ','), [[' a ', ' b ']]);
  });

  it('ignores empty lines outside quoted fields', () => {
    const model = parse('\nitem\n\nRent\n\n\nTax\n\n');
    assert.deepEqual(model.columns, ['item']);
    assert.deepEqual(model.rows.map((r) => r.fields[0]), ['Rent', 'Tax']);
  });

  it('keeps empty lines inside quoted fields', () => {
    assert.deepEqual(parseRecords('"a\n\nb"\n', ','), [['a\n\nb']]);
  });

  it('keeps a line with only spaces or only a delimiter as a record', () => {
    assert.deepEqual(parseRecords('a,b\n \n,\n', ','), [['a', 'b'], [' '], ['', '']]);
  });

  it('accepts a final record without a line break', () => {
    assert.deepEqual(parseRecords('a\n1', ','), [['a'], ['1']]);
  });

  it('reports an unterminated quoted field as an error', () => {
    assert.throws(() => parse('a\n"open\n'), (e) => e instanceof CssvError && e.section === '5');
  });

  it('treats a quote inside an unquoted field as a literal character', () => {
    assert.deepEqual(parseRecords('5"3,x\n', ','), [['5"3', 'x']]);
  });

  it('treats text after a closing quote as literal characters', () => {
    assert.deepEqual(parseRecords('"a"b,c\n', ','), [['ab', 'c']]);
  });

  it('reads an empty quoted field as an empty field', () => {
    assert.deepEqual(parseRecords('"",x\n', ','), [['', 'x']]);
  });
});

describe('§5.1 Delimiter detection', () => {
  it('chooses ; when the header has more ; than ,', () => {
    assert.equal(detectDelimiter('a;b;c\n1,2;3\n'), ';');
  });

  it('chooses , when there are more , or a tie', () => {
    assert.equal(detectDelimiter('a,b;c\n'), ',');
    assert.equal(detectDelimiter('a,b;c;d,e\n'), ',');
    assert.equal(detectDelimiter('single\n'), ',');
  });

  it('ignores delimiters inside quotes, including quoted line breaks', () => {
    assert.equal(detectDelimiter('"a,b,c";"d\ne,f,g";h\n1,2,3,4,5\n'), ';');
  });

  it('only looks at the header record', () => {
    assert.equal(detectDelimiter('a,b\n1;2;3;4\n'), ',');
  });

  it('applies the detected delimiter to the whole data section', () => {
    const model = parse('item;amount\nRent;1200\n"a;b";5\n');
    assert.equal(model.delimiter, ';');
    assert.deepEqual(model.rows.map((r) => r.fields), [['Rent', '1200'], ['a;b', '5']]);
  });

  it('skips leading empty lines before scanning the header', () => {
    assert.equal(detectDelimiter('\n\nitem;amount\n'), ';');
  });

  it('does not change how numbers are written', () => {
    const model = parse('item;amount\nRent;1200,50\nTax;12.5\n');
    assert.equal(model.rows[0].types[1].type, 'text');
    assert.equal(model.rows[1].types[1].type, 'number');
  });
});

describe('§5.2 Header record and column names', () => {
  it('uses header fields exactly as written', () => {
    assert.deepEqual(parse(' Item ,AMOUNT,,item\n').columns, [' Item ', 'AMOUNT', '', 'item']);
  });
});

describe('§5.3 Records and columns', () => {
  it('uses the longest record for the column count and pads short records', () => {
    const model = parse('a,b\n1\n1,2,3\n');
    assert.deepEqual(model.columns, ['a', 'b', '']);
    assert.deepEqual(model.rows.map((r) => r.fields), [['1', '', ''], ['1', '2', '3']]);
  });

  it('numbers records with the header as 1, not counting empty lines', () => {
    const model = parse('a\n\n1\n\n2\n');
    assert.deepEqual(model.rows.map((r) => r.number), [2, 3]);
  });

  it('produces no columns and no rows without records', () => {
    assert.deepEqual(parse('').columns, []);
    assert.deepEqual(parse('---\na{}\n---\n\n\n').rows, []);
  });

  it('produces no body rows with only a header record', () => {
    const model = parse('a,b\n');
    assert.deepEqual(model.columns, ['a', 'b']);
    assert.deepEqual(model.rows, []);
  });
});

describe('§11.6 Resource limits', () => {
  it('refuses a short file that describes more than MAX_CELLS cells', () => {
    // 1,201 records, one of them 1,001 fields long: every record is padded to that width.
    const text = `h\n${','.repeat(1000)}\n${'a\n'.repeat(1199)}`;
    assert.ok(text.length < 4000);
    assert.throws(() => parse(text), (e) => e instanceof CssvError && e.section === '11.6' && /1,202,201 cells/.test(e.message));
  });

  it('counts records × columns, header included, and takes another limit', () => {
    assert.equal(MAX_CELLS, 1_000_000);
    assert.equal(parse('a,b\n1,2\n', { maxCells: 4 }).rows.length, 1);
    assert.throws(() => parse('a,b\n1,2\n', { maxCells: 3 }), { section: '11.6' });
  });
});
