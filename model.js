export const FONTS = ['Comic Sans MS', 'Arial', 'Arial Black', 'Impact', 'Georgia', 'Trebuchet MS', 'Verdana', 'Tahoma', 'Times New Roman', 'Segoe UI', 'Courier New'];
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const clone = value => structuredClone(value);
export const uid = () => globalThis.crypto.randomUUID();
export const IMAGE_FILTERS = { none: 'Original', grayscale: 'Blanco y negro', sepia: 'Sepia', invert: 'Negativo' };
export const imageFilterCSS = element => {
  const brightness = element.brightness ?? 100, contrast = element.contrast ?? 100, saturation = element.saturation ?? 100;
  const preset = { grayscale: 'grayscale(1)', sepia: 'sepia(1)', invert: 'invert(1)' }[element.imageFilter] || '';
  return brightness === 100 && contrast === 100 && saturation === 100 && !preset ? 'none'
    : `brightness(${brightness / 100}) contrast(${contrast / 100}) saturate(${saturation / 100})${preset ? ` ${preset}` : ''}`;
};
export const blankDocument = () => ({ version: 2, name: 'Canvnail', width: 1280, height: 720, background: '#ffffff', transparent: false, elements: [] });
export const PAGE_FORMATS = {
  youtube: { label: 'Miniatura de YouTube', width: 1280, height: 720 },
  vertical: { label: 'Short / Reel · vertical', width: 1080, height: 1920 },
  a4: { label: 'A4 · folio vertical', width: 2480, height: 3508 },
  'a4-landscape': { label: 'A4 · folio horizontal', width: 3508, height: 2480 },
};
export const pageFormat = page => Object.keys(PAGE_FORMATS).find(key => PAGE_FORMATS[key].width === page.width && PAGE_FORMATS[key].height === page.height) || 'custom';
export function newPage(format = 'youtube') {
  const { width, height } = PAGE_FORMATS[format] || PAGE_FORMATS.youtube;
  return { id: uid(), width, height, background: '#ffffff', transparent: false, elements: [] };
}
export function blankWorkspace() {
  const page = newPage(); return { version: 3, name: 'Canvnail', activePageId: page.id, pages: [page] };
}
export const activePage = project => project.pages.find(page => page.id === project.activePageId) || project.pages[0];
/** Version 3 stores independent pages; versions 1/2 migrate without dropping content. */
export function parseWorkspace(value) {
  if (value?.version !== 3) {
    const legacy = parseProject(value), { version, name, ...page } = legacy;
    page.id = uid(); return { version: 3, name, activePageId: page.id, pages: [page] };
  }
  if (typeof value.name !== 'string' || value.name.length > 120 || !Array.isArray(value.pages) || !value.pages.length || value.pages.length > 100) throw new Error('El proyecto admite entre 1 y 100 páginas.');
  const ids = new Set(); let elements = 0;
  const pages = value.pages.map(input => {
    if (!input || typeof input.id !== 'string' || !input.id || input.id.length > 100 || ids.has(input.id)) throw new Error('Hay una página no válida o repetida.');
    ids.add(input.id);
    const parsed = parseProject({ ...input, version: 2, name: value.name });
    elements += parsed.elements.length;
    const { version, name, ...page } = parsed; return { id: input.id, ...page };
  });
  if (elements > 5000 || !ids.has(value.activePageId)) throw new Error('El proyecto contiene demasiados elementos o una página activa no válida.');
  return { version: 3, name: value.name, activePageId: value.activePageId, pages };
}
export const newText = (doc, id = uid()) => ({
  id, type: 'text', text: 'Tu texto', x: Math.max(0, (doc.width - 440) / 2), y: Math.max(0, doc.height / 2 - 70),
  width: 440, fontFamily: 'Comic Sans MS', fontSize: 80, bold: true, italic: false, align: 'center',
  fill: '#ffffff', outline: true, strokeColor: '#202c45', strokeWidth: 4,
  background: true, backgroundColor: '#ffcc66', paddingX: 24, paddingY: 16, radius: 16,
  visible: true, locked: false, rotation: 0, groupId: null,
});

