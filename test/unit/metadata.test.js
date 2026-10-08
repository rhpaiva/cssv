import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { metadata, CssvError } from '../../src/core.js';

const file = (style) => `---\n${style}\n---\nitem\n`;

describe('§4.6 Metadata', () => {
  it('reads the title and the description', () => {
    assert.deepEqual(metadata(file('/* cssv:title Office move */\n/* cssv:description What the move cost. */\ntd { color: red }')), {
      title: 'Office move',
      description: 'What the move cost.',
    });
  });

  it('allows white space before cssv: and needs none after the value', () => {
    assert.deepEqual(metadata(file('/*cssv:title A*/\n/*\n  cssv:description B\n*/')), { title: 'A', description: 'B' });
  });

  it('replaces each run of white space with one space and trims the ends', () => {
    const style = '/* cssv:description What the move\r\n   cost,\t\titem by item,\f in euros.   */';
    assert.deepEqual(metadata(file(style)), { description: 'What the move cost, item by item, in euros.' });
  });

  it('accepts an empty value, and keeps the first one of a name', () => {
    assert.deepEqual(metadata(file('/* cssv:title */\n/* cssv:title Second */')), { title: '' });
    assert.deepEqual(metadata(file('/* cssv:title First */\n/* cssv:title Second */')), { title: 'First' });
  });

  it('reads past ordinary comments at the start', () => {
    const style = '/* MIT License */\n/* cssv:title A */\n/* Notes on the styles. */\n/* cssv:description B */';
    assert.deepEqual(metadata(file(style)), { title: 'A', description: 'B' });
  });

  it('stops at the first character that is not white space or a comment', () => {
    assert.deepEqual(metadata(file('@import url("brand.css");\n/* cssv:title A */')), {});
    assert.deepEqual(metadata(file('/* cssv:title A */\n@charset "utf-8";\n/* cssv:description B */')), { title: 'A' });
    assert.deepEqual(metadata(file('td {}\n/* cssv:title A */')), {});
  });

  it('stops at a comment with no closing */', () => {
    assert.deepEqual(metadata(file('/* cssv:title A */\n/* cssv:description B')), { title: 'A' });
  });

  it('treats other spellings as ordinary comments', () => {
    for (const comment of ['/* cssv:Title A */', '/* cssv:title: A */', '/* CSSV:title A */', '/* cssv: title A */', '/* cssv:title A */', '/* x cssv:title A */']) {
      assert.deepEqual(metadata(file(comment)), {}, comment);
    }
  });

  it('returns the values as written, never as markup', () => {
    assert.deepEqual(metadata(file('/* cssv:title <b>Q1</b> &amp; Q2 */')), { title: '<b>Q1</b> &amp; Q2' });
  });

  it('ignores names it does not know', () => {
    assert.deepEqual(metadata(file('/* cssv:source https://example.com */\n/* cssv:title A */\n/* cssv:constructor B */')), { title: 'A' });
  });

  it('finds nothing in a file without a style block', () => {
    assert.deepEqual(metadata('/* cssv:title A */,b\n1,2\n'), {});
    assert.deepEqual(metadata('---\n---\nitem\n'), {});
  });

  it('reads files with a byte order mark and CRLF line breaks', () => {
    assert.deepEqual(metadata('﻿---\r\n/* cssv:title A */\r\n---\r\nitem\r\n'), { title: 'A' });
  });

  it('throws on a missing closing fence, as parse() does', () => {
    assert.throws(() => metadata('---\n/* cssv:title A */\nitem\n'), (e) => e instanceof CssvError && e.section === '3.4');
  });
});
