import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Loading the renderer without a DOM', () => {
  it('imports cssv-table.js without defining the element', async () => {
    assert.equal(globalThis.HTMLElement, undefined);
    const { CssvTable } = await import('../../src/cssv-table.js');
    assert.equal(typeof CssvTable, 'function');
  });
});
