/** Paint a continuous restore/erase stroke, interpolating in premultiplied alpha. */
export function restoreRegion(original, patch, fullWidth, bounds, from, to, radius, tool = 'restore') {
  const dx = to.x - from.x, dy = to.y - from.y, length2 = dx * dx + dy * dy;
  let changed = false;
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      const px = x + .5, py = y + .5;
      const t = length2 ? Math.min(1, Math.max(0, ((px - from.x) * dx + (py - from.y) * dy) / length2)) : 0;
      const distance = Math.hypot(px - from.x - t * dx, py - from.y - t * dy);
      const coverage = Math.min(1, Math.max(0, radius + .5 - distance));
      if (!coverage) continue;
      const i = ((y - bounds.y) * bounds.width + x - bounds.x) * 4, source = (y * fullWidth + x) * 4;
      const oldAlpha = patch[i + 3], sourceAlpha = tool === 'erase' ? 0 : original[source + 3];
      const alpha = oldAlpha * (1 - coverage) + sourceAlpha * coverage;
      for (let channel = 0; channel < 3; channel++) {
        const value = alpha ? Math.round((patch[i + channel] * oldAlpha * (1 - coverage) + original[source + channel] * sourceAlpha * coverage) / alpha) : 0;
        if (patch[i + channel] !== value) { patch[i + channel] = value; changed = true; }
      }
      const nextAlpha = Math.round(alpha);
      if (patch[i + 3] !== nextAlpha) { patch[i + 3] = nextAlpha; changed = true; }
    }
  }
  return changed;
}
