import * as ort from '/vendor/onnx/ort.wasm.min.mjs';
import { MODEL_SIZE, prepareInput, maskToRGBA, applyMask } from './background-math.js';
import { refineAlpha } from './edge-math.js';

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = '/vendor/onnx/';
let session, sessionQuality;
self.onmessage = async event => {
  try {
    const { source, quality = 'fast', kind, original, settings } = event.data;
    if (kind === 'edges') {
      self.postMessage({ phase: 'Afinando los bordes en tu equipo…' });
      const image = await createImageBitmap(source), fullOriginal = await createImageBitmap(original);
      try {
        if (image.width !== fullOriginal.width || image.height !== fullOriginal.height) throw new Error('Las dimensiones del original no coinciden.');
        const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0); const base = ctx.getImageData(0, 0, image.width, image.height);
        ctx.clearRect(0, 0, image.width, image.height); ctx.drawImage(fullOriginal, 0, 0);
        const pixels = ctx.getImageData(0, 0, image.width, image.height);
        refineAlpha(base.data, pixels.data, image.width, image.height, settings); ctx.putImageData(base, 0, 0);
        self.postMessage({ blob: await canvas.convertToBlob({ type: 'image/png' }) });
      } finally { image.close(); fullOriginal.close(); }
      return;
    }
    if (session && sessionQuality !== quality) { await session.release(); session = null; }
    if (!session) {
      self.postMessage({ phase: quality === 'quality' ? 'Cargando Mayor calidad… La primera vez puede tardar más.' : 'Cargando el modo Rápido…' });
      session = await ort.InferenceSession.create(quality === 'quality' ? '/models/u2net.onnx' : '/models/u2netp.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      sessionQuality = quality;
    }
    self.postMessage({ phase: 'Analizando la imagen en tu equipo…' });
    const image = await createImageBitmap(source);
    try {
      const small = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE), ctx = small.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, MODEL_SIZE, MODEL_SIZE);
      const tensor = new ort.Tensor('float32', prepareInput(ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data), [1, 3, MODEL_SIZE, MODEL_SIZE]);
      const outputs = await session.run({ [session.inputNames[0]]: tensor });
      const prediction = outputs[session.outputNames[0]].data;
      const mask = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
      mask.getContext('2d').putImageData(new ImageData(maskToRGBA(prediction), MODEL_SIZE, MODEL_SIZE), 0, 0);
      tensor.dispose(); Object.values(outputs).forEach(output => output.dispose());
      self.postMessage({ phase: 'Conservando el detalle y la transparencia…' });
      const full = new OffscreenCanvas(image.width, image.height), fullCtx = full.getContext('2d', { willReadFrequently: true });
      fullCtx.imageSmoothingEnabled = true; fullCtx.imageSmoothingQuality = 'high';
      fullCtx.drawImage(mask, 0, 0, image.width, image.height);
      const fullMask = fullCtx.getImageData(0, 0, image.width, image.height);
      fullCtx.clearRect(0, 0, image.width, image.height); fullCtx.drawImage(image, 0, 0);
      const pixels = fullCtx.getImageData(0, 0, image.width, image.height);
      applyMask(pixels.data, fullMask.data); fullCtx.putImageData(pixels, 0, 0);
      const blob = await full.convertToBlob({ type: 'image/png' });
      self.postMessage({ blob });
    } finally { image.close(); }
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
