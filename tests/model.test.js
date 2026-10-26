import test from 'node:test';
import assert from 'node:assert/strict';
import { blankDocument, newText, newImage, wrapText, textLayout, resizeText, resizeImage, snapToCanvas, parseProject, moveLayer } from '../model.js';

const measure = text => text.length * 10;
test('wrapping preserves line breaks and splits a long word', () => {
  assert.deepEqual(wrapText('Hola mundo\n\nabcdef', 40, measure), ['Hola', 'mund', 'o', '', 'abcd', 'ef']);
});
test('horizontal resize changes box width without scaling font or effects', () => {
  const original = newText(blankDocument(), 'a');
  const h = textLayout(original, measure).height;
  const result = resizeText(original, 'e', 100, 0, h, e => textLayout(e, measure).height);
  assert.equal(result.width, original.width + 100);
  assert.equal(result.fontSize, original.fontSize);
  assert.equal(result.strokeWidth, original.strokeWidth);
});
test('corner resize scales effects and keeps opposite corner anchored', () => {
  const original = newText(blankDocument(), 'a');
  const h = textLayout(original, measure).height;
  const result = resizeText(original, 'nw', -original.width, -h, h, e => textLayout(e, text => text.length * 20).height);
  assert.equal(result.width, original.width * 2);
  assert.equal(result.fontSize, original.fontSize * 2);
  assert.equal(result.strokeWidth, original.strokeWidth * 2);
  assert.equal(result.x + result.width, original.x + original.width);
});
test('project round trip preserves editable effects and rejects malformed data', () => {
  const doc = blankDocument(); doc.elements.push(newText(doc, 'a'));
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(doc))), doc);
  assert.throws(() => parseProject({ ...doc, width: Infinity }));
  const invalid = structuredClone(doc); invalid.elements[0].fill = 'url(https://example.com)';
  assert.throws(() => parseProject(invalid));
  assert.throws(() => parseProject({ ...doc, elements: [doc.elements[0], doc.elements[0]] }));
});
test('layer reordering preserves object geometry and moves exactly one item', () => {
  const doc = blankDocument(); const a = newText(doc, 'a'), b = newText(doc, 'b'), c = newText(doc, 'c');
  assert.deepEqual(moveLayer([a, b, c], 'c', 0), [c, a, b]);
  assert.deepEqual(moveLayer([a, b, c], 'a', 2), [b, c, a]);
  assert.deepEqual([a.x, a.y, a.width], [b.x, b.y, b.width]);
});

const asset = { src: 'data:image/png;base64,aGVsbG8=', name: 'foto.png', naturalWidth: 1600, naturalHeight: 800 };
test('image import fits and centers without stretching or upscaling', () => {
  const doc = blankDocument(), image = newImage(doc, asset, 'img');
  assert.equal(image.width / image.height, 2);
  assert.equal(image.x + image.width / 2, doc.width / 2);
  assert.ok(image.width <= doc.width * .75 && image.height <= doc.height * .75);
  assert.equal(newImage(doc, { ...asset, naturalWidth: 100, naturalHeight: 50 }, 'small').width, 100);
});
test('image resize preserves opposite corner and can unlock aspect ratio', () => {
  const original = newImage(blankDocument(), asset, 'img');
  const next = resizeImage(original, 'nw', -100, -50);
  assert.equal(next.width / next.height, original.width / original.height);
  assert.equal(next.x + next.width, original.x + original.width);
  assert.equal(next.y + next.height, original.y + original.height);
  const stretched = resizeImage(original, 'e', 100, 0, true);
  assert.equal(stretched.height, original.height);
  assert.equal(stretched.width, original.width + 100);
});
test('snapping has the same six screen pixel tolerance across zoom levels', () => {
  const canvas = blankDocument();
  for (const zoom of [.25, .5, 1, 2]) {
    const inside = snapToCanvas({ x: 5 / zoom, y: 100, width: 200, height: 100 }, canvas, zoom);
    assert.equal(inside.x, 0); assert.ok(inside.guides.some(guide => guide.axis === 'x' && guide.value === 0));
    const outside = snapToCanvas({ x: 7 / zoom, y: 100, width: 200, height: 100 }, canvas, zoom);
    assert.equal(outside.x, 7 / zoom);
  }
  assert.equal(snapToCanvas({ x: 543, y: 312, width: 200, height: 100 }, canvas, 1).x, 540);
  assert.equal(snapToCanvas({ x: 1083, y: 100, width: 200, height: 100 }, canvas, 1).x, 1080);
});
test('legacy text and mixed image projects round trip; external references are rejected', () => {
  const legacy = { ...blankDocument(), version: 1, name: 'Sin título' };
  legacy.elements.push(newText(legacy, 'text'));
  const upgraded = parseProject(legacy);
  assert.equal(upgraded.version, 2); assert.equal(upgraded.name, 'Canvnail');
  upgraded.elements.push(newImage(upgraded, asset, 'image'));
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(upgraded))), upgraded);
  const bad = structuredClone(upgraded); bad.elements[1].src = 'https://example.com/picture.png';
  assert.throws(() => parseProject(bad));
  bad.elements[1].src = 'data:image/svg+xml;base64,PHN2Zy8+';
  assert.throws(() => parseProject(bad));
});
