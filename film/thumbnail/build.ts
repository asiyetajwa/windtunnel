// Builds the thumbnails (3:2 for Devpost, 16:9 for YouTube) from the real simulator: seed 4 under v0 and under v2.
//   npx tsx film/thumbnail/build.ts && node film/thumbnail/shoot.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { simulate } from '../../src/sim/sim.js';
import { scenario } from '../../src/sim/scenario.js';
import { renderSvg, viewAround } from '../../src/sim/render.js';
import type { Policy } from '../../src/sim/policy.js';

const run = JSON.parse(readFileSync('data/run.json', 'utf8')) as { v0: Policy; rounds: Array<{ next: Policy; heldOut: { passRate: number }; nextHeldOut: { passRate: number } }> };
const v2 = run.rounds[1]!.next;
const sc = scenario(4);
function moment(policy: Policy, t: number): string {
  const r = simulate(4, policy, { frames: true });
  const frames = r.frames ?? [];
  const f = frames.find((x) => x.t >= t) ?? frames[frames.length - 1]!;
  const i = frames.indexOf(f);
  const view = viewAround(f.x, f.y + 0.6, 9, 6.6);
  return renderSvg(sc, f, { view, scale: 60, alert: i === frames.length - 1 && !r.pass, trail: frames.slice(0, i + 1).filter((_, j) => j % 3 === 0) }).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ');
}
const before = moment(run.v0, 99);
const after = moment(v2, 22.2);
const from = run.rounds[0]!.heldOut.passRate;
const to = run.rounds[run.rounds.length - 1]!.nextHeldOut.passRate;
const tpl = readFileSync('film/thumbnail/template.html', 'utf8');
writeFileSync('film/thumbnail/thumbnail.html', tpl.replace('{{BEFORE}}', before).replace('{{AFTER}}', after).replace('{{FROM}}', from.toFixed(1)).replace('{{TO}}', to.toFixed(1)));
console.log('wrote film/thumbnail/thumbnail.html');
