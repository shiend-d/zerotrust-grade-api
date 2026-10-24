import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './db.js';

const here = new URL('.', import.meta.url);
const services = ['gateway.js', 'service-nilai.js', 'service-transkrip.js'];
const children = services.map((file) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL(file, here))], {
    stdio: 'inherit',
    env: { ...process.env, ZERO_TRUST_DB_READY: '1' },
  });
  child.on('exit', (code, signal) => {
    if (code !== 0 && !signal) console.error(`${file} exited with code ${code}`);
  });
  return child;
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
  setTimeout(() => process.exit(0), 100).unref();
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
