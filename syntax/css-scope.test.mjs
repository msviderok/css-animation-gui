import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../css-scope.js', import.meta.url), 'utf8'), context);
const scope = context.window.FramecraftCssScope;

test('animation CSS excludes skins, unrelated keyframes and property registrations', () => {
  const source = `@property --sy { syntax: '<number>'; inherits: false; initial-value: 1; }
.player[data-skin="dino"] { animation: player-walk 1s infinite; }
html.marker-enter .player[data-me="true"] { animation: player-marker-hop 1s; }
@keyframes player-walk { to { opacity: 0; } }
@keyframes player-marker-hop { to { translate: 0 20px; } }
@layer components { .marker-polygons { --sy: 1; &::before { opacity: 0; } html.marker-enter & { &::before { opacity: 1; } & > * { --sy: 0; } } } }`;
  const result = scope.animation(source);
  assert.match(result.player, /@keyframes player-marker-hop/);
  assert.doesNotMatch(result.player, /player-walk|data-skin|@property/);
  assert.match(result.marker, /&::before \{ opacity: 1/);
  assert.doesNotMatch(result.marker, /opacity: 0|@property|--sy: 1/);
  assert.match(result.context, /@property --sy/);
  assert.match(result.context, /data-skin/);
  assert.match(result.context, /&::before \{ opacity: 0/);
});
