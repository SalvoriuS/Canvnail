const { openInspector, openDrawing } = require('./helpers.cjs');
const { chromium, launchOptions, baseURL, isLocalRequest } = require('./browser-runtime.cjs');
const { readProject } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const out = path.join(__dirname, 'artifacts'); await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(launchOptions);
  require('./helpers.cjs').useDownloadFallback(browser);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const waitSaved = () => page.waitForFunction(() => document.querySelector('#save-state').textContent.includes('Guardado'));
  const state = async () => { await waitSaved(); return readProject(page); };
  const waitBrush = () => page.locator('[data-restore-surface] canvas').waitFor();
  const readPixels = (src, points) => page.evaluate(async ({ src, points }) => {
    const image = new Image(); image.src = src; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
  }, { src, points });
  const screenPoint = async (x, y) => {
    const doc = await state(), el = doc.elements[0], box = await page.locator('#artboard').boundingBox();
    return { x: box.x + (el.x + x / el.naturalWidth * el.width) / doc.width * box.width,
      y: box.y + (el.y + y / el.naturalHeight * el.height) / doc.height * box.height };
  };
  const clickPixel = async (x, y) => { const p = await screenPoint(x, y); await page.mouse.click(p.x, p.y); await waitSaved(); };
  try {
    await page.goto(baseURL); await page.getByLabel('Nombre del proyecto', { exact: true }).waitFor();
    const fixture = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#3a88dd'; ctx.fillRect(0, 0, 320, 180);
      ctx.clearRect(0, 0, 15, 15); const original = canvas.toDataURL('image/png');
      ctx.clearRect(120, 50, 80, 80); ctx.clearRect(25, 25, 30, 30);
      return { original, cutout: canvas.toDataURL('image/png') };
    });
    const { blankDocument, newImage } = await import('../model.js');
    const doc = blankDocument(); doc.transparent = true;
    const image = newImage(doc, { src: fixture.cutout, name: 'Restauración de prueba', naturalWidth: 320, naturalHeight: 180 }, 'brush-test');
    image.originalSrc = fixture.original; image.x = 320; image.y = 180; image.width = 640; image.height = 270; image.keepRatio = false;
    doc.elements.push(image);
    await page.locator('#project-file').setInputFiles({ name: 'brush.canvnail.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
    await page.locator('#artboard image').waitFor();
    await page.getByRole('button', { name: 'Seleccionar Restauración de prueba', exact: true }).click();
    await openInspector(page,'background');
    await page.getByRole('spinbutton', { name: 'Grosor del pincel en píxeles', exact: true }).fill('20');
    await page.getByRole('button', { name: 'Restaurar con pincel', exact: true }).click(); await waitBrush();
    assert.equal(await page.locator('[data-handle]').count(), 0, 'brush does not resize or move');
    const cursorPoint = await screenPoint(150, 90); await page.mouse.move(cursorPoint.x, cursorPoint.y);
    assert.equal(await page.locator('[data-restore-cursor]').evaluate(node => getComputedStyle(node).display === 'none'), false);
    const cursor = await page.locator('[data-restore-cursor] ellipse').first().evaluate(node => ({ rx: +node.getAttribute('rx'), ry: +node.getAttribute('ry') }));
    assert.equal(cursor.rx, 20); assert.equal(cursor.ry, 15, 'cursor follows stretched image geometry');
    await clickPixel(150, 90);
    let first = (await state()).elements[0];
    assert.equal(first.x, image.x); assert.equal(first.width, image.width); assert.equal(first.originalSrc, fixture.original);
    assert.deepEqual(await readPixels(first.src, [[150, 90], [170, 90], [40, 40], [5, 5]]), [[58, 136, 221, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    await page.getByRole('spinbutton', { name: 'Grosor del pincel en píxeles', exact: true }).fill('60');
    await clickPixel(170, 90);
    const second = (await state()).elements[0];
    assert.deepEqual((await readPixels(second.src, [[170, 90]]))[0], [58, 136, 221, 255]);
    await page.keyboard.press('Control+z'); await waitBrush(); await waitSaved();
    assert.equal((await state()).elements[0].src, first.src, 'one stroke is one undo');
    await page.keyboard.press('Control+Shift+z'); await waitBrush(); await waitSaved();
    assert.equal((await state()).elements[0].src, second.src, 'redo restores the stroke');
    // Fast path segments restore continuously, including at another zoom level.
    await page.getByRole('button', { name: 'Acercar', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Grosor del pincel en píxeles', exact: true }).fill('10');
    const from = await screenPoint(125, 65), to = await screenPoint(195, 65);
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 1 }); await page.mouse.up(); await waitSaved();
    const third = (await state()).elements[0];
    for (const pixel of await readPixels(third.src, [[130, 65], [145, 65], [160, 65], [190, 65]])) assert.equal(pixel[3], 255);
    // Escape cancels the unfinished stroke, retaining all previously committed strokes.
    const cancelPoint = await screenPoint(40, 40); await page.mouse.move(cancelPoint.x, cancelPoint.y); await page.mouse.down();
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert.equal(await page.locator('[data-restore-surface]').count(), 0);
    assert.equal((await state()).elements[0].src, third.src);
    await page.getByRole('button', { name: 'Restaurar con pincel', exact: true }).click(); await waitBrush();
    // Export while the live canvas preview is active; it must serialize the committed PNG, not foreignObject.
    const exported = page.waitForEvent('download'); await page.getByRole('button', { name: 'Exportar PNG', exact: false }).click();
    const exportPath = path.join(out, 'restored-transparent.png'); await (await exported).saveAs(exportPath);
    const png = 'data:image/png;base64,' + (await fs.readFile(exportPath)).toString('base64');
    const pixelInDoc = [Math.round(image.x + 150 / 320 * image.width), Math.round(image.y + 90 / 180 * image.height)];
    assert.deepEqual(await readPixels(png, [pixelInDoc, [1, 1]]), [[58, 136, 221, 255], [0, 0, 0, 0]]);
    await page.screenshot({ path: path.join(out, '07-restoration-brush.png') });
    const saving = page.waitForEvent('download'); await page.getByRole('button', { name: 'Guardar proyecto', exact: true }).click();
    const file = path.join(out, 'restored.canvnail.json'); await (await saving).saveAs(file);
    await page.reload(); await page.locator('#artboard image').waitFor(); assert.equal((await state()).elements[0].src, third.src);
    const fresh = await browser.newContext({ acceptDownloads: true }), freshPage = await fresh.newPage();
    await freshPage.goto(baseURL); await freshPage.locator('#project-file').setInputFiles(file);
    await freshPage.locator('#artboard image').waitFor(); await freshPage.waitForFunction(() => document.querySelector('#save-state').textContent.includes('Guardado'));
    const reopened = await readProject(freshPage); assert.equal(reopened.elements[0].src, third.src); assert.equal(reopened.elements[0].originalSrc, fixture.original);
    await freshPage.getByRole('button', { name: 'Seleccionar Restauración de prueba', exact: true }).click();
    await openInspector(freshPage,'background');
    await freshPage.getByRole('button', { name: 'Restaurar con pincel', exact: true }).click();
    await freshPage.locator('[data-restore-surface] canvas').waitFor();
    // End brush, lock layer: no painting is permitted.
    await freshPage.getByRole('button', { name: 'Terminar retoque', exact: true }).click();
    await freshPage.getByRole('button', { name: 'Bloquear capa', exact: true }).click();
    assert.equal(await freshPage.getByRole('button', { name: 'Restaurar con pincel', exact: true }).isDisabled(), true);
    await fresh.close();
    assert.deepEqual(errors, []);
    console.log('PASS: precise local restoration, brush diameter/cursor on stretched image, continuous fast strokes at zoom, untouched alpha, per-stroke undo/redo while painting, Escape cancellation, PNG with active preview, saved/reopened retouches and original, locked layer.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
