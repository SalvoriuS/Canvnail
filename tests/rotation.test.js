import test from 'node:test';
import assert from 'node:assert/strict';
import { blankDocument, newText, newImage, parseProject, localToWorld, worldToLocal, rotateVector, rotatedBounds, positionRotatedResize, resizeImage, normalizeAngle } from '../model.js';
const near = (a, b) => { assert.ok(Math.abs(a.x - b.x) < 1e-8); assert.ok(Math.abs(a.y - b.y) < 1e-8); };
test('local/world rotation round trips and rotated bounds include every corner', () => {
  for (const rotation of [-360, -135, 0, 27, 90, 180, 360]) {
    const e = { x: 100, y: 120, width: 240, height: 80, rotation }, bounds = rotatedBounds(e);
    for (const point of [{ x: 0, y: 0 }, { x: 240, y: 80 }, { x: 100, y: 30 }]) near(worldToLocal(localToWorld(point, e), e), point);
    assert.ok(bounds.width >= 80 - 1e-8); assert.ok(bounds.height >= 80 - 1e-8);
  }
  const bounds = rotatedBounds({ x: 100, y: 120, width: 240, height: 80, rotation: 90 });
  near(bounds, { x: 180, y: 40 }); assert.ok(Math.abs(bounds.width - 80) < 1e-8);
  assert.equal(normalizeAngle(370), 10); assert.equal(normalizeAngle(-370), -10);
});
test('rotated resize keeps the opposite corner or edge midpoint fixed', () => {
  for (const rotation of [30, 90, -135]) for (const handle of ['nw', 'ne', 'sw', 'se', 'w', 'e', 'n', 's']) {
    const original = { x: 100, y: 120, width: 240, height: 80, rotation, keepRatio: true };
    const resized = resizeImage(original, handle, 30, 15), next = positionRotatedResize(original, resized, original.height, resized.height);
    const anchor = e => ({ x: handle.includes('w') ? e.width : handle.includes('e') ? 0 : e.width / 2, y: handle.includes('n') ? e.height : handle.includes('s') ? 0 : e.height / 2 });
    near(localToWorld(anchor(original), original), localToWorld(anchor(next), next));
  }
  near(rotateVector({ x: 10, y: 0 }, 90), { x: 0, y: 10 });
});
test('all element rotations persist; legacy elements default to zero and invalid angles are rejected', () => {
  const doc = blankDocument(); doc.elements.push(newText(doc, 't'), newImage(doc, { src: 'data:image/png;base64,aGVsbG8=', name: 'image', naturalWidth: 100, naturalHeight: 50 }, 'i'));
  doc.elements[0].rotation = -37.5; doc.elements[1].rotation = 270;
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(doc))), doc);
  doc.elements.forEach(e => delete e.rotation); assert.ok(parseProject(doc).elements.every(e => e.rotation === 0));
  for (const angle of [NaN, Infinity, 361, '90']) { doc.elements[0].rotation = angle; assert.throws(() => parseProject(doc)); }
});
