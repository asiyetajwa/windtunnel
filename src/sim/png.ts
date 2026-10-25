// Node only: the frames the vision model reads. Three moments of a failed run (2 s before, 1 s before, the end),
// close up around the robot, side by side in one PNG so one image carries the whole story.

import { Resvg } from '@resvg/resvg-js';
import { scenario } from './scenario.js';
import { simulate, type RunResult } from './sim.js';
import { renderSvg, viewAround } from './render.js';
import type { Policy } from './policy.js';

/** Which moments to show: the last 2 s for a crash; for a robot that stopped, when it stopped, a little later, and the end. */
function moments(run: RunResult): number[] {
  const frames = run.frames ?? [];
  const last = frames.length - 1;
  if (run.cause === 'stuck' || run.cause === 'timeout') {
    let i = last;
    while (i > 0 && frames[i - 1]!.v < 0.05) i--;
    const stop = Math.max(0, i);
    // Arriving, standing there, and the end.
    return [Math.max(0, stop - 30), Math.round((stop + last) / 2), last];
  }
  return [2, 1, 0].map((sec) => Math.max(0, last - Math.round(sec / 0.05)));
}

export function svgToPng(svg: string): Buffer {
  return new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans Mono' } }).render().asPng();
}

/** The failure strip for one seed: SVG (for the app) and PNG (for the model). */
export function failureStrip(seed: number, policy: Policy): { run: RunResult; svg: string; png: Buffer } {
  const sc = scenario(seed);
  const run = simulate(sc, policy, { frames: true });
  const frames = run.frames ?? [];
  const idx = moments(run);
  const end = frames[idx[2]!]!;
  const view = viewAround(end.x, end.y);
  const scale = 44;
  const w = (view.x1 - view.x0) * scale;
  const h = (view.y1 - view.y0) * scale;
  const gap = 10;
  const panels = idx.map((k, i) => {
    const f = frames[k]!;
    const trail = frames.slice(0, k + 1).filter((_, j) => j % 4 === 0);
    // A nested <svg> clips its panel, so racks drawn past the window do not spill into the next one.
    const inner = renderSvg(sc, f, { view, scale, labels: true, hud: true, alert: i === 2, trail }).replace(/^<svg /, `<svg x="${String(i * (w + gap))}" y="0" `);
    const before = (end.t - f.t).toFixed(1);
    const caption = i === 2 ? 'END' : `${before} S BEFORE END`;
    const cx = i * (w + gap) + w - 8;
    return `${inner}<rect x="${cx - 150}" y="${h - 30}" width="150" height="22" rx="11" fill="rgba(20,8,60,0.85)"/><text x="${cx - 75}" y="${h - 14}" fill="#ffffff" font-size="11" font-family="DejaVu Sans Mono" text-anchor="middle">${caption}</text>`;
  });
  const W = 3 * w + 2 * gap;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}"><rect width="${W}" height="${h}" fill="#faf7fd"/>${panels.join('')}</svg>`;
  return { run, svg, png: svgToPng(svg) };
}
