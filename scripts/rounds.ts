// Runs the loop for five rounds from policy v0 and records everything in data/run.json: every round's scores,
// the strips the vision model read and what it said, the clusters, the proposals and the checks, and the cost.
// Live with NEBIUS_API_KEY and WINDTUNNEL_BUDGET_USD set (every call goes through the spend guard); without a
// key, a clearly labelled stub answers, for testing the plumbing.
//   npm run rounds            # five rounds
//   npm run rounds -- 2       # two rounds

import { writeFileSync, mkdirSync } from 'node:fs';
import { createTokenFactory, type ChatRequest } from '@windtunnel/nebius-core';
import { runRound, MODELS, type HistoryLine, type Round } from '../src/loop/round.js';
import { V0, type Policy } from '../src/sim/policy.js';

const ROUNDS = Number(process.argv[2] ?? 5);
const OUT = process.env.WINDTUNNEL_OUT ?? 'data/run.json';

/** Stub answers: obviously canned, only for testing without a key. */
function stub(req: ChatRequest): string {
  if (req.model === MODELS.look) return 'Stub reading: the robot failed here (no model was called).';
  return JSON.stringify({ clusters: [{ name: 'Stub cluster', causes: ['door-frame'], count: 1, explanation: 'Stub: no model was called.' }], proposals: [{ param: 'lookahead', value: 1.2, reason: 'Stub proposal.', cluster: 'Stub cluster' }] });
}

const tf = createTokenFactory({ respond: stub, speed: 0 });
console.log(tf.live ? 'Live: Nemotron on Nebius Token Factory, behind the spend guard.' : 'Stub mode: no NEBIUS_API_KEY, no model is called.');

const rounds: Round[] = [];
const history: HistoryLine[] = [];
let policy: Policy = { ...V0 };
const started = new Date().toISOString();

function save(): void {
  mkdirSync('data', { recursive: true });
  const calls = tf.telemetry.calls;
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        live: tf.live,
        started,
        finished: new Date().toISOString(),
        models: MODELS,
        v0: V0,
        rounds,
        calls: calls.map((c) => ({ step: c.step, model: c.model, tokensIn: c.tokensIn, tokensOut: c.tokensOut, latencyMs: c.latencyMs, costUsd: c.costUsd, ok: c.ok })),
        costUsd: calls.reduce((t, c) => t + c.costUsd, 0),
      },
      null,
      1,
    ),
  );
}

for (let n = 1; n <= ROUNDS; n++) {
  const r = await runRound(tf, n, policy, history, (step) => console.log(`round ${String(n)}: ${step}`));
  rounds.push(r);
  for (const c of r.checks) history.push({ round: n, changes: c.changes, kept: c.kept, verdict: c.verdict });
  console.log(`round ${String(n)}: tune ${String(r.tune.passRate)}% -> ${String(r.nextTune.passRate)}%, held-out ${String(r.heldOut.passRate)}% -> ${String(r.nextHeldOut.passRate)}%`);
  for (const l of r.looks) console.log(`  look ${l.cause} #${String(l.seed)}: ${l.sentence}`);
  for (const c of r.checks) console.log(`  ${c.kept ? 'KEPT' : 'rejected'} ${c.changes.map((x) => `${x.param} ${String(x.from)} -> ${String(x.to)}`).join(' + ')}: ${c.verdict} | ${c.reason}`);
  policy = r.next;
  save();
}
const cost = tf.telemetry.calls.reduce((t, c) => t + c.costUsd, 0);
console.log(`done: ${String(tf.telemetry.calls.length)} calls, $${cost.toFixed(4)}`);
