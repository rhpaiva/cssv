import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inlineText, parse } from '../../src/core.js';

describe('Appendix C Embedding', () => {
  it('drops leading empty lines and trailing whitespace', () => {
    assert.equal(inlineText('\n   \n---\na{}\n---\nx\n1\n  '), '---\na{}\n---\nx\n1');
  });

  it('leaves text that starts in column 0 as written', () => {
    assert.equal(inlineText('a,b\n  x,1\n\t"y"'), 'a,b\n  x,1\n\t"y"');
  });

  it("removes the first line's indentation from every line", () => {
    const model = parse(inlineText(`
    ---
    table { --cssv-key: item; }
    ---
    item,amount
    Rent,1200
  `));
    assert.equal(model.style, 'table { --cssv-key: item; }\n');
    assert.deepEqual(model.columns, ['item', 'amount']);
    assert.deepEqual(model.rows.map((r) => r.fields), [['Rent', '1200']]);
  });

  it('keeps indentation beyond the first line', () => {
    assert.equal(inlineText('\t\tname\n\t\t  x\n\t\t\ty'), 'name\n  x\n\ty');
  });

  it('removes only what a line has when it is indented less', () => {
    const model = parse(inlineText('    item,note\n  \n    A,"first\n  second"'));
    assert.deepEqual(model.columns, ['item', 'note']);
    assert.deepEqual(model.rows.map((r) => r.fields), [['A', 'first\nsecond']]);
  });

  it('empties a line that is only the indentation', () => {
    assert.equal(inlineText('  a\n  \n  b'), 'a\n\nb');
  });

  it('removes only indentation that matches the first line', () => {
    assert.equal(inlineText('    a\n\tb\n  \tc'), 'a\n\tb\n\tc');
  });

  it('keeps spaces inside quotes', () => {
    assert.deepEqual(parse(inlineText('  "  Item"\n  1')).columns, ['  Item']);
  });
});
