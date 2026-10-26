let worker = null;
let active = null;

function destroy() { if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); } worker = null; }
function finish(error, value) {
  const request = active; active = null;
  if (!request) return;
  error ? request.reject(error) : request.resolve(value);
}

export async function removeBackground(src, onProgress = () => {}, options = {}) {
  return processImage(src, onProgress, { quality: options.quality === 'quality' ? 'quality' : 'fast' });
}
export async function refineEdges(src, originalSrc, settings, onProgress = () => {}) {
  return processImage(src, onProgress, { kind: 'edges', originalSrc, settings });
}
async function processImage(src, onProgress, options) {
  if (active) throw new Error('Ya se está procesando una imagen.');
  if (!worker) {
    worker = new Worker(new URL('./background-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = event => {
      if (event.data.phase) active?.onProgress(event.data.phase);
      else if (event.data.error) {
        console.error('Canvnail: eliminación local de fondo:', event.data.error);
        destroy(); finish(new Error('No se ha podido completar el recorte. Prueba el modo Rápido o comprueba la instalación de los modelos locales.'));
      } else finish(null, event.data.blob);
    };
    worker.onerror = event => {
      event.preventDefault(); destroy(); finish(new Error('No se ha podido iniciar el procesador local. Recarga el editor y comprueba que el modelo está instalado.'));
    };
  }
  return new Promise((resolve, reject) => {
    active = { resolve, reject, onProgress };
    Promise.all([fetch(src).then(response => response.blob()), options.originalSrc ? fetch(options.originalSrc).then(response => response.blob()) : null]).then(([source, original]) => {
      if (active?.resolve === resolve) worker.postMessage({ source, ...options, original });
    }).catch(error => { if (active?.resolve === resolve) finish(error); });
  });
}

export function cancelBackground() {
  if (!active) return;
  destroy(); finish(new DOMException('Proceso cancelado', 'AbortError'));
}
