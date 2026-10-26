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
    const {blankDocument,newText}=await import('../model.js');const doc=blankDocument();
    const a=newText(doc,'a');Object.assign(a,{text:'Doble clic para editar',x:170,y:160,width:650,fontSize:68,rotation:20,groupId:'g'});
    const b=newText(doc,'b');Object.assign(b,{text:'Otro texto',x:760,y:460,width:360,fontSize:40,groupId:'g'});
    const c=newText(doc,'c');Object.assign(c,{text:'Texto independiente',x:70,y:530,width:500,fontSize:40});
    const locked=newText(doc,'locked');Object.assign(locked,{text:'Texto bloqueado',x:800,y:50,width:300,fontSize:35,locked:true});doc.elements.push(a,b,c,locked);
    await page.locator('#project-file').setInputFiles({name:'inline.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});await page.locator('#artboard text').first().waitFor();await waitSaved();
    const doubleClick=async id=>{const b=await page.locator(`[data-element-id="${id}"]`).boundingBox();await page.mouse.dblclick(b.x+b.width/2,b.y+b.height/2);};
    const editor=()=>page.getByRole('textbox',{name:'Editar texto en el lienzo',exact:true});
    await doubleClick('a');await editor().waitFor();assert.equal(await editor().inputValue(),a.text);assert.equal(await page.locator('[data-handle], [data-rotate-handle]').count(),0);
    const next='Texto editado aquí\ncon varias líneas';await editor().fill(next);await waitSaved();
    assert.equal(await editor().evaluate(n=>document.activeElement===n),true);assert.equal((await state()).elements[0].text,next);assert.equal(await page.getByRole('textbox',{name:'Contenido del texto',exact:true}).inputValue(),next);
    await page.screenshot({path:path.join(out,'23-inline-text.png')});
    await editor().press('Control+Enter');assert.equal(await editor().count(),0);await waitSaved();
    const edited=await state();assert.deepEqual(edited.elements[0],{...a,text:next});assert.deepEqual(edited.elements[1],b);
    await page.keyboard.press('Control+z');await waitSaved();assert.equal((await state()).elements[0].text,a.text);await page.keyboard.press('Control+Shift+z');await waitSaved();assert.equal((await state()).elements[0].text,next);
    await doubleClick('a');await editor().fill('Esto se cancela');await editor().press('Escape');await waitSaved();assert.equal((await state()).elements[0].text,next);assert.equal(await editor().count(),0);
    await doubleClick('a');await page.getByRole('button',{name:'Terminar edición',exact:true}).click();assert.equal(await editor().count(),0);
    // Enter inserts a real newline. Clicking a different layer commits without swallowing the click.
    await doubleClick('a');await editor().fill('Nueva línea');await editor().press('End');await editor().press('Enter');await editor().pressSequentially('Segunda');await page.getByRole('button',{name:'Seleccionar Texto independiente',exact:true}).click();await waitSaved();assert.equal(await editor().count(),0);assert.equal((await state()).elements[0].text,'Nueva línea\nSegunda');assert.equal(await page.locator('[data-layer-id="c"]').getAttribute('class').then(v=>v.includes('active')),true);
    // Changing a contextual tab also commits on the first click.
    await doubleClick('a');await editor().fill('Texto definitivo');await page.locator('#inspector').getByRole('tab',{name:'Posición',exact:true}).click();assert.equal(await editor().count(),0);assert.equal(await page.getByRole('spinbutton',{name:'Ángulo de giro',exact:true}).isVisible(),true);await waitSaved();assert.equal((await state()).elements[0].text,'Texto definitivo');
    await doubleClick('locked');assert.equal(await editor().count(),0,'locked text cannot be edited inline');
    // Clicking outside commits, exits editing and deselects, preserving the group.
    await doubleClick('a');await editor().fill('Guardado desde el lienzo');const viewport=await page.locator('#viewport').boundingBox();await page.mouse.click(viewport.x+12,viewport.y+12);await waitSaved();assert.equal(await editor().count(),0);assert.equal(await page.locator('.layer-row.active').count(),0);assert.equal((await state()).elements[0].groupId,'g');
    const expected=await state();
    const exporting=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar PNG',exact:true}).click();const exported=path.join(out,'inline-text.png');await(await exporting).saveAs(exported);assert.equal((await fs.readFile(exported)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    // Save while editing commits the text before serializing the project.
    await doubleClick('a');await editor().fill('Última edición guardada');const saving=page.waitForEvent('download');await page.getByRole('button',{name:'Guardar proyecto',exact:true}).click();const file=path.join(out,'inline.canvnail.json');await(await saving).saveAs(file);assert.equal(await editor().count(),0);await waitSaved();const saved=await state();assert.equal(saved.elements[0].text,'Última edición guardada');
    await page.reload();await page.locator('#artboard text').first().waitFor();assert.deepEqual(await state(),saved);
    const fresh=await browser.newContext(),p=await fresh.newPage();await p.goto(baseURL);await p.locator('#project-file').setInputFiles(file);await p.locator('#artboard text').first().waitFor();await p.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('Guardado'));assert.deepEqual(await readProject(p),saved);await fresh.close();assert.deepEqual(errors,[]);
    console.log('PASS: double-click inline editing, rotated/grouped text styling, live multiline updates, retained focus and sidebar sync, commit/undo/redo/Escape, first-click layer/tab navigation, locked text, outside deselection, export and save/import/reload.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
