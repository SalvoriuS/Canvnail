import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareInput, maskToRGBA, applyMask } from '../background-math.js';
import { blankDocument, newImage, parseProject } from '../model.js';

test('model input is planar RGB and uses the declared normalization', () => {
  const result = prepareInput(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]));
  assert.equal(result.length, 6);
  assert.ok(Math.abs(result[0] - (1 - .485) / .229) < 1e-5);
  assert.ok(Math.abs(result[1] - result[0]) < 1e-5, 'transparent pixels composite to white');
  assert.ok(Math.abs(result[2] - (0 - .456) / .224) < 1e-5);
});
test('mask restores range and preserves already-transparent and partial-alpha pixels', () => {
  const mask = maskToRGBA(new Float32Array([.2, .5, .8]));
  assert.deepEqual(Array.from(mask.filter((_, index) => index % 4 === 0)), [0, 127, 255]);
  const rgba = new Uint8ClampedArray([255, 20, 10, 255, 10, 10, 10, 128, 20, 30, 40, 0]);
  applyMask(rgba, mask);
  assert.deepEqual([rgba[3], rgba[7], rgba[11]], [0, 64, 0]);
  assert.equal(rgba[0], 255, 'RGB is not painted white');
  assert.ok(maskToRGBA(new Float32Array([1, 1])).every(Number.isFinite));
});
test('transparent canvas and retained original survive project import; old projects stay opaque', () => {
  const doc = blankDocument(); doc.transparent = true;
  const image = newImage(doc, { src: 'data:image/png;base64,aGVsbG8=', name: 'a', naturalWidth: 100, naturalHeight: 100 }, 'a');
  image.originalSrc = 'data:image/jpeg;base64,b3JpZ2luYWw='; doc.elements.push(image);
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(doc))), doc);
  const old = structuredClone(doc); delete old.transparent; delete old.elements[0].originalSrc;
  const migrated = parseProject(old); assert.equal(migrated.transparent, false); assert.equal(migrated.elements[0].originalSrc, null);
  doc.elements[0].originalSrc = 'https://example.com/private.jpg'; assert.throws(() => parseProject(doc));
});
