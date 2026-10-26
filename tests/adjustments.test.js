import test from 'node:test';
import assert from 'node:assert/strict';
import { blankDocument, newImage, parseProject, imageFilterCSS } from '../model.js';

const image = () => newImage(blankDocument(), { src: 'data:image/png;base64,aGVsbG8=', name: 'foto', naturalWidth: 100, naturalHeight: 100 }, 'img');
test('old image projects gain neutral adjustments; adjusted projects round trip', () => {
  const doc = blankDocument(); doc.elements.push(image());
  for (const key of ['brightness', 'contrast', 'saturation', 'imageFilter']) delete doc.elements[0][key];
  const loaded = parseProject(doc);
  assert.equal(imageFilterCSS(loaded.elements[0]), 'none');
  Object.assign(loaded.elements[0], { brightness: 135, contrast: 80, saturation: 0, imageFilter: 'sepia' });
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(loaded))), loaded);
  assert.equal(imageFilterCSS(loaded.elements[0]), 'brightness(1.35) contrast(0.8) saturate(0) sepia(1)');
});
test('project import rejects nonfinite/out-of-range adjustments and arbitrary filter code', () => {
  for (const invalid of [{ brightness: -1 }, { contrast: 201 }, { saturation: NaN }, { brightness: '100' }, { imageFilter: 'url(https://example.com)' }, { imageFilter: '__proto__' }]) {
    const doc = blankDocument(); doc.elements.push(Object.assign(image(), invalid));
    assert.throws(() => parseProject(doc));
  }
});
