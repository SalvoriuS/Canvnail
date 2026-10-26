import test from 'node:test';
import assert from 'node:assert/strict';
import { floodFill } from '../drawing.js';
import { blankDocument, newImage, parseProject } from '../model.js';

test('bucket fills only the connected region and respects an opaque border', () => {
  const width = 12, height = 10, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) data.set([10, 20, 30, 255], (y * width + 5) * 4);
  assert.equal(floodFill(data, width, height, 2, 3, [255, 0, 0, 255]), true);
  assert.deepEqual([...data.slice((3 * width + 4) * 4, (3 * width + 4) * 4 + 4)], [255, 0, 0, 255]);
  assert.deepEqual([...data.slice((3 * width + 6) * 4, (3 * width + 6) * 4 + 4)], [0, 0, 0, 0]);
  assert.equal(floodFill(data, width, height, 2, 3, [255, 0, 0, 255]), false);
  assert.equal(floodFill(data, width, height, -1, 3, [0, 0, 0, 255]), false);
});
test('bucket terminates for near-identical replacement colors and transparent hidden RGB', () => {
  const data = new Uint8ClampedArray(100 * 100 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([50, 60, 70, 255], i);
  floodFill(data, 100, 100, 0, 0, [51, 60, 70, 255]);
  for (let i = 0; i < data.length; i += 4) assert.equal(data[i], 51);
  assert.equal(floodFill(new Uint8ClampedArray([100, 200, 40, 0, 0, 0, 0, 0]), 2, 1, 0, 0, [10, 20, 30, 255]), true);
});
test('drawing layers round trip; old images default to ordinary image layers', () => {
  const doc = blankDocument(), image = newImage(doc, { src: 'data:image/png;base64,aGVsbG8=', name: 'Dibujo', naturalWidth: 100, naturalHeight: 100 }, 'draw');
  image.drawing = true; doc.elements.push(image);
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(doc))), doc);
  delete image.drawing; assert.equal(parseProject(doc).elements[0].drawing, false);
  image.drawing = 'true'; assert.throws(() => parseProject(doc));
});
