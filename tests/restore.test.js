import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreRegion } from '../restore-math.js';

function solid(width, height, rgba) {
  return new Uint8ClampedArray(Array.from({ length: width * height }, () => rgba).flat());
}
test('a click restores original RGBA only inside its circular footprint', () => {
  const original = solid(8, 8, [230, 60, 30, 255]), patch = solid(8, 8, [0, 0, 0, 0]);
  const bounds = { x: 0, y: 0, width: 8, height: 8 };
  assert.equal(restoreRegion(original, patch, 8, bounds, { x: 4.5, y: 4.5 }, { x: 4.5, y: 4.5 }, 1.5), true);
  assert.deepEqual(Array.from(patch.slice((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)), [230, 60, 30, 255]);
  assert.deepEqual(Array.from(patch.slice(0, 4)), [0, 0, 0, 0]);
  assert.equal(restoreRegion(original, patch, 8, bounds, { x: 4.5, y: 4.5 }, { x: 4.5, y: 4.5 }, .1), false, 'painting identical pixels adds no change');
});
test('restoring semi-transparent original pixels never makes them opaque or darkens edge RGB', () => {
  const original = solid(1, 1, [240, 80, 20, 128]), patch = solid(1, 1, [0, 0, 0, 0]);
  restoreRegion(original, patch, 1, { x: 0, y: 0, width: 1, height: 1 }, { x: .5, y: .5 }, { x: .5, y: .5 }, .1);
  assert.deepEqual(Array.from(patch), [240, 80, 20, 77]);
  restoreRegion(original, patch, 1, { x: 0, y: 0, width: 1, height: 1 }, { x: .5, y: .5 }, { x: .5, y: .5 }, 2);
  assert.deepEqual(Array.from(patch), [240, 80, 20, 128]);
});
test('a fast long stroke has continuous coverage and reads the correct cropped-source offset', () => {
  const original = solid(20, 6, [100, 140, 200, 255]), patch = solid(16, 2, [0, 0, 0, 0]);
  const bounds = { x: 2, y: 2, width: 16, height: 2 };
  restoreRegion(original, patch, 20, bounds, { x: 2, y: 3 }, { x: 18, y: 3 }, 1.5);
  for (let i = 0; i < patch.length; i += 4) assert.deepEqual(Array.from(patch.slice(i, i + 4)), [100, 140, 200, 255]);
});

test('erasing removes alpha only along the stroke, preserving RGB on soft edges', () => {
  const original = solid(8, 8, [230, 60, 30, 255]), patch = original.slice();
  const bounds = { x: 0, y: 0, width: 8, height: 8 };
  restoreRegion(original, patch, 8, bounds, { x: 2.5, y: 4.5 }, { x: 5.5, y: 4.5 }, 1, 'erase');
  const pixel = (x, y) => Array.from(patch.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4));
  assert.deepEqual(pixel(0, 0), [230, 60, 30, 255]);
  assert.deepEqual(pixel(4, 4), [0, 0, 0, 0]);
  assert.deepEqual(pixel(4, 3), [230, 60, 30, 128]);
  restoreRegion(original, patch, 8, bounds, { x: 4.5, y: 4.5 }, { x: 4.5, y: 4.5 }, 1);
  assert.deepEqual(pixel(4, 4), [230, 60, 30, 255], 'erased pixels can be restored from the preserved original');
});
