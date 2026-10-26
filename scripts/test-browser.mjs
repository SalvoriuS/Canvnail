import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const available = (await readdir(new URL('../tests/', import.meta.url)))
  .filter(name => name === 'browser.cjs' || name.endsWith('-browser.cjs')).sort();
const suites = process.argv.length > 2 ? process.argv.slice(2) : available;
if (suites.some(name => !available.includes(name))) throw new Error('Nombre de prueba no válido. Usa nombres de tests/*-browser.cjs o browser.cjs.');

// A separate origin avoids interfering with an editor already open on port 4173.
const server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
let active;
try {
  const baseURL = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('El servidor de pruebas no ha arrancado.')), 15000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', () => { clearTimeout(timeout); reject(new Error('El servidor de pruebas se ha detenido.')); });
    server.stdout.on('data', bytes => {
      output += bytes.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0] + '/'); }
    });
  });
  for (const suite of suites) {
    console.log(`\nPrueba: ${suite}`);
    const code = await new Promise((resolve, reject) => {
      active = spawn(process.execPath, [`tests/${suite}`], {
        cwd: root, env: { ...process.env, CANVNAIL_TEST_URL: baseURL }, stdio: 'inherit', timeout: 300000,
      });
      active.once('error', reject);
      active.once('exit', (code, signal) => signal ? reject(new Error(`${suite} detenido: ${signal}`)) : resolve(code));
    });
    active = undefined;
    if (code !== 0) throw new Error(`${suite} ha fallado (código ${code}).`);
  }
  console.log(`\n${suites.length} pruebas de navegador completadas.`);
} finally {
  active?.kill();
  server.kill();
}
