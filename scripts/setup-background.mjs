import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
await mkdir(new URL('models/', root), { recursive: true });
await mkdir(new URL('licenses/', root), { recursive: true });
for (const [name, md5, sha256] of [
  ['u2netp', '8e83ca70e441ab06c318d82300c84806', '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8'],
  ['u2net', '60024c5c889badc19c04ad937298a77b', '8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491'],
]) {
  const model = new URL(`models/${name}.onnx`, root);
  const source = `https://github.com/danielgatis/rembg/releases/download/v0.0.0/${name}.onnx`;
  let bytes;
  try { bytes = await readFile(model); } catch { /* First installation. */ }
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== sha256) {
    console.log(`Descargando el modelo local ${name}…`);
    const response = await fetch(source);
    if (!response.ok) throw new Error(`No se ha podido descargar el modelo: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('El SHA-256 del modelo no coincide con el esperado. No se ha instalado.');
    await writeFile(model, bytes);
  }
  const manifest = { model: name, source, md5, sha256, bytes: bytes.length,
    architecture: 'https://github.com/xuebinqin/U-2-Net', license: 'Apache-2.0', runtime: 'onnxruntime-web@1.22.0' };
  await writeFile(new URL(`models/${name === 'u2netp' ? 'manifest' : 'manifest-quality'}.json`, root), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Modelo ${name} verificado (${(bytes.length / 1024 / 1024).toFixed(1)} MB).`);
}
// The license is bundled with the source; an already prepared installation needs no network.
await readFile(new URL('licenses/U2NET-Apache-2.0.txt', root));
console.log('Ambos modos listos para usar sin Internet.');
