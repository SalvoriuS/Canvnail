import { restoreRegion } from './restore-math.js';

export async function createRestoreBrush(currentSrc, originalSrc) {
  const load = async src => { const image = new Image(); image.src = src; await image.decode(); return image; };
  const [current, original] = await Promise.all([load(currentSrc), load(originalSrc)]);
  if (current.naturalWidth !== original.naturalWidth || current.naturalHeight !== original.naturalHeight) throw new Error('El original y el recorte tienen tamaños distintos.');
  const width = current.naturalWidth, height = current.naturalHeight;
  const originalCanvas = document.createElement('canvas'); originalCanvas.width = width; originalCanvas.height = height;
  const originalContext = originalCanvas.getContext('2d', { willReadFrequently: true }); originalContext.drawImage(original, 0, 0);
  let originalPixels = originalContext.getImageData(0, 0, width, height).data;
  originalCanvas.width = originalCanvas.height = 0;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none';
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(current, 0, 0);
  return {
    canvas,
    paint(from, to, diameter, tool = 'restore') {
      const radius = diameter / 2;
      const x = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius - 1));
      const y = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius - 1));
      const right = Math.min(width, Math.ceil(Math.max(from.x, to.x) + radius + 1));
      const bottom = Math.min(height, Math.ceil(Math.max(from.y, to.y) + radius + 1));
      if (x >= right || y >= bottom) return false;
      const bounds = { x, y, width: right - x, height: bottom - y };
      const patch = ctx.getImageData(x, y, bounds.width, bounds.height);
      const changed = restoreRegion(originalPixels, patch.data, width, bounds, from, to, radius, tool);
      if (changed) ctx.putImageData(patch, x, y);
      return changed;
    },
    snapshot: () => canvas.toDataURL('image/png'),
    dispose() { originalPixels = null; canvas.width = canvas.height = 0; canvas.remove(); },
  };
}
