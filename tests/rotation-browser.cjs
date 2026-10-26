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
    const fixture=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=120;c.height=60;const x=c.getContext('2d');x.fillStyle='#ff0000';x.fillRect(0,0,60,60);x.fillStyle='#0000ff';x.fillRect(60,0,60,60);return c.toDataURL();});
    const {blankDocument,newImage,newText,localToWorld,rotateVector}=await import('../model.js');const doc=blankDocument();doc.transparent=true;
    const image=newImage(doc,{src:fixture,name:'Imagen giratoria',naturalWidth:120,naturalHeight:60},'image');Object.assign(image,{x:180,y:200,width:240,height:120});
    const text=newText(doc,'text');Object.assign(text,{text:'Texto giratorio',x:700,y:170,width:300,fontSize:48});
    const drawing=newImage(doc,{src:fixture,name:'Dibujo giratorio',naturalWidth:120,naturalHeight:60},'drawing');Object.assign(drawing,{x:500,y:450,width:240,height:120,drawing:true});doc.elements.push(image,text,drawing);
    await page.locator('#project-file').setInputFiles({name:'rotate.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});await page.locator('#artboard image').first().waitFor();await waitSaved();
    const selected=async()=>{const id=await page.locator('[data-layer-id].active').getAttribute('data-layer-id');return(await state()).elements.find(e=>e.id===id);};
    const select=async name=>page.getByRole('button',{name:'Seleccionar '+name,exact:true}).click();
    const setAngle=async value=>{await openInspector(page,'position');const f=page.getByRole('spinbutton',{name:'Ángulo de giro',exact:true});await f.fill(String(value));await f.press('Tab');await waitSaved();};
    const screen=async point=>{const box=await page.locator('#artboard').boundingBox();return{x:box.x+point.x/1280*box.width,y:box.y+point.y/720*box.height};};
    const rotateBy=async(delta,shift=false,cancel=false)=>{
      const e=await selected(),height=Number(await page.locator('[data-selection]>rect').first().getAttribute('height')),center=await screen({x:e.x+e.width/2,y:e.y+height/2});
      const handle=await page.locator('[data-rotate-handle]').boundingBox(),start={x:handle.x+handle.width/2,y:handle.y+handle.height/2};
      const vector=rotateVector({x:start.x-center.x,y:start.y-center.y},delta);
      if(shift)await page.keyboard.down('Shift');await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(center.x+vector.x,center.y+vector.y,{steps:8});
      if(cancel)await page.keyboard.press('Escape');await page.mouse.up();if(shift)await page.keyboard.up('Shift');await waitSaved();
    };
    const download=async name=>{if(name==='Descargar esta imagen PNG')await openInspector(page,'content');const event=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();const result=await event;const file=path.join(out,result.suggestedFilename());await result.saveAs(file);return file;};
    await select('Imagen giratoria');await setAngle(90);assert.equal((await selected()).rotation,90);
    await page.getByRole('button',{name:'Deshacer',exact:true}).click();await waitSaved();assert.equal((await selected()).rotation,0);
    await page.getByRole('button',{name:'Rehacer',exact:true}).click();await waitSaved();assert.equal((await selected()).rotation,90);
    const file=await download('Exportar PNG'),png='data:image/png;base64,'+(await fs.readFile(file)).toString('base64');
    assert.deepEqual(await readPixels(png,[[300,200],[300,320],[200,260]]),[[255,0,0,255],[0,0,255,255],[0,0,0,0]],'PNG uses center rotation');
    const standalone=await download('Descargar esta imagen PNG'),bytes=await fs.readFile(standalone);assert.equal(bytes.readUInt32BE(16),60);assert.equal(bytes.readUInt32BE(20),120);
    await page.getByRole('combobox',{name:'Formato de exportación',exact:true}).selectOption('pdf');const pdf=await download('Exportar PDF');await fs.copyFile(pdf,path.join(out,'rotation.pdf'));
    await rotateBy(40,true);assert.equal((await selected()).rotation,135);await page.getByRole('button',{name:'Deshacer',exact:true}).click();await waitSaved();assert.equal((await selected()).rotation,90);
    await rotateBy(25,false,true);assert.equal((await selected()).rotation,90,'Escape cancels rotation');
    // Photo eraser and restore map pointer coordinates back through rotation.
    await openInspector(page,'background');
    await page.getByRole('button',{name:'Borrar con pincel',exact:true}).click();await waitBrush();const photoPoint=await screen(localToWorld({x:60,y:60},await selected()));await page.getByRole('spinbutton',{name:'Grosor del pincel en píxeles',exact:true}).fill('12');await page.mouse.click(photoPoint.x,photoPoint.y);await waitSaved();
    assert.equal((await readPixels((await selected()).src,[[30,30]]))[0][3],0);
    await page.getByRole('button',{name:'Restaurar con pincel',exact:true}).click();await waitBrush();await page.mouse.click(photoPoint.x,photoPoint.y);await waitSaved();assert.deepEqual((await readPixels((await selected()).src,[[30,30]]))[0],[255,0,0,255]);
    await page.getByRole('button',{name:'Terminar retoque',exact:true}).click();
    // A rotated side resize must retain the opposite midpoint in world coordinates.
    let before=await selected(),anchor=localToWorld({x:0,y:before.height/2},before);const handle=await page.locator('[data-handle="e"]').boundingBox(),delta=rotateVector({x:40,y:0},before.rotation),board=await page.locator('#artboard').boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+delta.x/1280*board.width,handle.y+handle.height/2+delta.y/720*board.height,{steps:4});await page.mouse.up();await waitSaved();
    let after=await selected(),newAnchor=localToWorld({x:0,y:after.height/2},after);assert.ok(Math.abs(anchor.x-newAnchor.x)<.01&&Math.abs(anchor.y-newAnchor.y)<.01);assert.ok(after.width>before.width+39);
    await select('Texto giratorio');await setAngle(-20);await rotateBy(55);assert.ok(Math.abs((await selected()).rotation-35)<.2);
    await select('Dibujo giratorio');await setAngle(45);await rotateBy(45,true);assert.equal((await selected()).rotation,90);
    // Drawing on a rotated layer remains aligned with its native pixels.
    await openDrawing(page);await page.getByRole('button',{name:'Pincel',exact:true}).click();await page.locator('[data-drawing-surface] canvas').waitFor();const drawPoint=await screen(localToWorld({x:60,y:60},await selected()));await page.getByLabel('Color del dibujo',{exact:true}).fill('#ff00ff');await page.mouse.click(drawPoint.x,drawPoint.y);await waitSaved();assert.deepEqual((await readPixels((await selected()).src,[[30,30]]))[0],[255,0,255,255]);await page.getByRole('button',{name:'Terminar retoque',exact:true}).click();
    await openInspector(page,'position');
    await page.locator('[data-layer-id="drawing"] [data-layer-action="locked"]').click();assert.equal(await page.locator('[data-rotate-handle]').count(),0);assert.equal(await page.getByRole('spinbutton',{name:'Ángulo de giro',exact:true}).isDisabled(),true);await page.locator('[data-layer-id="drawing"] [data-layer-action="locked"]').click();
    await page.getByRole('spinbutton',{name:'Ángulo de giro',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'15-rotation.png')});
    const saved=await state(),projectFile=await download('Guardar proyecto');await page.reload();await page.locator('#artboard image').first().waitFor();assert.deepEqual(await state(),saved);
    const fresh=await browser.newContext(),p=await fresh.newPage();await p.goto(baseURL);await p.locator('#project-file').setInputFiles(projectFile);await p.locator('#artboard image').first().waitFor();await p.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('Guardado'));assert.deepEqual(await readProject(p),saved);await fresh.close();
    assert.deepEqual(errors,[]);console.log('PASS: exact and drag rotation for images/text/drawings, Shift snapping, undo/redo/Escape, rotated resize anchor, eraser/restore/drawing coordinate mapping, PNG/standalone/PDF exports, locked layers, project save/import/reload.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
