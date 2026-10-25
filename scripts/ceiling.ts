// Calibration, no models: a coordinate search over the policy space, to see how good a policy can get on this track.
import { runBatch, seeds } from '../src/sim/sim.js';
import { BOUNDS, POLICY_KEYS, V0, clampPolicy, type Policy } from '../src/sim/policy.js';
const start: Policy = { ...V0, ...JSON.parse(process.argv[2] ?? '{}') };
const score = (p: Policy) => runBatch(seeds(1, 200), p).summary.passRate;
let best = { p: start, rate: score(start) };
console.log('start', JSON.stringify(runBatch(seeds(1, 200), start).summary));
for (let pass = 0; pass < 4; pass++) {
  for (const k of POLICY_KEYS) {
    for (const f of [-0.3, -0.15, -0.07, 0.07, 0.15, 0.3]) {
      const c = clampPolicy({ ...best.p, [k]: best.p[k] + f * (BOUNDS[k].max - BOUNDS[k].min) });
      const rate = score(c);
      if (rate > best.rate) best = { p: c, rate };
    }
  }
  console.log('pass', pass, best.rate, JSON.stringify(best.p));
}
console.log('best tune', JSON.stringify(runBatch(seeds(1, 200), best.p).summary));
console.log('best held-out', JSON.stringify(runBatch(seeds(100001, 200), best.p).summary));
import { simulate } from '../src/sim/sim.js';
const byTag: Record<string, [number, number]> = {};
for (const s of seeds(1, 200)) { const r = simulate(s, best.p); for (const t of r.tags) { byTag[t] ??= [0, 0]; byTag[t][1]++; if (!r.pass) byTag[t][0]++; } }
console.log('fail/total by tag (best)', JSON.stringify(byTag));
const v0Tag: Record<string, [number, number]> = {};
for (const s of seeds(1, 200)) { const r = simulate(s, start); for (const t of r.tags) { v0Tag[t] ??= [0, 0]; v0Tag[t][1]++; if (!r.pass) v0Tag[t][0]++; } }
console.log('fail/total by tag (v0)', JSON.stringify(v0Tag));
