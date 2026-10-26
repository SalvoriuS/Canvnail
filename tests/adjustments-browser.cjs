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
      const c=document.createElement('canvas'); c.width=320; c.height=180;
      const x=c.getContext('2d'); x.fillStyle='rgb(80,120,180)'; x.fillRect(0,0,320,180);
      x.clearRect(0,0,30,30); x.clearRect(40,0,30,30); x.fillStyle='rgba(180,80,40,.5)'; x.fillRect(40,0,30,30);
      return c.toDataURL();
    });
    const {blankDocument,newImage}=await import('../model.js');
    const doc=blankDocument(); doc.width=640; doc.height=360; doc.transparent=true;
    const image=newImage(doc,{src:fixture,name:'Ajustes de prueba',naturalWidth:320,naturalHeight:180},'adjustments-test');
    image.x=160; image.y=90; doc.elements.push(image);
    await page.locator('#project-file').setInputFiles({name:'adjustments.canvnail.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
    await page.locator('#artboard image').waitFor();
    await page.getByRole('button',{name:'Seleccionar Ajustes de prueba',exact:true}).click();
    const field=name=>page.getByRole('spinbutton',{name:name+' en porcentaje',exact:true});
    const set=async(name,value)=>{await field(name).fill(String(value));await field(name).press('Tab');await waitSaved();};
    const undo=()=>page.getByRole('button',{name:'Deshacer',exact:true}).click();
    const redo=()=>page.getByRole('button',{name:'Rehacer',exact:true}).click();
    await set('Brillo',140); await set('Contraste',125); await set('Saturación',65);
    await page.getByRole('combobox',{name:'Filtro de imagen',exact:true}).selectOption('sepia');
    await waitSaved(); let adjusted=(await state()).elements[0];
    assert.equal(adjusted.src,fixture,'adjustments do not alter source pixels');
    assert.equal(adjusted.brightness,140); assert.equal(adjusted.contrast,125); assert.equal(adjusted.saturation,65); assert.equal(adjusted.imageFilter,'sepia');
    await undo(); assert.equal((await state()).elements[0].imageFilter,'none');
    await redo(); assert.equal((await state()).elements[0].imageFilter,'sepia');
    // A continuous slider gesture is one history entry; synchronized number input follows it.
    await page.getByRole('slider',{name:'Brillo',exact:true}).evaluate(node=>{
      node.focus(); for(const value of [145,150,160]){node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));}
      node.dispatchEvent(new Event('change',{bubbles:true})); node.blur();
    });
    assert.equal(await field('Brillo').inputValue(),'160');
    await undo(); assert.equal((await state()).elements[0].brightness,140);
    await redo(); assert.equal((await state()).elements[0].brightness,160);
    adjusted=(await state()).elements[0];
    const reference=await page.evaluate(async src=>{
      const i=new Image();i.src=src;await i.decode();const c=document.createElement('canvas');c.width=320;c.height=180;
      const x=c.getContext('2d');x.filter='brightness(1.6) contrast(1.25) saturate(0.65) sepia(1)';x.drawImage(i,0,0);
      return [[100,90],[5,5],[50,10]].map(([a,b])=>Array.from(x.getImageData(a,b,1,1).data));
    },fixture);
    const exportImage=async(action,name)=>{const download=page.waitForEvent('download');await page.getByRole('button',{name:action,exact:true}).click();const file=path.join(out,name);await(await download).saveAs(file);return 'data:image/png;base64,'+(await fs.readFile(file)).toString('base64');};
    const standalone=await exportImage('Descargar esta imagen PNG','adjusted-image.png');
    const rendered=await readPixels(standalone,[[100,90],[5,5],[50,10]]);
    rendered.forEach((pixel,i)=>pixel.forEach((channel,c)=>assert.ok(Math.abs(channel-reference[i][c]) <= (c===3?0:3),'filter output matches independent canvas reference within browser rounding')));
    const composition=await exportImage('Exportar PNG','adjusted-canvas.png');
    assert.deepEqual(await readPixels(composition,[[260,180],[165,95],[210,100]]),rendered,'standalone and composition export identical colors and alpha');
    // All presets are applied in preview and reversible without baking pixel changes.
    for(const preset of ['grayscale','invert','none','sepia']){
      await page.getByRole('combobox',{name:'Filtro de imagen',exact:true}).selectOption(preset);
      assert.equal((await state()).elements[0].imageFilter,preset);
      assert.equal((await state()).elements[0].src,fixture);
    }
    await page.getByRole('button',{name:'Restablecer filtros y ajustes',exact:true}).click();
    const reset=(await state()).elements[0];assert.equal(reset.brightness,100);assert.equal(reset.contrast,100);assert.equal(reset.saturation,100);assert.equal(reset.imageFilter,'none');
    await undo(); assert.equal((await state()).elements[0].brightness,160);
    // Painting works on source pixels while the preview and exports retain adjustments.
    await openInspector(page,'background');
    await page.getByRole('button',{name:'Borrar con pincel',exact:true}).click();await waitBrush();
    await page.getByRole('spinbutton',{name:'Grosor del pincel en píxeles',exact:true}).fill('20');await clickPixel(100,90);
    const painted=(await state()).elements[0];assert.equal(painted.brightness,160);assert.equal(painted.imageFilter,'sepia');
    assert.equal((await readPixels(painted.src,[[100,90]]))[0][3],0);
    const paintingExport=await exportImage('Exportar PNG','adjusted-painting.png');
    assert.deepEqual(await readPixels(paintingExport,[[260,180],[300,200]]),[[0,0,0,0],rendered[0]]);
    await page.getByRole('button',{name:'Terminar retoque',exact:true}).click();
    await openInspector(page,'content');
    await page.getByRole('combobox',{name:'Filtro de imagen',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'09-image-adjustments.png')});
    const saving=page.waitForEvent('download');await page.getByRole('button',{name:'Guardar proyecto',exact:true}).click();
    const file=path.join(out,'adjusted.canvnail.json');await(await saving).saveAs(file);
    await page.reload();await page.locator('#artboard image').waitFor();assert.deepEqual((await state()).elements[0],painted);
    const fresh=await browser.newContext(),p=await fresh.newPage();await p.goto(baseURL);await p.locator('#project-file').setInputFiles(file);
    await p.locator('#artboard image').waitFor();await p.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('Guardado'));
    assert.deepEqual((await readProject(p)).elements[0],painted);
    await p.getByRole('button',{name:'Seleccionar Ajustes de prueba',exact:true}).click();await p.getByRole('button',{name:'Bloquear capa',exact:true}).click();
    assert.equal(await p.getByRole('slider',{name:'Brillo',exact:true}).isDisabled(),true);
    await fresh.close();assert.deepEqual(errors,[]);
    console.log('PASS: image adjustments and presets, source preservation, synchronized sliders, grouped undo/redo, reset, exact PNG colors/alpha in standalone and composition, active eraser compatibility, autosave/project reopening, locked layers.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
