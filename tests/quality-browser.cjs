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
    await page.getByRole('button',{name:'Quitar fondo',exact:true}).waitFor();await saved();
    const original=(await readProject(page)).elements[0];
    const cut=async quality=>{
      await page.getByRole('radio',{name:quality==='quality'?'Mayor calidad':'Rápido',exact:true}).check();await saved();
      const start=Date.now();await page.getByRole('button',{name:'Quitar fondo',exact:true}).click();
      await page.locator('#background-status').waitFor({state:'visible'});
      await page.locator('#background-status').waitFor({state:'hidden',timeout:180000});await saved();
      const element=(await readProject(page)).elements[0];
      assert.equal(element.cutoutQuality,quality,'real inference completes in requested mode: '+logs.join('\n'));
      assert.equal(element.originalSrc,original.src);assert.equal(element.naturalWidth,770);
      const alpha=await pixels(element.src);assert.ok(alpha.transparent>100000);assert.ok(alpha.opaque>40000);assert.ok(alpha.center[3]>230);
      return {element,alpha,elapsedMs:Date.now()-start};
    };
    const fast=await cut('fast'),quality=await cut('quality');assert.notEqual(quality.element.src,fast.element.src);
    await fs.writeFile(path.join(out,'bear-quality.png'),Buffer.from(quality.element.src.split(',')[1],'base64'));
    await page.getByRole('button',{name:'Propiedades de la página',exact:true}).click();await page.getByRole('checkbox',{name:'Lienzo transparente',exact:true}).check();await saved();await page.getByRole('button',{name:/^Seleccionar/}).click();await openInspector(page,'background');
    await page.locator('.edge-details summary').click();
    await page.screenshot({path:path.join(out,'11-background-quality.png')});
    const switched=await cut('fast');assert.equal(switched.element.src,fast.element.src,'switching model sessions remains deterministic');
    // The large model can be cancelled without changing the current cutout.
    await page.getByRole('radio',{name:'Mayor calidad',exact:true}).check();await page.getByRole('button',{name:'Quitar fondo',exact:true}).click();
    await page.getByRole('button',{name:'Cancelar',exact:true}).click();await page.locator('#background-status').waitFor({state:'hidden'});
    assert.equal((await readProject(page)).elements[0].src,fast.element.src);
    assert.ok(network.some(url=>url.endsWith('/models/u2net.onnx')));assert.ok(network.some(url=>url.endsWith('/models/u2netp.onnx')));
    assert.ok(network.every(url=>isLocalRequest(url)));assert.deepEqual(errors,[]);
    const result={fastMs:fast.elapsedMs,qualityMs:quality.elapsedMs,fastAlpha:fast.alpha,qualityAlpha:quality.alpha,network:network.filter(url=>!url.startsWith('data:')&&!url.startsWith('blob:')),errors};
    await fs.writeFile(path.join(out,'quality-result.json'),JSON.stringify(result,null,2));
    console.log('PASS: real fast/full U2NET models, foreground and transparency, model switching/reuse, cancellation, preserved original and geometry, both modes entirely local.');console.log(JSON.stringify({fastMs:fast.elapsedMs,qualityMs:quality.elapsedMs}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
