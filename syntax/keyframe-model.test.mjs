import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../keyframe-model.js', import.meta.url), 'utf8'), context);
const model = context.window.FramecraftKeyframes;
test('recording at the same time updates a key without duplicating it', () => {
  const track = { keys: [{ time: 0, css: 'opacity: 0;' }] };
  model.record(track, 1000, 'opacity: 1;');
  model.record(track, 500, 'opacity: .5;');
  model.record(track, 1000, 'opacity: .8;', 'ease-out');
  assert.deepEqual(Array.from(track.keys, key => key.time), [0, 500, 1000]);
  assert.equal(track.keys[2].css, 'opacity: .8;');
  assert.equal(track.keys[2].easing, 'ease-out');
});

test('initial declarations are formatted without splitting CSS strings or functions', () => {
  assert.equal(model.format('opacity: 0; filter: brightness(1); --sx: 0;'), 'opacity: 0;\nfilter: brightness(1);\n--sx: 0;');
  assert.equal(model.format('content: "a;b"; background: url("data:image/svg+xml;a;b"); /* keep; this */'), 'content: "a;b";\nbackground: url("data:image/svg+xml;a;b");\n/* keep; this */');
});
