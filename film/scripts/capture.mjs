// Captures every app state the Wind Tunnel film shows, from the running app (npm start in the repo root), at
// 1440 x 900 @2x, and records the on-screen box of each element the camera frames (public/app/boxes.json).
// The robot scene in the hero card is drawn live in the film by the same simulator, over the box recorded here.
//   npm start   (repo root), then   npm run capture   (film/)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.WINDTUNNEL_URL ?? 'http://127.0.0.1:8790';
const OUT = new URL('../public/app/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const boxes = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));

async function open(query) {
  await page.goto(`${BASE}/?film=1&${query}`);
  await page.waitForSelector('#view > *');
  await sleep(1800);
}

async function shot(name, keys = {}) {
  for (const [key, sel] of Object.entries(keys)) {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`No box for ${name}:${key} (${sel})`);
    boxes[`${name}:${key}`] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  }
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log('captured', name);
}

const overviewKeys = { cta: '#cta', fails: '#fails-card', policy: '#policy-card', rate: '.rate .core', big: '#big', plot: '.plot', scene: '.scene-in', hero: '.hero-shell', stats: '.stats', spend: '.right .chip:last-child' };

await open('k=0');
await shot('ov-k0', overviewKeys);
await page.click('#cta');
await sleep(2500);
await shot('ov-look', { ...overviewKeys, looking: '.looking' });
await sleep(2300);
await shot('ov-propose', overviewKeys);
await sleep(4000);
await shot('ov-k1', { ...overviewKeys, kept: '#policy-card .d.is-kept', rej1: '#policy-card .diff .d:nth-child(2)', rej2: '#policy-card .diff .d:nth-child(3)', read: '#fails-card .read' });

await open('k=2');
await shot('ov-k2', { ...overviewKeys, kept: '#policy-card .d.is-kept', read: '#fails-card .read' });

await open('k=5');
await shot('ov-k5', overviewKeys);
await page.click('[data-m="safety"]');
await sleep(1900);
await shot('ov-k5-safety', overviewKeys);

await open('k=0&tab=track');
await shot('track-k0', { tiles: '#tiles', viewer: '.viewer-shell' });
await open('k=2&tab=track');
await shot('track-k2', { tiles: '#tiles', viewer: '.viewer-shell' });

await open('k=1&tab=failures');
await shot('fail-k1', { first: '.look', clusters: '.clusters' });

await open('k=5&tab=policy');
await page.evaluate(() => document.querySelector('.scroll')?.scrollTo(0, 620));
await sleep(400);
await shot('policy-k5', { table: '.ptable', hist: '.hist' });

writeFileSync(`${OUT}boxes.json`, JSON.stringify(boxes, null, 2));
await browser.close();
