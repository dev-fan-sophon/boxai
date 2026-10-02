import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteTour } from './quote.js';

test('one traveller pays the listed price', () => {
  assert.equal(quoteTour(800_000, 1), 800_000);
});
