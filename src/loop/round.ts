// One round of the loop:
//   1. Run: the current policy drives 200 seeded tuning scenarios.
//   2. Look: Nemotron 3.5 Super VL reads a three-frame strip of one failure per leading cause and says what
//      went wrong in one sentence.
//   3. Group and propose: Nemotron 3 Super groups the failures and proposes policy changes, with reasons.
//   4. Check: code clamps each change to its bounds and re-runs the same 200 seeds. A change is kept only if the
//      pass rate rises by at least half a point and at most 1 in 100 runs that passed before now hits or nearly
//      hits something (a safety regression). Kept changes are combined one at a time, re-checked at each step.
// The held-out seeds are run for the record only; nothing in the loop ever sees them.

import type { TokenFactory } from '@windtunnel/nebius-core';
import { BOUNDS, POLICY_KEYS, clampValue, formatValue, type Policy, type PolicyKey } from '../sim/policy.js';
import { CAUSE_LABEL, runBatch, seeds, type BatchSummary, type Cause, type RunResult } from '../sim/sim.js';
import { failureStrip } from '../sim/png.js';

export const MODELS = {
  look: 'nvidia/Nemotron-3.5-Super-VL',
  propose: 'nvidia/nemotron-3-super-120b-a12b',
};

export const TUNE_SEEDS = seeds(1, 200);
export const HELD_OUT_SEEDS = seeds(100001, 200);
/** How many failures the vision model reads per round: one per leading cause. */
export const LOOKS_PER_ROUND = 4;

export interface Look {
  seed: number;
  cause: Cause;
  tags: string[];
  /** The vision model's sentence. */
  sentence: string;
  /** The simulator's log line for the run. */
  note: string;
  /** The strip it read, as SVG (the PNG it was sent is rendered from this). */
  svg: string;
}

export interface Cluster {
  name: string;
  causes: Cause[];
  count: number;
  explanation: string;
}

export interface Change {
  param: PolicyKey;
  from: number;
  to: number;
}

/** One or two changes that are tried together (some fixes only work as a pair). */
export interface Proposal {
  changes: Change[];
  reason: string;
  cluster: string;
}

export interface Check extends Proposal {
  /** Alone, on the tuning seeds, against this round's policy. */
  alone: BatchSummary;
  kept: boolean;
  verdict: string;
}

export interface Round {
  n: number;
  policy: Policy;
  tune: BatchSummary;
  heldOut: BatchSummary;
  looks: Look[];
  clusters: Cluster[];
  checks: Check[];
  next: Policy;
  nextTune: BatchSummary;
  nextHeldOut: BatchSummary;
  /** Failures in this round, for the app's grid: seed, cause, tags. */
  failures: Array<{ seed: number; cause: Cause; tags: string[] }>;
}

export interface HistoryLine {
  round: number;
  changes: Change[];
  kept: boolean;
  verdict: string;
}

const LOOK_SYSTEM = `You review a simulated warehouse robot's failed runs. The robot (orange, labelled ROBOT) carries a tote from PICK 3 along an aisle between racks, turns up through a DOOR into the packing room and stops at PACK 1. The image shows three moments, left to right, ending at the failure. The orange fan is its sensor view. Pale circles are people (labelled NOT SEEN when its camera cannot see them yet). A blue area is wet floor, where braking grip is low. A brown square is a pallet. The top line of each frame gives time, speed and braking.
Say in one plain sentence of at most 30 words what went wrong and the most likely reason, from what you see and the facts given. Reply with that one sentence only. No em dashes, no markdown.`;

const PROPOSE_SYSTEM = `You tune the driving policy of a warehouse robot in simulation. You get this round's failures, grouped by cause, the simulator's facts, a reviewer's one-sentence reading of one failure per cause, the policy with each value's bounds and meaning, and the changes already tried.
Group the failures into at most 4 clusters by their underlying reason. Propose up to 5 changes aimed at the clusters, at least one per cluster. A proposal changes one policy value, or two values together when they only work as a pair (for example gentler braking with more clearance). The simulator checks every proposal; one that raises the pass rate but makes runs that passed before hit or nearly hit something is rejected, so pair a change with whatever keeps it safe. It is fine to try a bold value. Base them on the run logs and numbers, not only the reviewer's guess. Prefer changes not already rejected. Keep in mind the trade-offs: slower is safer but runs can time out (45 s limit), and harder braking can drop the tote.
Submit your answer with the submit_plan tool. No em dashes.`;

