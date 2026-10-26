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
      return canvas.toDataURL('image/png');
    });
    const { blankDocument, newImage } = await import('../model.js');
    const doc = blankDocument(); doc.transparent = true;
    const image = newImage(doc, { src: fixture, name: 'Borrado de prueba', naturalWidth: 320, naturalHeight: 180 }, 'erase-test');
    image.x = 320; image.y = 180; image.width = 640; image.height = 270;
    doc.elements.push(image);
    await page.locator('#project-file').setInputFiles({ name: 'erase.canvnail.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
    await page.locator('#artboard image').waitFor();
    const selectLayer = async () => { await page.getByRole('button', { name: 'Seleccionar Borrado de prueba', exact: true }).click(); await openInspector(page,'background'); };
    const erase = async () => { await page.getByRole('button', { name: 'Borrar con pincel', exact: true }).click(); await waitBrush(); };
    const exited = async () => {
      assert.equal(await page.locator('[data-restore-surface]').count(), 0);
      assert.equal(await page.locator('[data-handle]').count(), 8);
      assert.equal(await page.locator('#retouch-toolbar').isVisible(), false);
    };
    await selectLayer(); await erase();
    await page.getByRole('spinbutton', { name: 'Grosor del pincel en píxeles', exact: true }).fill('20');
    await clickPixel(100, 90);
    const first = (await state()).elements[0];
    assert.equal(first.originalSrc, fixture, 'manual erase retains original even before automatic removal');
    assert.deepEqual(await readPixels(first.src, [[100, 90], [120, 90]]), [[0, 0, 0, 0], [58, 136, 221, 255]]);
    await page.getByRole('spinbutton', { name: 'Grosor del pincel en píxeles', exact: true }).fill('50');
    const a = await screenPoint(150, 90), b = await screenPoint(210, 90);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.mouse.up();
    const second = (await state()).elements[0];
    for (const pixel of await readPixels(second.src, [[150,90], [180,90], [210,90], [180,110]])) assert.equal(pixel[3], 0);
    await page.keyboard.press('Control+z'); await waitBrush();
    assert.equal((await state()).elements[0].src, first.src);
    assert.equal(await page.getByRole('button', { name: 'Borrar con pincel', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Control+Shift+z'); await waitBrush();
    assert.equal((await state()).elements[0].src, second.src);
    // Switch tools without leaving retouch mode, then undo only that stroke.
    await page.getByRole('button', { name: 'Restaurar con pincel', exact: true }).click(); await waitBrush();
    await clickPixel(180, 90);
    assert.equal((await readPixels((await state()).elements[0].src, [[180,90]]))[0][3], 255);
    await page.keyboard.press('Control+z'); await waitBrush();
    assert.equal((await state()).elements[0].src, second.src);
    // Done must work with the brush width field focused and retain committed changes.
    await page.getByRole('spinbutton', { name: 'Grosor del pincel en píxeles', exact: true }).fill('30');
    await page.getByRole('button', { name: 'Terminar retoque', exact: true }).click(); await exited();
    assert.equal((await state()).elements[0].src, second.src);
    // Moving and resizing work again, with real pointer input.
    let pos = await screenPoint(270, 130); const beforeMove = (await state()).elements[0];
    await page.mouse.move(pos.x,pos.y); await page.mouse.down(); await page.mouse.move(pos.x+23,pos.y+17,{steps:3}); await page.mouse.up();
    const moved = (await state()).elements[0]; assert.notEqual(moved.x,beforeMove.x); assert.notEqual(moved.y,beforeMove.y);
    const handle = await page.locator('[data-handle="se"]').boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2); await page.mouse.down(); await page.mouse.move(handle.x+handle.width/2+20,handle.y+handle.height/2+10); await page.mouse.up();
    assert.notEqual((await state()).elements[0].width, moved.width);
    // Toggle, blank canvas, same-layer selection and Escape are independent exits.
    await erase(); await page.getByRole('button',{name:'Borrar con pincel',exact:true}).click(); await exited();
    await erase(); const board = await page.locator('#artboard').boundingBox(); await page.mouse.click(board.x+10,board.y+10); await exited();
    await erase(); await selectLayer(); await exited();
    await erase(); await page.getByRole('spinbutton',{name:'Grosor del pincel en píxeles',exact:true}).focus(); await page.keyboard.press('Escape'); await exited();
    await erase();
    const pending = await screenPoint(270,40); await page.mouse.move(pending.x,pending.y); await page.mouse.down(); await page.keyboard.press('Escape'); await page.mouse.up(); await exited();
    assert.equal((await state()).elements[0].src, second.src, 'Escape cancels unfinished erase only');
    await erase();
    await page.screenshot({path:path.join(out,'08-erase-brush.png')});
    const exported = page.waitForEvent('download'); await page.getByRole('button',{name:'Exportar PNG',exact:false}).click();
    const exportPath=path.join(out,'erased-transparent.png'); await (await exported).saveAs(exportPath);
    const finalImage=(await state()).elements[0];
    const png='data:image/png;base64,'+(await fs.readFile(exportPath)).toString('base64');
    const erasedPoint=[Math.round(finalImage.x+100/320*finalImage.width),Math.round(finalImage.y+90/180*finalImage.height)];
    assert.equal((await readPixels(png,[erasedPoint]))[0][3],0);
    const saving=page.waitForEvent('download'); await page.getByRole('button',{name:'Guardar proyecto',exact:true}).click();
    const file=path.join(out,'erased.canvnail.json'); await (await saving).saveAs(file);
    await page.reload(); await page.locator('#artboard image').waitFor();
    assert.equal((await state()).elements[0].src,second.src);
    const fresh=await browser.newContext(), freshPage=await fresh.newPage(); await freshPage.goto(baseURL);
    await freshPage.locator('#project-file').setInputFiles(file); await freshPage.locator('#artboard image').waitFor();
    await freshPage.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('Guardado'));
    const reopened=(await readProject(freshPage)).elements[0]; assert.equal(reopened.src,second.src); assert.equal(reopened.originalSrc,fixture);
    await fresh.close(); assert.deepEqual(errors,[]);
    console.log('PASS: eraser size and continuous strokes, original preservation, per-stroke undo/redo, restore switching, Done/toggle/outside/layer/Escape exits, movement and resize after exit, cancelled stroke, transparent PNG and project persistence.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
