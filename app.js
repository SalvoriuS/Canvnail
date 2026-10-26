import { translateElements, expandSelection, normalizeGroups, selectionBounds, scaleElements, normalizeAngle, rotateVector, worldToLocal, rotatedBounds, positionRotatedResize, PAGE_FORMATS, pageFormat, newPage, blankWorkspace, parseWorkspace, activePage, IMAGE_FILTERS, imageFilterCSS, FONTS, newText, newImage, textLayout, resizeText, resizeImage, snapToCanvas, moveLayer, clone, clamp, uid } from './model.js';
import { readDocument, writeDocument } from './storage.js';
import { importImage, verifyProjectImages } from './media.js';
import { removeBackground, refineEdges, cancelBackground } from './background.js';
import { createRestoreBrush } from './restore-brush.js';
import { DRAW_TOOLS, createDrawingSurface } from './drawing.js';
import { EXPORT_FORMATS, chooseSaveTarget, saveBlob, buildPDF } from './exports.js';

const $ = selector => document.querySelector(selector);
const icons = {
  text: '<path d="M4 5h16M12 5v15M8 20h8"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  undo: '<path d="m9 5-5 5 5 5M4 10h10a6 6 0 0 1 6 6v3"/>',
  redo: '<path d="m15 5 5 5-5 5M20 10H10a6 6 0 0 0-6 6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  hidden: '<path d="m3 3 18 18M10 5c7-1 12 7 12 7s-1 2-4 4M6 6c-3 2-4 6-4 6s4 7 10 7c2 0 3 0 5-1"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-3M12 14v3"/>',
  up: '<path d="m6 14 6-6 6 6"/>', down: '<path d="m6 10 6 6 6-6"/>',
  save: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  folder: '<path d="M3 7V4h7l2 3h9v13H3V7Z"/>',
  fit: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
  left: '<path d="M4 5h16M4 10h10M4 15h16M4 20h10"/>',
  center: '<path d="M4 5h16M7 10h10M4 15h16M7 20h10"/>',
  right: '<path d="M4 5h16M10 10h10M4 15h16M10 20h10"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  arrow: '<path d="m5 3 14 10-7 1-3 7-4-18Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="2"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  paste: '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="8" y="2" width="8" height="5" rx="1"/><path d="M9 12h6M9 16h6"/>',
  magnet: '<path d="M5 3v9a7 7 0 0 0 14 0V3h-4v9a3 3 0 0 1-6 0V3H5ZM5 7h4M15 7h4"/>',
};
const icon = name => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.text}</svg>`;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const round = value => Math.round(value * 10) / 10;
let project = blankWorkspace(), doc = activePage(project), selectedId = null, selectedIds = new Set(), past = [], future = [], zoom = 0.5, fitMode = true;
let lastCanvasClick = null;
let inlineEdit = null;
let gesture = null, editingSnapshot = null, draggedLayer = null, saveTimer, toastTimer;
let magnetic = true, guides = [], importing = false, importGeneration = 0, revision = 0;
let backgroundJob = null, edgeDraft = null, edgePanelOpen = false;
let restoreMode = null, brushStroke = null, brushSize = 60, brushCursor = null;
let drawingMode = null, drawingStroke = null, drawingColor = '#202c45', drawingSize = 12, drawingFilled = false;
let exportFormat = 'png', exporting = false;
let toolPane = 'add', inspectorKind = 'page', inspectorPanes = { image: 'content', text: 'content', drawing: 'content' };
let storageAvailable = true;
try {
  const saved = await readDocument();
  const legacy = !saved && localStorage.getItem('trazo.document.v1');
  if (saved || legacy) { project = parseWorkspace(saved || JSON.parse(legacy)); doc = activePage(project); await verifyProjectImages(project); }
} catch { storageAvailable = false; }
const measureCanvas = document.createElement('canvas');
const measureContext = measureCanvas.getContext('2d');
function layout(element) {
  if (element.type === 'image') return { height: element.height };
  measureContext.font = `${element.italic ? 'italic ' : ''}${element.bold ? '700 ' : '400 '}${element.fontSize}px "${element.fontFamily}"`;
  return textLayout(element, text => measureContext.measureText(text).width);
}
const selectedElements = () => doc.elements.filter(element => selectedIds.has(element.id));
const selected = () => selectedIds.size === 1 ? doc.elements.find(element => element.id === selectedId) : undefined;
const selectionBox = elements => selectionBounds(elements, element => layout(element).height);
const canTransformSelection = () => selectedElements().length > 0 && selectedElements().every(element => element.visible && !element.locked);
function setSelection(ids) { selectedIds = new Set(ids); selectedId = [...selectedIds][0] || null; }
const isEditable = target => target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"]');

$('#app').innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="Canvnail, editor local"><span class="brand-mark">${icon('image')}</span><span>Canvnail<span class="brand-dot">.</span></span></a>
    <span class="top-divider"></span>
    <div class="project-meta"><input id="project-name" aria-label="Nombre del proyecto" maxlength="120"><span id="save-state">${icon('check')} Guardado en este navegador</span></div>
    <div class="file-actions"><button class="button quiet" data-action="open">${icon('folder')}<span>Abrir</span></button><button class="button quiet" data-action="save" title="Guardar el proyecto editable, con todas sus páginas">${icon('save')}<span>Guardar proyecto</span></button><div class="export-controls"><div class="export-buttons"><label class="export-format"><span class="sr-only">Formato de exportación</span><select id="export-format" aria-label="Formato de exportación"><option value="png">PNG</option><option value="jpg">JPG</option><option value="pdf">PDF</option></select></label><button class="button primary" data-action="export">Exportar PNG ${icon('save')}</button></div><button id="export-scope" data-action="deselect" aria-label="Propiedades del fondo y de la página" title="Cambiar el fondo en Propiedades de la página">Página actual · fondo de la página</button></div></div>
  </header>
  <main class="editor-shell">
    <aside class="left-panel" aria-label="Herramientas y capas"><nav class="tool-tabs" role="tablist" aria-label="Herramientas"><button role="tab" id="tool-tab-add" aria-controls="tool-add" data-tool-pane="add" aria-selected="true">Añadir</button><button role="tab" id="tool-tab-draw" aria-controls="tool-draw" data-tool-pane="draw" aria-selected="false">Dibujar</button></nav>
      <div id="tool-add" class="create-panel" role="tabpanel" aria-labelledby="tool-tab-add"><div class="eyebrow">AÑADIR AL DISEÑO</div><button class="add-text" data-action="add">${icon('text')}<span>Añadir texto</span><kbd>T</kbd></button><div class="media-actions"><button class="button outlined" data-action="upload">${icon('image')} Subir imágenes</button><button class="button quiet" data-action="paste" title="También puedes pegar una imagen con Ctrl+V">${icon('paste')} Pegar imagen</button></div><p class="paste-hint">También puedes pegar con <kbd>Ctrl+V</kbd></p></div>
      <div id="tool-draw" class="drawing-panel" role="tabpanel" aria-labelledby="tool-tab-draw" hidden><h3>Herramientas de dibujo</h3><p id="drawing-target" class="drawing-target"></p><button class="button outlined full-width" data-action="new-drawing">Nueva capa de dibujo</button><div class="drawing-tools">${Object.entries(DRAW_TOOLS).map(([tool,label]) => `<button class="button quiet" data-draw-tool="${tool}" aria-pressed="false">${label}</button>`).join('')}</div><label class="drawing-color">Color <input type="color" id="drawing-color" aria-label="Color del dibujo" value="${drawingColor}"></label><label class="field"><span>Grosor del dibujo</span><span class="brush-size-controls"><input type="range" data-drawing-size aria-label="Grosor del dibujo" min="1" max="200" value="${drawingSize}"><input type="number" data-drawing-size aria-label="Grosor del dibujo en píxeles" min="1" max="200" value="${drawingSize}"><span>px</span></span></label><label class="drawing-filled"><input type="checkbox" id="drawing-filled"> Rellenar formas</label><p class="field-help">Pinta en la capa seleccionada. Shift: formas regulares. Esc: volver a seleccionar.</p></div>
      <div class="layers-workspace"><div class="panel-heading"><h2>${icon('layers')} Capas <span id="layer-count">0</span></h2><div class="layer-order"><button class="icon-button" data-action="up" title="Adelantar capa" aria-label="Adelantar capa">${icon('up')}</button><button class="icon-button" data-action="down" title="Atrasar capa" aria-label="Atrasar capa">${icon('down')}</button></div></div>
      <div class="layer-tip">La primera capa queda por encima. Shift + clic añade a la selección.</div>
      <div id="layer-list" role="list" aria-label="Capas del proyecto"></div>
      </div><button class="canvas-layer" data-action="deselect" aria-label="Propiedades de la página"><span class="paper-swatch" id="paper-swatch"></span><span>Página<small id="canvas-size"></small></span>${icon('fit')}</button>
      <div class="left-bottom"><span>Solo en tu equipo</span><button class="button quiet" data-action="shortcuts">Atajos <kbd>?</kbd></button></div>
    </aside>
    <section class="workbench" aria-label="Área de trabajo">
      <div class="workbench-toolbar"><div class="history-actions"><button class="icon-button" data-action="undo" aria-label="Deshacer" title="Deshacer · Ctrl+Z">${icon('undo')}</button><button class="icon-button" data-action="redo" aria-label="Rehacer" title="Rehacer · Ctrl+Shift+Z">${icon('redo')}</button><span class="toolbar-divider"></span><button class="button quiet clear-canvas-button" data-action="clear-canvas" aria-label="Limpiar lienzo" title="Limpiar todos los elementos de esta página · se puede deshacer">${icon('trash')}<span>Limpiar</span></button><span id="format-label">Miniatura de YouTube</span></div><div class="zoom-actions"><button class="magnet-button active" data-action="magnet" aria-label="Ajuste magnético" aria-pressed="true" title="Ajustar a los bordes y al centro al mover · Alt para desactivar temporalmente">${icon('magnet')}<span>Imán</span></button><button class="icon-button" data-action="zoom-out" aria-label="Alejar">${icon('minus')}</button><button id="zoom-label" class="zoom-label" data-action="fit" title="Ajustar lienzo a la pantalla">50 %</button><button class="icon-button" data-action="zoom-in" aria-label="Acercar">${icon('plus')}</button><button class="icon-button" data-action="fit" aria-label="Ajustar a pantalla" title="Ajustar a pantalla">${icon('fit')}</button></div></div>
      <div id="retouch-toolbar" class="retouch-toolbar" hidden role="region" aria-label="Retoque de imagen"><span id="retouch-label"></span><button class="button outlined" data-action="finish-retouch">Terminar retoque</button><small>Esc · o haz clic fuera de la capa</small></div>
      <div id="viewport" tabindex="0" aria-label="Lienzo de diseño">
        <div id="artboard-wrap"><div class="artboard-caption"><span>PÁGINA <span id="dimensions-label"></span></span><span id="artboard-name">Canvnail</span></div><svg id="artboard" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Diseño editable"></svg><div id="empty-canvas"><div class="empty-cross">${icon('plus')}</div><h1>Tu página está vacía</h1><p>Empieza con texto, imágenes o dibujo.</p><button class="button quiet" data-action="add">Añadir texto ${icon('plus')}</button></div></div>
      </div>
      <nav id="pagebar" class="pagebar" aria-label="Páginas del proyecto"><div id="page-tabs" class="page-tabs" role="tablist" aria-label="Páginas"></div><div class="page-actions"><select id="new-page-format" aria-label="Formato de la nueva página"><option value="same">Mismo tamaño</option>${Object.entries(PAGE_FORMATS).map(([key,value]) => `<option value="${key}">${value.label}</option>`).join('')}</select><button class="button quiet add-page-button" data-action="add-page" aria-label="Añadir página" title="Añadir página">${icon('plus')}<span>Añadir página</span></button><button class="icon-button" data-action="duplicate-page" aria-label="Duplicar página" title="Duplicar página">${icon('duplicate')}</button><button class="icon-button danger" data-action="delete-page" aria-label="Eliminar página" title="Eliminar página">${icon('trash')}</button></div></nav>
      <footer class="workbench-footer"><span id="selection-status">Lienzo en blanco</span><span><kbd>Alt</kbd> sin imán <span class="footer-dot">·</span> <kbd>Supr</kbd> eliminar <span class="footer-dot">·</span> <kbd>Shift + ↑ ↓ ← →</kbd> mover 10 px</span></footer>
    </section>
    <aside id="inspector" class="right-panel" aria-label="Propiedades"></aside>
  </main>
  <dialog id="new-dialog"><form method="dialog"><span class="eyebrow">EMPEZAR DE NUEVO</span><h2>¿Crear un nuevo proyecto?</h2><p>Empezarás con una página en blanco. Guarda el proyecto actual si quieres conservar una copia; también podrás recuperarlo con Deshacer.</p><div class="dialog-actions"><button class="button quiet" value="cancel">Cancelar</button><button class="button primary" value="create">Crear proyecto</button></div></form></dialog>
  <dialog id="shortcuts-dialog"><form method="dialog"><span class="eyebrow">CANVNAIL · AYUDA RÁPIDA</span><h2>Lo esencial, a mano</h2><dl class="shortcuts-list"><div><dt>Editar texto en el lienzo</dt><dd>Doble clic · Ctrl+Enter: terminar · Esc: cancelar</dd></div><div><dt>Seleccionar varios</dt><dd>Shift / Ctrl + clic, o arrastra desde una zona vacía</dd></div><div><dt>Agrupar / separar</dt><dd>Ctrl+G / Ctrl+Shift+G</dd></div><div><dt>Deshacer / rehacer</dt><dd>Ctrl+Z / Ctrl+Shift+Z</dd></div><div><dt>Salir del dibujo o retoque</dt><dd>Escape o Terminar retoque</dd></div><div><dt>Movimiento preciso</dt><dd>Flechas: 1 px · Shift: 10 px · Alt: sin imán</dd></div><div><dt>Giro preciso</dt><dd>Shift al girar: pasos de 15°</dd></div><div><dt>Guardar el proyecto editable</dt><dd>Ctrl+S · Exportar genera PNG, JPG o PDF</dd></div></dl><div class="dialog-actions"><button class="button primary">Entendido</button></div></form></dialog>`;