const PLAN_TOOL = {
  type: 'function',
  function: {
    name: 'submit_plan',
    description: 'Submit the failure clusters and the proposed policy changes.',
    parameters: {
      type: 'object',
      properties: {
        clusters: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Short name, at most 5 words' },
              causes: { type: 'array', items: { type: 'string' }, description: 'Cause codes in this cluster' },
              count: { type: 'integer' },
              explanation: { type: 'string', description: 'One sentence' },
            },
            required: ['name', 'causes', 'count', 'explanation'],
          },
        },
        proposals: {
          type: 'array',
          maxItems: 5,
          items: {
            type: 'object',
            properties: {
              param: { type: 'string', enum: [] as string[] },
              value: { type: 'number' },
              param2: { type: 'string', enum: [] as string[], description: 'Optional second value changed together with the first' },
              value2: { type: 'number' },
              reason: { type: 'string', description: 'One sentence' },
              cluster: { type: 'string', description: 'The cluster name it is aimed at' },
            },
            required: ['param', 'value', 'reason', 'cluster'],
          },
        },
      },
      required: ['clusters', 'proposals'],
    },
  },
};
PLAN_TOOL.function.parameters.properties.proposals.items.properties.param.enum = Object.keys(BOUNDS);
PLAN_TOOL.function.parameters.properties.proposals.items.properties.param2.enum = Object.keys(BOUNDS);

const MEANING: Record<PolicyKey, string> = {
  cruiseSpeed: 'top speed on a clear aisle',
  lookahead: 'steering look-ahead distance: long cuts corners, short follows the path tightly',
  safetyMargin: 'extra clearance kept from anything ahead, and the width of the lane it checks',
  plannedDecel: 'deceleration it plans its stops with: high stops late and hard, low starts braking earlier and gentler',
  wetSpeedFactor: 'speed multiplier on and just before a wet floor (1 = no change)',
  yieldRadius: 'slow to 0.5 m/s while a person it can see is within this distance (0 = never)',
  replanTimeout: 'seconds stopped behind an obstacle before re-planning a path around it',
  darkSpeedFactor: 'speed multiplier in low light, where its camera sees people only 3 m out (1 = no change)',
};

function policyTable(p: Policy): string {
  return POLICY_KEYS.map((k) => `- ${k} = ${String(p[k])} (${BOUNDS[k].unit}, bounds ${String(BOUNDS[k].min)} to ${String(BOUNDS[k].max)}): ${MEANING[k]}`).join('\n');
}

