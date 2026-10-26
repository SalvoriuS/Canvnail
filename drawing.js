export const DRAW_TOOLS = { brush: 'Pincel', eraser: 'Borrador', fill: 'Cubo de relleno', line: 'Línea', arrow: 'Flecha', rectangle: 'Rectángulo', ellipse: 'Círculo' };

/** Flood only the connected region. Transparent RGB is deliberately ignored. */
export function floodFill(data, width, height, x, y, rgba, tolerance = 24) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const start = (y * width + x) * 4, target = Array.from(data.slice(start, start + 4));
  if (target.every((v, i) => v === rgba[i])) return false;
  const matches = index => Math.abs(data[index + 3] - target[3]) <= tolerance &&
    (target[3] === 0 && data[index + 3] === 0 || [0, 1, 2].every(c => Math.abs(data[index + c] - target[c]) <= tolerance));
  // One byte per pixel keeps traversal bounded even when new and target colors are close.
  const visited = new Uint8Array(width * height), pending = [y * width + x];
  while (pending.length) {
    const seed = pending.pop(), row = Math.floor(seed / width), col = seed % width;
    if (visited[seed] || !matches(seed * 4)) continue;
    let left = col, right = col;
    while (left > 0 && !visited[row * width + left - 1] && matches((row * width + left - 1) * 4)) left--;
    while (right + 1 < width && !visited[row * width + right + 1] && matches((row * width + right + 1) * 4)) right++;
    let above = false, below = false;
    for (let cx = left; cx <= right; cx++) {
      const pos = row * width + cx; visited[pos] = 1; data.set(rgba, pos * 4);
      const up = row > 0 && !visited[pos - width] && matches((pos - width) * 4);
      const down = row + 1 < height && !visited[pos + width] && matches((pos + width) * 4);
      if (up && !above) pending.push(pos - width);
      if (down && !below) pending.push(pos + width);
      above = up; below = down;
    }
  }
  return true;
}

export async function createDrawingSurface(src, width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none';
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (src) { const image = new Image(); image.src = src; await image.decode(); ctx.drawImage(image, 0, 0); }
  let stroke = null;
  const paint = (p, shift = false) => {
    if (!stroke) return;
    const { tool, start, previous, color, size, filled, backup } = stroke;
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (tool === 'brush' || tool === 'eraser') {
      ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      if (previous.x === p.x && previous.y === p.y) { ctx.beginPath(); ctx.arc(p.x, p.y, size / 2, 0, 2 * Math.PI); ctx.fill(); }
    } else {
      ctx.clearRect(0, 0, width, height); ctx.drawImage(backup, 0, 0);
      let dx = p.x - start.x, dy = p.y - start.y;
      if (shift) {
        if (tool === 'rectangle' || tool === 'ellipse') { const side = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * side; dy = Math.sign(dy || 1) * side; }
        else { const length = Math.hypot(dx, dy), angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4; dx = Math.cos(angle) * length; dy = Math.sin(angle) * length; }
      }
      ctx.beginPath();
      if (tool === 'rectangle') ctx.rect(start.x, start.y, dx, dy);
      else if (tool === 'ellipse') ctx.ellipse(start.x + dx / 2, start.y + dy / 2, Math.abs(dx / 2), Math.abs(dy / 2), 0, 0, 2 * Math.PI);
      else { ctx.moveTo(start.x, start.y); ctx.lineTo(start.x + dx, start.y + dy); }
      if (filled && ['rectangle', 'ellipse'].includes(tool)) ctx.fill();
      ctx.stroke();
      if (tool === 'arrow' && Math.hypot(dx, dy) > 0) {
        const angle = Math.atan2(dy, dx), head = Math.min(Math.hypot(dx, dy), Math.max(12, size * 3));
        ctx.beginPath(); ctx.moveTo(start.x + dx, start.y + dy);
        ctx.lineTo(start.x + dx - head * Math.cos(angle - Math.PI / 6), start.y + dy - head * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(start.x + dx, start.y + dy);
        ctx.lineTo(start.x + dx - head * Math.cos(angle + Math.PI / 6), start.y + dy - head * Math.sin(angle + Math.PI / 6)); ctx.stroke();
      }
    }
    stroke.previous = p;
    ctx.globalCompositeOperation = 'source-over';
  };
  return {
    canvas,
    begin(tool, p, color, size, filled) {
      if (tool === 'fill') {
        const pixels = ctx.getImageData(0, 0, width, height);
        const rgba = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)).concat(255);
        if (floodFill(pixels.data, width, height, p.x, p.y, rgba)) ctx.putImageData(pixels, 0, 0);
        return;
      }
      const backup = document.createElement('canvas'); backup.width = width; backup.height = height; backup.getContext('2d').drawImage(canvas, 0, 0);
      stroke = { tool, start: p, previous: p, color, size, filled, backup };
      if (tool === 'brush' || tool === 'eraser') paint(p);
    },
    move: paint,
    finish(cancel = false) {
      if (stroke) {
        if (cancel) { ctx.clearRect(0, 0, width, height); ctx.drawImage(stroke.backup, 0, 0); }
        stroke.backup.width = stroke.backup.height = 0; stroke = null;
      }
    },
    snapshot: () => canvas.toDataURL('image/png'),
    dispose() { if (stroke) stroke.backup.width = stroke.backup.height = 0; stroke = null; canvas.width = canvas.height = 0; canvas.remove(); },
  };
}
