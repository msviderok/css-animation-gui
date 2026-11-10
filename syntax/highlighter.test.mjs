import test from 'node:test';
import assert from 'node:assert/strict';
import { highlighter, highlightCode } from './highlighter.mjs';

test('registry contains only the three code languages used in Framecraft', () => {
  assert.deepEqual([...highlighter.listLanguages()].sort(), ['css', 'js', 'json']);
});
test('CSS selectors, properties and custom values produce semantic classes', () => {
  const html = highlightCode('.marker::before { opacity: .5; --sy: 0; }');
  assert.match(html, /th-selector/);
  assert.match(html, /th-property/);
  assert.match(html, /th-number/);
  assert.equal((html.match(/<pre\b/g) || []).length, 1);
  assert.doesNotMatch(html, /style=|data-theme/);
});
test('untrusted source is escaped and unknown languages fall back to plaintext', () => {
  const html = highlightCode('<script>alert(1)</script>', 'unknown');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
test('SSR rendering is deterministic and preserves exact range decorations', () => {
  const options = { decorations: [{ range: [0, 6], className: 'code-focus' }] };
  const source = '.marker { opacity: 1; }';
  assert.equal(highlightCode(source, 'css', options), highlightCode(source, 'css', options));
  assert.match(highlightCode(source, 'css', options), /code-focus/);
});
