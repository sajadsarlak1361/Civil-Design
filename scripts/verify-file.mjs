/**
 * Open dist-single/fieldline.html from file:// and check the sample plan,
 * the 3D canvas, and the inlined TIN worker.
 */
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const htmlPath = new URL('/opt/cursor/artifacts/fieldline.html', 'file:');
const fileUrl = htmlPath.href;
const shotPath = '/opt/cursor/artifacts/screenshot_file_plan.png';
const port = 9333;

function decodeJsString(html, quote, start) {
  let i = start;
  let out = '';
  while (i < html.length) {
    const ch = html[i];
    if (ch === '\\') {
      const next = html[i + 1];
      if (next === 'n') out += '\n';
      else if (next === 'r') out += '\r';
      else if (next === 't') out += '\t';
      else if (next === 'u') {
        out += String.fromCharCode(Number.parseInt(html.slice(i + 2, i + 6), 16));
        i += 4;
      } else out += next;
      i += 2;
      continue;
    }
    if (ch === quote) break;
    out += ch;
    i += 1;
  }
  return out;
}

function workerSource(html) {
  const blob = html.match(/new Blob\(\[([A-Za-z0-9_]+)\],\{type:"text\/javascript;charset=utf-8"\}\)/);
  if (!blob) throw new Error('Inlined worker blob was not found.');
  const ident = blob[1];
  const single = html.lastIndexOf(`${ident}='`, blob.index);
  const double = html.lastIndexOf(`${ident}="`, blob.index);
  const at = Math.max(single, double);
  if (at < 0) throw new Error('Inlined worker source was not found.');
  const quote = html[at + ident.length + 1];
  const out = decodeJsString(html, quote, at + ident.length + 2);
  if (!out.includes('TIN build failed')) throw new Error('Worker source did not include the TIN builder.');
  return out;
}

const chrome = spawn(
  '/opt/google/chrome/chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--use-gl=angle',
    '--use-angle=swiftshader-webgl',
    `--remote-debugging-port=${port}`,
    '--user-data-dir=/tmp/fieldline-file-chrome',
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let ws;
try {
  let page;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(150);
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      page = list.find((entry) => entry.type === 'page');
      if (page) break;
    } catch {
      // Chrome is still starting.
    }
  }
  if (!page) throw new Error('Headless Chrome did not open a debugging port.');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('DevTools socket failed.')));
  });
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: fileUrl });

  let status = '';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await delay(200);
    const evaluated = await send('Runtime.evaluate', {
      expression: `document.querySelector('.status')?.textContent || ''`,
      returnByValue: true,
    });
    status = evaluated.result?.value || '';
    if (status.includes('existing points')) break;
  }
  if (!status.includes('existing points')) throw new Error(`Sample did not load. Status: ${status}`);

  await send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Dismiss')?.click()`,
  });
  await delay(400);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));

  await send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Plan')?.click()`,
  });
  await delay(200);
  await send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '3D')?.click()`,
  });
  await delay(900);
  const sceneShot = await send('Page.captureScreenshot', { format: 'png' });
  const scenePath = '/tmp/fieldline-file-3d.png';
  writeFileSync(scenePath, Buffer.from(sceneShot.data, 'base64'));
  const sceneRaw = execFileSync('ffmpeg', ['-v', 'error', '-i', scenePath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 20_000_000 });
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', scenePath], { encoding: 'utf8' }).trim();
  const [sceneW, sceneH] = probe.split(',').map(Number);
  let lit = 0;
  let sampled = 0;
  for (let y = Math.floor(sceneH * 0.3); y < Math.floor(sceneH * 0.75); y += 6) {
    for (let x = Math.floor(sceneW * 0.25); x < Math.floor(sceneW * 0.75); x += 6) {
      const i = (y * sceneW + x) * 3;
      const r = sceneRaw[i];
      const g = sceneRaw[i + 1];
      const b = sceneRaw[i + 2];
      sampled += 1;
      if (r > 30 || g > 45 || b > 55) lit += 1;
    }
  }
  const sceneValue = { lit, sampled, width: sceneW, height: sceneH };
  if (lit < 40) throw new Error(`3D view did not draw: ${JSON.stringify(sceneValue)}`);

  const source = workerSource(readFileSync(htmlPath, 'utf8'));
  await send('Runtime.evaluate', {
    expression: `globalThis.__fieldlineWorkerSource = ${JSON.stringify(source)}`,
  });
  const worker = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const blob = new Blob([globalThis.__fieldlineWorkerSource], { type: 'text/javascript;charset=utf-8' });
      const worker = new Worker(URL.createObjectURL(blob));
      const result = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ error: 'timeout' }), 15000);
        worker.onmessage = (event) => {
          clearTimeout(timer);
          resolve({ triangles: event.data.triangles?.length ?? 0, error: event.data.error || null });
        };
        worker.onerror = () => {
          clearTimeout(timer);
          resolve({ error: 'worker error' });
        };
        const coords = new Float64Array([0, 0, 1, 10, 0, 2, 0, 10, 3, 10, 10, 4]);
        worker.postMessage({
          coords,
          numbers: ['1', '2', '3', '4'],
          descriptions: ['', '', '', ''],
          roles: ['survey', 'survey', 'survey', 'survey'],
          options: {},
        });
      });
      worker.terminate();
      return result;
    })()`,
  });
  const workerValue = worker.result?.value;
  if (!workerValue || workerValue.error || !(workerValue.triangles > 0)) {
    throw new Error(`TIN worker failed from file://: ${JSON.stringify(workerValue)}`);
  }

  console.log(JSON.stringify({ status, scene: sceneValue, worker: workerValue, screenshot: shotPath, url: fileUrl }));
} finally {
  ws?.close();
  chrome.kill();
}
