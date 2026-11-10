import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeLines, renderLine } from './lines.mjs';

test('line splitting preserves multiline tokens, tabs, empty lines and trailing newline', () => {
  const source = '/* first\nsecond */\n\t.marker { content: "<unsafe>"; }\n\n';
  const lines = tokenizeLines(source, 'css');
  assert.equal(lines.map(line => line.map(token => token.value).join('')).join('\n'), source);
  assert.match(renderLine(lines[1]), /th-comment/);
  assert.doesNotMatch(renderLine(lines[2]), /<unsafe>/);
  assert.equal(lines.length, 5);
});
test('large files can render any line without rendering the preceding lines', () => {
  const source = Array.from({ length: 20000 }, (_, i) => `.marker-${i} { opacity: .5; }`).join('\n');
  const lines = tokenizeLines(source, 'css');
  assert.equal(lines.length, 20000);
  assert.match(renderLine(lines[19999]), /marker-19999/);
  assert.doesNotMatch(renderLine(lines[19999]), /marker-19998/);
});