const imageInput = document.createElement('input');
imageInput.id = 'image-file'; imageInput.type = 'file'; imageInput.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif'; imageInput.multiple = true; imageInput.hidden = true; document.body.append(imageInput);
const processingStatus = document.createElement('div');
processingStatus.id = 'background-status'; processingStatus.hidden = true; processingStatus.setAttribute('role', 'status');
processingStatus.innerHTML = `<span class="processing-spinner" aria-hidden="true"></span><span><strong id="background-title">Quitando el fondo</strong><small id="background-phase">Preparando la imagen…</small></span><button class="button quiet" data-action="cancel-background">Cancelar</button>`;
document.body.append(processingStatus);

function notify(message) {
  $('#toast').textContent = message; $('#toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3200);
}
function markDirty() {
  revision++;
  $('#save-state').innerHTML = 'Guardando…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 350);
}
async function persist() {
  const savingRevision = revision;
  try { await writeDocument(clone(project)); storageAvailable = true; } catch { storageAvailable = false; }
  if (revision === savingRevision) $('#save-state').innerHTML = storageAvailable ? `${icon('check')} Guardado en este navegador` : 'Usa Guardar proyecto para conservarlo';
}
function remember(before) {
  if (JSON.stringify(before) === JSON.stringify(project)) return;
  past.push(before); if (past.length > 80) past.shift(); future = []; markDirty();
  $('[data-action="undo"]').disabled = false;
  $('[data-action="redo"]').disabled = true;
}
function change(operation) {
  stopDrawingMode();
  stopRestoreMode();
  finishEditing();
  const before = clone(project); operation(); normalizeGroups(doc.elements); remember(before); render();
}
function finishEditing() {
  if (inlineEdit) finishInlineEdit();
  if (editingSnapshot) { remember(editingSnapshot); editingSnapshot = null; }
}
function choose(id, toggle = false, individual = false) {
  lastCanvasClick = null;
  edgeDraft = null; stopDrawingMode(); stopRestoreMode(); finishEditing();
  if (!id) setSelection([]);
  else {
    const ids = individual ? [id] : expandSelection(doc.elements, [id]);
    if (toggle) {
      const remove = ids.every(value => selectedIds.has(value)), next = new Set(selectedIds);
      ids.forEach(value => remove ? next.delete(value) : next.add(value)); setSelection([...next]);
    } else setSelection(ids);
  }
  render();
}

function editIndividual(id) {
  if (inlineEdit?.id === id) { inlineEdit.input.focus(); return; }
  inspectorPanes.image = inspectorPanes.text = inspectorPanes.drawing = 'content';
  choose(id, false, true);
  const element = selected(); if (!element || element.locked) return;
  if (element.type === 'text') { startInlineEdit(element); return; }
  const field = element.type === 'text' ? $('#text-content') : $('[data-prop="name"]');
  field?.focus(); field?.select();
}
function startInlineEdit(element) {
  if (element.type !== 'text' || element.locked || !element.visible) return;
  const layer = document.createElement('div'); layer.className = 'inline-text-layer'; layer.dataset.inlineEditor = 'true';
  const input = document.createElement('textarea'); input.className = 'inline-text-input'; input.setAttribute('aria-label', 'Editar texto en el lienzo');
  input.setAttribute('spellcheck', 'false'); input.setAttribute('maxlength', '20000'); input.value = element.text;
  layer.append(input); $('#artboard-wrap').append(layer);
  const toolbar = document.createElement('div'); toolbar.className = 'inline-text-actions'; toolbar.dataset.inlineEditor = 'true';
  toolbar.innerHTML = '<span>Editando texto</span><button class="button outlined">Terminar edición</button><small>Ctrl+Enter · Esc cancela</small>';
  $('#viewport').append(toolbar);
  toolbar.querySelector('button').addEventListener('pointerdown', event => event.preventDefault());
  toolbar.querySelector('button').addEventListener('click', () => { finishInlineEdit(); $('#viewport').focus({ preventScroll: true }); });
  inlineEdit = { id: element.id, originalText: element.text, before: clone(project), input, layer, toolbar };
  input.addEventListener('input', () => {
    if (inlineEdit?.input !== input) return;
    const current = doc.elements.find(e => e.id === inlineEdit.id); if (!current) return;
    current.text = input.value;
    const field = $('#text-content'); if (field) field.value = current.text;
    markDirty(); renderScene(); renderLayers();
  });
  input.addEventListener('blur', () => { if (inlineEdit?.input === input) finishInlineEdit(); });
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape' || (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation(); finishInlineEdit(event.key === 'Escape'); $('#viewport').focus({ preventScroll: true });
    }
  });
  renderScene(); updateInlineEdit(); input.focus({ preventScroll: true }); input.select();
}
function updateInlineEdit() {
  if (!inlineEdit) return;
  const element = doc.elements.find(e => e.id === inlineEdit.id); if (!element) return;
  const metrics = layout(element), fontMetrics = measureContext.measureText('Mg');
  const ascent = fontMetrics.fontBoundingBoxAscent ?? element.fontSize * .8, descent = fontMetrics.fontBoundingBoxDescent ?? element.fontSize * .2;
  const baseline = (metrics.lineHeight - ascent - descent) / 2 + ascent, adjustment = element.fontSize - baseline;
  const top = Math.max(0, element.paddingY + metrics.inset + adjustment), bottom = Math.max(0, element.paddingY + metrics.inset - adjustment);
  Object.assign(inlineEdit.layer.style, { width: `${doc.width}px`, height: `${doc.height}px`, transform: `scale(${zoom})` });
  Object.assign(inlineEdit.input.style, {
    left: `${element.x}px`, top: `${element.y}px`, width: `${element.width}px`, height: `${metrics.lines.length * metrics.lineHeight + top + bottom}px`,
    padding: `${top}px ${element.paddingX + metrics.inset}px ${bottom}px`,
    fontFamily: `"${element.fontFamily}"`, fontSize: `${element.fontSize}px`, fontWeight: element.bold ? '700' : '400', fontStyle: element.italic ? 'italic' : 'normal',
    lineHeight: `${metrics.lineHeight}px`, textAlign: element.align, transform: `rotate(${element.rotation || 0}deg)`, transformOrigin: `${element.width / 2}px ${metrics.height / 2}px`,
  });
}
function finishInlineEdit(cancel = false) {
  if (!inlineEdit) return;
  const edit = inlineEdit; inlineEdit = null;
  const element = doc.elements.find(e => e.id === edit.id);
  edit.layer.remove(); edit.toolbar.remove();
  if (cancel && element) { if (element.text !== edit.originalText) { element.text = edit.originalText; markDirty(); } }
  else if (element && element.text !== edit.originalText) remember(edit.before);
  const field = $('#text-content'); if (field && element) field.value = element.text;
  // Keep the controls being clicked in place while focus leaves the editor.
  renderScene(); if (cancel) renderLayers();
}
function font(element) { return `font-family="${escape(element.fontFamily)}, sans-serif" font-size="${element.fontSize}" font-weight="${element.bold ? 700 : 400}" font-style="${element.italic ? 'italic' : 'normal'}"`; }

