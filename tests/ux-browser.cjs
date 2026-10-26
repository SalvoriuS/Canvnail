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
    await page.screenshot({path:path.join(out,'17-ux-empty.png')});
    assert.equal(await page.getByRole('tab',{name:'Añadir',exact:true}).getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#tool-draw').isVisible(),false);
    const {blankDocument,newText,newImage}=await import('../model.js');const doc=blankDocument();
    const photo=await require('./browser-runtime.cjs').fixtureImage(page);
    const cutout=await require('./browser-runtime.cjs').fixtureImage(page, true);
    const image=newImage(doc,{src:cutout,name:'Osito',naturalWidth:770,naturalHeight:595},'photo');Object.assign(image,{x:80,y:180,width:620,height:479,originalSrc:photo,cutoutQuality:'fast'});
    const text=newText(doc,'text');Object.assign(text,{text:'Mi próximo diseño',x:350,y:60,width:730,fontSize:65});
    const src=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=100;const x=c.getContext('2d');x.strokeStyle='#6b5ce7';x.lineWidth=12;x.lineCap='round';x.beginPath();x.moveTo(10,50);x.lineTo(170,50);x.lineTo(135,20);x.moveTo(170,50);x.lineTo(135,80);x.stroke();return c.toDataURL();});
    const drawing=newImage(doc,{src,name:'Flecha dibujada',naturalWidth:200,naturalHeight:100},'draw');Object.assign(drawing,{x:800,y:410,width:300,height:150,drawing:true});doc.elements.push(image,text,drawing);
    await page.locator('#project-file').setInputFiles({name:'ux.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});await page.locator('#artboard image').first().waitFor();await waitSaved();
    const select=async name=>page.getByRole('button',{name:'Seleccionar '+name,exact:true}).click();
    const pane=async name=>page.locator('#inspector').getByRole('tab',{name,exact:true}).click();
    await select('Osito');assert.equal(await page.getByRole('slider',{name:'Brillo',exact:true}).isVisible(),true);assert.equal(await page.getByRole('button',{name:'Quitar fondo',exact:true}).isVisible(),false);
    assert.equal(await page.getByRole('checkbox',{name:'Lienzo transparente',exact:true}).count(),0,'page transparency is no longer mixed into image properties');
    await page.screenshot({path:path.join(out,'18-ux-image.png')});
    await pane('Fondo');assert.equal(await page.getByRole('radio',{name:'Mayor calidad',exact:true}).isVisible(),true);assert.equal(await page.getByRole('slider',{name:'Brillo',exact:true}).isVisible(),false);
    await page.getByRole('button',{name:'Restaurar con pincel',exact:true}).click();await page.locator('[data-restore-surface] canvas').waitFor();
    await pane('Posición');assert.equal(await page.locator('[data-restore-surface]').count(),0);assert.equal(await page.locator('[data-handle]').count(),8);assert.equal(await page.locator('#retouch-toolbar').isVisible(),false);
    const angle=page.getByRole('spinbutton',{name:'Ángulo de giro',exact:true});await angle.fill('10');await angle.press('Tab');await waitSaved();
    await pane('Ajustes');const brightness=page.getByRole('spinbutton',{name:'Brillo en porcentaje',exact:true});await brightness.fill('110');await brightness.press('Tab');await waitSaved();
    await pane('Fondo');await pane('Ajustes');assert.equal(await brightness.inputValue(),'110');
    // Keyboard navigation switches contextual tabs without moving the selected element.
    const before=await state();await page.locator('#inspector').getByRole('tab',{name:'Ajustes',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#inspector').getByRole('tab',{name:'Fondo',exact:true}).getAttribute('aria-selected'),'true');assert.deepEqual(await state(),before);
    await select('Mi próximo diseño');await pane('Efectos');assert.equal(await page.getByRole('checkbox',{name:'Activar contorno',exact:true}).isVisible(),true);assert.equal(await page.getByRole('textbox',{name:'Contenido del texto',exact:true}).isVisible(),false);await pane('Texto');assert.equal(await page.getByRole('textbox',{name:'Contenido del texto',exact:true}).isVisible(),true);
    await page.screenshot({path:path.join(out,'19-ux-text.png')});
    await page.getByRole('tab',{name:'Dibujar',exact:true}).click();assert.equal(await page.locator('#tool-draw [data-draw-tool]').count(),7);assert.equal(await page.locator('#tool-add').isVisible(),false);
    await select('Flecha dibujada');await page.getByRole('button',{name:'Continuar dibujando',exact:true}).click();await page.locator('[data-drawing-surface] canvas').waitFor();
    const layersBox=await page.locator('.layers-workspace').boundingBox();assert.ok(layersBox.height>=120&&layersBox.y+layersBox.height<=1000,'layers stay on screen while drawing');
    await page.screenshot({path:path.join(out,'20-ux-drawing.png')});
    await page.getByRole('tab',{name:'Añadir',exact:true}).click();assert.equal(await page.locator('[data-drawing-surface]').count(),0);assert.equal(await page.locator('#retouch-toolbar').isVisible(),false);
    await page.getByRole('button',{name:'Atajos',exact:false}).click();assert.equal(await page.locator('#shortcuts-dialog').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#shortcuts-dialog').isVisible(),false);
    await page.getByRole('combobox',{name:'Formato de exportación',exact:true}).selectOption('pdf');assert.ok((await page.locator('#export-scope').textContent()).includes('Todas las páginas'));await page.getByRole('combobox',{name:'Formato de exportación',exact:true}).selectOption('jpg');assert.ok((await page.locator('#export-scope').textContent()).includes('sin transparencia'));
    await page.getByRole('button',{name:'Propiedades de la página',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Nuevo proyecto',exact:true}).isVisible(),true);assert.equal(await page.getByRole('checkbox',{name:'Lienzo transparente',exact:true}).isVisible(),true);
    await page.setViewportSize({width:1366,height:768});await select('Osito');await pane('Ajustes');await page.screenshot({path:path.join(out,'21-ux-laptop.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const laptopLayers=await page.locator('.layers-workspace').boundingBox();assert.ok(laptopLayers.height>=120&&laptopLayers.y+laptopLayers.height<=768);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'22-ux-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.getByRole('tab',{name:'Añadir',exact:true}).waitFor({state:'visible'});await page.locator('#inspector').getByRole('tab',{name:'Ajustes',exact:true}).waitFor({state:'visible'});
    assert.deepEqual(errors,[]);console.log('PASS: purposeful tool tabs, persistent layers, contextual image/text/drawing panels, field values across panels, safe mode exit, keyboard tabs/help, export scope, page-only transparency, desktop/laptop/mobile layout, no page errors.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
