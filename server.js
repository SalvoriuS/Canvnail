import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/model.js', ['model.js', 'text/javascript; charset=utf-8']],
  ['/exports.js', ['exports.js', 'text/javascript; charset=utf-8']],
  ['/vendor/pdf-lib.esm.min.js', ['node_modules/pdf-lib/dist/pdf-lib.esm.min.js', 'text/javascript; charset=utf-8']],
  ['/media.js', ['media.js', 'text/javascript; charset=utf-8']],
  ['/storage.js', ['storage.js', 'text/javascript; charset=utf-8']],
  ['/background.js', ['background.js', 'text/javascript; charset=utf-8']],
  ['/background-worker.js', ['background-worker.js', 'text/javascript; charset=utf-8']],
  ['/background-math.js', ['background-math.js', 'text/javascript; charset=utf-8']],
  ['/edge-math.js', ['edge-math.js', 'text/javascript; charset=utf-8']],
  ['/restore-brush.js', ['restore-brush.js', 'text/javascript; charset=utf-8']],
  ['/restore-math.js', ['restore-math.js', 'text/javascript; charset=utf-8']],
  ['/drawing.js', ['drawing.js', 'text/javascript; charset=utf-8']],
  ['/models/u2netp.onnx', ['models/u2netp.onnx', 'application/octet-stream']],
  ['/models/u2net.onnx', ['models/u2net.onnx', 'application/octet-stream']],
  ['/vendor/onnx/ort.wasm.min.mjs', ['node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', 'text/javascript; charset=utf-8']],
  ['/vendor/onnx/ort-wasm-simd-threaded.mjs', ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'text/javascript; charset=utf-8']],
  ['/vendor/onnx/ort-wasm-simd-threaded.wasm', ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'application/wasm']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/workspace.css', ['workspace.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
const server = createServer(async (req, res) => {
  const entry = files.get(new URL(req.url, 'http://127.0.0.1').pathname);
  if (!entry || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404); res.end('No encontrado'); return;
  }
  try {
    const bytes = await readFile(new URL(entry[0], import.meta.url));
    res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch {
    res.writeHead(500); res.end('No se ha podido cargar el editor.');
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Canvnail listo: http://127.0.0.1:${server.address().port}`));
