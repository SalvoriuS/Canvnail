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
    const {blankDocument,newText,newImage}=await import('../model.js');const doc=blankDocument();
    const src=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=80;c.getContext('2d').fillRect(0,0,80,80);return c.toDataURL();});
    const image=newImage(doc,{src,name:'Imagen',naturalWidth:80,naturalHeight:80},'image');Object.assign(image,{x:300,y:200,width:200,height:200});
    const text=newText(doc,'text');text.text='Texto';text.x=700;text.y=220;doc.elements.push(image,text);
    await page.locator('#project-file').setInputFiles({name:'deselect.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});await page.locator('#artboard image').waitFor();await waitSaved();
    const select=async name=>page.getByRole('button',{name:'Seleccionar '+name,exact:true}).click();
    const outside=async(button='left')=>{const box=await page.locator('#viewport').boundingBox();await page.mouse.click(box.x+12,box.y+12,{button});};
    const empty=async()=>{assert.equal(await page.locator('.layer-row.active').count(),0);assert.equal(await page.locator('[data-selection], [data-multi-selection], [data-member-selection]').count(),0);assert.equal(await page.getByRole('heading',{name:'Tu lienzo',exact:true}).isVisible(),true);};
    await select('Imagen');await page.locator('#inspector').getByRole('tab',{name:'Posición',exact:true}).click();
    const angle=page.getByRole('spinbutton',{name:'Ángulo de giro',exact:true});await angle.fill('20');await angle.press('Tab');await waitSaved();
    const before=await state();await outside();await empty();assert.deepEqual(await state(),before,'deselect does not alter the document');
    await page.getByRole('button',{name:'Deshacer',exact:true}).click();await waitSaved();assert.equal((await state()).elements[0].rotation,0,'deselect does not add an undo entry');
    await select('Imagen');await page.getByRole('button',{name:'Seleccionar Texto',exact:true}).click({modifiers:['Shift']});assert.equal(await page.locator('.layer-row.active').count(),2);await outside();await empty();
    await select('Imagen');await page.getByRole('button',{name:'Seleccionar Texto',exact:true}).click({modifiers:['Shift']});await page.getByRole('button',{name:'Agrupar',exact:true}).click();await waitSaved();const grouped=await state();await outside();await empty();assert.deepEqual(await state(),grouped);
    await select('Imagen');assert.equal(await page.locator('.layer-row.active').count(),2);await outside('right');assert.equal(await page.locator('.layer-row.active').count(),2,'right-click does not clear selection');await page.keyboard.press('Escape');
    // Controls and panels remain interactive without clearing their target selection.
    await select('Imagen');await page.getByRole('button',{name:'Desagrupar',exact:true}).click();await page.keyboard.press('Escape');await select('Imagen');
    await page.locator('#inspector').getByRole('tab',{name:'Posición',exact:true}).click();assert.equal(await page.locator('.layer-row.active').count(),1);await page.getByRole('spinbutton',{name:'Ángulo de giro',exact:true}).fill('15');await page.getByRole('spinbutton',{name:'Ángulo de giro',exact:true}).press('Tab');assert.equal(await page.locator('.layer-row.active').count(),1);
    await page.getByRole('button',{name:'Acercar',exact:true}).click();assert.equal(await page.locator('.layer-row.active').count(),1);await outside();await empty();
    // A click outside while drawing exits the mode and deselects, retaining the layer.
    await page.getByRole('tab',{name:'Dibujar',exact:true}).click();await page.getByRole('button',{name:'Nueva capa de dibujo',exact:true}).click();await page.locator('[data-drawing-surface] canvas').waitFor();await waitSaved();const withDrawing=await state();await outside();await empty();assert.equal(await page.locator('[data-drawing-surface]').count(),0);assert.equal(await page.locator('#retouch-toolbar').isVisible(),false);assert.deepEqual(await state(),withDrawing);
    assert.deepEqual(errors,[]);console.log('PASS: outside-page click deselects single/multiple/group and exits drawing; preserves document/group/history; right-click, property controls and zoom preserve selection.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
