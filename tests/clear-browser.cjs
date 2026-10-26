const { openInspector, openDrawing } = require('./helpers.cjs');
const { chromium, launchOptions, baseURL, isLocalRequest } = require('./browser-runtime.cjs');
const { readWorkspace, useDownloadFallback } = require('./helpers.cjs');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch(launchOptions);
  useDownloadFallback(browser);
  const context = await browser.newContext(), page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const saved = () => page.waitForFunction(() => document.querySelector('#save-state').textContent.includes('Guardado'));
  try {
    await page.goto(baseURL); await page.getByRole('button', { name: 'Limpiar lienzo', exact: true }).waitFor();
    const { blankWorkspace, newPage, newText, newImage } = await import('../model.js');
    const project = blankWorkspace(), first = project.pages[0], other = newPage('a4');
    first.background = '#ddeeff'; first.transparent = true;
    const text = newText(first, 'locked'); text.locked = true; text.visible = false; first.elements.push(text);
    const src = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 40; canvas.getContext('2d').fillRect(0, 0, 40, 40); return canvas.toDataURL(); });
    const drawing = newImage(first, { src, name: 'Dibujo a limpiar', naturalWidth: 40, naturalHeight: 40 }, 'drawing'); drawing.drawing = true; first.elements.push(drawing);
    other.elements.push(newText(other, 'other')); project.pages.push(other);
    await page.locator('#project-file').setInputFiles({ name: 'clear.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.locator('#artboard image').waitFor(); await saved();
    await page.getByRole('button', { name: 'Seleccionar Dibujo a limpiar', exact: true }).click();
    await openDrawing(page);
    await page.getByRole('button', { name: 'Pincel', exact: true }).click(); await page.locator('[data-drawing-surface] canvas').waitFor();
    await page.getByRole('button', { name: 'Limpiar lienzo', exact: true }).click(); await saved();
    let result = await readWorkspace(page);
    assert.deepEqual(result.pages[0], { ...first, elements: [] }); assert.deepEqual(result.pages[1], other);
    assert.equal(result.activePageId, first.id); assert.equal(await page.locator('[data-drawing-surface]').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Limpiar lienzo', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Deshacer', exact: true }).click(); await saved(); assert.deepEqual(await readWorkspace(page), project);
    await page.getByRole('button', { name: 'Rehacer', exact: true }).click(); await saved();
    await page.reload(); await page.getByRole('button', { name: 'Limpiar lienzo', exact: true }).waitFor(); await saved();
    result = await readWorkspace(page); assert.deepEqual(result.pages[0].elements, []); assert.deepEqual(result.pages[1], other);
    assert.deepEqual(errors, []);
    console.log('PASS: clear current page including hidden/locked/drawing layers, exit drawing mode, preserve page format/background and other pages, undo/redo, disable when empty, autosave/reload.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
