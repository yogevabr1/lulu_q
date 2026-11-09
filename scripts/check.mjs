// Build step: there is nothing to compile, so just make sure the pieces exist
// and the JavaScript parses before Cloudflare deploys it.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const required = [
  'public/index.html', 'public/app.js', 'public/app.css', 'public/sw.js',
  'public/manifest.webmanifest', 'public/icons/apple-touch-icon.png',
  'src/worker.js', 'src/logic.js'
];
const missing = required.filter((f) => !existsSync(f));
if (missing.length) {
  console.error('Missing files:', missing.join(', '));
  process.exit(1);
}
for (const f of ['src/worker.js', 'src/logic.js', 'public/app.js', 'public/sw.js']) {
  execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
}
console.log('ok');
