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
    const fixture=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=120;c.height=80;const x=c.getContext('2d');x.fillStyle='#4488dd';x.fillRect(0,0,120,80);return c.toDataURL();});
    const {blankDocument,newImage,newText}=await import('../model.js');const doc=blankDocument();doc.transparent=true;
    const image=newImage(doc,{src:fixture,name:'Imagen',naturalWidth:120,naturalHeight:80},'image');Object.assign(image,{x:120,y:180,width:160,height:100,rotation:-15});
    const text=newText(doc,'text');Object.assign(text,{x:450,y:210,width:240,fontSize:50,text:'Texto',rotation:20});
    const drawing=newImage(doc,{src:fixture,name:'Dibujo',naturalWidth:120,naturalHeight:80},'drawing');Object.assign(drawing,{x:800,y:450,width:140,height:100,drawing:true,rotation:25});
    const locked=newImage(doc,{src:fixture,name:'Bloqueada',naturalWidth:120,naturalHeight:80},'locked');Object.assign(locked,{x:1100,y:100,width:70,height:70,locked:true});
    const hidden=newText(doc,'hidden');hidden.visible=false;hidden.text='Oculta';doc.elements.push(image,text,drawing,locked,hidden);
    await page.locator('#project-file').setInputFiles({name:'groups.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});await page.locator('#artboard image').first().waitFor();await waitSaved();
    const elements=async()=> (await state()).elements;
    const select=async(name,modifiers=[])=>page.getByRole('button',{name:'Seleccionar '+name,exact:true}).click({modifiers});
    const screen=async(x,y)=>{const b=await page.locator('#artboard').boundingBox();return{x:b.x+x/1280*b.width,y:b.y+y/720*b.height};};
    const drag=async(a,b,cancel=false)=>{await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});if(cancel)await page.keyboard.press('Escape');await page.mouse.up();await waitSaved();};
    await select('Imagen');await select('Texto',['Shift']);assert.equal(await page.locator('.layer-row.active').count(),2);assert.equal(await page.locator('[data-multi-handle]').count(),4);
    // Move an ungrouped selection as one history operation.
    let before=await elements(),p=await screen(200,230);await page.keyboard.down('Alt');await drag(p,{x:p.x+30,y:p.y+20});await page.keyboard.up('Alt');
    let moved=await elements(),dx=moved[0].x-before[0].x,dy=moved[0].y-before[0].y;assert.ok(dx>0&&dy>0);assert.ok(Math.abs(moved[1].x-before[1].x-dx)<.001);assert.deepEqual(moved[2],before[2]);
    await page.getByRole('button',{name:'Deshacer',exact:true}).click();await waitSaved();assert.deepEqual(await elements(),before);await page.getByRole('button',{name:'Rehacer',exact:true}).click();await waitSaved();
    await page.getByRole('button',{name:'Agrupar',exact:true}).click();await waitSaved();let grouped=await elements();assert.ok(grouped[0].groupId);assert.equal(grouped[0].groupId,grouped[1].groupId);
    await page.keyboard.press('Escape');await select('Imagen');assert.equal(await page.locator('.layer-row.active').count(),2,'one click selects saved group');
    // Uniform resize scales all members, fonts and effects without changing their rotations.
    const box=await page.locator('[data-multi-selection]>rect').first().getAttribute('width'),handle=await page.locator('[data-multi-handle="se"]').boundingBox();
    const h=Number(await page.locator('[data-multi-selection]>rect').first().getAttribute('height')),board=await page.locator('#artboard').boundingBox();
    const start={x:handle.x+handle.width/2,y:handle.y+handle.height/2};before=await elements();await drag(start,{x:start.x+Number(box)*.2/1280*board.width,y:start.y+h*.2/720*board.height});
    let scaled=await elements();assert.ok(Math.abs(scaled[0].width/before[0].width-1.2)<.005);assert.ok(Math.abs(scaled[1].fontSize/before[1].fontSize-1.2)<.005);assert.ok(Math.abs(scaled[1].strokeWidth/before[1].strokeWidth-1.2)<.005);assert.equal(scaled[0].rotation,before[0].rotation);assert.equal(scaled[1].rotation,before[1].rotation);
    await page.getByRole('button',{name:'Deshacer',exact:true}).click();await waitSaved();assert.deepEqual(await elements(),before);await page.getByRole('button',{name:'Rehacer',exact:true}).click();await waitSaved();
    before=await elements();const anchor=await page.locator('[data-multi-handle="se"]').boundingBox();await drag({x:anchor.x+anchor.width/2,y:anchor.y+anchor.height/2},{x:anchor.x+70,y:anchor.y+50},true);assert.deepEqual(await elements(),before);
    await select('Dibujo',['Control']);assert.equal(await page.locator('.layer-row.active').count(),3);await page.keyboard.press('Control+g');await waitSaved();grouped=await elements();assert.equal(grouped[0].groupId,grouped[2].groupId);
    // Numeric group translation and keyboard movement preserve relative offsets.
    const field=page.getByRole('spinbutton',{name:'X de la selección',exact:true});const oldX=Number(await field.inputValue());await field.fill(String(oldX+10));await field.press('Tab');await waitSaved();
    const translated=await elements();assert.ok(translated[0].x>grouped[0].x+9);await page.locator('#viewport').focus();await page.keyboard.press('ArrowRight');await waitSaved();assert.ok(Math.abs((await elements())[0].x-translated[0].x-1)<.001);
    await page.screenshot({path:path.join(out,'16-groups.png')});
    const saved=await state(),saving=page.waitForEvent('download');await page.getByRole('button',{name:'Guardar proyecto',exact:true}).click();const file=path.join(out,'groups.canvnail.json');await(await saving).saveAs(file);
    await page.reload();await page.locator('#artboard image').first().waitFor();assert.deepEqual(await state(),saved);await select('Imagen');assert.equal(await page.locator('.layer-row.active').count(),3);
    const member=(await elements())[0],memberPoint=await screen(member.x+member.width/2,member.y+member.height/2);
    await page.mouse.dblclick(memberPoint.x,memberPoint.y);assert.equal(await page.locator('.layer-row.active').count(),1);assert.equal(await page.getByRole('textbox',{name:'Nombre de la imagen',exact:true}).count(),1);assert.ok((await elements())[0].groupId);
    await select('Imagen');assert.equal(await page.locator('.layer-row.active').count(),3);
    // Locked members block transforming the whole selection instead of moving only part.
    await page.locator('[data-layer-id="text"] [data-layer-action="locked"]').click();assert.equal(await page.locator('[data-multi-handle]').count(),0);assert.equal(await page.getByRole('spinbutton',{name:'Ancho de la selección',exact:true}).isDisabled(),true);await page.locator('[data-layer-id="text"] [data-layer-action="locked"]').click();
    await page.keyboard.press('Control+Shift+g');await waitSaved();assert.ok((await elements()).slice(0,3).every(e=>e.groupId===null));
    await page.getByRole('button',{name:'Deshacer',exact:true}).click();await waitSaved();assert.ok((await elements())[0].groupId);
    // Duplicating a group creates a separate group and preserves membership; delete removes it atomically.
    await page.getByRole('button',{name:'Duplicar selección',exact:true}).click();await waitSaved();let copies=await elements();assert.equal(copies.length,8);assert.notEqual(copies[5].groupId,copies[0].groupId);assert.equal(copies[5].groupId,copies[7].groupId);
    await page.getByRole('button',{name:'Eliminar selección',exact:true}).click();await waitSaved();assert.equal((await elements()).length,5);
    // Marquee selects visible editable members and expands their groups; Escape cancels marquee.
    await page.keyboard.press('Escape');const a=await screen(60,120),b=await screen(750,410);await drag(a,b);assert.equal(await page.locator('.layer-row.active').count(),3);assert.equal(await page.locator('[data-layer-id="locked"].active').count(),0);assert.equal(await page.locator('[data-layer-id="hidden"].active').count(),0);
    await page.getByRole('button',{name:'Desagrupar',exact:true}).click();await waitSaved();await page.keyboard.press('Escape');await drag(await screen(60,120),await screen(750,410));assert.equal(await page.locator('.layer-row.active').count(),2);
    const selectedBefore=await page.locator('.layer-row.active').count();await drag(await screen(50,50),await screen(1250,700),true);assert.equal(await page.locator('.layer-row.active').count(),selectedBefore);
    const fresh=await browser.newContext(),p2=await fresh.newPage();await p2.goto(baseURL);await p2.locator('#project-file').setInputFiles(file);await p2.locator('#artboard image').first().waitFor();await p2.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('Guardado'));assert.deepEqual(await readProject(p2),saved);await p2.getByRole('button',{name:'Seleccionar Imagen',exact:true}).click();assert.equal(await p2.locator('.layer-row.active').count(),3);await fresh.close();
    assert.deepEqual(errors,[]);console.log('PASS: Shift/Ctrl selection, marquee and cancellation, grouping/ungrouping shortcuts, atomic group movement/resize/numeric transforms/undo/redo, rotated members and text effects, locked/hidden rules, independent group duplication/deletion, saved group membership/reload/import.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