function byCause(results: RunResult[]): Array<{ cause: Cause; runs: RunResult[] }> {
  const map = new Map<Cause, RunResult[]>();
  for (const r of results) if (r.cause) map.set(r.cause, [...(map.get(r.cause) ?? []), r]);
  return [...map.entries()].map(([cause, runs]) => ({ cause, runs })).sort((a, b) => b.runs.length - a.runs.length);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function tagCounts(runs: RunResult[]): string {
  const c = new Map<string, number>();
  for (const r of runs) for (const t of r.tags) c.set(t, (c.get(t) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${String(n)}`).join(', ');
}

function facts(r: RunResult): string {
  return `Cause code: ${r.cause ?? 'none'} (${r.cause ? CAUSE_LABEL[r.cause] : ''}). Scenario: ${r.tags.join(', ')}. Ended at ${r.t.toFixed(1)} s, speed at the end ${r.speedAtEnd.toFixed(2)} m/s, hardest braking ${r.maxDecel.toFixed(1)} m/s2, furthest off its planned path in the last 2 s ${r.pathError.toFixed(2)} m, closest a person came ${r.minClearance >= 99 ? 'none nearby' : `${r.minClearance.toFixed(2)} m`}.`;
}

/** Rejects empty, overlong or dash-laden sentences from the vision model, and trims them. */
export function cleanSentence(text: string): string {
  const once = text.trim();
  // Models sometimes say the same sentence twice in a row.
  const half = once.slice(0, Math.floor(once.length / 2));
  const deduped = half.length > 20 && once === half + half ? half : once;
  return deduped
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^"|"$/g, '');
}

const SAFETY: ReadonlySet<Cause> = new Set(['collision-person', 'collision-pallet', 'door-frame', 'rack', 'near-miss']);
/** Runs that passed before and now hit, or nearly hit, something. */
export function safetyRegressions(before: RunResult[], after: RunResult[]): number[] {
  return after.filter((r, i) => before[i]!.pass && r.cause !== null && SAFETY.has(r.cause)).map((r) => r.seed);
}
const MAX_REGRESSIONS = TUNE_SEEDS.length / 100;

/** Readings already made, by seed and policy: a policy that did not change is not read twice. */
const lookCache = new Map<string, Look>();

export async function runRound(tf: TokenFactory, n: number, policy: Policy, history: HistoryLine[], onStep?: (step: string) => void): Promise<Round> {
  const stalled = history.length > 0 && !history.some((h) => h.round === n - 1 && h.kept);
  onStep?.('run');
  const { results, summary: tune } = runBatch(TUNE_SEEDS, policy);
  const heldOut = runBatch(HELD_OUT_SEEDS, policy).summary;
  const groups = byCause(results);

  onStep?.('look');
  const looks: Look[] = [];
  for (const g of groups.slice(0, LOOKS_PER_ROUND)) {
    const r = g.runs[0]!;
    const key = `${String(r.seed)}:${JSON.stringify(policy)}`;
    const cached = lookCache.get(key);
    if (cached) {
      looks.push(cached);
      continue;
    }
    const strip = failureStrip(r.seed, policy);
    const out = await tf.chat({
      step: `round ${String(n)} look`,
      role: 'look',
      model: MODELS.look,
      maxTokens: 120,
      messages: [
        { role: 'system', content: LOOK_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${strip.png.toString('base64')}` } },
            { type: 'text', text: facts(r) },
          ],
        },
      ],
    });
    const look = { seed: r.seed, cause: g.cause, tags: r.tags, sentence: cleanSentence(out.text), note: r.note, svg: strip.svg };
    lookCache.set(key, look);
    looks.push(look);
  }

  onStep?.('propose');
  const failuresText = groups
    .map((g) => `- ${g.cause} (${CAUSE_LABEL[g.cause]}): ${String(g.runs.length)} runs; scenarios: ${tagCounts(g.runs)}; on average speed at the end ${mean(g.runs.map((r) => r.speedAtEnd)).toFixed(2)} m/s, hardest braking ${mean(g.runs.map((r) => r.maxDecel)).toFixed(1)} m/s2, furthest off path ${mean(g.runs.map((r) => r.pathError)).toFixed(2)} m`)
    .join('\n');
  const looksText = looks.map((l) => `- ${l.cause}, seed ${String(l.seed)}: ${l.sentence} Run log: ${l.note}`).join('\n');
  const logsText = groups.map((g) => `- ${g.cause}:\n${g.runs.slice(0, 3).map((r) => `  - seed ${String(r.seed)} (${r.tags.join(', ')}): ${r.note}`).join('\n')}`).join('\n');
  const historyText = history.length
    ? history
        .map((h) => {
          const unsafe = !h.kept && h.verdict.includes('hit or nearly hit');
          return `- round ${String(h.round)}: ${h.changes.map((c) => `${c.param} ${String(c.from)} to ${String(c.to)}`).join(' with ')}: ${h.kept ? 'kept' : 'rejected'} (${h.verdict})${unsafe ? '. It helped but cost safety: try it again paired with a second value that adds clearance or slows near people.' : ''}`;
        })
        .join('\n')
    : '- none yet';
  const plan = await tf.json<{ clusters: Cluster[]; proposals: Array<{ param: string; value: number; param2?: string; value2?: number; reason: string; cluster: string }> }>({
    step: `round ${String(n)} propose`,
    role: 'propose',
    model: MODELS.propose,
    // Reasoning on: this is the one step that has to think (about 3,000 tokens, a fraction of a cent).
    maxTokens: 8000,
    schema: { name: 'plan', schema: PLAN_TOOL.function.parameters },
    extraBody: { tools: [PLAN_TOOL], tool_choice: { type: 'function', function: { name: 'submit_plan' } }, chat_template_kwargs: { enable_thinking: true } },
    messages: [
      { role: 'system', content: PROPOSE_SYSTEM },
      {
        role: 'user',
        content: `${stalled ? 'The last round kept no change: its proposals did not raise the pass rate. Look at the facts again and try different values or different parameters.\n\n' : ''}Round ${String(n)}. Passed ${String(tune.passed)} of ${String(tune.runs)} runs (${String(tune.passRate)}%).\nFailures by cause:\n${failuresText}\n\nRun logs, up to 3 per cause:\n${logsText}\n\nReviewer readings of one failure per cause, from the frames:\n${looksText}\n\nPolicy now:\n${policyTable(policy)}\n\nChanges already tried:\n${historyText}`,
      },
    ],
  });

  onStep?.('check');
  const proposals: Proposal[] = [];
  const seen = new Set<string>();
  for (const p of (plan.proposals ?? []).slice(0, 5)) {
    const changes: Change[] = [];
    for (const [k, v] of [[p.param, p.value], [p.param2, p.value2]] as const) {
      if (!k || !POLICY_KEYS.includes(k as PolicyKey) || !Number.isFinite(Number(v))) continue;
      const param = k as PolicyKey;
      const to = clampValue(param, Number(v));
      if (to !== policy[param] && !changes.some((c) => c.param === param)) changes.push({ param, from: policy[param], to });
    }
    const key = JSON.stringify(changes);
    if (!changes.length || seen.has(key)) continue;
    seen.add(key);
    proposals.push({ changes, reason: cleanSentence(p.reason ?? ''), cluster: p.cluster ?? '' });
  }
  const apply = (base: Policy, changes: Change[]): Policy => ({ ...base, ...Object.fromEntries(changes.map((c) => [c.param, c.to])) });
  const checks: Check[] = proposals.map((p) => ({ ...p, alone: runBatch(TUNE_SEEDS, apply(policy, p.changes)).summary, kept: false, verdict: '' }));
  // Combine: best single change first, each addition re-checked on top of what is already kept.
  let next = { ...policy };
  let current = { results, summary: tune };
  for (const c of [...checks].sort((a, b) => b.alone.passRate - a.alone.passRate)) {
    // A later proposal may touch a value an earlier kept one already set: it is tried on top, from that value.
    const trial = apply(next, c.changes);
    const after = runBatch(TUNE_SEEDS, trial);
    const regressions = safetyRegressions(current.results, after.results);
    const from = current.summary.passRate;
    const to = after.summary.passRate;
    if (to >= from + 0.5 && regressions.length <= MAX_REGRESSIONS) {
      c.kept = true;
      c.verdict = `pass rate ${String(from)}% to ${String(to)}%`;
      next = trial;
      current = after;
    } else if (to < from + 0.5) c.verdict = `pass rate ${String(from)}% to ${String(to)}%`;
    else c.verdict = `pass rate up to ${String(to)}%, but ${String(regressions.length)} runs that passed now hit or nearly hit something`;
  }
  const nextTune = current.summary;
  const nextHeldOut = runBatch(HELD_OUT_SEEDS, next).summary;

  return {
    n,
    policy,
    tune,
    heldOut,
    looks,
    clusters: (plan.clusters ?? []).slice(0, 4).map((c) => ({ ...c, explanation: cleanSentence(c.explanation ?? ''), causes: (c.causes ?? []).filter((x) => x in CAUSE_LABEL) })),
    checks,
    next,
    nextTune,
    nextHeldOut,
    failures: results.filter((r) => !r.pass).map((r) => ({ seed: r.seed, cause: r.cause!, tags: r.tags })),
  };
}

export function describeChange(c: Change): string {
  return `${BOUNDS[c.param].label} ${formatValue(c.param, c.from)} to ${formatValue(c.param, c.to)}`;
}