function sceneMarkup(page, live = false) {
  let content = `<svg data-scene="true" width="${page.width}" height="${page.height}" overflow="hidden"><rect width="${page.width}" height="${page.height}" fill="${page.transparent ? 'none' : page.background}"/>`;
  for (const element of page.elements) {
    if (!element.visible) continue;
    const metrics = layout(element);
    if (element.type === 'image') {
      const preview = live && restoreMode?.id === element.id && restoreMode.surface;
      const drawingPreview = live && drawingMode?.id === element.id && drawingMode.surface;
      content += `<g data-element-id="${escape(element.id)}" transform="translate(${element.x} ${element.y}) rotate(${element.rotation || 0} ${element.width / 2} ${metrics.height / 2})" class="canvas-element ${element.locked ? 'locked' : ''}">${drawingPreview ? `<foreignObject style="filter:${imageFilterCSS(element)}" data-drawing-surface="${escape(element.id)}" width="${element.width}" height="${element.height}" pointer-events="none"></foreignObject>` : preview ? `<foreignObject style="filter:${imageFilterCSS(element)}" data-restore-surface="${escape(element.id)}" width="${element.width}" height="${element.height}" pointer-events="none"></foreignObject>` : `<image style="filter:${imageFilterCSS(element)}" href="${escape(element.src)}" width="${element.width}" height="${element.height}" preserveAspectRatio="none"/>`}<rect width="${element.width}" height="${element.height}" fill="transparent"/></g>`;
      continue;
    }
    const left = element.paddingX + metrics.inset;
    const x = element.align === 'center' ? element.width / 2 : element.align === 'right' ? element.width - left : left;
    const anchor = element.align === 'center' ? 'middle' : element.align === 'right' ? 'end' : 'start';
    const tspans = metrics.lines.map((line, index) => `<tspan x="${x}" y="${element.paddingY + metrics.inset + element.fontSize + index * metrics.lineHeight}">${escape(line || '\u00a0')}</tspan>`).join('');
    content += `<g data-element-id="${escape(element.id)}" transform="translate(${element.x} ${element.y}) rotate(${element.rotation || 0} ${element.width / 2} ${metrics.height / 2})" class="canvas-element ${element.locked ? 'locked' : ''}">
      <rect width="${element.width}" height="${metrics.height}" fill="transparent"/>
      ${element.background ? `<rect width="${element.width}" height="${metrics.height}" rx="${Math.min(element.radius, metrics.height / 2, element.width / 2)}" fill="${element.backgroundColor}"/>` : ''}
      <text ${font(element)} text-anchor="${anchor}" fill="${element.fill}" ${element.outline ? `stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" stroke-linejoin="round" paint-order="stroke fill"` : ''} style="white-space:pre" pointer-events="none">${tspans}</text></g>`;
  }
  content += '</svg>';
  return content;
}
function renderScene() {
  renderRetouchToolbar();
  const svg = $('#artboard');
  svg.setAttribute('viewBox', `0 0 ${doc.width} ${doc.height}`);
  svg.setAttribute('width', doc.width); svg.setAttribute('height', doc.height);
  svg.classList.toggle('transparent-canvas', doc.transparent);
  svg.classList.toggle('restore-mode', !!restoreMode?.surface);
  svg.classList.toggle('drawing-mode', !!drawingMode?.surface);
  let content = sceneMarkup(doc, true);
  if (pageFormat(doc).startsWith('a4')) content += `<rect data-page-margins="true" x="236" y="236" width="${doc.width - 472}" height="${doc.height - 472}" fill="none" stroke="#a4aec0" stroke-opacity=".45" stroke-dasharray="4 5" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  const element = selected();
  if (element?.visible) {
    const h = layout(element).height;
    const handleSize = 9 / zoom;
    const handles = [['nw', 0, 0], ['ne', element.width, 0], ['sw', 0, h], ['se', element.width, h], ['w', 0, h / 2], ['e', element.width, h / 2]];
    if (element.type === 'image') handles.push(['n', element.width / 2, 0], ['s', element.width / 2, h]);
    content += `<g data-selection="true" transform="translate(${element.x} ${element.y}) rotate(${element.rotation || 0} ${element.width / 2} ${h / 2})" class="selection ${element.locked ? 'selection-locked' : ''}"><rect width="${element.width}" height="${h}" fill="none" stroke="${element.locked ? '#8792a5' : '#6b5ce7'}" stroke-width="1.5" vector-effect="non-scaling-stroke" pointer-events="none"/>${element.locked || restoreMode || drawingMode || inlineEdit ? '' : handles.map(([handle, x, y]) => `<rect data-handle="${handle}" x="${x - handleSize / 2}" y="${y - handleSize / 2}" width="${handleSize}" height="${handleSize}" rx="${1.5 / zoom}" fill="white" stroke="#6b5ce7" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('')}${element.locked || restoreMode || drawingMode || inlineEdit ? '' : `<line x1="${element.width / 2}" y1="0" x2="${element.width / 2}" y2="${-30 / zoom}" stroke="#6b5ce7" stroke-width="1" vector-effect="non-scaling-stroke"/><circle data-rotate-handle="true" cx="${element.width / 2}" cy="${-30 / zoom}" r="${7 / zoom}" fill="white" stroke="#6b5ce7" stroke-width="1.5" vector-effect="non-scaling-stroke"><title>Arrastra para girar · Shift: saltos de 15°</title></circle>`}</g>`;
  }
  const members = selectedElements();
  if (members.length > 1 && members.some(item => item.visible)) {
    const box = selectionBox(members), size = 9 / zoom, enabled = canTransformSelection();
    content += members.filter(item => item.visible).map(item => `<rect data-member-selection="true" transform="translate(${item.x} ${item.y}) rotate(${item.rotation || 0} ${item.width / 2} ${layout(item).height / 2})" width="${item.width}" height="${layout(item).height}" fill="none" stroke="#a89be9" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" pointer-events="none"/>`).join('');
    content += `<g data-multi-selection="true" class="multi-selection" transform="translate(${box.x} ${box.y})"><rect width="${box.width}" height="${box.height}" fill="none" stroke="${enabled ? '#6b5ce7' : '#8792a5'}" stroke-width="1.5" vector-effect="non-scaling-stroke" pointer-events="none"/>${enabled ? [['nw',0,0],['ne',box.width,0],['sw',0,box.height],['se',box.width,box.height]].map(([handle,x,y]) => `<rect data-multi-handle="${handle}" x="${x-size/2}" y="${y-size/2}" width="${size}" height="${size}" rx="${1.5/zoom}" fill="white" stroke="#6b5ce7" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('') : ''}</g>`;
  }
  if (gesture?.kind === 'marquee' && gesture.rect) content += `<rect data-marquee="true" x="${gesture.rect.x}" y="${gesture.rect.y}" width="${gesture.rect.width}" height="${gesture.rect.height}" fill="#6b5ce7" fill-opacity=".08" stroke="#6b5ce7" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  if (guides.length) content += `<g data-guides="true" pointer-events="none">${guides.map(guide => `<line x1="${guide.axis === 'x' ? guide.value : 0}" x2="${guide.axis === 'x' ? guide.value : doc.width}" y1="${guide.axis === 'y' ? guide.value : 0}" y2="${guide.axis === 'y' ? guide.value : doc.height}" stroke="#e352a5" stroke-width="1" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"/>`).join('')}</g>`;
  if (restoreMode?.surface) content += '<g data-restore-cursor="true" pointer-events="none" style="display:none"><ellipse fill="none" stroke="white" stroke-width="3" vector-effect="non-scaling-stroke"/><ellipse fill="none" stroke="#6b5ce7" stroke-width="1" vector-effect="non-scaling-stroke"/></g>';
  svg.innerHTML = content;
  if (restoreMode?.surface) svg.querySelector('[data-restore-surface]')?.append(restoreMode.surface.canvas);
  if (drawingMode?.surface) svg.querySelector('[data-drawing-surface]')?.append(drawingMode.surface.canvas);
  updateBrushCursor();
  updateInlineEdit();
  $('#empty-canvas').hidden = doc.elements.some(element => element.visible);
  $('[data-action="clear-canvas"]').disabled = doc.elements.length === 0;
  $('#selection-status').textContent = inlineEdit ? 'Editando texto · Ctrl+Enter: terminar · Esc: cancelar' : members.length > 1 ? `${members.length} elementos seleccionados · Shift + clic para añadir o quitar` : element ? `${element.locked ? 'Bloqueado · ' : ''}${element.type === 'image' ? 'Imagen' : 'Texto'} · ${round(element.width)} × ${round(layout(element).height)} px${guides.length ? ' · Alineado' : ''}` : `${doc.elements.length} ${doc.elements.length === 1 ? 'elemento' : 'elementos'} · ${doc.width} × ${doc.height} px`;
}

function renderLayers() {
  $('#layer-count').textContent = doc.elements.length;
  $('#layer-list').innerHTML = doc.elements.length ? [...doc.elements].reverse().map(element => `
    <div class="layer-row ${selectedIds.has(element.id) ? 'active' : ''} ${!element.visible ? 'is-hidden' : ''}" role="listitem" draggable="true" data-layer-id="${escape(element.id)}">
      <button class="layer-select" data-select="${escape(element.id)}" aria-label="Seleccionar ${escape((element.type === 'image' ? element.name : element.text).slice(0, 45) || (element.type === 'image' ? 'Imagen' : 'Texto vacío'))}" aria-pressed="${selectedIds.has(element.id)}"><span class="layer-thumb ${element.type === 'image' ? 'image-thumb' : ''}">${element.type === 'image' ? `<img style="filter:${imageFilterCSS(element)}" src="${escape(element.src)}" alt="">` : 'T'}</span><span>${escape((element.type === 'image' ? element.name : element.text).replace(/\n/g, ' ').slice(0, 45) || (element.type === 'image' ? 'Imagen' : 'Texto vacío'))}<small>${element.type === 'image' ? `${element.naturalWidth} × ${element.naturalHeight} · ${element.drawing ? 'Dibujo' : 'Imagen'}${element.groupId ? ' · Grupo' : ''}` : escape(element.fontFamily) + (element.groupId ? ' · Grupo' : '')}</small></span></button>
      <button class="icon-button small" data-layer-action="visible" data-id="${escape(element.id)}" aria-label="${element.visible ? 'Ocultar' : 'Mostrar'} capa" title="${element.visible ? 'Ocultar' : 'Mostrar'}">${icon(element.visible ? 'eye' : 'hidden')}</button>
      <button class="icon-button small ${element.locked ? 'is-locked' : ''}" data-layer-action="locked" data-id="${escape(element.id)}" aria-label="${element.locked ? 'Desbloquear' : 'Bloquear'} capa" title="${element.locked ? 'Desbloquear' : 'Bloquear'}">${icon(element.locked ? 'lock' : 'unlock')}</button>
    </div>`).join('') : `<div class="empty-layers">${icon('layers')}<p>Aquí aparecerán tus capas.</p><span>Añade texto o una imagen.</span></div>`;
  $('#paper-swatch').style.background = doc.transparent ? '' : doc.background;
  $('#paper-swatch').classList.toggle('transparent-swatch', doc.transparent);
  $('#canvas-size').textContent = `${doc.width} × ${doc.height} px`;
}

function numeric(label, prop, value, min, max, step = 1, unit = 'px') {
  return `<label class="field"><span>${label}</span><span class="number-wrap"><input type="number" data-prop="${prop}" aria-label="${label}" value="${round(value)}" min="${min}" max="${max}" step="${step}"><span>${unit}</span></span></label>`;
}
function rotationControl(element) {
  return `${numeric('Ángulo de giro', 'rotation', element.rotation || 0, -360, 360, .1, '°')}<p class="field-help">Arrastra el tirador redondo sobre el elemento. Shift: saltos de 15°.</p>`;
}
function colorField(label, prop, value) {
  return `<div class="field"><span>${label}</span><div class="color-field"><input type="color" data-prop="${prop}" aria-label="${label}" value="${value}"><input type="text" class="hex-input" data-color-hex="${prop}" aria-label="${label} hexadecimal" value="${value.toUpperCase()}" maxlength="7" spellcheck="false"></div></div>`;
}
function toggle(label, prop, on) {
  return `<label class="toggle-label"><span>${label}</span><input class="toggle" type="checkbox" data-prop="${prop}" aria-label="${label}" ${on ? 'checked' : ''}></label>`;
}
function documentPanel() {
  const format = pageFormat(doc);
  return `<div class="inspector-title"><span class="inspector-symbol">${icon('fit')}</span><div><h2>Tu lienzo</h2><span>Formato y fondo de esta página</span></div></div>
    <section class="inspector-section"><h3>Formato</h3><label class="field"><span>Tamaño del diseño</span><select id="preset" aria-label="Formato del lienzo"><option value="youtube" ${format === 'youtube' ? 'selected' : ''}>Miniatura de YouTube</option><option value="vertical" ${format === 'vertical' ? 'selected' : ''}>Short / Reel · vertical</option>${['a4', 'a4-landscape'].map(key => `<option value="${key}" ${format === key ? 'selected' : ''}>${PAGE_FORMATS[key].label}</option>`).join('')}<option value="custom" ${format === 'custom' ? 'selected' : ''}>Personalizado</option></select></label><div class="field-grid">${numeric('Ancho del lienzo', 'doc.width', doc.width, 64, 8192)}${numeric('Alto del lienzo', 'doc.height', doc.height, 64, 8192)}</div><p class="field-help">${format.startsWith('a4') ? 'Folio A4 de 210 × 297 mm a 300 ppp. Texto e imágenes se colocan libremente; las páginas se añaden manualmente.' : 'Dimensiones en píxeles. Cambiar el lienzo no escala los elementos.'}</p>${colorField('Color del lienzo', 'doc.background', doc.background)}${toggle('Lienzo transparente', 'doc.transparent', doc.transparent)}<p class="field-help">El PNG conserva la transparencia si el lienzo no tiene un color de fondo.</p></section>
    <section class="inspector-section page-guidance"><h3>Tu página</h3><p class="field-help">Añade contenido desde la izquierda. Selecciona un elemento para ver sus propiedades aquí.</p><p class="field-help">Las páginas se gestionan debajo del lienzo. PDF incluye todas; PNG y JPG, la actual.</p></section><section class="inspector-section"><h3>Proyecto</h3><button class="button outlined full-width new-document" data-action="new">Nuevo proyecto</button><p class="field-help">Crea un proyecto nuevo con una página en blanco.</p></section>`;
}
function imageAdjustment(label, property, value) {
  return `<label class="field image-adjustment"><span>${label}</span><span class="adjustment-controls"><input type="range" data-prop="${property}" aria-label="${label}" min="0" max="200" step="1" value="${value}"><span class="number-wrap"><input type="number" data-prop="${property}" aria-label="${label} en porcentaje" min="0" max="200" step="1" value="${value}"><span>%</span></span></span></label>`;
}
function edgeControl(label, key, value, min, max, unit) {
  return `<label class="field edge-field"><span>${label}<output data-edge-output="${key}">${value > 0 && key === 'offset' ? '+' : ''}${value} ${unit}</output></span><input type="range" data-edge-param="${key}" aria-label="${label}" min="${min}" max="${max}" value="${value}" step="1"></label>`;
}
function cutoutPanel(element) {
  const draft = edgeDraft?.id === element.id ? edgeDraft : { offset: element.edgeOffset, softness: element.edgeSoftness, definition: element.edgeDefinition };
  const busy = !!backgroundJob;
  return `<section class="inspector-section cutout-panel"><div class="section-label"><h3>Quitar fondo</h3><span class="section-tag">GRATIS · LOCAL</span></div>
    <fieldset class="quality-picker" ${busy ? 'disabled' : ''}><legend>Calidad del recorte</legend>
      <label><input type="radio" name="background-quality" data-prop="backgroundQuality" aria-label="Rápido" value="fast" ${element.backgroundQuality === 'fast' ? 'checked' : ''}><span><strong>Rápido</strong><small>Para probar y avanzar</small></span></label>
      <label><input type="radio" name="background-quality" data-prop="backgroundQuality" aria-label="Mayor calidad" value="quality" ${element.backgroundQuality === 'quality' ? 'checked' : ''}><span><strong>Mayor calidad</strong><small>Más detalle · tarda más</small></span></label>
    </fieldset><p class="field-help quality-help">${element.backgroundQuality === 'quality' ? 'Modelo más potente. La primera carga necesita más tiempo y memoria; la imagen se queda en tu equipo.' : 'Un recorte ligero para trabajar ágilmente. Puedes repetirlo después con Mayor calidad.'}</p>
    <button class="button primary full-width" data-action="remove-background" ${busy ? 'disabled' : ''}>${backgroundJob?.id === element.id ? 'Procesando…' : 'Quitar fondo'}</button>
    ${element.cutoutQuality ? `<div class="cutout-result">${icon('check')} Recorte aplicado · ${element.cutoutQuality === 'quality' ? 'Mayor calidad' : 'Rápido'}</div>` : ''}
    ${element.originalSrc ? `<details class="edge-details" ${edgePanelOpen ? 'open' : ''}><summary>Afinar bordes<span>Acabado</span></summary><div class="edge-body"><p class="field-help">Afina primero el borde y retoca después con pinceles.</p>
      <fieldset class="edge-settings" ${busy ? 'disabled' : ''}>${edgeControl('Contraer / expandir', 'offset', draft.offset, -8, 8, 'px')}<div class="edge-directions"><span>Quitar halo</span><span>Recuperar borde</span></div>${edgeControl('Suavizar', 'softness', draft.softness, 0, 8, 'px')}${edgeControl('Definir borde', 'definition', draft.definition, 0, 100, '%')}<button class="button outlined full-width" data-action="apply-edges">Aplicar bordes</button><button class="button quiet full-width" data-action="reset-edges">Restablecer bordes</button></fieldset><p class="field-help">Pulsa Aplicar para ver el resultado. No repite la IA y puedes deshacerlo. Los pinceles fijan este acabado.</p></div></details>` : ''}
    <div class="manual-retouch"><h4>Retoque manual</h4><div class="retouch-tools"><button class="button outlined full-width ${restoreMode?.tool === 'erase' ? 'brush-active' : ''}" data-action="erase-brush" aria-pressed="${restoreMode?.tool === 'erase'}" ${busy ? 'disabled' : ''}>Borrar con pincel</button>${element.originalSrc ? `<button class="button outlined full-width ${restoreMode?.tool === 'restore' ? 'brush-active' : ''}" data-action="restore-brush" aria-pressed="${restoreMode?.tool === 'restore'}" ${busy ? 'disabled' : ''}>Restaurar con pincel</button>` : ''}</div>
    <label class="field brush-field"><span>Grosor del pincel</span><span class="brush-size-controls"><input type="range" data-restore-size min="1" max="500" value="${brushSize}" aria-label="Grosor del pincel"><input type="number" data-restore-size min="1" max="500" value="${brushSize}" aria-label="Grosor del pincel en píxeles"><span>px</span></span></label><p class="field-help">Cada trazo se puede deshacer. Terminar retoque o Esc: volver a mover la imagen.</p></div>
    ${element.originalSrc ? `<button class="button quiet full-width original-reset" data-action="restore-background" ${busy ? 'disabled' : ''}>Restaurar original completo</button>` : ''}</section>`;
}
function imagePanel(element) {
  return `<div class="inspector-title"><span class="inspector-symbol">${icon('image')}</span><div><h2>${element.drawing ? 'Dibujo' : 'Imagen'}</h2><span>${element.locked ? 'Capa bloqueada' : element.drawing ? 'Pintura y formas en esta capa' : 'Ajustes, recorte y posición'}</span></div><div class="inspector-tools"><button class="icon-button" data-action="duplicate" aria-label="Duplicar imagen" title="Duplicar · Ctrl+D">${icon('duplicate')}</button><button class="icon-button danger" data-action="delete" aria-label="Eliminar imagen" ${element.locked ? 'disabled' : ''}>${icon('trash')}</button></div></div>
    ${element.locked ? '<div class="locked-notice">Desbloquea esta capa para moverla o cambiar su tamaño.</div>' : ''}
    <fieldset class="properties" ${element.locked ? 'disabled' : ''}><section class="inspector-section"><div class="image-preview"><img style="filter:${imageFilterCSS(element)}" src="${escape(element.src)}" alt="Vista previa de la imagen"></div><label class="field"><span>Nombre de la imagen</span><input class="image-name" type="text" data-prop="name" aria-label="Nombre de la imagen" maxlength="200" value="${escape(element.name)}"></label><p class="field-help">Original: ${element.naturalWidth} × ${element.naturalHeight} px · Incluida en el proyecto.</p></section>
    ${element.drawing ? '<section class="inspector-section"><h3>Capa de dibujo</h3><p class="field-help">Selecciona una herramienta del panel izquierdo para seguir pintando en esta capa. El borrador y el cubo solo afectan a este dibujo. Puedes mover o redimensionar toda la capa al terminar.</p></section>' : cutoutPanel(element)}
    <section class="inspector-section"><div class="section-label"><h3>Filtros y ajustes</h3><span class="section-tag">IMAGEN</span></div><label class="field"><span>Filtro</span><select data-prop="imageFilter" aria-label="Filtro de imagen">${Object.entries(IMAGE_FILTERS).map(([key, label]) => `<option value="${key}" ${element.imageFilter === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${imageAdjustment('Brillo', 'brightness', element.brightness)}${imageAdjustment('Contraste', 'contrast', element.contrast)}${imageAdjustment('Saturación', 'saturation', element.saturation)}<p class="field-help">100 % conserva el valor original. Los ajustes son reversibles y no alteran los retoques del fondo.</p><button class="button outlined full-width" data-action="reset-image-adjustments">Restablecer filtros y ajustes</button></section>
    <section class="inspector-section"><h3>Exportación PNG</h3>${toggle('Lienzo transparente', 'doc.transparent', doc.transparent)}<p class="field-help">Actívalo para exportar sin el color de fondo del lienzo. Las otras capas se conservan.</p><button class="button outlined full-width" data-action="download-cutout">${icon('save')} Descargar esta imagen PNG</button></section>
    <section class="inspector-section"><h3>Tamaño</h3>${toggle('Mantener proporción', 'keepRatio', element.keepRatio)}<div class="field-grid">${numeric('Ancho de la imagen', 'width', element.width, 1, 16000, 0.1)}${numeric('Alto de la imagen', 'height', element.height, 1, 16000, 0.1)}</div><p class="field-help">Arrastra las esquinas o los bordes. Shift invierte temporalmente el bloqueo de proporción.</p><button class="button outlined full-width" data-action="fit-image">${icon('fit')} Encajar en el lienzo</button></section>
    <section class="inspector-section"><h3>Posición y giro</h3>${rotationControl(element)}<div class="field-grid">${numeric('X', 'x', element.x, -100000, 100000)}${numeric('Y', 'y', element.y, -100000, 100000)}</div><p class="field-help">El imán se activa cerca de los bordes y del centro al arrastrar. Alt permite colocar sin ajuste.</p></section></fieldset><button class="button quiet back-to-canvas" data-action="deselect">${icon('fit')} Propiedades del lienzo</button>`;
}
function groupSelected() {
  const expanded = new Set(expandSelection(doc.elements, [...selectedIds]));
  const members = doc.elements.filter(e => expanded.has(e.id));
  if (members.length < 2 || members.some(e => e.locked)) return;
  if (members[0].groupId && members.every(e => e.groupId === members[0].groupId)) return;
  change(() => { const id = uid(); members.forEach(e => { e.groupId = id; }); setSelection(members.map(e => e.id)); });
}
function ungroupSelected() {
  const members = selectedElements(); if (members.some(e => e.locked)) return;
  const groups = new Set(members.map(e => e.groupId).filter(Boolean)); if (!groups.size || doc.elements.some(e => groups.has(e.groupId) && e.locked)) return;
  change(() => doc.elements.forEach(e => { if (groups.has(e.groupId)) e.groupId = null; }));
}
function multiSelectionPanel() {
  const members = selectedElements(), box = selectionBox(members), enabled = canTransformSelection(), locked = members.some(e => e.locked);
  const grouped = members[0]?.groupId && members.every(e => e.groupId === members[0].groupId);
  const field = (label, key, value, min, max) => `<label class="field"><span>${label}</span><span class="number-wrap"><input type="number" data-selection-prop="${key}" aria-label="${label}" value="${round(value)}" min="${min}" max="${max}" step="1"><span>px</span></span></label>`;
  return `<div class="inspector-title"><span class="inspector-symbol">${icon('layers')}</span><div><h2>${grouped ? 'Grupo' : 'Selección múltiple'}</h2><span>${members.length} elementos</span></div></div>
    <section class="inspector-section"><p class="field-help">Shift, Ctrl o Cmd + clic para añadir o quitar elementos. Arrastra desde una zona vacía para seleccionar varios.</p><div class="selection-actions"><button class="button primary full-width" data-action="group" ${locked || grouped ? 'disabled' : ''}>Agrupar</button><button class="button outlined full-width" data-action="ungroup" ${locked || !members.some(e => e.groupId) ? 'disabled' : ''}>Desagrupar</button></div><p class="field-help">Un grupo se selecciona con un clic. Doble clic sobre un miembro para editarlo por separado. Ctrl+G agrupa; Ctrl+Shift+G desagrupa.</p></section>
    ${enabled ? '' : '<div class="locked-notice">Muestra y desbloquea todos los elementos seleccionados para moverlos o redimensionarlos juntos.</div>'}
    <fieldset class="properties" ${enabled ? '' : 'disabled'}><section class="inspector-section"><h3>Posición y tamaño conjunto</h3><div class="field-grid">${field('X de la selección','x',box.x,-100000,100000)}${field('Y de la selección','y',box.y,-100000,100000)}</div><div class="field-grid">${field('Ancho de la selección','width',box.width,1,100000)}${field('Alto de la selección','height',box.height,1,100000)}</div><p class="field-help">Las esquinas y los campos de tamaño escalan todo proporcionalmente, incluidos textos, contornos y fondos.</p></section></fieldset>
    <section class="inspector-section selection-actions"><button class="button outlined full-width" data-action="duplicate">Duplicar selección</button><button class="button quiet full-width" data-action="delete" ${locked ? 'disabled' : ''}>Eliminar selección</button></section><button class="button quiet back-to-canvas" data-action="deselect">Deseleccionar</button>`;
}
function applySelectionInput(input) {
  if (!canTransformSelection() || !input.value.trim() || !Number.isFinite(Number(input.value))) return;
  if (!editingSnapshot) editingSnapshot = clone(project);
  const members = selectedElements(), box = selectionBox(members), key = input.dataset.selectionProp, value = clamp(Number(input.value), Number(input.min), Number(input.max));
  if (key === 'x' || key === 'y') {
    const next = translateElements(members, key === 'x' ? value - box.x : 0, key === 'y' ? value - box.y : 0), replacements = new Map(next.map(e => [e.id,e]));
    doc.elements = doc.elements.map(e => replacements.get(e.id) || e);
  }
  else {
    const next = scaleElements(members, value / box[key], { x: box.x, y: box.y }, e => layout(e).height), replacements = new Map(next.map(e => [e.id, e]));
    doc.elements = doc.elements.map(e => replacements.get(e.id) || e);
  }
  renderScene(); renderLayers(); markDirty();
}
function setToolPane(pane, userAction = false) {
  if (!['add', 'draw'].includes(pane)) return;
  toolPane = pane;
  $('#tool-add').hidden = pane !== 'add'; $('#tool-draw').hidden = pane !== 'draw';
  document.querySelectorAll('[data-tool-pane]').forEach(tab => { tab.setAttribute('aria-selected', String(tab.dataset.toolPane === pane)); tab.tabIndex = tab.dataset.toolPane === pane ? 0 : -1; });
  if (userAction && pane === 'add' && drawingMode) finishRetouch();
}
function setInspectorPane(key) {
  if (!$('#inspector [data-pane="' + key + '"]')) return;
  finishEditing(); inspectorPanes[inspectorKind] = key;
  if (key === 'position' || inspectorKind === 'image' && key === 'content') {
    stopDrawingMode(); stopRestoreMode(); renderScene();
  }
  document.querySelectorAll('#inspector [data-pane]').forEach(pane => { pane.hidden = pane.dataset.pane !== key; });
  document.querySelectorAll('#inspector [data-inspector-tab]').forEach(tab => { tab.setAttribute('aria-selected', String(tab.dataset.inspectorTab === key)); tab.tabIndex = tab.dataset.inspectorTab === key ? 0 : -1; });
  $('#inspector').scrollTop = 0;
}
function organizeInspector(kind) {
  const inspector = $('#inspector'), properties = inspector.querySelector(':scope > fieldset.properties');
  if (!properties) return;
  inspectorKind = kind;
  const tabs = kind === 'text' ? { content: 'Texto', effects: 'Efectos', position: 'Posición' }
    : kind === 'drawing' ? { content: 'Dibujo', effects: 'Ajustes', position: 'Posición' }
    : { content: 'Ajustes', background: 'Fondo', position: 'Posición' };
  const current = inspectorPanes[kind] in tabs ? inspectorPanes[kind] : 'content';
  const nav = document.createElement('nav'); nav.className = 'inspector-tabs'; nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Propiedades del elemento');
  nav.innerHTML = Object.entries(tabs).map(([key, label]) => `<button role="tab" id="inspector-tab-${key}" data-inspector-tab="${key}" aria-controls="inspector-pane-${key}" aria-selected="${key === current}" tabindex="${key === current ? 0 : -1}">${label}</button>`).join('');
  inspector.querySelector('.inspector-title').after(nav);
  const panes = {};
  for (const key of Object.keys(tabs)) { const pane = document.createElement('div'); pane.dataset.pane = key; pane.id = `inspector-pane-${key}`; pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', `inspector-tab-${key}`); pane.hidden = key !== current; panes[key] = pane; }
  for (const section of Array.from(properties.children)) {
    const title = section.querySelector('h3')?.textContent || ''; let key = 'content';
    if (kind === 'text') key = ['Contorno', 'Fondo'].includes(title) ? 'effects' : title.includes('Posición') ? 'position' : 'content';
    else key = title === 'Quitar fondo' ? 'background' : title === 'Tamaño' || title.includes('Posición') ? 'position' : kind === 'drawing' && title === 'Filtros y ajustes' ? 'effects' : 'content';
    if (title === 'Exportación PNG') {
      section.classList.add('individual-export'); section.querySelector('h3').textContent = 'Guardar solo esta capa';
      section.querySelector('.toggle-label')?.remove();
      section.querySelector('.field-help').textContent = 'Imagen independiente, con su transparencia.';
    }
    if (title === 'Capa de dibujo') section.insertAdjacentHTML('beforeend', `<button class="button outlined full-width" data-action="open-drawing" ${drawingMode?.id === selected()?.id ? 'disabled' : ''}>${drawingMode?.id === selected()?.id ? 'Herramientas abiertas' : 'Continuar dibujando'}</button>`);
    (panes[key] || panes.content).append(section);
  }
  Object.values(panes).forEach(pane => properties.append(pane));
}
function renderInspector() {
  if (selectedElements().length > 1) { $('#inspector').innerHTML = multiSelectionPanel(); return; }
  const element = selected();
  if (!element) { inspectorKind = 'page'; $('#inspector').innerHTML = documentPanel(); return; }
  if (element.type === 'image') { $('#inspector').innerHTML = imagePanel(element); organizeInspector(element.drawing ? 'drawing' : 'image'); return; }
  $('#inspector').innerHTML = `<div class="inspector-title"><span class="inspector-symbol">${icon('text')}</span><div><h2>Texto</h2><span>${element.locked ? 'Capa bloqueada' : 'Doble clic para editar en el lienzo'}</span></div><div class="inspector-tools"><button class="icon-button" data-action="duplicate" aria-label="Duplicar texto" title="Duplicar · Ctrl+D">${icon('duplicate')}</button><button class="icon-button danger" data-action="delete" aria-label="Eliminar texto" title="Eliminar · Supr" ${element.locked ? 'disabled' : ''}>${icon('trash')}</button></div></div>
    ${element.locked ? '<div class="locked-notice">Esta capa está bloqueada. Desbloquéala en el panel de capas para editarla.</div>' : ''}
    <fieldset class="properties" ${element.locked ? 'disabled' : ''}>
    <section class="inspector-section"><label class="field text-field"><span>Contenido</span><textarea id="text-content" data-prop="text" aria-label="Contenido del texto" rows="${pageFormat(doc).startsWith('a4') ? 10 : 3}" maxlength="20000" spellcheck="false">${escape(element.text)}</textarea></label><label class="field"><span>Tipografía</span><select data-prop="fontFamily" aria-label="Tipografía">${FONTS.map(name => `<option ${name === element.fontFamily ? 'selected' : ''}>${name}</option>`).join('')}</select></label><div class="typography-row">${numeric('Tamaño de fuente', 'fontSize', element.fontSize, 4, 600, 1)}<button class="style-button ${element.bold ? 'active' : ''}" data-text-toggle="bold" aria-label="Negrita" aria-pressed="${element.bold}"><b>B</b></button><button class="style-button ${element.italic ? 'active' : ''}" data-text-toggle="italic" aria-label="Cursiva" aria-pressed="${element.italic}"><i>I</i></button></div><div class="alignment-group" aria-label="Alineación del texto">${[['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']].map(([value, label]) => `<button class="style-button ${element.align === value ? 'active' : ''}" data-align="${value}" aria-label="Alinear texto: ${label}" aria-pressed="${element.align === value}">${icon(value)}</button>`).join('')}</div>${colorField('Color del texto', 'fill', element.fill)}</section>
    <section class="inspector-section effect-section"><div class="section-label"><h3>Contorno</h3><span class="section-tag">LETRAS</span></div>${toggle('Activar contorno', 'outline', element.outline)}${element.outline ? `<div class="field-grid">${colorField('Color del contorno', 'strokeColor', element.strokeColor)}${numeric('Grosor', 'strokeWidth', element.strokeWidth, 0, 80, 0.5)}</div>` : ''}</section>
    <section class="inspector-section effect-section"><div class="section-label"><h3>Fondo</h3><span class="section-tag">BLOQUE</span></div>${toggle('Activar fondo', 'background', element.background)}${element.background ? `${colorField('Color del fondo', 'backgroundColor', element.backgroundColor)}<div class="field-grid">${numeric('Padding horizontal', 'paddingX', element.paddingX, 0, 500)}${numeric('Padding vertical', 'paddingY', element.paddingY, 0, 500)}</div>${numeric('Esquinas redondeadas', 'radius', element.radius, 0, 500)}` : ''}</section>
    <section class="inspector-section"><h3>Posición y tamaño</h3><div class="field-grid">${numeric('X', 'x', element.x, -100000, 100000)}${numeric('Y', 'y', element.y, -100000, 100000)}</div>${numeric('Ancho de la caja', 'width', element.width, 32, 16000)}${rotationControl(element)}<p class="field-help">Los laterales ajustan la caja. Las esquinas escalan el texto y sus efectos.</p></section></fieldset>
    <button class="button quiet back-to-canvas" data-action="deselect">${icon('fit')} Propiedades del lienzo</button>`;
  organizeInspector('text');
}

function updateZoom() {
  if (fitMode) {
    const box = $('#viewport').getBoundingClientRect();
    zoom = clamp(Math.min((box.width - 100) / doc.width, (box.height - 120) / doc.height), 0.03, 2);
  }
  $('#artboard-wrap').style.width = `${doc.width * zoom}px`;
  $('#artboard-wrap').style.height = `${doc.height * zoom}px`;
  $('#artboard').style.width = `${doc.width * zoom}px`;
  $('#artboard').style.height = `${doc.height * zoom}px`;
  $('#zoom-label').textContent = `${Math.round(zoom * 100)} %`;
}
function render() {
  setSelection([...selectedIds].filter(id => doc.elements.some(element => element.id === id)));
  $('#project-name').value = project.name;
  $('#artboard-name').textContent = project.name;
  $('#dimensions-label').textContent = `${doc.width} × ${doc.height}`;
  $('#format-label').textContent = PAGE_FORMATS[pageFormat(doc)]?.label || 'Formato personalizado';
  $('[data-action="undo"]').disabled = past.length === 0;
  $('[data-action="redo"]').disabled = future.length === 0;
  const index = doc.elements.findIndex(element => element.id === selectedId);
  $('[data-action="up"]').disabled = selectedIds.size !== 1 || index < 0 || index === doc.elements.length - 1;
  $('[data-action="down"]').disabled = selectedIds.size !== 1 || index <= 0;
  renderPages(); updateZoom(); renderScene(); renderLayers(); renderInspector();
}

const totalElements = () => project.pages.reduce((sum, page) => sum + page.elements.length, 0);
function renderPages() {
  updateExportUI();
  $('#page-tabs').innerHTML = project.pages.map((page, index) => `<button role="tab" class="page-tab" data-page-id="${escape(page.id)}" aria-selected="${page.id === project.activePageId}" tabindex="${page.id === project.activePageId ? 0 : -1}" aria-label="Página ${index + 1}"><span>${index + 1}</span><small>${escape(PAGE_FORMATS[pageFormat(page)]?.label || 'Personalizado')}</small></button>`).join('');
  $('[data-action="delete-page"]').disabled = project.pages.length === 1;
  $('[data-action="add-page"]').disabled = project.pages.length >= 100;
  $('[data-action="duplicate-page"]').disabled = project.pages.length >= 100 || totalElements() + doc.elements.length > 5000;
}
function switchPage(id) {
  if (id === project.activePageId || !project.pages.some(page => page.id === id)) return;
  stopDrawingMode(); stopRestoreMode(); finishEditing();
  if (backgroundJob) { backgroundJob.cancelled = true; cancelBackground(); }
  project.activePageId = id; doc = activePage(project); setSelection([]); edgeDraft = null; guides = []; fitMode = true;
  markDirty(); render();
}
function addPage() {
  if (project.pages.length >= 100) return;
  const format = $('#new-page-format').value;
  if (backgroundJob) { backgroundJob.cancelled = true; cancelBackground(); }
  change(() => {
    const page = newPage(format === 'same' ? pageFormat(doc) : format);
    if (format === 'same') Object.assign(page, { width: doc.width, height: doc.height, background: doc.background, transparent: doc.transparent });
    const index = project.pages.findIndex(item => item.id === doc.id);
    project.pages.splice(index + 1, 0, page); project.activePageId = page.id; doc = page; setSelection([]); edgeDraft = null; fitMode = true;
  });
}
function duplicatePage() {
  if (project.pages.length >= 100 || totalElements() + doc.elements.length > 5000) return;
  if (backgroundJob) { backgroundJob.cancelled = true; cancelBackground(); }
  change(() => {
    const page = clone(doc); page.id = uid(); page.elements.forEach(element => { element.id = uid(); });
    const index = project.pages.findIndex(item => item.id === doc.id);
    project.pages.splice(index + 1, 0, page); project.activePageId = page.id; doc = page; setSelection([]); edgeDraft = null; fitMode = true;
  });
}
function deletePage() {
  if (project.pages.length <= 1) return;
  if (backgroundJob) { backgroundJob.cancelled = true; cancelBackground(); }
  change(() => {
    const index = project.pages.findIndex(page => page.id === doc.id); project.pages.splice(index, 1);
    project.activePageId = project.pages[Math.min(index, project.pages.length - 1)].id; doc = activePage(project);
    setSelection([]); edgeDraft = null; fitMode = true;
  });
}
document.addEventListener('keydown', event => {
  const tab = event.target.closest?.('[data-tool-pane], [data-inspector-tab]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const tabs = Array.from(tab.parentElement.querySelectorAll('[role="tab"]')), index = tabs.indexOf(tab);
  const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length];
  if (next.dataset.toolPane) setToolPane(next.dataset.toolPane, true); else setInspectorPane(next.dataset.inspectorTab);
  next.focus();
}, true);
$('#page-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const current = project.pages.findIndex(page => page.id === project.activePageId);
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? project.pages.length - 1 : clamp(current + (event.key === 'ArrowLeft' ? -1 : 1), 0, project.pages.length - 1);
  switchPage(project.pages[index].id); $('#page-tabs [aria-selected="true"]').focus();
});

function addText() {
  setToolPane('add');
  inspectorPanes.text = 'content';
  if (doc.elements.length >= 500 || totalElements() >= 5000) { notify('Límite: 500 elementos por página y 5000 por proyecto.'); return; }
  change(() => { const element = newText(doc);
    if (pageFormat(doc).startsWith('a4')) Object.assign(element, { text: 'Escribe aquí…', fontFamily: 'Arial', fontSize: 50, bold: false, outline: false, background: false, fill: '#202c45', align: 'left', paddingX: 0, paddingY: 0, x: 236, y: 236, width: doc.width - 472 });
    doc.elements.push(element); setSelection([element.id]); });
  $('#text-content').focus(); $('#text-content').select();
}
async function addImages(files) {
  setToolPane('add', true);
  if (importing) { notify('Espera a que terminen de cargarse las imágenes.'); return; }
  const targetPage = doc, importToken = importGeneration;
  const available = Math.min(500 - doc.elements.length, 5000 - totalElements());
  if (!available) { notify('El proyecto admite hasta 500 elementos.'); return; }
  const inputs = Array.from(files).slice(0, available);
  if (!inputs.length) return;
  importing = true; document.querySelectorAll('[data-action="upload"], [data-action="paste"]').forEach(button => button.disabled = true);
  const images = [], errors = [];
  try {
    for (const file of inputs) { try { images.push(await importImage(file)); } catch (error) { errors.push(error.message); } }
    if (doc !== targetPage || importToken !== importGeneration) { notify('La carga se ha cancelado porque cambió el lienzo. Vuelve a subir las imágenes.'); return; }
    if (images.length) change(() => {
      for (const asset of images.slice(0, Math.min(500 - doc.elements.length, 5000 - totalElements()))) {
        const element = newImage(doc, asset); doc.elements.push(element); setSelection([element.id]);
      }
    });
    notify(`${images.length ? `${images.length === 1 ? 'Imagen añadida' : `${images.length} imágenes añadidas`}. ` : ''}${errors.length ? errors[0] : 'Puedes moverlas y ordenarlas en Capas.'}`);
  } finally {
    importing = false; document.querySelectorAll('[data-action="upload"], [data-action="paste"]').forEach(button => button.disabled = false);
    imageInput.value = '';
  }
}
async function pasteImage() {
  if (!navigator.clipboard?.read) { notify('Usa Ctrl+V para pegar una imagen copiada en el portapapeles.'); return; }
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const item of items) {
      const type = item.types.find(type => /^image\/(png|jpeg|webp|gif|bmp|avif)$/i.test(type));
      if (type) files.push(new File([await item.getType(type)], 'Imagen del portapapeles', { type }));
    }
    if (!files.length) { notify('No hay una imagen en el portapapeles. Copia una imagen y pega con Ctrl+V.'); return; }
    await addImages(files);
  } catch { notify('El navegador no ha permitido leer el portapapeles. Prueba a pegar con Ctrl+V sobre el lienzo.'); }
}
imageInput.addEventListener('change', event => addImages(event.target.files));
document.addEventListener('paste', event => {
  const files = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
  if (!files.length) return;
  event.preventDefault(); addImages(files);
});
function drawingPoint(position) {
  return imagePoint(position, doc.elements.find(element => element.id === drawingMode.id));
}
function finishDrawingStroke(cancel = false) {
  if (!drawingStroke) return;
  const stroke = drawingStroke; drawingStroke = null;
  if ($('#artboard').hasPointerCapture(stroke.pointerId)) $('#artboard').releasePointerCapture(stroke.pointerId);
  drawingMode.surface.finish(cancel);
  const element = doc.elements.find(item => item.id === drawingMode.id);
  if (!cancel && element) {
    const src = drawingMode.surface.snapshot();
    if (src.length <= 40_000_000) { element.src = src; remember(stroke.before); }
    else { drawingMode.surface.dispose(); drawingMode = null; notify('El dibujo es demasiado grande. Usa un lienzo de menor resolución.'); }
  }
  renderScene(); renderLayers(); renderInspector();
}
function stopDrawingMode() {
  finishDrawingStroke(); drawingMode?.surface?.dispose(); drawingMode = null; renderRetouchToolbar();
}
async function startDrawingMode(tool, forceNew = false) {
  inspectorPanes.drawing = 'content';
  setToolPane('draw');
  if (!Object.hasOwn(DRAW_TOOLS, tool)) return;
  if (drawingMode?.tool === tool && !forceNew) { finishRetouch(); return; }
  stopDrawingMode(); stopRestoreMode(); finishEditing();
  let element = selected();
  if (forceNew || !element?.drawing) {
    if (doc.elements.length >= 500 || totalElements() >= 5000 || doc.width * doc.height > 32_000_000) { render(); notify('Para dibujar, usa un lienzo de hasta 32 millones de píxeles y menos de 500 capas.'); return; }
    const canvas = document.createElement('canvas'); canvas.width = doc.width; canvas.height = doc.height;
    element = newImage(doc, { src: canvas.toDataURL('image/png'), name: `Dibujo ${doc.elements.filter(item => item.drawing).length + 1}`, naturalWidth: doc.width, naturalHeight: doc.height });
    canvas.width = canvas.height = 0;
    Object.assign(element, { drawing: true, width: doc.width, height: doc.height, x: 0, y: 0 });
    change(() => { doc.elements.push(element); setSelection([element.id]); });
  }
  if (element.locked || !element.visible) { render(); notify('Muestra y desbloquea la capa de dibujo para pintar.'); return; }
  const mode = { id: element.id, tool, surface: null }; drawingMode = mode; render();
  try {
    const surface = await createDrawingSurface(element.src, element.naturalWidth, element.naturalHeight);
    if (drawingMode !== mode || selected()?.id !== mode.id) { surface.dispose(); return; }
    mode.surface = surface; renderScene();
  } catch {
    if (drawingMode !== mode) return;
    drawingMode = null; render(); notify('No se ha podido preparar la capa de dibujo.');
  }
}
function resumeDrawingMode(mode) {
  if (mode && selected()?.id === mode.id && selected().drawing && !selected().locked && selected().visible) startDrawingMode(mode.tool);
}
function beginDrawing(event) {
  if (!drawingMode.surface || drawingStroke) return;
  const element = selected(); if (!element?.drawing || element.id !== drawingMode.id || element.locked || !element.visible) return;
  const pixel = drawingPoint(point(event));
  if (pixel.x < 0 || pixel.y < 0 || pixel.x >= element.naturalWidth || pixel.y >= element.naturalHeight) { finishRetouch(); return; }
  event.preventDefault(); document.activeElement?.blur(); $('#viewport').focus({ preventScroll: true });
  drawingStroke = { pointerId: event.pointerId, before: clone(project) };
  drawingMode.surface.begin(drawingMode.tool, pixel, drawingColor, drawingSize, drawingFilled);
  if (drawingMode.tool === 'fill') finishDrawingStroke();
  else $('#artboard').setPointerCapture(event.pointerId);
}
$('#drawing-color').addEventListener('input', event => { drawingColor = event.target.value; });
$('#drawing-filled').addEventListener('change', event => { drawingFilled = event.target.checked; });
document.querySelectorAll('[data-drawing-size]').forEach(input => {
  input.addEventListener('input', () => {
    if (!input.value || !Number.isFinite(Number(input.value))) return;
    drawingSize = clamp(Math.round(Number(input.value)), 1, 200);
    document.querySelectorAll('[data-drawing-size]').forEach(field => { if (field !== input) field.value = drawingSize; });
  });
  input.addEventListener('blur', () => { input.value = drawingSize; });
});
function brushElement() {
  const element = selected();
  return restoreMode?.surface && element?.id === restoreMode.id && element.visible && !element.locked ? element : null;
}
function updateBrushCursor() {
  const cursor = $('#artboard [data-restore-cursor]'), element = brushElement();
  if (!cursor) return;
  const local = element && brushCursor && worldToLocal(brushCursor, element);
  const inside = local && local.x >= 0 && local.x <= element.width && local.y >= 0 && local.y <= element.height;
  cursor.style.display = inside ? '' : 'none';
  if (!inside) return;
  cursor.setAttribute('transform', `translate(${brushCursor.x} ${brushCursor.y}) rotate(${element.rotation || 0})`);
  cursor.querySelectorAll('ellipse').forEach(ellipse => {
    ellipse.setAttribute('cx', 0); ellipse.setAttribute('cy', 0);
    ellipse.setAttribute('rx', brushSize / 2 * element.width / element.naturalWidth);
    ellipse.setAttribute('ry', brushSize / 2 * element.height / element.naturalHeight);
  });
}
function imagePoint(position, element) {
  const local = worldToLocal(position, element);
  return { x: local.x * element.naturalWidth / element.width, y: local.y * element.naturalHeight / element.height };
}
function finishBrushStroke(cancel = false) {
  if (!brushStroke) return;
  const stroke = brushStroke; brushStroke = null;
  if ($('#artboard').hasPointerCapture(stroke.pointerId)) $('#artboard').releasePointerCapture(stroke.pointerId);
  const element = brushElement();
  if (!cancel && stroke.changed && element) {
    const src = restoreMode.surface.snapshot();
    if (src.length <= 40_000_000) {
      element.originalSrc ||= element.src; element.src = src; restoreMode.src = src;
      element.edgeBaseSrc = null; element.edgeOffset = element.edgeSoftness = element.edgeDefinition = 0; edgeDraft = null; remember(stroke.before);
    } else {
      cancel = true; notify('El retoque es demasiado grande. Usa una imagen de menor resolución.');
    }
  }
  if (cancel) {
    restoreMode?.surface?.dispose(); restoreMode = null; brushCursor = null;
  }
  renderScene(); renderLayers(); renderInspector();
}
function stopRestoreMode(cancelStroke = false) {
  finishBrushStroke(cancelStroke);
  restoreMode?.surface?.dispose(); restoreMode = null; brushCursor = null;
  renderRetouchToolbar();
  document.querySelectorAll('[data-action="restore-brush"], [data-action="erase-brush"]').forEach(button => {
    button.setAttribute('aria-pressed', 'false'); button.classList.remove('brush-active'); button.disabled = !!backgroundJob;
  });
}
function renderRetouchToolbar() {
  const target = selected(), drawing = target?.drawing ? target : null;
  $('#drawing-target').textContent = drawing ? `Capa: ${drawing.name}` : 'Se creará una capa de dibujo. Para retocar una foto, abre Fondo.';
  $('#drawing-target').title = drawing ? drawing.name : '';
  $('[data-draw-tool="eraser"]').disabled = !drawing || drawing.locked || !drawing.visible;
  $('#retouch-toolbar').hidden = !restoreMode && !drawingMode;
  document.querySelectorAll('[data-draw-tool]').forEach(button => { const active = drawingMode?.tool === button.dataset.drawTool; button.setAttribute('aria-pressed', String(active)); button.classList.toggle('brush-active', active); });
  $('#retouch-label').textContent = restoreMode ? `${restoreMode.surface ? '' : 'Preparando · '}${restoreMode.tool === 'erase' ? 'Borrador' : 'Restauración'} de imagen` : drawingMode ? `Dibujo · ${DRAW_TOOLS[drawingMode.tool]}${drawingMode.surface ? '' : ' · Preparando…'}` : '';
}
function finishRetouch() {
  stopDrawingMode(); stopRestoreMode(); render(); $('#viewport').focus({ preventScroll: true });
}
async function startRestoreMode(tool = 'restore') {
  inspectorPanes.image = 'background';
  stopDrawingMode();
  const element = selected();
  if (element?.type !== 'image' || (tool === 'restore' && !element.originalSrc) || element.locked || !element.visible || backgroundJob) return;
  if (restoreMode?.id === element.id && restoreMode.tool === tool) { finishRetouch(); return; }
  stopRestoreMode(); finishEditing();
  const mode = { id: element.id, src: element.src, tool, surface: null };
  restoreMode = mode; renderRetouchToolbar(); renderInspector();
  try {
    const surface = await createRestoreBrush(element.src, element.originalSrc || element.src);
    if (restoreMode !== mode || selected()?.id !== mode.id || selected().src !== mode.src) { surface.dispose(); return; }
    mode.surface = surface; renderScene(); renderInspector();
  } catch {
    if (restoreMode !== mode) return;
    restoreMode = null; render(); notify('No se ha podido preparar el pincel. Comprueba que el proyecto conserva la imagen original.');
  }
}
function resumeRestoreMode(mode) {
  const element = selected();
  if (mode && element?.id === mode.id && element.visible && !element.locked) startRestoreMode(mode.tool);
}
$('#inspector').addEventListener('toggle', event => {
  if (event.target.classList?.contains('edge-details')) edgePanelOpen = event.target.open;
}, true);
function resetSelectedEdges() {
  const element = selected(); if (element?.type !== 'image' || element.locked || backgroundJob) return;
  change(() => {
    if (element.edgeBaseSrc) element.src = element.edgeBaseSrc;
    element.edgeOffset = element.edgeSoftness = element.edgeDefinition = 0; edgeDraft = null;
  });
}
async function applySelectedEdges() {
  const element = selected();
  if (element?.type !== 'image' || !element.originalSrc || element.locked || backgroundJob) return;
  stopDrawingMode(); stopRestoreMode(); finishEditing();
  const settings = edgeDraft?.id === element.id ? { offset: edgeDraft.offset, softness: edgeDraft.softness, definition: edgeDraft.definition }
    : { offset: element.edgeOffset, softness: element.edgeSoftness, definition: element.edgeDefinition };
  const baseSrc = element.edgeBaseSrc || element.src;
  const job = { id: element.id, src: element.src, document: doc }; backgroundJob = job;
  processingStatus.hidden = false; $('#background-title').textContent = 'Afinando bordes'; $('#background-phase').textContent = 'Preparando el acabado…';
  renderScene(); renderInspector();
  try {
    let src = baseSrc;
    if (settings.offset || settings.softness || settings.definition) {
      const blob = await refineEdges(baseSrc, element.originalSrc, settings, phase => { $('#background-phase').textContent = phase; });
      src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
    }
    if (job.cancelled) throw new DOMException('Proceso cancelado', 'AbortError');
    const current = doc.elements.find(item => item.id === job.id);
    if (doc !== job.document || !current || current.src !== job.src || current.locked) return;
    if (src.length > 40_000_000) throw new Error('El recorte es demasiado grande. Usa una imagen de menor resolución.');
    change(() => {
      current.edgeBaseSrc = baseSrc; current.src = src;
      current.edgeOffset = settings.offset; current.edgeSoftness = settings.softness; current.edgeDefinition = settings.definition; edgeDraft = null;
    });
    notify('Bordes aplicados. Puedes deshacer o restablecer el acabado.');
  } catch (error) { notify(error.name === 'AbortError' ? 'Afinado cancelado. El recorte sigue intacto.' : error.message); }
  finally { backgroundJob = null; processingStatus.hidden = true; renderInspector(); }
}
async function removeSelectedBackground() {
  const element = selected();
  if (element?.type !== 'image' || element.locked || backgroundJob) return;
  stopDrawingMode();
  stopRestoreMode();
  finishEditing();
  const job = { id: element.id, src: element.src, document: doc };
  backgroundJob = job; processingStatus.hidden = false; $('#background-title').textContent = 'Quitando el fondo';
  $('#background-phase').textContent = 'Preparando la imagen…'; renderScene(); renderInspector();
  try {
    const quality = element.backgroundQuality;
    const blob = await removeBackground(element.originalSrc || element.src, phase => { $('#background-phase').textContent = phase; }, { quality });
    const src = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
    });
    if (job.cancelled) throw new DOMException('Proceso cancelado', 'AbortError');
    const current = doc.elements.find(item => item.id === job.id);
    if (doc !== job.document || !current || current.src !== job.src || current.locked) { notify('La imagen cambió durante el proceso. Se ha conservado su estado actual.'); return; }
    if (src.length > 40_000_000) throw new Error('El recorte es demasiado grande. Prueba con una imagen de menor resolución.');
    change(() => { current.originalSrc ||= current.src; current.src = src; current.cutoutQuality = quality; current.edgeBaseSrc = null; current.edgeOffset = current.edgeSoftness = current.edgeDefinition = 0; edgeDraft = null; });
    notify('Fondo eliminado. Activa Lienzo transparente para exportar sin fondo, o descarga esta imagen PNG.');
  } catch (error) {
    notify(error.name === 'AbortError' ? 'Proceso cancelado. La imagen sigue intacta.' : error.message);
  } finally {
    backgroundJob = null; processingStatus.hidden = true; renderInspector();
  }
}
async function downloadSelectedImage() {
  finishDrawingStroke();
  finishBrushStroke();
  const element = selected(); if (element?.type !== 'image') return;
  const name = (element.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim() || 'imagen') + '-recorte.png';
  let url;
  try {
    const handle = await chooseSaveTarget(name, 'image/png', '.png');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const bounds = rotatedBounds({ x: 0, y: 0, width: element.naturalWidth, height: element.naturalHeight, rotation: element.rotation || 0 });
    svg.setAttribute('width', Math.max(1, Math.ceil(bounds.width - 1e-8))); svg.setAttribute('height', Math.max(1, Math.ceil(bounds.height - 1e-8)));
    const source = document.createElementNS(svg.namespaceURI, 'image');
    source.setAttribute('href', element.src); source.setAttribute('width', element.naturalWidth); source.setAttribute('height', element.naturalHeight);
    source.style.filter = imageFilterCSS(element); source.setAttribute('transform', `translate(${-bounds.x} ${-bounds.y}) rotate(${element.rotation || 0} ${element.naturalWidth / 2} ${element.naturalHeight / 2})`); svg.append(source);
    url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error();
    await saveBlob(blob, name, handle); notify('Imagen PNG guardada con su transparencia.');
  } catch (error) { if (error.name !== 'AbortError') notify('No se ha podido guardar la imagen. Prueba otra ubicación.'); }
  finally { if (url) URL.revokeObjectURL(url); }
}
function clearCanvas() {
  if (!doc.elements.length) return;
  importGeneration++;
  if (backgroundJob) { backgroundJob.cancelled = true; cancelBackground(); }
  if (gesture) endGesture(null, true);
  change(() => { doc.elements = []; setSelection([]); edgeDraft = null; guides = []; });
  notify('Página limpia. Puedes recuperar todos sus elementos con Deshacer o Ctrl+Z.');
}
function removeSelected() {
  const members = selectedElements(); if (!members.length || members.some(e => e.locked)) return;
  const ids = new Set(selectedIds);
  change(() => { doc.elements = doc.elements.filter(element => !ids.has(element.id)); setSelection([]); });
}
function duplicate() {
  const members = selectedElements();
  if (!members.length || doc.elements.length + members.length > 500 || totalElements() + members.length > 5000) return;
  change(() => {
    const groups = new Map(), copies = members.map(original => {
      const element = clone(original); element.id = uid(); element.x += 24; element.y += 24; element.locked = false;
      if (element.groupId) { if (!groups.has(element.groupId)) groups.set(element.groupId, uid()); element.groupId = groups.get(element.groupId); }
      return element;
    });
    doc.elements.push(...copies); setSelection(copies.map(e => e.id));
  });
}
function undo() {
  const drawing = drawingMode && { id: drawingMode.id, tool: drawingMode.tool }; stopDrawingMode();
  const brushId = restoreMode && { id: restoreMode.id, tool: restoreMode.tool }; stopRestoreMode();
  edgeDraft = null; finishEditing(); if (!past.length) { render(); resumeRestoreMode(brushId); resumeDrawingMode(drawing); return; }
  future.push(clone(project)); project = past.pop(); doc = activePage(project); setSelection([...selectedIds].filter(id => doc.elements.some(element => element.id === id)));
  markDirty(); render(); resumeRestoreMode(brushId); resumeDrawingMode(drawing);
}
function redo() {
  const drawing = drawingMode && { id: drawingMode.id, tool: drawingMode.tool }; stopDrawingMode();
  const brushId = restoreMode && { id: restoreMode.id, tool: restoreMode.tool }; stopRestoreMode();
  edgeDraft = null; finishEditing(); if (!future.length) { render(); resumeRestoreMode(brushId); resumeDrawingMode(drawing); return; }
  past.push(clone(project)); project = future.pop(); doc = activePage(project); setSelection([...selectedIds].filter(id => doc.elements.some(element => element.id === id)));
  markDirty(); render(); resumeRestoreMode(brushId); resumeDrawingMode(drawing);
}
const filename = () => (project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim() || 'mi-diseno').slice(0, 100);
async function saveProject() {
  finishDrawingStroke(); finishBrushStroke(); finishEditing(); persist();
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), name = `${filename()}.canvnail.json`;
  try { const handle = await chooseSaveTarget(name, 'application/json', '.json'); await saveBlob(blob, name, handle); notify('Proyecto guardado con todas sus páginas.'); }
  catch (error) { if (error.name !== 'AbortError') notify('No se ha podido guardar el archivo. Prueba otra ubicación.'); }
}
async function renderPageCanvas(page, white = false) {
  if (page.width * page.height > 32_000_000) throw new Error('Una página supera los 32 millones de píxeles. Reduce su tamaño antes de exportar.');
  await document.fonts.ready;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}">${sceneMarkup(page)}</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = page.width; canvas.height = page.height;
    const context = canvas.getContext('2d'); if (white) { context.fillStyle = '#ffffff'; context.fillRect(0, 0, page.width, page.height); }
    context.drawImage(image, 0, 0); return canvas;
  } finally { URL.revokeObjectURL(url); }
}
async function exportDocument() {
  if (exporting) return;
  finishDrawingStroke(); finishBrushStroke(); finishEditing();
  const snapshot = clone(project), format = exportFormat, spec = EXPORT_FORMATS[format];
  const pages = format === 'pdf' ? snapshot.pages : [activePage(snapshot)];
  if (pages.some(page => page.width * page.height > 32_000_000)) { notify('Una página supera los 32 millones de píxeles. Reduce su tamaño antes de exportar.'); return; }
  const name = `${filename()}${format !== 'pdf' && snapshot.pages.length > 1 ? `-pagina-${snapshot.pages.findIndex(page => page.id === snapshot.activePageId) + 1}` : ''}${spec.extension}`;
  exporting = true; const button = $('[data-action="export"]'); button.disabled = true; $('#export-format').disabled = true;
  try {
    // Request the destination while the click still has transient user activation.
    const handle = await chooseSaveTarget(name, spec.mime, spec.extension);
    let blob;
    if (format === 'pdf') blob = await buildPDF(pages, renderPageCanvas, snapshot.name, (index, total) => { button.textContent = `PDF · ${index}/${total}`; });
    else {
      const canvas = await renderPageCanvas(pages[0], format === 'jpg');
      try { blob = await new Promise(resolve => canvas.toBlob(resolve, spec.mime, .95)); }
      finally { canvas.width = canvas.height = 0; }
      if (!blob) throw new Error('No se ha podido preparar la imagen.');
    }
    await saveBlob(blob, name, handle);
    notify(format === 'pdf' ? `PDF guardado · ${pages.length} ${pages.length === 1 ? 'página' : 'páginas'}.` : `${spec.label} guardado · página actual.${format === 'jpg' ? ' Las transparencias se rellenan de blanco.' : ''}`);
  } catch (error) { if (error.name !== 'AbortError') notify(error.message || 'No se ha podido exportar. Prueba otra ubicación.'); }
  finally { exporting = false; button.disabled = false; $('#export-format').disabled = false; updateExportUI(); }
}
function updateExportUI() {
  if (!exporting) $('[data-action="export"]').innerHTML = `Exportar ${EXPORT_FORMATS[exportFormat].label} ${icon('save')}`;
  $('#export-scope').textContent = exportFormat === 'pdf' ? `Todas las páginas · ${project.pages.length}` : exportFormat === 'jpg' ? 'Página actual · sin transparencia' : doc.transparent ? 'Página actual · fondo transparente' : 'Página actual · fondo de la página';
  $('[data-action="export"]').title = exportFormat === 'pdf' ? 'Guardar todas las páginas en un PDF' : 'Guardar la página actual';
}
$('#export-format').addEventListener('change', event => { exportFormat = event.target.value; updateExportUI(); });

const actions = {
  'group': groupSelected, 'ungroup': ungroupSelected,
  'shortcuts': () => $('#shortcuts-dialog').showModal(),
  'open-drawing': () => { setToolPane('draw'); if (!drawingMode) startDrawingMode('brush'); },
  'clear-canvas': clearCanvas,
  'add-page': addPage, 'duplicate-page': duplicatePage, 'delete-page': deletePage,
  add: addText, delete: removeSelected, duplicate, undo, redo, save: saveProject,
  upload: () => imageInput.click(), paste: pasteImage,
  'remove-background': removeSelectedBackground,
  'apply-edges': applySelectedEdges,
  'reset-edges': resetSelectedEdges,
  'restore-brush': () => startRestoreMode('restore'),
  'erase-brush': () => startRestoreMode('erase'),
  'finish-retouch': finishRetouch,
  'new-drawing': () => startDrawingMode('brush', true),
  'reset-image-adjustments': () => {
    if (selected()?.type !== 'image' || selected().locked) return;
    change(() => Object.assign(selected(), { brightness: 100, contrast: 100, saturation: 100, imageFilter: 'none' }));
  },
  'cancel-background': () => { if (backgroundJob) backgroundJob.cancelled = true; cancelBackground(); },
  'download-cutout': downloadSelectedImage,
  'restore-background': () => {
    const element = selected(); if (element?.type !== 'image' || element.locked || !element.originalSrc) return;
    if (backgroundJob?.id === element.id) cancelBackground();
    change(() => { element.src = element.originalSrc; element.originalSrc = null; element.cutoutQuality = null; element.edgeBaseSrc = null; element.edgeOffset = element.edgeSoftness = element.edgeDefinition = 0; edgeDraft = null; });
    notify('Imagen original restaurada.');
  },
  magnet: () => {
    magnetic = !magnetic; guides = [];
    const button = $('[data-action="magnet"]'); button.setAttribute('aria-pressed', magnetic); button.classList.toggle('active', magnetic);
    renderScene(); notify(magnetic ? 'Imán activado: bordes y centro. Alt para mover sin ajuste.' : 'Imán desactivado.');
  },
  'fit-image': () => {
    if (selected()?.type !== 'image' || selected().locked) return;
    change(() => {
      const element = selected(), bounds = rotatedBounds(element), scale = Math.min(doc.width / bounds.width, doc.height / bounds.height);
      element.width *= scale; element.height *= scale;
      element.x = (doc.width - element.width) / 2; element.y = (doc.height - element.height) / 2;
    });
  },
  open: () => $('#project-file').click(), export: exportDocument, deselect: () => choose(null),
  up: () => selected() && change(() => { doc.elements = moveLayer(doc.elements, selectedId, doc.elements.findIndex(element => element.id === selectedId) + 1); }),
  down: () => selected() && change(() => { doc.elements = moveLayer(doc.elements, selectedId, doc.elements.findIndex(element => element.id === selectedId) - 1); }),
  fit: () => { fitMode = true; updateZoom(); renderScene(); },
  'zoom-in': () => { fitMode = false; zoom = clamp(zoom * 1.2, 0.03, 3); updateZoom(); renderScene(); },
  'zoom-out': () => { fitMode = false; zoom = clamp(zoom / 1.2, 0.03, 3); updateZoom(); renderScene(); },
  new: () => $('#new-dialog').showModal(),
};
document.addEventListener('click', event => {
  const toolTab = event.target.closest('[data-tool-pane]'); if (toolTab) setToolPane(toolTab.dataset.toolPane, true);
  const inspectorTab = event.target.closest('[data-inspector-tab]'); if (inspectorTab) setInspectorPane(inspectorTab.dataset.inspectorTab);
  const pageButton = event.target.closest('[data-page-id]'); if (pageButton) switchPage(pageButton.dataset.pageId);
  const drawTool = event.target.closest('[data-draw-tool]'); if (drawTool) startDrawingMode(drawTool.dataset.drawTool);
  const action = event.target.closest('[data-action]');
  if (action && !action.disabled) actions[action.dataset.action]?.();
  const select = event.target.closest('[data-select]'); if (select) choose(select.dataset.select, event.shiftKey || event.ctrlKey || event.metaKey);
  const layerAction = event.target.closest('[data-layer-action]');
  if (layerAction) change(() => {
    const element = doc.elements.find(item => item.id === layerAction.dataset.id);
    const key = layerAction.dataset.layerAction; element[key] = !element[key];
  });
  const textToggle = event.target.closest('[data-text-toggle]');
  if (textToggle && selected() && !selected().locked) change(() => { const key = textToggle.dataset.textToggle; selected()[key] = !selected()[key]; });
  const align = event.target.closest('[data-align]');
  if (align && selected() && !selected().locked) change(() => { selected().align = align.dataset.align; });
});

function applyInput(input) {
  const property = input.dataset.prop || input.dataset.colorHex;
  if (!property) return;
  const isDoc = property.startsWith('doc.');
  const key = isDoc ? property.slice(4) : property;
  const target = isDoc ? doc : selected();
  if (!target || (!isDoc && target.locked)) return;
  if (!isDoc) { stopDrawingMode(); stopRestoreMode(); }
  let value = input.type === 'checkbox' ? input.checked : input.value;
  if (input.type === 'number' || input.type === 'range') {
    if (value.trim() === '' || !Number.isFinite(Number(value))) return;
    value = clamp(Number(value), Number(input.min), Number(input.max));
    if (isDoc) value = Math.round(value);
  }
  if (input.dataset.colorHex) {
    if (!/^#[\da-f]{6}$/i.test(value)) { input.setAttribute('aria-invalid', 'true'); return; }
    input.removeAttribute('aria-invalid');
  }
  if (!editingSnapshot) editingSnapshot = clone(project);
  if (!isDoc && target.type === 'image' && target.keepRatio && ['width', 'height'].includes(key)) {
    const other = key === 'width' ? 'height' : 'width';
    const scale = clamp(value / target[key], Math.max(0.001 / target.width, 0.001 / target.height), Math.min(16000 / target.width, 16000 / target.height));
    value = target[key] * scale; target[other] *= scale;
    const field = $(`[data-prop="${other}"]`); if (field) field.value = round(target[other]);
  }
  target[key] = value;
  if (['brightness', 'contrast', 'saturation'].includes(key)) {
    document.querySelectorAll(`[data-prop="${key}"]`).forEach(field => { if (field !== input) field.value = value; });
    const preview = $('.image-preview img'); if (preview) preview.style.filter = imageFilterCSS(target);
  }
  if (key === 'imageFilter') {
    const preview = $('.image-preview img'); if (preview) preview.style.filter = imageFilterCSS(target);
  }
  if (input.type === 'color') {
    const hex = document.querySelector(`[data-color-hex="${property}"]`); if (hex) hex.value = value.toUpperCase();
  } else if (input.dataset.colorHex) {
    const color = document.querySelector(`input[type="color"][data-prop="${property}"]`); if (color) color.value = value;
  }
  updateZoom(); renderScene(); renderLayers(); markDirty();
  $('#canvas-size').textContent = `${doc.width} × ${doc.height} px`;
  $('#dimensions-label').textContent = `${doc.width} × ${doc.height}`;
  if (isDoc) {
    updateExportUI();
    const format = pageFormat(doc);
    if ($('#preset')) $('#preset').value = format;
    $('#format-label').textContent = PAGE_FORMATS[format]?.label || 'Formato personalizado';
  }
  if (input.type === 'checkbox' || input.type === 'radio') { finishEditing(); renderInspector(); }
}
$('#inspector').addEventListener('input', event => {
  if (event.target.hasAttribute('data-selection-prop')) { applySelectionInput(event.target); return; }
  if (event.target.hasAttribute('data-edge-param')) {
    const element = selected(); if (!element || backgroundJob) return;
    if (edgeDraft?.id !== element.id) edgeDraft = { id: element.id, offset: element.edgeOffset, softness: element.edgeSoftness, definition: element.edgeDefinition };
    const key = event.target.dataset.edgeParam; edgeDraft[key] = Number(event.target.value);
    const output = $(`[data-edge-output="${key}"]`); if (output) output.textContent = `${edgeDraft[key] > 0 && key === 'offset' ? '+' : ''}${edgeDraft[key]} ${key === 'definition' ? '%' : 'px'}`;
    return;
  }
  if (event.target.hasAttribute('data-restore-size')) {
    if (!event.target.value || !Number.isFinite(Number(event.target.value))) return;
    brushSize = clamp(Math.round(Number(event.target.value)), 1, 500);
    document.querySelectorAll('[data-restore-size]').forEach(input => { if (input !== event.target) input.value = brushSize; });
    updateBrushCursor(); return;
  }
  applyInput(event.target);
});
$('#inspector').addEventListener('change', event => {
  if (event.target.id === 'preset') {
    const value = event.target.value;
    if (value === 'custom') { $('[data-prop="doc.width"]').focus(); return; }
    change(() => { [doc.width, doc.height] = [PAGE_FORMATS[value].width, PAGE_FORMATS[value].height]; fitMode = true; });
  } else { finishEditing(); if (event.target.tagName === 'SELECT') render(); }
});
$('#inspector').addEventListener('focusout', event => {
  finishEditing();
  if (event.target.hasAttribute('data-restore-size')) event.target.value = brushSize;
  if (event.target.hasAttribute('data-selection-prop')) renderInspector();
  if (event.target.type === 'number' && event.target.dataset.prop) {
    const property = event.target.dataset.prop;
    const target = property.startsWith('doc.') ? doc : selected();
    if (target) event.target.value = round(target[property.replace('doc.', '')]);
  }
  if (event.target.dataset.colorHex && event.target.getAttribute('aria-invalid')) {
    const property = event.target.dataset.colorHex; const target = property.startsWith('doc.') ? doc : selected();
    if (target) event.target.value = target[property.replace('doc.', '')].toUpperCase();
    event.target.removeAttribute('aria-invalid');
  }
});
$('#project-name').addEventListener('input', event => {
  if (!editingSnapshot) editingSnapshot = clone(project);
  project.name = event.target.value; $('#artboard-name').textContent = project.name; markDirty();
});
$('#project-name').addEventListener('blur', () => { if (!project.name.trim()) { project.name = 'Canvnail'; $('#project-name').value = project.name; } finishEditing(); });
$('#project-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 100_000_000) throw new Error('El proyecto supera los 100 MB admitidos en esta versión.');
    edgeDraft = null;
    const incoming = parseWorkspace(JSON.parse(await file.text()));
    await verifyProjectImages(incoming);
    change(() => { project = incoming; doc = activePage(project); setSelection([]); fitMode = true; });
    notify('Proyecto abierto. Puedes deshacer para recuperar el anterior.');
  } catch (error) { notify(error instanceof SyntaxError ? 'El archivo no contiene un proyecto JSON válido.' : error.message); }
  finally { event.target.value = ''; }
});
$('#new-dialog').addEventListener('close', event => {
  if (event.target.returnValue === 'create') change(() => { project = blankWorkspace(); doc = activePage(project); setSelection([]); fitMode = true; });
});

function point(event) {
  const bounds = $('#artboard').getBoundingClientRect();
  return { x: (event.clientX - bounds.left) * doc.width / bounds.width, y: (event.clientY - bounds.top) * doc.height / bounds.height };
}
$('#artboard').addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  finishEditing();
  if (drawingMode) { beginDrawing(event); return; }
  let restoring = brushElement();
  if (restoring) {
    const position = point(event), pixel = imagePoint(position, restoring);
    if (pixel.x < 0 || pixel.y < 0 || pixel.x > restoring.naturalWidth || pixel.y > restoring.naturalHeight) {
      finishRetouch(); return;
    }
    event.preventDefault();
    document.activeElement?.blur(); $('#viewport').focus({ preventScroll: true });
    brushStroke = { pointerId: event.pointerId, previous: pixel, before: clone(project), changed: restoreMode.surface.paint(pixel, pixel, brushSize, restoreMode.tool) };
    brushCursor = position; updateBrushCursor(); $('#artboard').setPointerCapture(event.pointerId); return;
  }
  if (restoreMode) return;
  const multiHandle = event.target.closest('[data-multi-handle]')?.dataset.multiHandle;
  const handle = event.target.closest('[data-rotate-handle]') ? 'rotate' : event.target.dataset.handle;
  const id = event.target.closest('[data-element-id]')?.dataset.elementId;
  const toggle = event.shiftKey || event.ctrlKey || event.metaKey;
  const doubleCandidate = id && !toggle && !handle && !multiHandle && lastCanvasClick?.id === id && performance.now() - lastCanvasClick.time < 400 && Math.hypot(event.clientX - lastCanvasClick.x, event.clientY - lastCanvasClick.y) < 5;
  if (id && toggle && !handle && !multiHandle) { event.preventDefault(); choose(id, true); return; }
  if (!id && !handle && !multiHandle) {
    event.preventDefault(); const start = point(event), beforeSelection = [...selectedIds];
    if (!toggle) setSelection([]);
    gesture = { kind: 'marquee', pointerId: event.pointerId, start, beforeSelection, base: toggle ? beforeSelection : [] };
    $('#artboard').setPointerCapture(event.pointerId); renderScene(); renderLayers(); renderInspector(); return;
  }
  if (id && !selectedIds.has(id)) choose(id);
  else if (id && selectedIds.size === 1 && doc.elements.find(e => e.id === id)?.groupId) choose(id);
  if (selectedElements().length > 1) {
    render(); if (!canTransformSelection()) return;
    event.preventDefault(); document.activeElement?.blur(); $('#viewport').focus({ preventScroll: true });
    gesture = { kind: 'multi', hitId: id, doubleCandidate, pointerId: event.pointerId, start: point(event), originals: clone(selectedElements()), bounds: selectionBox(selectedElements()), handle: multiHandle, before: clone(project) };
    $('#artboard').setPointerCapture(event.pointerId); return;
  }
  const element = selected(); if (!element) return;
  render();
  if (element.locked) return;
  event.preventDefault();
  const center = { x: element.x + element.width / 2, y: element.y + layout(element).height / 2 }, position = point(event);
  gesture = { hitId: id, doubleCandidate, pointerId: event.pointerId, start: position, original: clone(element), before: clone(project), handle, height: layout(element).height,
    center, startAngle: Math.atan2(position.y - center.y, position.x - center.x) * 180 / Math.PI };
  document.activeElement?.blur(); $('#viewport').focus({ preventScroll: true });
  $('#artboard').setPointerCapture(event.pointerId);
});
$('#viewport').addEventListener('pointerdown', event => {
  // A fill replaces the SVG children during pointerdown; use the original event path.
  if (event.button !== 0 || event.composedPath().includes($('#artboard')) || gesture) return;
  if (event.target.closest('button, input, textarea, select, a, [role="button"], [data-inline-editor]')) return;
  const viewport = $('#viewport'), bounds = viewport.getBoundingClientRect();
  // Using a scrollbar should not discard the current selection.
  if (event.clientX >= bounds.left + viewport.clientLeft + viewport.clientWidth || event.clientY >= bounds.top + viewport.clientTop + viewport.clientHeight) return;
  document.activeElement?.blur(); choose(null); viewport.focus({ preventScroll: true });
});
$('#artboard').addEventListener('pointermove', event => {
  if (drawingStroke?.pointerId === event.pointerId) { drawingMode.surface.move(drawingPoint(point(event)), event.shiftKey); return; }
  const restoring = brushElement();
  if (restoring) {
    brushCursor = point(event); updateBrushCursor();
    if (brushStroke?.pointerId === event.pointerId) {
      const pixel = imagePoint(brushCursor, restoring);
      brushStroke.changed = restoreMode.surface.paint(brushStroke.previous, pixel, brushSize, restoreMode.tool) || brushStroke.changed;
      brushStroke.previous = pixel;
    }
    return;
  }
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const position = point(event), dx = position.x - gesture.start.x, dy = position.y - gesture.start.y;
  if (gesture.kind === 'marquee') {
    const rect = { x: Math.min(position.x, gesture.start.x), y: Math.min(position.y, gesture.start.y), width: Math.abs(dx), height: Math.abs(dy) }; gesture.rect = rect;
    const ids = doc.elements.filter(e => e.visible && !e.locked).filter(e => { const b = rotatedBounds(e, layout(e).height); return b.x <= rect.x + rect.width && b.x + b.width >= rect.x && b.y <= rect.y + rect.height && b.y + b.height >= rect.y; }).map(e => e.id);
    setSelection(expandSelection(doc.elements, [...gesture.base, ...ids])); renderScene(); renderLayers(); renderInspector(); return;
  }
  if (gesture.kind === 'multi') {
    const box = gesture.bounds; let replacements;
    guides = [];
    if (gesture.handle) {
      const west = gesture.handle.includes('w'), north = gesture.handle.includes('n');
      const sx = 1 + (west ? -dx : dx) / box.width, sy = 1 + (north ? -dy : dy) / box.height;
      const scale = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy;
      replacements = scaleElements(gesture.originals, scale, { x: west ? box.x + box.width : box.x, y: north ? box.y + box.height : box.y }, e => layout(e).height);
    } else {
      const snapped = magnetic && !event.altKey ? snapToCanvas({ ...box, x: box.x + dx, y: box.y + dy }, doc, zoom) : { x: box.x + dx, y: box.y + dy, guides: [] };
      replacements = translateElements(gesture.originals, snapped.x - box.x, snapped.y - box.y); guides = snapped.guides;
    }
    const byId = new Map(replacements.map(e => [e.id, e])); doc.elements = doc.elements.map(e => byId.get(e.id) || e); renderScene(); return;
  }
  const index = doc.elements.findIndex(element => element.id === gesture.original.id);
  guides = [];
  if (gesture.handle === 'rotate') {
    const angle = normalizeAngle((gesture.original.rotation || 0) + Math.atan2(position.y - gesture.center.y, position.x - gesture.center.x) * 180 / Math.PI - gesture.startAngle);
    doc.elements[index].rotation = event.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle * 10) / 10;
    const input = $('[data-prop="rotation"]'); if (input) input.value = doc.elements[index].rotation;
  } else if (gesture.handle) {
    const delta = rotateVector({ x: dx, y: dy }, -(gesture.original.rotation || 0));
    const next = gesture.original.type === 'image'
      ? resizeImage(gesture.original, gesture.handle, delta.x, delta.y, event.shiftKey)
      : resizeText(gesture.original, gesture.handle, delta.x, delta.y, gesture.height, element => layout(element).height);
    doc.elements[index] = positionRotatedResize(gesture.original, next, gesture.height, layout(next).height);
  } else {
    const x = clamp(gesture.original.x + dx, -100000, 100000), y = clamp(gesture.original.y + dy, -100000, 100000);
    const bounds = rotatedBounds({ ...gesture.original, x, y }, gesture.height);
    const snapped = magnetic && !event.altKey ? snapToCanvas(bounds, doc, zoom) : { ...bounds, guides: [] };
    doc.elements[index].x = x + snapped.x - bounds.x; doc.elements[index].y = y + snapped.y - bounds.y; guides = snapped.guides;
  }
  renderScene();
});
function endGesture(event, cancel = false) {
  if (!gesture || (event && gesture.pointerId !== event.pointerId)) return;
  let editId = null;
  if (!cancel && event && gesture.hitId && !gesture.handle && Math.hypot(point(event).x - gesture.start.x, point(event).y - gesture.start.y) * zoom < 3) {
    if (gesture.doubleCandidate) { editId = gesture.hitId; lastCanvasClick = null; }
    else lastCanvasClick = { id: gesture.hitId, time: performance.now(), x: event.clientX, y: event.clientY };
  } else lastCanvasClick = null;
  const before = gesture.before; const pointerId = gesture.pointerId; const marquee = gesture.kind === 'marquee', beforeSelection = gesture.beforeSelection;
  gesture = null; guides = [];
  if ($('#artboard').hasPointerCapture(pointerId)) $('#artboard').releasePointerCapture(pointerId);
  if (marquee) { if (cancel) setSelection(beforeSelection); }
  else if (cancel) { project = before; doc = activePage(project); } else remember(before);
  render();
  if (editId) editIndividual(editId);
}
$('#artboard').addEventListener('pointerup', event => { if (drawingStroke?.pointerId === event.pointerId) finishDrawingStroke(); else if (brushStroke?.pointerId === event.pointerId) finishBrushStroke(); else endGesture(event); });
$('#artboard').addEventListener('pointercancel', event => { if (drawingStroke?.pointerId === event.pointerId) finishDrawingStroke(true); else if (brushStroke?.pointerId === event.pointerId) finishBrushStroke(true); else endGesture(event, true); });
$('#artboard').addEventListener('lostpointercapture', event => { if (drawingStroke?.pointerId === event.pointerId) finishDrawingStroke(true); else if (brushStroke?.pointerId === event.pointerId) finishBrushStroke(true); else if (gesture) endGesture(event, true); });
$('#artboard').addEventListener('pointerleave', () => { brushCursor = null; updateBrushCursor(); });
$('#artboard').addEventListener('dblclick', event => {
  if (restoreMode || drawingMode) return;
  // Pointer selection redraws the SVG; the original click target may have been detached.
  const id = event.target.closest('[data-element-id]')?.dataset.elementId || document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-element-id]')?.dataset.elementId;
  if (id) {
    editIndividual(id);
  }
});

$('#layer-list').addEventListener('dragstart', event => {
  draggedLayer = event.target.closest('[data-layer-id]')?.dataset.layerId;
  if (draggedLayer) { event.dataTransfer.setData('text/plain', draggedLayer); event.dataTransfer.effectAllowed = 'move'; }
});
$('#layer-list').addEventListener('dragover', event => {
  if (!draggedLayer) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.drop-target').forEach(node => node.classList.remove('drop-target'));
  event.target.closest('[data-layer-id]')?.classList.add('drop-target');
});
$('#layer-list').addEventListener('drop', event => {
  event.preventDefault();
  const target = event.target.closest('[data-layer-id]')?.dataset.layerId;
  if (draggedLayer && target && target !== draggedLayer) change(() => {
    const destination = doc.elements.findIndex(element => element.id === target);
    doc.elements = moveLayer(doc.elements, draggedLayer, destination);
  });
  draggedLayer = null; renderLayers();
});
$('#layer-list').addEventListener('dragend', () => { draggedLayer = null; renderLayers(); });

document.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if ($('#shortcuts-dialog').open) return;
  if (event.key === 'Escape') {
    if ($('#new-dialog').open) return;
    if (drawingMode) { event.preventDefault(); finishDrawingStroke(true); finishRetouch(); return; }
    if (restoreMode) { event.preventDefault(); stopRestoreMode(true); render(); $('#viewport').focus({ preventScroll: true }); return; }
    if (backgroundJob) { event.preventDefault(); actions['cancel-background'](); return; }
    if (gesture) endGesture(null, true); else { event.target.blur?.(); choose(null); }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); return; }
  if (isEditable(event.target) || $('#new-dialog').open) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (event.key === '?') { event.preventDefault(); $('#shortcuts-dialog').showModal(); }
  else if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  else if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
  else if (modifier && event.key.toLowerCase() === 'g') { event.preventDefault(); event.shiftKey ? ungroupSelected() : groupSelected(); }
  else if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicate(); }
  else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); }
  else if (!modifier && event.key.toLowerCase() === 't') { event.preventDefault(); addText(); }
  else if (event.key.startsWith('Arrow') && !restoreMode && !drawingMode && canTransformSelection()) {
    event.preventDefault(); const step = event.shiftKey ? 10 : 1;
    change(() => { const next = translateElements(selectedElements(), event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0, event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), replacements = new Map(next.map(e => [e.id,e])); doc.elements = doc.elements.map(e => replacements.get(e.id) || e); });
  }
});
window.addEventListener('pagehide', () => { finishInlineEdit(); finishDrawingStroke(); finishBrushStroke(); persist(); });
new ResizeObserver(() => { updateZoom(); renderScene(); }).observe($('#viewport'));
render();
if (storageAvailable) persist();
if (!storageAvailable) notify('No se pudo recuperar el guardado automático. Puedes abrir un proyecto desde un archivo.');
