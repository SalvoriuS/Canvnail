/** Separable sliding min/max, with clamped image boundaries. O(width * height). */
function morphAxis(input, width, height, radius, horizontal, expand) {
  const output = new Float32Array(input.length), length = horizontal ? width : height, rows = horizontal ? height : width;
  const queue = new Int32Array(length + radius * 2 + 1);
  for (let row = 0; row < rows; row++) {
    let head = 0, tail = 0;
    const index = x => horizontal ? row * width + Math.max(0, Math.min(length - 1, x)) : Math.max(0, Math.min(length - 1, x)) * width + row;
    for (let x = -radius; x < length + radius; x++) {
      const value = input[index(x)];
      while (tail > head && (expand ? input[index(queue[tail - 1])] <= value : input[index(queue[tail - 1])] >= value)) tail--;
      queue[tail++] = x;
      while (tail > head && queue[head] < x - radius * 2) head++;
      const center = x - radius;
      if (center >= 0) output[horizontal ? row * width + center : center * width + row] = input[index(queue[head])];
    }
  }
  return output;
}
function blurAxis(input, width, height, radius, horizontal) {
  const output = new Float32Array(input.length), length = horizontal ? width : height, rows = horizontal ? height : width;
  for (let row = 0; row < rows; row++) {
    const index = x => horizontal ? row * width + Math.max(0, Math.min(length - 1, x)) : Math.max(0, Math.min(length - 1, x)) * width + row;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += input[index(k)];
    for (let x = 0; x < length; x++) {
      output[index(x)] = sum / (radius * 2 + 1);
      sum += input[index(x + radius + 1)] - input[index(x - radius)];
    }
  }
  return output;
}
export function refineAlpha(base, original, width, height, { offset = 0, softness = 0, definition = 0 } = {}) {
  let mask = new Float32Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = original[i * 4 + 3] ? Math.min(1, base[i * 4 + 3] / original[i * 4 + 3]) : 0;
  const radius = Math.min(8, Math.abs(Math.round(offset))), blur = Math.max(0, Math.min(8, Math.round(softness)));
  if (radius) mask = morphAxis(morphAxis(mask, width, height, radius, true, offset > 0), width, height, radius, false, offset > 0);
  if (blur) {
    // Two box passes provide a smooth falloff without modifying RGB or original alpha.
    for (let pass = 0; pass < 2; pass++) mask = blurAxis(blurAxis(mask, width, height, blur, true), width, height, blur, false);
  }
  const contrast = 1 + Math.max(0, Math.min(100, definition)) / 25;
  for (let i = 0; i < mask.length; i++) {
    const alpha = Math.max(0, Math.min(1, (mask[i] - .5) * contrast + .5));
    base[i * 4] = original[i * 4]; base[i * 4 + 1] = original[i * 4 + 1]; base[i * 4 + 2] = original[i * 4 + 2];
    base[i * 4 + 3] = Math.round(original[i * 4 + 3] * alpha);
  }
  return base;
}
