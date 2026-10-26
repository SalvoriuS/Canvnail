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
    const requests=[];context.on('request',request=>requests.push(request.url()));
    await context.route('**/*',route=>isLocalRequest(route.request().url())?route.continue():route.abort());
    const fixture=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.fillStyle='#14a05a';x.fillRect(0,0,64,64);x.clearRect(0,0,4,4);const original=c.toDataURL();
      x.clearRect(0,0,64,20);x.clearRect(0,44,64,20);x.clearRect(0,20,20,24);x.clearRect(44,20,20,24);return{original,cutout:c.toDataURL()};
    });
    const {blankDocument,newImage}=await import('../model.js');const doc=blankDocument();doc.width=640;doc.height=360;doc.transparent=true;
    const image=newImage(doc,{src:fixture.cutout,name:'Bordes de prueba',naturalWidth:64,naturalHeight:64},'edges-test');
    Object.assign(image,{originalSrc:fixture.original,width:256,height:256,x:180,y:60,backgroundQuality:'quality',cutoutQuality:'quality'});doc.elements.push(image);
    await page.locator('#project-file').setInputFiles({name:'edges.canvnail.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});await page.locator('#artboard image').waitFor();
    await page.getByRole('button',{name:'Seleccionar Bordes de prueba',exact:true}).click();await openInspector(page,'background');await page.locator('.edge-details summary').click();
    const set=async(name,value)=>page.getByRole('slider',{name,exact:true}).evaluate((node,value)=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
    const apply=async()=>{await page.getByRole('button',{name:'Aplicar bordes',exact:true}).click();await page.locator('#background-status').waitFor({state:'hidden'});await waitSaved();return(await state()).elements[0];};
    const undo=async()=>{await page.getByRole('button',{name:'Deshacer',exact:true}).click();await waitSaved();};const redo=async()=>{await page.getByRole('button',{name:'Rehacer',exact:true}).click();await waitSaved();};
    await set('Contraer / expandir',-2);assert.equal((await state()).elements[0].src,fixture.cutout,'draft does not silently change pixels');
    const shrunk=await apply();assert.equal(shrunk.edgeBaseSrc,fixture.cutout);assert.equal(shrunk.edgeOffset,-2);
    assert.deepEqual(await readPixels(shrunk.src,[[20,30],[22,30]]),[[0,0,0,0],[20,160,90,255]]);
    await set('Contraer / expandir',2);const expanded=await apply();assert.deepEqual((await readPixels(expanded.src,[[18,30],[17,30]])),[[20,160,90,255],[0,0,0,0]]);
    assert.equal(expanded.edgeBaseSrc,fixture.cutout,'reapplying uses the same base instead of accumulating erosion');
    await undo();assert.equal((await state()).elements[0].src,shrunk.src);assert.equal(await page.getByRole('slider',{name:'Contraer / expandir',exact:true}).inputValue(),'-2');await redo();assert.equal((await state()).elements[0].src,expanded.src);
    await set('Suavizar',2);const softened=await apply();const a=await readPixels(softened.src,[[17,30],[18,30],[5,5]]);assert.ok(a[0][3]>0&&a[0][3]<255);assert.ok(a[1][3]>0&&a[1][3]<255);assert.equal(a[2][3],0);
    await set('Definir borde',70);const defined=await apply();assert.equal(defined.edgeDefinition,70);assert.notEqual(defined.src,softened.src);
    await page.getByRole('button',{name:'Restablecer bordes',exact:true}).click();await waitSaved();assert.equal((await state()).elements[0].src,fixture.cutout);await undo();assert.equal((await state()).elements[0].src,defined.src);
    await page.locator('.edge-details').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'12-edge-refinement.png')});
    // Export and save the refined alpha and editable settings/base.
    const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar PNG',exact:true}).click();const exportPath=path.join(out,'refined-transparent.png');await(await exported).saveAs(exportPath);
    const png='data:image/png;base64,'+(await fs.readFile(exportPath)).toString('base64');assert.equal((await readPixels(png,[[1,1]]))[0][3],0);
    const saving=page.waitForEvent('download');await page.getByRole('button',{name:'Guardar proyecto',exact:true}).click();const file=path.join(out,'refined.canvnail.json');await(await saving).saveAs(file);
    await page.reload();await page.locator('#artboard image').waitFor();assert.deepEqual((await state()).elements[0],defined);
    await page.getByRole('button',{name:'Seleccionar Bordes de prueba',exact:true}).click();await openInspector(page,'background');await page.locator('.edge-details summary').click();
    assert.equal(await page.getByRole('slider',{name:'Definir borde',exact:true}).inputValue(),'70');
    await page.getByRole('button',{name:'Restablecer bordes',exact:true}).click();await waitSaved();assert.equal((await state()).elements[0].src,fixture.cutout);
    const fresh=await browser.newContext(),p=await fresh.newPage();await p.goto(baseURL);await p.locator('#project-file').setInputFiles(file);await p.locator('#artboard image').waitFor();await p.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('Guardado'));assert.deepEqual((await readProject(p)).elements[0],defined);await fresh.close();
    // Brush retouches establish a new edge base, so later refinement cannot discard them.
    await page.getByRole('button',{name:'Borrar con pincel',exact:true}).click();await waitBrush();await page.getByRole('spinbutton',{name:'Grosor del pincel en píxeles',exact:true}).fill('8');await clickPixel(32,32);
    const brushed=(await state()).elements[0];assert.equal(brushed.edgeBaseSrc,null);assert.equal(brushed.edgeOffset,0);assert.equal((await readPixels(brushed.src,[[32,32]]))[0][3],0);
    await page.getByRole('button',{name:'Terminar retoque',exact:true}).click();
    await set('Definir borde',30);const final=await apply();assert.equal(final.edgeBaseSrc,brushed.src);assert.equal((await readPixels(final.src,[[32,32]]))[0][3],0);
    assert.ok(!requests.some(url=>url.endsWith('.onnx')),'edge tuning never runs the AI model');assert.deepEqual(errors,[]);
    console.log('PASS: edge expand/contract, smooth/define, draft/apply UX, noncumulative base, grouped undo/redo, exact reset, PNG alpha, saved settings/base and project reload, brush compatibility, no inference or external requests.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
