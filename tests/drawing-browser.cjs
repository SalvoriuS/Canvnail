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
  const waitBrush = () => page.locator('[data-drawing-surface] canvas').waitFor();
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
    const {blankDocument,newText}=await import('../model.js');
    const doc=blankDocument();doc.width=640;doc.height=360;doc.transparent=true;
    const text=newText(doc,'text'); text.text='Texto independiente';text.x=10;text.y=5;text.fontSize=20;text.width=300;doc.elements.push(text);
    await page.locator('#project-file').setInputFiles({name:'drawing.canvnail.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
    await page.locator('#artboard text').waitFor();
    const drawing=async()=> (await state()).elements.find(e=>e.drawing);
    const tool=async name=>{await openDrawing(page);await page.getByRole('button',{name,exact:true}).click();await waitBrush();};
    const color=async value=>{await page.getByLabel('Color del dibujo',{exact:true}).fill(value);};
    const size=async value=>page.getByRole('spinbutton',{name:'Grosor del dibujo en píxeles',exact:true}).fill(String(value));
    const pos=async(x,y)=>{const d=await state(),box=await page.locator('#artboard').boundingBox();return{x:box.x+x/d.width*box.width,y:box.y+y/d.height*box.height};};
    const drag=async(x,y,a,b,shift=false)=>{const from=await pos(x,y),to=await pos(a,b);if(shift)await page.keyboard.down('Shift');await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:4});await page.mouse.up();if(shift)await page.keyboard.up('Shift');await waitSaved();};
    const click=async(x,y)=>{const p=await pos(x,y);await page.mouse.click(p.x,p.y);await waitSaved();};
    const undo=async()=>{await page.getByRole('button',{name:'Deshacer',exact:true}).click();await waitBrush();await waitSaved();};
    const redo=async()=>{await page.getByRole('button',{name:'Rehacer',exact:true}).click();await waitBrush();await waitSaved();};
    await tool('Rectángulo'); await color('#000000');await size(8);await drag(100,80,240,200);
    const rectangle=await drawing();assert.equal((await state()).elements.length,2);assert.equal(rectangle.drawing,true);
    assert.deepEqual(await readPixels(rectangle.src,[[100,120],[150,120],[50,120]]),[[0,0,0,255],[0,0,0,0],[0,0,0,0]]);
    await tool('Cubo de relleno');await color('#ff0000');await click(150,120);
    const filled=await drawing();assert.deepEqual(await readPixels(filled.src,[[150,120],[50,120],[100,120]]),[[255,0,0,255],[0,0,0,0],[0,0,0,255]]);
    await undo();assert.equal((await drawing()).src,rectangle.src);await redo();assert.equal((await drawing()).src,filled.src);
    await tool('Pincel');await color('#0000ff');await size(10);await drag(300,100,400,100);
    const painted=await drawing();assert.deepEqual(await readPixels(painted.src,[[350,100],[350,115]]),[[0,0,255,255],[0,0,0,0]]);
    await tool('Borrador');await size(18);await drag(340,95,340,105);
    const erased=await drawing();assert.deepEqual(await readPixels(erased.src,[[340,100],[370,100],[150,120]]),[[0,0,0,0],[0,0,255,255],[255,0,0,255]]);
    await undo();assert.equal((await drawing()).src,painted.src);await redo();assert.equal((await drawing()).src,erased.src);
    await tool('Línea');await color('#00aa00');await size(6);await drag(300,200,400,200);
    assert.deepEqual((await readPixels((await drawing()).src,[[350,200]]))[0],[0,170,0,255]);
    await tool('Flecha');await drag(500,200,560,240);
    assert.equal((await readPixels((await drawing()).src,[[550,233]]))[0][3],255);
    await tool('Círculo');await drag(200,230,280,270,true);
    assert.equal((await readPixels((await drawing()).src,[[240,230],[240,270]]))[0][3],255);
    assert.equal((await readPixels((await drawing()).src,[[240,270]]))[0][3],0,'circle outline leaves transparent center');
    await tool('Rectángulo');await page.getByRole('checkbox',{name:'Rellenar formas',exact:true}).check();await color('#ffcc00');await drag(40,240,100,300);
    const shapes=await drawing();assert.deepEqual((await readPixels(shapes.src,[[60,260]]))[0],[255,204,0,255]);
    // Escape drops an unfinished shape and restores the previous canvas exactly.
    const a=await pos(420,260),b=await pos(500,320);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);await page.keyboard.press('Escape');await page.mouse.up();
    assert.equal(await page.locator('[data-drawing-surface]').count(),0);assert.equal((await drawing()).src,shapes.src);assert.equal(await page.locator('[data-handle]').count(),8);
    // Move and resize are available after exiting drawing.
    await page.keyboard.down('Alt');await drag(450,300,460,308);await page.keyboard.up('Alt');
    const moved=await drawing();assert.notEqual(moved.x,0);
    const handle=await page.locator('[data-handle="e"]').boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2-15,handle.y+handle.height/2);await page.mouse.up();await waitSaved();assert.notEqual((await drawing()).width,moved.width);
    // Painting on a resized layer uses its original pixel coordinates.
    await tool('Pincel');await size(12);await color('#ff00ff');
    const el=await drawing(),d=await state();const local=[450,140];
    await click(el.x+local[0]/el.naturalWidth*el.width,el.y+local[1]/el.naturalHeight*el.height);
    const final=await drawing();assert.deepEqual((await readPixels(final.src,[local]))[0],[255,0,255,255]);
    const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar PNG',exact:true}).click();const exportPath=path.join(out,'drawing-transparent.png');await(await exported).saveAs(exportPath);
    const png='data:image/png;base64,'+(await fs.readFile(exportPath)).toString('base64');
    const red=[Math.round(final.x+150/640*final.width),Math.round(final.y+120/360*final.height)];
    assert.deepEqual((await readPixels(png,[red,[630,350]])),[[255,0,0,255],[0,0,0,0]]);
    await page.screenshot({path:path.join(out,'10-drawing-tools.png')});
    await page.getByRole('button',{name:'Terminar retoque',exact:true}).click();
    // Drawing and text stay independent, including ordering, visibility, and locking.
    await page.getByRole('button',{name:'Atrasar capa',exact:true}).click();assert.equal((await state()).elements[0].drawing,true);
    await page.locator(`[data-layer-id="${final.id}"] [data-layer-action="visible"]`).click();assert.equal((await drawing()).visible,false);
    await page.locator(`[data-layer-id="${final.id}"] [data-layer-action="visible"]`).click();
    await page.locator(`[data-layer-id="${final.id}"] [data-layer-action="locked"]`).click();await page.getByRole('button',{name:'Pincel',exact:true}).click();assert.equal(await page.locator('[data-drawing-surface]').count(),0);
    await page.locator(`[data-layer-id="${final.id}"] [data-layer-action="locked"]`).click();
    assert.deepEqual((await state()).elements.find(e=>e.type==='text'),text);
    const savedDoc=await state(),saving=page.waitForEvent('download');await page.getByRole('button',{name:'Guardar proyecto',exact:true}).click();const file=path.join(out,'drawing.canvnail.json');await(await saving).saveAs(file);
    await page.reload();await page.locator('#artboard image').waitFor();assert.deepEqual(await state(),savedDoc);
    const fresh=await browser.newContext(),p=await fresh.newPage();await p.goto(baseURL);await p.locator('#project-file').setInputFiles(file);await p.locator('#artboard image').waitFor();await p.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('Guardado'));
    assert.deepEqual(await readProject(p),savedDoc);await p.getByRole('button',{name:'Seleccionar Dibujo 1',exact:true}).click();await openDrawing(p);await p.getByRole('button',{name:'Pincel',exact:true}).click();await p.locator('[data-drawing-surface] canvas').waitFor();await fresh.close();
    assert.deepEqual(errors,[]);console.log('PASS: seven drawing tools, connected bucket, color/width, filled and Shift shapes, per-gesture undo/redo, cancellation, exit/movement/resize, transformed-layer painting, transparent PNG during drawing, mixed layers/order/visibility/lock, autosave and editable project round trip.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
