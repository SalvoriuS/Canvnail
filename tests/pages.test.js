import test from 'node:test';
import assert from 'node:assert/strict';
import { blankDocument, newText, newPage, blankWorkspace, parseWorkspace, activePage, pageFormat } from '../model.js';
import { pdfPageSize } from '../exports.js';

test('legacy documents migrate to one page without changing content; version 3 round trips', () => {
  const legacy = blankDocument(); legacy.elements.push(newText(legacy, 'text'));
  const project = parseWorkspace(legacy), { id, ...page } = activePage(project);
  const { version, name, ...content } = legacy;
  assert.deepEqual(page, content); assert.equal(project.name, name);
  project.pages.push(newPage('a4')); project.activePageId = project.pages[1].id;
  assert.deepEqual(parseWorkspace(JSON.parse(JSON.stringify(project))), project);
});
test('page IDs, active page, page count and hidden-page content are validated', () => {
  const project = blankWorkspace(); project.pages.push(newPage('a4'));
  const badActive = structuredClone(project); badActive.activePageId = 'missing'; assert.throws(() => parseWorkspace(badActive));
  const duplicate = structuredClone(project); duplicate.pages[1].id = duplicate.pages[0].id; assert.throws(() => parseWorkspace(duplicate));
  const invalid = structuredClone(project); invalid.pages[1].background = 'url(https://example.com)'; assert.throws(() => parseWorkspace(invalid));
  assert.throws(() => parseWorkspace({ ...project, pages: [] }));
  assert.throws(() => parseWorkspace({ ...project, pages: Array.from({ length: 101 }, () => newPage()) }));
});
test('A4 exports have exact physical dimensions in points and custom canvases retain aspect ratio', () => {
  const a4 = newPage('a4'), landscape = newPage('a4-landscape');
  assert.equal(pageFormat(a4), 'a4'); assert.equal(pageFormat(landscape), 'a4-landscape');
  assert.ok(Math.abs(pdfPageSize(a4)[0] - 595.27559) < .00001);
  assert.deepEqual(pdfPageSize(landscape), pdfPageSize(a4).slice().reverse());
  assert.equal(pdfPageSize({ width: 1280, height: 720 })[0] / pdfPageSize({ width: 1280, height: 720 })[1], 1280 / 720);
});