export function newImage(doc, { src, name, naturalWidth, naturalHeight }, id = uid()) {
  const scale = Math.min(1, doc.width * 0.75 / naturalWidth, doc.height * 0.75 / naturalHeight);
  const width = naturalWidth * scale, height = naturalHeight * scale;
  return { id, type: 'image', name, src, originalSrc: null, drawing: false, naturalWidth, naturalHeight, width, height,
    brightness: 100, contrast: 100, saturation: 100, imageFilter: 'none',
    backgroundQuality: 'fast', cutoutQuality: null, edgeBaseSrc: null, edgeOffset: 0, edgeSoftness: 0, edgeDefinition: 0,
    x: (doc.width - width) / 2, y: (doc.height - height) / 2, keepRatio: true, visible: true, locked: false, rotation: 0, groupId: null };
}

export function expandSelection(elements, ids) {
  const selected = new Set(ids), groups = new Set(elements.filter(e => selected.has(e.id) && e.groupId).map(e => e.groupId));
  return elements.filter(e => selected.has(e.id) || groups.has(e.groupId)).map(e => e.id);
}
export function normalizeGroups(elements) {
  const counts = new Map(); elements.forEach(e => { if (e.groupId) counts.set(e.groupId, (counts.get(e.groupId) || 0) + 1); });
  elements.forEach(e => { if (e.groupId && counts.get(e.groupId) < 2) e.groupId = null; });
  return elements;
}
export function selectionBounds(elements, heightOf = e => e.height) {
  if (!elements.length) return null;
  const boxes = elements.map(e => rotatedBounds(e, heightOf(e)));
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
}
/** Apply one constrained delta to retain spacing at the position limits. */
export function translateElements(elements, dx, dy) {
  dx = clamp(dx, Math.max(...elements.map(e => -100000 - e.x)), Math.min(...elements.map(e => 100000 - e.x)));
  dy = clamp(dy, Math.max(...elements.map(e => -100000 - e.y)), Math.min(...elements.map(e => 100000 - e.y)));
  return elements.map(e => ({ ...e, x: e.x + dx, y: e.y + dy }));
}
/** Uniform scaling avoids shearing rotated items and keeps text effects editable. */
export function scaleElements(elements, requestedScale, anchor, heightOf) {
  let min = 0, max = Infinity;
  for (const e of elements) {
    min = Math.max(min, (e.type === 'text' ? 32 : 1) / e.width, e.type === 'text' ? 4 / e.fontSize : 1 / e.height);
    max = Math.min(max, 16000 / e.width, e.type === 'text' ? 600 / e.fontSize : 16000 / e.height);
    if (e.type === 'text') for (const key of ['paddingX', 'paddingY', 'radius', 'strokeWidth']) if (e[key]) max = Math.min(max, 2000 / e[key]);
    for (const key of ['x', 'y']) {
      const delta = e[key] - anchor[key];
      if (delta) { const a = (-100000 - anchor[key]) / delta, b = (100000 - anchor[key]) / delta; min = Math.max(min, Math.min(a, b)); max = Math.min(max, Math.max(a, b)); }
    }
  }
  const scale = clamp(requestedScale, min, max);
  return elements.map(e => {
    const h = heightOf(e), next = { ...e, width: clamp(e.width * scale, e.type === 'text' ? 32 : 1, 16000) };
    if (e.type === 'image') next.height = clamp(e.height * scale, 1, 16000);
    else for (const key of ['fontSize', 'paddingX', 'paddingY', 'radius', 'strokeWidth']) next[key] = clamp(e[key] * scale, key === 'fontSize' ? 4 : 0, key === 'fontSize' ? 600 : 2000);
    const center = { x: anchor.x + (e.x + e.width / 2 - anchor.x) * scale, y: anchor.y + (e.y + h / 2 - anchor.y) * scale };
    next.x = clamp(center.x - next.width / 2, -100000, 100000); next.y = clamp(center.y - heightOf(next) / 2, -100000, 100000);
    return next;
  });
}

