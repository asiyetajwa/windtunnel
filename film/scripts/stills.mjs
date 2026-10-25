// Renders single frames of the film for review: node scripts/stills.mjs 120 900 ...
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { existsSync } from 'node:fs';
import { webpackOverride } from '../webpack-override.mjs';

const browserExecutable = ['/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'].find((p) => existsSync(p)) ?? null;
const serveUrl = await bundle({ entryPoint: new URL('../src/index.ts', import.meta.url).pathname, webpackOverride });
const composition = await selectComposition({ serveUrl, id: 'WindTunnelLandscape', browserExecutable });
console.log('frames', composition.durationInFrames, 'seconds', (composition.durationInFrames / composition.fps).toFixed(1));
for (const f of process.argv.slice(2).map(Number)) {
  await renderStill({ serveUrl, composition, frame: f, output: `out/stills/f${String(f).padStart(5, '0')}.jpg`, imageFormat: 'jpeg', jpegQuality: 70, browserExecutable });
  console.log('still', f);
}
