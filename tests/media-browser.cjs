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
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
  page.setDefaultTimeout(12000);
  const saved = () => page.waitForFunction(() => document.querySelector('#save-state').textContent.includes('Guardado'));
  const state = async () => { await saved(); return readProject(page); };
  const set = async (label, value) => { await openInspector(page,'position'); const field = page.getByRole('spinbutton', { name: label, exact: true }); await field.fill(String(value)); await field.press('Tab'); };
  const imageLocator = id => page.locator(`#artboard [data-element-id="${id}"]`);
  const dragToPosition = async (id, x, y, alt = false) => {
    const project = await state(), element = project.elements.find(e => e.id === id);
    const artboard = await page.locator('#artboard').boundingBox(), zoom = artboard.width / project.width;
    const current = await imageLocator(id).boundingBox();
    const from = { x: current.x + current.width / 2, y: current.y + current.height / 2 };
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + (x - element.x) * zoom, from.y + (y - element.y) * zoom, { steps: 8 });
    return async () => { await page.mouse.up(); if (alt) await page.keyboard.up('Alt'); await saved(); };
  };
  try {
    await page.goto(baseURL); await page.getByLabel('Nombre del proyecto', { exact: true }).waitFor();
    assert.equal(await page.title(), 'Canvnail · Editor local');
    assert.equal(await page.getByLabel('Nombre del proyecto', { exact: true }).inputValue(), 'Canvnail');
    const fixture = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ed3f64'; ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = '#ffd764'; ctx.fillRect(180, 0, 140, 180);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 24px sans-serif'; ctx.fillText('CANVNAIL', 18, 105);
      return canvas.toDataURL('image/png');
    });
    await page.getByRole('button', { name: 'Añadir texto', exact: true }).first().click();
    await page.getByLabel('Contenido del texto', { exact: true }).fill('Canvnail');
    await page.getByLabel('Contenido del texto', { exact: true }).press('Tab');
    await page.locator('#image-file').setInputFiles({ name: 'tarjeta.png', mimeType: 'image/png', buffer: Buffer.from(fixture.split(',')[1], 'base64') });
    await page.getByRole('heading', { name: 'Imagen', exact: true }).waitFor();
    let project = await state(), image = project.elements.find(e => e.type === 'image');
    assert.ok(image); assert.equal(image.naturalWidth, 320); assert.equal(image.naturalHeight, 180);
    assert.equal(image.src, fixture); assert.equal(await imageLocator(image.id).locator('image').count(), 1);
    assert.equal(await page.locator('.image-thumb img').count(), 1);
    const artboard = await page.locator('#artboard').boundingBox(); const zoom = artboard.width / 1280;
    let release = await dragToPosition(image.id, 3 / zoom, 140);
    assert.equal(await page.locator('[data-guides] line[x1="0"]').count(), 1, 'guide visible at canvas edge');
    await release(); assert.equal((await state()).elements.find(e => e.id === image.id).x, 0);
    assert.equal(await page.locator('[data-guides]').count(), 0, 'guides disappear on release');
    release = await dragToPosition(image.id, 3 / zoom, 140, true);
    assert.equal(await page.locator('[data-guides]').count(), 0, 'Alt bypasses magnet');
    await release(); assert.ok(Math.abs((await state()).elements.find(e => e.id === image.id).x - 3 / zoom) < .1);
    release = await dragToPosition(image.id, 480 + 3 / zoom, 270 + 3 / zoom);
    assert.equal(await page.locator('[data-guides] line').count(), 2, 'both center guides');
    await release(); project = await state(); image = project.elements.find(e => e.type === 'image');
    assert.equal(image.x + image.width / 2, 640); assert.equal(image.y + image.height / 2, 360);
    await page.getByRole('button', { name: 'Ajuste magnético', exact: true }).click();
    release = await dragToPosition(image.id, 480 + 3 / zoom, 270 + 3 / zoom);
    assert.equal(await page.locator('[data-guides]').count(), 0); await release();
    assert.ok(Math.abs((await state()).elements.find(e => e.id === image.id).x - (480 + 3 / zoom)) < .1);
    await page.getByRole('button', { name: 'Ajuste magnético', exact: true }).click();
    const corner = await page.locator('[data-handle="se"]').boundingBox();
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await page.mouse.down();
    await page.mouse.move(corner.x + corner.width / 2 + 35, corner.y + corner.height / 2 + 10, { steps: 6 }); await page.mouse.up();
    image = (await state()).elements.find(e => e.type === 'image');
    assert.ok(image.width > 320); assert.ok(Math.abs(image.width / image.height - 16 / 9) < .0001);
    await openInspector(page,'position');
    await page.getByRole('checkbox', { name: 'Mantener proporción', exact: true }).uncheck();
    await set('Ancho de la imagen', 320); await set('Alto de la imagen', 180); await set('X', 40); await set('Y', 50);
    await page.getByRole('button', { name: 'Atrasar capa', exact: true }).click();
    assert.equal((await state()).elements[0].type, 'image');
    await page.locator(`.layer-row[data-layer-id="${image.id}"]`).getByRole('button', { name: 'Ocultar capa', exact: true }).click();
    assert.equal(await page.locator('#artboard image').count(), 0);
    await page.locator(`.layer-row[data-layer-id="${image.id}"]`).getByRole('button', { name: 'Mostrar capa', exact: true }).click();
    await page.locator(`.layer-row[data-layer-id="${image.id}"]`).getByRole('button', { name: 'Bloquear capa', exact: true }).click();
    assert.equal(await page.getByLabel('Ancho de la imagen', { exact: true }).isDisabled(), true);
    await page.keyboard.press('Delete'); assert.equal((await state()).elements.length, 2);
    await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
    assert.equal(await page.getByLabel('Ancho de la imagen', { exact: true }).isDisabled(), false);
    // Exercise the clipboard event payload without altering the person's OS clipboard.
    const cancelled = await page.evaluate(async data => {
      const blob = await (await fetch(data)).blob(), transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'pegada.png', { type: 'image/png' }));
      return !document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, fixture);
    assert.equal(cancelled, true);
    await page.waitForFunction(() => document.querySelectorAll('#artboard image').length === 2);
    await saved(); assert.equal((await state()).elements.filter(e => e.type === 'image').length, 2);
    // The explicit Paste button uses the browser Clipboard API. Supply a controlled test payload.
    await page.evaluate(data => Object.defineProperty(navigator.clipboard, 'read', { configurable: true, value: async () => [{ types: ['image/png'], getType: async () => (await fetch(data)).blob() }] }), fixture);
    await page.getByRole('button', { name: 'Pegar imagen', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('#artboard image').length === 3);
    await saved();
    await page.screenshot({ path: path.join(out, '04-canvnail-images.png') });
    const save = page.waitForEvent('download'); await page.getByRole('button', { name: 'Guardar proyecto', exact: true }).click();
    const download = await save; assert.equal(download.suggestedFilename(), 'Canvnail.canvnail.json');
    const file = path.join(out, 'images.canvnail.json'); await download.saveAs(file);
    const downloaded = JSON.parse(await fs.readFile(file, 'utf8'));
    await page.reload(); await page.locator('#artboard image').first().waitFor();
    assert.deepEqual(await state(), require('./helpers.cjs').legacyView(downloaded));
    const fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const freshPage = await fresh.newPage(); await freshPage.goto(baseURL);
    await freshPage.locator('#project-file').setInputFiles(file);
    await freshPage.waitForFunction(() => document.querySelectorAll('#artboard image').length === 3);
    const exporting = freshPage.waitForEvent('download'); await freshPage.getByRole('button', { name: 'Exportar PNG', exact: false }).click();
    const pngPath = path.join(out, 'images-export.png'); await (await exporting).saveAs(pngPath);
    const pngData = 'data:image/png;base64,' + (await fs.readFile(pngPath)).toString('base64');
    const pixel = await freshPage.evaluate(async data => {
      const image = new Image(); image.src = data; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return Array.from(ctx.getImageData(80, 80, 1, 1).data);
    }, pngData);
    assert.deepEqual(pixel, [237, 63, 100, 255], 'PNG contains embedded image pixels');
    await fresh.close();
    // A decoded image larger than localStorage's old allowance must survive IndexedDB reload.
    const bigData = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 1200;
      const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(canvas.width, canvas.height);
      let seed = 42;
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let j = 0; j < 3; j++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[i + j] = seed >>> 24; }
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0); return canvas.toDataURL('image/png');
    });
    assert.ok(bigData.length > 5_500_000);
    await page.locator('#image-file').setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: Buffer.from(bigData.split(',')[1], 'base64') });
    await page.waitForFunction(() => document.querySelectorAll('#artboard image').length === 4); await saved();
    await page.reload(); await page.locator('#artboard image').first().waitFor();
    assert.equal(await page.locator('#artboard image').count(), 4);
    // Rejected import leaves the current project untouched.
    await page.locator('#image-file').setInputFiles({ name: 'no-imagen.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
    await page.getByRole('status').filter({ hasText: 'Elige una imagen' }).waitFor();
    assert.equal(await page.locator('#artboard image').count(), 4);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, '05-canvnail-mobile.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile fits viewport');
    await context.close();
    const legacy = await browser.newContext();
    const { blankDocument, newText } = await import('../model.js');
    const oldDoc = blankDocument(); oldDoc.version = 1; oldDoc.name = 'Sin título'; oldDoc.elements.push(newText(oldDoc, 'legacy'));
    await legacy.addInitScript(doc => localStorage.setItem('trazo.document.v1', JSON.stringify(doc)), oldDoc);
    const legacyPage = await legacy.newPage(); await legacyPage.goto(baseURL);
    await legacyPage.locator('#artboard text').waitFor();
    await legacyPage.waitForFunction(() => document.querySelector('#save-state').textContent.includes('Guardado'));
    assert.equal((await readProject(legacyPage)).name, 'Canvnail');
    await legacyPage.getByLabel('Nombre del proyecto', { exact: true }).fill('Mi miniatura'); await legacyPage.getByLabel('Nombre del proyecto', { exact: true }).press('Tab');
    await legacyPage.waitForFunction(() => document.querySelector('#save-state').textContent.includes('Guardado'));
    await legacyPage.reload(); await legacyPage.locator('#artboard text').waitFor();
    assert.equal(await legacyPage.getByLabel('Nombre del proyecto', { exact: true }).inputValue(), 'Mi miniatura');
    await legacy.close();
    assert.deepEqual(errors, []);
    assert.ok(requests.every(url => url.startsWith(baseURL) || /^(data:|blob:)/.test(url)), 'no external network requests');
    console.log('PASS: image file import, clipboard event, Clipboard API handler, movement, magnetic edges/center/Alt/toggle, proportional resizing, mixed layers, visibility/lock/undo, embedded project round trip, PNG pixels, large-image autosave, invalid files, legacy migration, mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
