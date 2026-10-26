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
  const network = [], errors = [], logs = [];
  context.on('request', request => network.push(request.url()));
  await context.route('**/*', route => {
    if (isLocalRequest(route.request().url())) route.continue();
    else route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (event.type() === 'error') logs.push(event.text()); });
  const saved = () => page.waitForFunction(() => document.querySelector('#save-state').textContent.includes('Guardado'));
  const pixels = src => page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0, opaque = 0, partial = 0;
    for (let i = 3; i < data.length; i += 4) { if (data[i] < 5) transparent++; else if (data[i] > 250) opaque++; else partial++; }
    return { width: image.width, height: image.height, transparent, opaque, partial, corner: Array.from(ctx.getImageData(10, 10, 1, 1).data), center: Array.from(ctx.getImageData(Math.round(image.width * .45), Math.round(image.height * .5), 1, 1).data) };
  }, src);
  try {
    await page.goto(baseURL);
    await require('./browser-runtime.cjs').uploadFixture(page);
    await openInspector(page,'background');
    await page.getByRole('button', { name: 'Quitar fondo', exact: true }).waitFor(); await saved();
    const original = (await readProject(page)).elements[0];
    const start = Date.now();
    await page.getByRole('button', { name: 'Quitar fondo', exact: true }).click();
    await page.locator('#background-status').waitFor({ state: 'visible' });
    await Promise.race([
      page.getByRole('button', { name: 'Restaurar original completo', exact: true }).waitFor({ timeout: 90000 }),
      page.waitForFunction(() => document.querySelector('#toast').textContent.startsWith('No se ha podido'), { timeout: 90000 }).then(() => { throw new Error('Background removal failed: ' + logs.join('\n')); }),
    ]);
    await page.locator('#background-status').waitFor({ state: 'hidden' }); await saved();
    const elapsedMs = Date.now() - start;
    let doc = await readProject(page), cutout = doc.elements[0];
    assert.equal(cutout.originalSrc, original.src); assert.notEqual(cutout.src, original.src);
    assert.equal(cutout.x, original.x); assert.equal(cutout.width, original.width);
    const alpha = await pixels(cutout.src);
    assert.equal(alpha.width, 770); assert.equal(alpha.height, 595);
    assert.ok(alpha.transparent > 770 * 595 * .2, 'real background was removed');
    assert.ok(alpha.opaque > 770 * 595 * .1, 'foreground remains opaque');
    assert.ok(alpha.partial > 0, 'soft edges exist');
    assert.ok(alpha.corner[3] < 5); assert.ok(alpha.center[3] > 230);
    await fs.writeFile(path.join(out, 'bear-cutout.png'), Buffer.from(cutout.src.split(',')[1], 'base64'));
    await openInspector(page,'content');
    const singleDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar esta imagen PNG', exact: true }).click();
    const singlePath = path.join(out, 'single-cutout.png'); await (await singleDownload).saveAs(singlePath);
    assert.ok((await pixels('data:image/png;base64,' + (await fs.readFile(singlePath)).toString('base64'))).transparent > 0);
    await page.getByRole('button',{name:'Propiedades de la página',exact:true}).click();
    await page.getByRole('checkbox', { name: 'Lienzo transparente', exact: true }).check(); await saved();
    await page.getByRole('button',{name:/^Seleccionar/}).click();await openInspector(page,'background');
    await page.screenshot({ path: path.join(out, '06-background-removal.png') });
    const exporting = page.waitForEvent('download'); await page.getByRole('button', { name: 'Exportar PNG', exact: false }).click();
    const exported = path.join(out, 'transparent-canvas.png'); await (await exporting).saveAs(exported);
    const exportStats = await pixels('data:image/png;base64,' + (await fs.readFile(exported)).toString('base64'));
    assert.equal(exportStats.width, 1280); assert.equal(exportStats.height, 720); assert.equal(exportStats.corner[3], 0);
    assert.ok(exportStats.opaque > 10000);
    const save = page.waitForEvent('download'); await page.getByRole('button', { name: 'Guardar proyecto', exact: true }).click();
    const projectFile = path.join(out, 'cutout.canvnail.json'); await (await save).saveAs(projectFile);
    const freshContext = await browser.newContext({ acceptDownloads: true }), fresh = await freshContext.newPage();
    await fresh.goto(baseURL); await fresh.locator('#project-file').setInputFiles(projectFile);
    await fresh.locator('#artboard image').waitFor();
    await fresh.waitForFunction(() => document.querySelector('#save-state').textContent.includes('Guardado'));
    const imported = await readProject(fresh); assert.equal(imported.transparent, true); assert.equal(imported.elements[0].originalSrc, original.src); assert.equal(imported.elements[0].src, cutout.src);
    await fresh.reload(); await fresh.locator('#artboard image').waitFor(); assert.equal((await readProject(fresh)).elements[0].src, cutout.src);
    await fresh.getByRole('button', { name: /^Seleccionar/ }).click();
    await openInspector(fresh,'background');
    await fresh.getByRole('button', { name: 'Restaurar original completo', exact: true }).click();
    await fresh.waitForFunction(() => document.querySelector('#save-state').textContent.includes('Guardado'));
    assert.equal((await readProject(fresh)).elements[0].src, original.src);
    await freshContext.close();
    await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
    // Undo the transparent-canvas toggle first, then the actual cutout.
    await page.getByRole('button',{name:'Propiedades de la página',exact:true}).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Lienzo transparente', exact: true }).isChecked(), false);
    await page.getByRole('button', { name: 'Deshacer', exact: true }).click(); await saved();
    assert.equal((await readProject(page)).elements[0].src, original.src);
    await page.getByRole('button', { name: 'Rehacer', exact: true }).click(); await saved();
    assert.equal((await readProject(page)).elements[0].src, cutout.src);
    await page.getByRole('button',{name:/^Seleccionar/}).click();await openInspector(page,'background');
    await page.getByRole('button', { name: 'Quitar fondo', exact: true }).click();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.locator('#background-status').waitFor({ state: 'hidden' });
    assert.equal((await readProject(page)).elements[0].src, cutout.src, 'cancel preserves image');
    await page.getByRole('button', { name: 'Quitar fondo', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.locator('#background-status').waitFor({ state: 'hidden' });
    assert.equal((await readProject(page)).elements[0].src, cutout.src, 'Escape cancels background processing');
    assert.equal(await page.locator('[data-handle]').count(), 8, 'normal editing remains available after cancellation');
    assert.ok(network.some(url => url.endsWith('/models/u2netp.onnx')));
    assert.ok(network.every(url => isLocalRequest(url)), 'all runtime requests stay on this machine');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(out, 'background-result.json'), JSON.stringify({ elapsedMs, alpha, exportStats, network: network.filter(url => !url.startsWith('data:') && !url.startsWith('blob:')), errors }, null, 2));
    console.log('PASS: real U2NETP inference, foreground/background alpha, full resolution, standalone PNG, transparent canvas PNG, project/reload/original restoration, undo/redo, cancellation, no external requests.');
    console.log(JSON.stringify({ elapsedMs, alpha }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
