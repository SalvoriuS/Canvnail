import test from 'node:test';
import assert from 'node:assert/strict';
import { refineAlpha } from '../edge-math.js';
import { blankDocument, newImage, parseProject } from '../model.js';
const opaque = (w, h) => new Uint8ClampedArray(Array.from({ length: w * h }, () => [180, 70, 20, 255]).flat());

test('edge offset expands/contracts alpha and preserves source colors and existing transparency', () => {
  const original = opaque(11, 11), base = original.slice();
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) base[(y * 11 + x) * 4 + 3] = x >= 3 && x <= 7 && y >= 3 && y <= 7 ? 255 : 0;
  const expand = refineAlpha(base.slice(), original, 11, 11, { offset: 1 });
  const shrink = refineAlpha(base.slice(), original, 11, 11, { offset: -1 });
  assert.equal(expand[(5 * 11 + 2) * 4 + 3], 255); assert.equal(expand[(5 * 11 + 1) * 4 + 3], 0);
  assert.equal(shrink[(5 * 11 + 3) * 4 + 3], 0); assert.equal(shrink[(5 * 11 + 4) * 4 + 3], 255);
  assert.deepEqual([...expand.slice((5 * 11 + 2) * 4, (5 * 11 + 2) * 4 + 3)], [180, 70, 20]);
  original[3] = 0; original[(5 * 11 + 5) * 4 + 3] = 128; base[(5 * 11 + 5) * 4 + 3] = 128;
  const soft = refineAlpha(base.slice(), original, 11, 11, { softness: 1 });
  assert.ok(soft[(5 * 11 + 2) * 4 + 3] > 0); assert.ok(soft[(5 * 11 + 3) * 4 + 3] < 255);
  assert.equal(soft[3], 0); assert.ok(soft[(5 * 11 + 5) * 4 + 3] <= 128);
});
test('separable edge morphology matches a naive square neighborhood, including image borders', () => {
  const w = 7, h = 5, original = opaque(w, h), base = original.slice();
  for (let i = 3; i < base.length; i += 4) base[i] = (i * 59) % 256;
  for (const offset of [-8, -2, 2, 8]) {
    const result = refineAlpha(base.slice(), original, w, h, { offset });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let expected = offset > 0 ? 0 : 255;
      for (let dy = -Math.abs(offset); dy <= Math.abs(offset); dy++) for (let dx = -Math.abs(offset); dx <= Math.abs(offset); dx++) {
        const value = base[(Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))) * 4 + 3];
        expected = offset > 0 ? Math.max(expected, value) : Math.min(expected, value);
      }
      assert.equal(result[(y * w + x) * 4 + 3], expected);
    }
  }
});
test('definition sharpens alpha without changing dimensions or RGB', () => {
  const original = opaque(3, 1), base = original.slice(); base[3] = 90; base[7] = 165;
  const result = refineAlpha(base, original, 3, 1, { definition: 100 });
  assert.equal(result[3], 0); assert.equal(result[7], 255); assert.equal(result[11], 255); assert.equal(result[0], 180);
});
test('quality and edge adjustments persist; older projects have neutral values; bad references are rejected', () => {
  const doc = blankDocument(), image = newImage(doc, { src: 'data:image/png;base64,aGVsbG8=', name: 'a', naturalWidth: 50, naturalHeight: 50 }, 'a');
  Object.assign(image, { originalSrc: image.src, edgeBaseSrc: image.src, backgroundQuality: 'quality', cutoutQuality: 'quality', edgeOffset: -2, edgeSoftness: 3, edgeDefinition: 50 }); doc.elements.push(image);
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(doc))), doc);
  for (const key of ['backgroundQuality', 'cutoutQuality', 'edgeBaseSrc', 'edgeOffset', 'edgeSoftness', 'edgeDefinition']) delete image[key];
  assert.equal(parseProject(doc).elements[0].backgroundQuality, 'fast');
  image.edgeBaseSrc = 'https://example.com/file'; assert.throws(() => parseProject(doc));
  delete image.edgeBaseSrc; image.edgeOffset = 9; assert.throws(() => parseProject(doc));
});