export const normalizeAngle = angle => ((angle + 180) % 360 + 360) % 360 - 180;
export function rotateVector(point, angle) {
  const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}
export function localToWorld(point, element, height = element.height) {
  const rotated = rotateVector({ x: point.x - element.width / 2, y: point.y - height / 2 }, element.rotation || 0);
  return { x: element.x + element.width / 2 + rotated.x, y: element.y + height / 2 + rotated.y };
}
export function worldToLocal(point, element, height = element.height) {
  const rotated = rotateVector({ x: point.x - element.x - element.width / 2, y: point.y - element.y - height / 2 }, -(element.rotation || 0));
  return { x: element.width / 2 + rotated.x, y: height / 2 + rotated.y };
}
export function rotatedBounds(element, height = element.height) {
  const corners = [[0, 0], [element.width, 0], [0, height], [element.width, height]].map(([x, y]) => localToWorld({ x, y }, element, height));
  const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
  return { x, y, width: Math.max(...corners.map(p => p.x)) - x, height: Math.max(...corners.map(p => p.y)) - y };
}
/** Existing resize functions work on local axes; rotate their center shift back to the page. */
export function positionRotatedResize(original, next, oldHeight, newHeight) {
  if (!original.rotation) return next;
  const shift = rotateVector({ x: next.x - original.x + (next.width - original.width) / 2, y: next.y - original.y + (newHeight - oldHeight) / 2 }, original.rotation);
  return { ...next, x: original.x + original.width / 2 + shift.x - next.width / 2, y: original.y + oldHeight / 2 + shift.y - newHeight / 2 };
}

/** All handle directions retain the opposite anchor; Shift temporarily inverts ratio locking. */
export function resizeImage(original, handle, dx, dy, invertRatio = false) {
  const west = handle.includes('w'), north = handle.includes('n');
  const horizontal = handle.includes('w') || handle.includes('e');
  const vertical = handle.includes('n') || handle.includes('s');
  const keepRatio = original.keepRatio !== invertRatio;
  let width = original.width + (horizontal ? (west ? -dx : dx) : 0);
  let height = original.height + (vertical ? (north ? -dy : dy) : 0);
  if (keepRatio) {
    let scale = horizontal ? width / original.width : height / original.height;
    if (horizontal && vertical && Math.abs(dy / original.height) > Math.abs(dx / original.width)) scale = height / original.height;
    scale = clamp(scale, Math.max(1 / original.width, 1 / original.height), Math.min(16000 / original.width, 16000 / original.height));
    width = original.width * scale; height = original.height * scale;
  } else { width = clamp(width, 1, 16000); height = clamp(height, 1, 16000); }
  return { ...original, width, height,
    x: west ? original.x + original.width - width : !horizontal ? original.x + (original.width - width) / 2 : original.x,
    y: north ? original.y + original.height - height : !vertical ? original.y + (original.height - height) / 2 : original.y };
}

/** A six-screen-pixel attraction zone is consistent at any zoom; no cumulative drift. */
export function snapToCanvas({ x, y, width, height }, canvas, zoom, threshold = 6) {
  const tolerance = threshold / zoom;
  const snapAxis = (position, size, extent) => {
    let best = null;
    for (const [offset, target] of [[0, 0], [size / 2, extent / 2], [size, extent]]) {
      const delta = target - (position + offset);
      if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, target };
    }
    return best ? { position: position + best.delta, target: best.target } : { position, target: null };
  };
  const sx = snapAxis(x, width, canvas.width), sy = snapAxis(y, height, canvas.height);
  return { x: sx.position, y: sy.position, guides: [
    ...(sx.target === null ? [] : [{ axis: 'x', value: sx.target }]),
    ...(sy.target === null ? [] : [{ axis: 'y', value: sy.target }]),
  ] };
}

