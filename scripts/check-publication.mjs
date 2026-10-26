import { execFileSync } from 'node:child_process';
import { readFile, stat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trimEnd();
const actualRoot = git(['rev-parse', '--show-toplevel']);
if (await realpath(actualRoot) !== await realpath(root)) throw new Error('El repositorio debe empezar dentro de editor, nunca en la carpeta superior.');
const files = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))];
const findings = [];
const forbidden = /(^|\/)(node_modules|\.rea-browser-profile|\.rea-downloads|research|rea|artifacts)(\/|$)|(^|\/)\.env($|\.)|\.(onnx|log|pid|pem|key|pfx|p12)$|\.canvnail\.json$|u2net-horse\.jpg$/i;
const patterns = [
  ['credencial', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9_-]{32,})/],
  ['clave privada', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['ruta personal de Windows', /[C-Z]:[\\/]+Users[\\/]+[^\\/\s]+/i],
];
for (const file of files) {
  if (forbidden.test(file) && file !== '.env.example') findings.push(`${file}: archivo privado o generado que debe excluirse`);
  const info = await stat(path.join(root, file));
  if (info.size > 100 * 1024 * 1024) findings.push(`${file}: supera el límite de 100 MiB`);
  if (info.size < 2 * 1024 * 1024 && /\.(js|mjs|cjs|json|md|html|css|svg|cmd|ya?ml|txt)$/i.test(file)) {
    const text = await readFile(path.join(root, file), 'utf8');
    for (const [label, pattern] of patterns) if (pattern.test(text)) findings.push(`${file}: posible ${label}`);
    if (!file.startsWith('licenses/')) {
      const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
      if (emails.some(email => !email.endsWith('@users.noreply.github.com'))) findings.push(`${file}: correo que conviene revisar antes de publicar`);
    }
  }
}
const email = git(['config', 'user.email']);
if (!/^[^@]+@users\.noreply\.github\.com$/.test(email)) findings.push('Git: configura un correo privado de GitHub para los commits');
if (findings.length) {
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`${files.length} archivos candidatos revisados: sin archivos privados conocidos, claves detectadas ni archivos de más de 100 MiB; autor con correo privado.`);
  console.log('Comprobación preventiva, no una garantía de ausencia de secretos. Revisa el contenido antes de publicar.');
}
