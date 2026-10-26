export const MODEL_SIZE = 320;

/** U²-Net RGB normalization, planar NCHW. Transparent input is composited on white for inference. */
export function prepareInput(rgba) {
  const count = rgba.length / 4;
  const rgb = new Float32Array(count * 3);
  let max = 1e-6;
  for (let i = 0; i < count; i++) {
    const alpha = rgba[i * 4 + 3] / 255;
    for (let channel = 0; channel < 3; channel++) {
      const value = rgba[i * 4 + channel] * alpha + 255 * (1 - alpha);
      rgb[channel * count + i] = value;
      max = Math.max(max, value);
    }
  }
  const mean = [.485, .456, .406], std = [.229, .224, .225];
  for (let channel = 0; channel < 3; channel++) {
    for (let i = 0; i < count; i++) rgb[channel * count + i] = (rgb[channel * count + i] / max - mean[channel]) / std[channel];
  }
  return rgb;
}

export function maskToRGBA(prediction) {
  let min = Infinity, max = -Infinity;
  for (const value of prediction) { if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); } }
  const rgba = new Uint8ClampedArray(prediction.length * 4);
  for (let i = 0; i < prediction.length; i++) {
    // A flat prediction is ambiguous; do not turn the entire input into an invisible result.
    const value = max - min > 1e-6 ? (prediction[i] - min) / (max - min) : 1;
    const gray = Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 255);
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = gray; rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** Combine masks rather than replacing alpha, preserving any pre-existing transparency. */
export function applyMask(rgba, maskRGBA) {
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = Math.round(rgba[i] * maskRGBA[i - 3] / 255);
  return rgba;
}
