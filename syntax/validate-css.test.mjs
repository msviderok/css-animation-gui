import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCss } from './validate-css.mjs';
test('incomplete CSS is rejected instead of auto-closed by the browser parser', () => {
  for (const text of ['.marker { filter: brightness(', '.marker { opacity: 1;', '/* unfinished', '.marker { content: "open; }']) assert.equal(validateCss(text).valid, false, text);
});
test('valid nested rules, typed properties and escaped strings are accepted', () => {
  assert.equal(validateCss('@property --sy { syntax: "<number>"; inherits: false; initial-value: 1; } @layer components { .marker { html.marker-enter & { filter: brightness(0); } } }').valid, true);
  assert.equal(validateCss('.marker::before { content: "{hello}"; }').valid, true);
});
test('browser declaration validation rejects invalid values', () => {
  assert.equal(validateCss('.marker { filter: brightness(foo); }', (key, value) => key !== 'filter' || value !== 'brightness(foo)').valid, false);
});
