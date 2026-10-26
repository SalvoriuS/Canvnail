const { chromium, launchOptions, baseURL, isLocalRequest } = require('./browser-runtime.cjs');
const { readProject, readWorkspace } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const out = path.join(__dirname, 'artifacts'); await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(() => {
    window.__pickerRequests=[]; window.__savedFiles=[]; window.__pickerMode='save';
    window.showSaveFilePicker=async options=>{
      window.__pickerRequests.push(options);
      if(window.__pickerMode==='cancel') throw new DOMException('Cancelled','AbortError');
      return { createWritable:async()=>({write:async blob=>{window.__savedFiles.push({name:options.suggestedName,type:blob.type,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))});},close:async()=>{},abort:async()=>{}})};
    };
  });
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
    const network=[];page.on('request',request=>network.push(request.url()));
    const fixture=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=50;const x=c.getContext('2d');x.fillStyle='#ee2222';x.fillRect(0,0,50,50);return c.toDataURL();});
    const {blankDocument,newImage}=await import('../model.js');const legacy=blankDocument();legacy.width=640;legacy.height=360;legacy.transparent=true;
    const image=newImage(legacy,{src:fixture,name:'Imagen primera página',naturalWidth:50,naturalHeight:50},'image');image.x=image.y=80;legacy.elements.push(image);
    await page.locator('#project-file').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});await page.locator('#artboard image').waitFor();await waitSaved();
    assert.equal((await readWorkspace(page)).version,3);assert.equal((await readWorkspace(page)).pages.length,1);
    const lastFile=()=>page.evaluate(()=>window.__savedFiles.at(-1));
    const exportFile=async format=>{await page.getByRole('combobox',{name:'Formato de exportación',exact:true}).selectOption(format);const count=await page.evaluate(()=>window.__savedFiles.length);await page.getByRole('button',{name:'Exportar '+format.toUpperCase(),exact:true}).click();await page.waitForFunction(n=>window.__savedFiles.length>n,count);return lastFile();};
    const png=await exportFile('png');assert.equal(png.type,'image/png');assert.equal(Buffer.from(png.bytes).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.deepEqual((await readPixels('data:image/png;base64,'+Buffer.from(png.bytes).toString('base64'),[[1,1],[100,100]])),[[0,0,0,0],[238,34,34,255]]);
    await page.getByRole('button',{name:'Seleccionar Imagen primera página',exact:true}).click();
    await page.getByRole('button',{name:'Descargar esta imagen PNG',exact:true}).click();
    await page.waitForFunction(()=>window.__savedFiles.at(-1)?.name.endsWith('-recorte.png'));
    assert.equal((await lastFile()).type,'image/png');
    const jpg=await exportFile('jpg');assert.equal(jpg.type,'image/jpeg');assert.equal(Buffer.from(jpg.bytes).subarray(0,2).toString('hex'),'ffd8');assert.ok(jpg.name.endsWith('.jpg'));
    const jpgPixels=await readPixels('data:image/jpeg;base64,'+Buffer.from(jpg.bytes).toString('base64'),[[1,1],[100,100]]);assert.deepEqual(jpgPixels[0],[255,255,255,255]);assert.ok(jpgPixels[1][0]>230&&jpgPixels[1][1]<45);
    await page.getByRole('combobox',{name:'Formato de la nueva página',exact:true}).selectOption('a4');await page.getByRole('button',{name:'Añadir página',exact:true}).click();await waitSaved();
    let workspace=await readWorkspace(page);assert.equal(workspace.pages.length,2);assert.equal(workspace.pages[1].width,2480);assert.equal(workspace.pages[1].height,3508);
    assert.equal(await page.locator('[data-page-margins]').count(),1);
    await page.getByRole('button',{name:'Añadir texto',exact:true}).first().click();await page.getByRole('textbox',{name:'Contenido del texto',exact:true}).fill('Mi trabajo de prueba\n\nIntroducción\nEste documento combina texto, imágenes y varias páginas.\nLos archivos se generan en mi propio equipo.');await page.getByRole('textbox',{name:'Contenido del texto',exact:true}).press('Tab');await waitSaved();
    const bodyText=(await state()).elements[0];assert.equal(bodyText.fontFamily,'Arial');assert.equal(bodyText.background,false);assert.equal(bodyText.outline,false);assert.equal(bodyText.fontSize,50);assert.equal(bodyText.x,236);
    await page.getByRole('button',{name:'Duplicar página',exact:true}).click();await waitSaved();workspace=await readWorkspace(page);assert.equal(workspace.pages.length,3);assert.notEqual(workspace.pages[1].elements[0].id,workspace.pages[2].elements[0].id);
    await page.getByRole('button',{name:'Eliminar página',exact:true}).click();await waitSaved();assert.equal((await readWorkspace(page)).pages.length,2);
    await page.getByRole('button',{name:'Deshacer',exact:true}).click();await waitSaved();assert.equal((await readWorkspace(page)).pages.length,3);
    await page.getByRole('button',{name:'Rehacer',exact:true}).click();await waitSaved();assert.equal((await readWorkspace(page)).pages.length,2);
    await page.getByRole('combobox',{name:'Formato de la nueva página',exact:true}).selectOption('a4-landscape');await page.getByRole('button',{name:'Añadir página',exact:true}).click();await waitSaved();
    await page.getByRole('button',{name:'Añadir texto',exact:true}).first().click();await page.getByRole('textbox',{name:'Contenido del texto',exact:true}).fill('Anexo en horizontal\n\nPágina A4 apaisada.');await page.getByRole('textbox',{name:'Contenido del texto',exact:true}).press('Tab');await waitSaved();
    await page.getByRole('tab',{name:'Página 1',exact:true}).click();await waitSaved();assert.equal(await page.locator('#artboard image').count(),1);assert.equal(await page.locator('#artboard text').count(),0);
    await page.getByRole('tab',{name:'Página 2',exact:true}).click();await waitSaved();assert.equal(await page.locator('#artboard image').count(),0);assert.equal(await page.locator('#artboard text').count(),1);
    const beforePDF=await readWorkspace(page),pdf=await exportFile('pdf');assert.equal(pdf.type,'application/pdf');assert.equal(Buffer.from(pdf.bytes).subarray(0,5).toString(),'%PDF-');
    const {PDFDocument}=require('pdf-lib');const parsed=await PDFDocument.load(Uint8Array.from(pdf.bytes));assert.equal(parsed.getPageCount(),3);
    const sizes=parsed.getPages().map(p=>p.getSize());assert.deepEqual(sizes[0],{width:480,height:270});assert.ok(Math.abs(sizes[1].width-595.27559)<.0001);assert.ok(Math.abs(sizes[1].height-841.88976)<.0001);assert.ok(sizes[2].width>sizes[2].height);
    assert.deepEqual(await readWorkspace(page),beforePDF,'export does not switch pages or alter editable content');
    await fs.writeFile(path.join(out,'multi-page-work.pdf'),Buffer.from(pdf.bytes));
    await page.screenshot({path:path.join(out,'13-pages-pdf-export.png')});
    await page.getByRole('button',{name:'Guardar proyecto',exact:true}).click();await page.waitForFunction(()=>window.__savedFiles.at(-1)?.type==='application/json');const saved=await lastFile(),savedDoc=JSON.parse(Buffer.from(saved.bytes).toString());assert.deepEqual(savedDoc,beforePDF);
    await fs.writeFile(path.join(out,'multi-page.canvnail.json'),Buffer.from(saved.bytes));
    const requests=await page.evaluate(()=>window.__pickerRequests);assert.ok(requests.every(r=>r.startIn==='downloads'));assert.ok(requests.some(r=>r.types[0].accept['application/pdf']?.[0]==='.pdf'));
    const count=await page.evaluate(()=>window.__savedFiles.length);await page.evaluate(()=>window.__pickerMode='cancel');await page.getByRole('button',{name:'Exportar PDF',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-action="export"]').disabled);assert.equal(await page.evaluate(()=>window.__savedFiles.length),count);assert.deepEqual(await readWorkspace(page),beforePDF);
    await page.reload();await page.locator('#artboard text').waitFor();await waitSaved();assert.deepEqual(await readWorkspace(page),beforePDF);
    const fresh=await browser.newContext({viewport:{width:1440,height:1000}}),p=await fresh.newPage();await p.goto(baseURL);await p.locator('#project-file').setInputFiles(path.join(out,'multi-page.canvnail.json'));await p.locator('#artboard text').waitFor();await p.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('Guardado'));assert.deepEqual(await readWorkspace(p),beforePDF);await fresh.close();
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'14-pages-mobile.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    assert.ok(network.every(url=>isLocalRequest(url)),'all export resources stay local');
    assert.deepEqual(errors,[]);console.log('PASS: PNG alpha, JPG white background, three-page PDF/A4 physical dimensions, native save target/Downloads/types/cancellation, page isolation/duplication/deletion/undo, A4 writing defaults, full-project migration/reload/import, unchanged active page on export, mobile layout.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