/** Wrap in document pixels. Explicit line breaks and long unbroken words survive. */
export function wrapText(text, maxWidth, measure) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/u)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const char of word) {
        if (line && measure(line + char) > maxWidth) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

export function textLayout(element, measure) {
  const inset = element.outline ? element.strokeWidth / 2 : 0;
  const available = Math.max(1, element.width - element.paddingX * 2 - inset * 2);
  const lines = wrapText(element.text, available, measure);
  const lineHeight = element.fontSize * 1.25;
  return { lines, lineHeight, inset, height: lines.length * lineHeight + element.paddingY * 2 + inset * 2 };
}

/** Horizontal handles reflow text; corners scale the whole text object. */
export function resizeText(original, handle, dx, dy, originalHeight, layoutHeight) {
  const west = handle.includes('w');
  const north = handle.includes('n');
  const corner = handle.length === 2;
  let widthDelta = west ? -dx : dx;
  if (corner && Math.abs(dy) > Math.abs(dx * originalHeight / original.width)) {
    widthDelta = (north ? -dy : dy) * original.width / originalHeight;
  }
  const next = clone(original);
  next.width = clamp(original.width + widthDelta, 32, 16000);
  if (corner) {
    const scale = clamp(next.width / original.width, 4 / original.fontSize, 600 / original.fontSize);
    next.width = original.width * scale;
    for (const key of ['fontSize', 'paddingX', 'paddingY', 'strokeWidth', 'radius']) next[key] = clamp(original[key] * scale, 0, key === 'fontSize' ? 600 : 2000);
  }
  if (west) next.x = original.x + original.width - next.width;
  if (north) next.y = original.y + originalHeight - layoutHeight(next);
  return next;
}

export function moveLayer(elements, id, destination) {
  const result = [...elements];
  const index = result.findIndex(element => element.id === id);
  if (index < 0) return result;
  const [element] = result.splice(index, 1);
  result.splice(clamp(destination, 0, result.length), 0, element);
  return result;
}

const numberIn = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value);
const embeddedImage = value => typeof value === 'string' && value.length <= 40_000_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value);
/** Rebuild from known fields; a project is data, never HTML or executable code. */
export function parseProject(value) {
  if (!value || ![1, 2].includes(value.version) || !Array.isArray(value.elements) || value.elements.length > 500) throw new Error('El archivo no es un proyecto Canvnail compatible.');
  if (!numberIn(value.width, 64, 8192) || !numberIn(value.height, 64, 8192) || !color(value.background)) throw new Error('Las dimensiones o el fondo del proyecto no son válidos.');
  if (value.transparent !== undefined && typeof value.transparent !== 'boolean') throw new Error('La transparencia del lienzo no es válida.');
  if (typeof value.name !== 'string' || value.name.length > 120) throw new Error('El nombre del proyecto no es válido.');
  const ids = new Set();
  const elements = value.elements.map(input => {
    if (!input || !['text', 'image'].includes(input.type) || typeof input.id !== 'string' || !input.id || input.id.length > 100 || ids.has(input.id)) throw new Error('El proyecto contiene elementos no válidos o repetidos.');
    ids.add(input.id);
    if (input.rotation !== undefined && !numberIn(input.rotation, -360, 360)) throw new Error('El ángulo de giro no es válido.');
    if (input.groupId != null && (typeof input.groupId !== 'string' || !input.groupId || input.groupId.length > 100)) throw new Error('El grupo no es válido.');
    for (const key of ['x', 'y']) if (!numberIn(input[key], -100000, 100000)) throw new Error('Hay una posición no válida.');
    for (const key of ['visible', 'locked']) if (typeof input[key] !== 'boolean') throw new Error('Hay una propiedad de capa no válida.');
    if (input.type === 'image') {
      if (!embeddedImage(input.src) || (input.originalSrc != null && !embeddedImage(input.originalSrc))) throw new Error('La imagen debe estar incluida en el proyecto en formato PNG, JPG o WebP.');
      if (typeof input.name !== 'string' || input.name.length > 200 || typeof input.keepRatio !== 'boolean') throw new Error('Hay una imagen no válida.');
      for (const key of ['naturalWidth', 'naturalHeight']) if (!numberIn(input[key], 1, 32000)) throw new Error('La resolución de la imagen no es válida.');
      if (input.naturalWidth * input.naturalHeight > 32_000_000) throw new Error('La imagen supera los 32 millones de píxeles admitidos.');
      for (const key of ['width', 'height']) if (!numberIn(input[key], 0.001, 16000)) throw new Error('El tamaño de la imagen no es válido.');
      for (const key of ['brightness', 'contrast', 'saturation']) if (input[key] !== undefined && !numberIn(input[key], 0, 200)) throw new Error('Hay un ajuste de imagen no válido.');
      if (input.imageFilter !== undefined && !Object.hasOwn(IMAGE_FILTERS, input.imageFilter)) throw new Error('El filtro de imagen no es válido.');
      if (input.drawing !== undefined && typeof input.drawing !== 'boolean') throw new Error('La capa de dibujo no es válida.');
      if (input.edgeBaseSrc != null && !embeddedImage(input.edgeBaseSrc)) throw new Error('La base del recorte no es válida.');
      if (input.edgeBaseSrc && !input.originalSrc) throw new Error('El recorte necesita conservar el original.');
      if (input.backgroundQuality !== undefined && !['fast', 'quality'].includes(input.backgroundQuality)) throw new Error('La calidad del recorte no es válida.');
      if (input.cutoutQuality != null && !['fast', 'quality'].includes(input.cutoutQuality)) throw new Error('El modo del recorte no es válido.');
      for (const [key, min, max] of [['edgeOffset', -8, 8], ['edgeSoftness', 0, 8], ['edgeDefinition', 0, 100]]) {
        if (input[key] !== undefined && (!numberIn(input[key], min, max) || !Number.isInteger(input[key]))) throw new Error('Hay un ajuste de borde no válido.');
      }
      const result = newImage(value, input, input.id);
      for (const key of Object.keys(result)) {
        if (['groupId', 'rotation', 'backgroundQuality', 'cutoutQuality', 'edgeBaseSrc', 'edgeOffset', 'edgeSoftness', 'edgeDefinition', 'drawing', 'brightness', 'contrast', 'saturation', 'imageFilter'].includes(key) && input[key] === undefined) continue;
        result[key] = key === 'originalSrc' ? input.originalSrc ?? null : input[key];
      }
      return result;
    }
    if (typeof input.text !== 'string' || input.text.length > 20000 || !FONTS.includes(input.fontFamily) || !['left', 'center', 'right'].includes(input.align)) throw new Error('Hay un texto o una fuente no válidos.');
    for (const key of ['fill', 'strokeColor', 'backgroundColor']) if (!color(input[key])) throw new Error('Hay un color no válido.');
    for (const key of ['bold', 'italic', 'outline', 'background', 'visible', 'locked']) if (typeof input[key] !== 'boolean') throw new Error('Hay una propiedad no válida.');
    if (!numberIn(input.width, 32, 16000) || !numberIn(input.fontSize, 4, 600)) throw new Error('Hay un tamaño de texto no válido.');
    for (const key of ['paddingX', 'paddingY', 'radius', 'strokeWidth']) if (!numberIn(input[key], 0, 2000)) throw new Error('Hay un efecto de texto no válido.');
    const result = newText(value, input.id);
    for (const key of Object.keys(result)) result[key] = key === 'rotation' ? input.rotation ?? 0 : key === 'groupId' ? input.groupId ?? null : input[key];
    return result;
  });
  return { version: 2, name: value.name === 'Sin título' ? 'Canvnail' : value.name, width: value.width, height: value.height, background: value.background, transparent: value.transparent ?? false, elements: normalizeGroups(elements) };
}
