import test from 'node:test';
import assert from 'node:assert/strict';
import { blankDocument, newText, newImage, parseProject, expandSelection, normalizeGroups, selectionBounds, scaleElements, translateElements } from '../model.js';
const height = e => e.type === 'image' ? e.height : e.fontSize * 1.25 + e.paddingY * 2 + e.strokeWidth;
test('groups expand atomically, persist, and dissolve when only one member remains', () => {
  const doc = blankDocument(), a = newText(doc, 'a'), b = newText(doc, 'b'); a.groupId = b.groupId = 'group'; doc.elements.push(a,b);
  assert.deepEqual(expandSelection(doc.elements, ['a']), ['a','b']);
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(doc))), doc);
  assert.equal(normalizeGroups([a])[0].groupId, null);
  a.groupId = 14; assert.throws(() => parseProject(doc));
});
test('uniform selection scaling preserves rotated centers, text effects and group IDs', () => {
  const doc = blankDocument(), text = newText(doc, 'text'), image = newImage(doc, { src: 'data:image/png;base64,aGVsbG8=', name:'image', naturalWidth:100,naturalHeight:50 }, 'image');
  Object.assign(text,{x:400,y:200,rotation:35,groupId:'g'}); Object.assign(image,{x:100,y:100,rotation:-25,groupId:'g'});
  const elements = [text,image], box = selectionBounds(elements,height), next = scaleElements(elements,1.5,box,height);
  next.forEach((e,i) => {
    const old = elements[i];
    assert.ok(Math.abs(e.x+e.width/2-(box.x+(old.x+old.width/2-box.x)*1.5))<1e-8);
    assert.ok(Math.abs(e.y+height(e)/2-(box.y+(old.y+height(old)/2-box.y)*1.5))<1e-8);
    assert.equal(e.rotation,old.rotation); assert.equal(e.groupId,'g');
  });
  assert.equal(next[0].fontSize,text.fontSize*1.5); assert.equal(next[0].strokeWidth,text.strokeWidth*1.5);
  assert.equal(next[1].height,image.height*1.5);
});
test('joint transforms respect limits while retaining relative spacing', () => {
  const a={type:'image',x:99990,y:0,width:100,height:50}, b={...a,x:99900};
  const moved=translateElements([a,b],50,10); assert.equal(moved[0].x,100000); assert.equal(moved[0].x-moved[1].x,90);
  const scaled=scaleElements([a,b],100,{x:0,y:0},height); assert.ok(scaled.every(e=>e.width<=16000&&e.x<=100000));
});
