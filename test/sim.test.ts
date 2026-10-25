import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, runBatch, seeds } from '../src/sim/sim.js';
import { scenario } from '../src/sim/scenario.js';
import { V0, clampValue, clampPolicy, BOUNDS } from '../src/sim/policy.js';
import { safetyRegressions, cleanSentence } from '../src/loop/round.js';
import { failureStrip } from '../src/sim/png.js';

test('a seed always gives the same scenario and the same run', () => {
  assert.deepEqual(scenario(42), scenario(42));
  assert.deepEqual(simulate(42, V0), simulate(42, V0));
});

test('an empty, dry, bright aisle passes with v0', () => {
  const clear = { ...scenario(1), people: [], pallet: null, wet: null, doorWidth: 1.7, lowLight: false, walkers: [], toteGrip: 3, tags: ['clear aisle'] };
  const r = simulate(clear, V0);
  assert.equal(r.pass, true, String(r.cause));
  assert.ok(r.t > 15 && r.t < 30, `took ${String(r.t)} s`);
});

test('a long look-ahead clips a narrow door that a short one clears', () => {
  const narrow = { ...scenario(1), people: [], pallet: null, wet: null, doorWidth: 1.0, lowLight: false, walkers: [], toteGrip: 3, tags: ['narrow door'] };
  assert.equal(simulate(narrow, { ...V0, lookahead: 2.2 }).cause, 'door-frame');
  assert.equal(simulate(narrow, { ...V0, lookahead: 1.0 }).pass, true);
});

test('planned braking harder than the tote can take drops it', () => {
  const sc = { ...scenario(1), people: [], pallet: { x: 12 }, wet: null, doorWidth: 1.7, lowLight: false, walkers: [], toteGrip: 2.0, tags: ['pallet in aisle'] };
  assert.equal(simulate(sc, { ...V0, lookahead: 1.2, plannedDecel: 2.6 }).cause, 'tote-dropped');
  assert.notEqual(simulate(sc, { ...V0, lookahead: 1.2, plannedDecel: 1.5 }).cause, 'tote-dropped');
});

test('policy values are clamped to their bounds', () => {
  assert.equal(clampValue('cruiseSpeed', 9), BOUNDS.cruiseSpeed.max);
  assert.equal(clampValue('yieldRadius', -3), 0);
  assert.equal(clampPolicy({ ...V0, lookahead: 0.01 }).lookahead, BOUNDS.lookahead.min);
});

test('a safety regression is a run that passed before and now hits something', () => {
  const before = runBatch(seeds(1, 20), V0).results;
  const after = before.map((r, i) => (i === 0 && r.pass ? { ...r, pass: false, cause: 'near-miss' as const } : r));
  assert.deepEqual(safetyRegressions(before, after), before[0]!.pass ? [before[0]!.seed] : []);
  assert.deepEqual(safetyRegressions(before, before), []);
});

test('model sentences lose em dashes and markdown', () => {
  assert.equal(cleanSentence('**The robot** braked late — on the wet patch.'), 'The robot braked late, on the wet patch.');
});

test('a failure strip renders to PNG', () => {
  const { png, run } = failureStrip(4, V0);
  assert.equal(run.pass, false);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
});
