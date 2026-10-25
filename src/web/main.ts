// Wind Tunnel's desktop app. It replays a recorded live run of the loop (what Nemotron read, grouped, proposed,
// and what the simulator kept), and the browser re-runs every scene itself with the bundled simulator, so each
// picture on screen is the real simulation of that seed under that policy.

import { scenario } from '../sim/scenario.js';
import { simulate, CAUSE_LABEL, type Cause, type RunResult } from '../sim/sim.js';
import { renderSvg, viewAround, FULL_VIEW } from '../sim/render.js';
import { BOUNDS, POLICY_KEYS, formatValue, type Policy, type PolicyKey } from '../sim/policy.js';

interface Summary {
  runs: number;
  passed: number;
  passRate: number;
  causes: Partial<Record<Cause, number>>;
  collisions: number;
  nearMisses: number;
  meanTime: number;
}
interface Change {
  param: PolicyKey;
  from: number;
  to: number;
}
interface Check {
  changes: Change[];
  reason: string;
  cluster: string;
  alone: Summary;
  kept: boolean;
  verdict: string;
}
interface Look {
  seed: number;
  cause: Cause;
  tags: string[];
  sentence: string;
  note: string;
  svg: string;
}
interface Cluster {
  name: string;
  causes: Cause[];
  count: number;
  explanation: string;
}
interface Round {
  n: number;
  policy: Policy;
  tune: Summary;
  heldOut: Summary;
  looks: Look[];
  clusters: Cluster[];
  checks: Check[];
  next: Policy;
  nextTune: Summary;
  nextHeldOut: Summary;
  failures: Array<{ seed: number; cause: Cause; tags: string[] }>;
}
interface Run {
  live: boolean;
  finished: string;
  models: { look: string; propose: string };
  v0: Policy;
  rounds: Round[];
  calls: Array<{ step: string; model: string; tokensIn: number; tokensOut: number; costUsd: number }>;
  costUsd: number;
}

type Tab = 'overview' | 'track' | 'failures' | 'policy';
type Phase = 'idle' | 'run' | 'look' | 'propose' | 'check' | 'done';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);
/** ?film=1 slows nothing down but hides the cursor-only affordances; ?k=N opens after N rounds. */
const FILM = params.has('film');

let run: Run;
const state = { k: Number(params.get('k') ?? 0), tab: (params.get('tab') as Tab | null) ?? 'overview', phase: 'idle' as Phase, cluster: 0, metric: 'pass' as 'pass' | 'safety', trackSeed: 0 };

const policyAt = (k: number): Policy => (k === 0 ? run.v0 : run.rounds[k - 1]!.next);
const heldAt = (k: number): Summary => (k === 0 ? run.rounds[0]!.heldOut : run.rounds[k - 1]!.nextHeldOut);
const tuneAt = (k: number): Summary => (k === 0 ? run.rounds[0]!.tune : run.rounds[k - 1]!.nextTune);
const spendAt = (k: number) => run.calls.filter((c) => Number(/round (\d+)/.exec(c.step)?.[1] ?? 99) <= k).reduce((t, c) => t + c.costUsd, 0);
const callsAt = (k: number) => run.calls.filter((c) => Number(/round (\d+)/.exec(c.step)?.[1] ?? 99) <= k).length;
const keptAt = (k: number) => run.rounds.slice(0, k).flatMap((r) => r.checks);
const prettyCluster = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])(?=[a-z])/g, (m) => m.toLowerCase());
const unsafePct = (s: Summary) => Math.round(((s.collisions + s.nearMisses) / s.runs) * 1000) / 10;

/** Simulations run so far: tuning and held-out batches, every proposal alone and in the combine step. */
function simsAt(k: number): number {
  return run.rounds.slice(0, k).reduce((t, r) => t + 200 * (3 + 2 * r.checks.length), 0);
}

// ---------- header ----------

function header(k: number): void {
  const spend = spendAt(k);
  $('#spend').textContent = `$${spend.toFixed(3)}`;
  $('#spend-bar').style.width = `${String(Math.max(2, Math.min(100, (spend / 0.15) * 100)))}%`;
  for (const a of document.querySelectorAll<HTMLElement>('#tabs a')) a.classList.toggle('on', a.dataset.tab === state.tab);
}

// ---------- hero scene ----------

interface Clip {
  seed: number;
  policy: Policy;
  result: RunResult;
  label: string;
}
let heroClips: Clip[] = [];
let heroTimer = 0;

/** A seed that failed before the last round and passes after it: the clearest before and after. */
function heroSeed(k: number): { seed: number; before: Policy; after: Policy | null } {
  const r = run.rounds[Math.max(0, k - 1)]!;
  const before = r.policy;
  const after = k === 0 ? null : r.next;
  const target = run.rounds[0]!.next;
  const candidates = r.looks.map((l) => l.seed);
  const pick = candidates.find((s) => simulate(s, after ?? target).pass) ?? candidates[0] ?? 4;
  return { seed: pick, before, after };
}

function startHero(k: number): void {
  const { seed, before, after } = heroSeed(k);
  const b = simulate(seed, before, { frames: true });
  const vb = k === 0 ? 'v0' : `v${String(k - 1)}`;
  heroClips = [{ seed, policy: before, result: b, label: `policy ${vb}: ${b.cause ? CAUSE_LABEL[b.cause].toLowerCase() : 'delivered'}` }];
  if (after) {
    const a = simulate(seed, after, { frames: true });
    heroClips.push({ seed, policy: after, result: a, label: `same seed, policy v${String(k)}: ${a.cause ? CAUSE_LABEL[a.cause].toLowerCase() : 'delivered'}` });
  }
  playHero();
}

function playHero(): void {
  cancelAnimationFrame(heroTimer);
  let clip = 0;
  let i = 0;
  let hold = 0;
  let last = performance.now();
  const step = (now: number) => {
    const host = document.getElementById('hero-scene');
    if (!host) return;
    const c = heroClips[clip]!;
    const frames = c.result.frames ?? [];
    const dt = now - last;
    if (dt >= 1000 / 30) {
      last = now;
      const f = frames[Math.min(i, frames.length - 1)]!;
      const sc = scenario(c.seed);
      const w = host.clientWidth || 440;
      const h = host.clientHeight || 300;
      // About 13 m across, but never taller than the map: a tall panel zooms in instead.
      const viewH = Math.min((13 * h) / w, FULL_VIEW.y1 - FULL_VIEW.y0);
      const span = (viewH * w) / h;
      const view = viewAround(f.x + 2.2 * Math.cos(f.heading), f.y + 2.2 * Math.sin(f.heading), span, viewH);
      const ended = i >= frames.length - 1;
      host.innerHTML = renderSvg(sc, f, { view, scale: w / span, alert: ended && !c.result.pass, trail: frames.slice(0, i + 1).filter((_, j) => j % 3 === 0) }).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block" ');
      $('#hero-hud-left').textContent = `seed ${String(c.seed)} · ${sc.tags.slice(0, 2).join(' + ')}`;
      $('#hero-hud-right').textContent = `t = ${f.t.toFixed(1)} s · ${f.v.toFixed(2)} m/s`;
      const cap = $('#hero-caption');
      cap.textContent = c.label;
      cap.classList.toggle('show', ended);
      cap.classList.toggle('good', ended && c.result.pass);
      // Faster than real time while driving, then hold the end.
      if (!ended) i += 2;
      else if (++hold > 50) {
        hold = 0;
        i = 0;
        clip = (clip + 1) % heroClips.length;
      }
    }
    heroTimer = requestAnimationFrame(step);
  };
  heroTimer = requestAnimationFrame(step);
}

// ---------- chart ----------

function chart(svg: SVGSVGElement, k: number, metric: 'pass' | 'safety', animateTo?: number): void {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  const n = run.rounds.length;
  const yTop = 14;
  const bottom = H - 28;
  const left = 40;
  const right = W - 14;
  const x = (i: number) => left + ((right - left) * i) / n;
  const pass = Array.from({ length: n + 1 }, (_, i) => heldAt(i).passRate);
  const unsafe = Array.from({ length: n + 1 }, (_, i) => unsafePct(heldAt(i)));
  const lo = 20;
  const yP = (v: number) => bottom - ((v - lo) / (100 - lo)) * (bottom - yTop);
  const yU = (v: number) => bottom - (v / 40) * (bottom - yTop) * 0.9;
  const shown = animateTo ?? k;
  const smooth = (pts: Array<[number, number]>) =>
    pts
      .map((p, i) => {
        if (i === 0) return `M${String(p[0])} ${String(p[1])}`;
        const q = pts[i - 1]!;
        const dx = (p[0] - q[0]) / 2;
        return `C ${String(q[0] + dx)} ${String(q[1])}, ${String(p[0] - dx)} ${String(p[1])}, ${String(p[0])} ${String(p[1])}`;
      })
      .join(' ');
  const P = pass.slice(0, shown + 1).map((v, i) => [x(i), yP(v)] as [number, number]);
  const U = unsafe.slice(0, shown + 1).map((v, i) => [x(i), yU(v)] as [number, number]);
  const ticks = metric === 'pass' ? [20, 40, 60, 80, 100] : [0, 10, 20, 30, 40];
  const yT = metric === 'pass' ? yP : yU;
  const grid = ticks.map((v) => `<line x1="${String(left)}" x2="${String(right)}" y1="${String(yT(v))}" y2="${String(yT(v))}" stroke="#5b2bd6" stroke-opacity=".06"/><text x="0" y="${String(yT(v) + 4)}" font-size="10.5" fill="#8d84a0" font-family="Geist Mono">${String(v)}%</text>`).join('');
  const labels = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 'v0' : `Round ${String(i)}`))
    .map((l, i) => `<text x="${String(x(i))}" y="${String(H - 6)}" text-anchor="${i === 0 ? 'start' : i === n ? 'end' : 'middle'}" font-size="11.5" font-weight="${i === shown ? 700 : 500}" fill="${i === shown ? '#1a1230' : i > shown ? '#c4bdd2' : '#8d84a0'}" font-family="Plus Jakarta Sans">${l}</text>`)
    .join('');
  const main = metric === 'pass' ? P : U;
  const mainColor = metric === 'pass' ? '#5b2bd6' : '#ff7a2e';
  const other = metric === 'pass' ? U : P;
  const otherColor = metric === 'pass' ? '#ff7a2e' : '#5b2bd6';
  const last = main[main.length - 1]!;
  svg.innerHTML = `
    <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mainColor}" stop-opacity=".2"/><stop offset="1" stop-color="${mainColor}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    ${main.length > 1 ? `<path d="${smooth(main)} L ${String(last[0])} ${String(bottom)} L ${String(left)} ${String(bottom)} Z" fill="url(#area)"/>` : ''}
    ${other.length > 1 ? `<path d="${smooth(other)}" stroke="${otherColor}" stroke-opacity=".55" stroke-width="2.5" fill="none" stroke-linecap="round"/>` : ''}
    ${main.length > 1 ? `<path class="draw" d="${smooth(main)}" stroke="${mainColor}" stroke-width="3.5" fill="none" stroke-linecap="round"/>` : ''}
    ${main.slice(0, -1).map((p) => `<circle cx="${String(p[0])}" cy="${String(p[1])}" r="3.5" fill="#fff" stroke="${mainColor}" stroke-width="2"/>`).join('')}
    <line x1="${String(last[0])}" x2="${String(last[0])}" y1="${String(last[1])}" y2="${String(bottom)}" stroke="${mainColor}" stroke-opacity=".35" stroke-dasharray="3 5"/>
    <circle cx="${String(last[0])}" cy="${String(last[1])}" r="12" fill="${mainColor}" opacity=".14"/><circle cx="${String(last[0])}" cy="${String(last[1])}" r="6" fill="#fff" stroke="${mainColor}" stroke-width="3"/>
    ${labels}`;
  const tip = $('#tip');
  const v = metric === 'pass' ? pass[shown]! : unsafe[shown]!;
  tip.innerHTML = `<span>${shown === 0 ? 'Policy v0' : `Round ${String(shown)}`}</span><b>${v.toFixed(1)}%</b>`;
  // Beside the point, not above it, so it never covers the headline number.
  const tw = 96;
  const besideRight = last[0] + 18 + tw < W;
  tip.style.left = `${String(besideRight ? last[0] + 18 : last[0] - 18 - tw)}px`;
  tip.style.top = `${String(Math.max(0, last[1] - 26))}px`;
}

// ---------- overview ----------

function overview(k: number): string {
  const p = heldAt(k);
  const p0 = heldAt(0);
  const kept = keptAt(k);
  const r = k > 0 ? run.rounds[k - 1]! : null;
  const done = k >= run.rounds.length;
  const delta = p.passRate - p0.passRate;
  return `
    <div class="shell hero-shell">
      <div class="core hero">
        <span class="eyebrow"><span class="live"></span>${run.live ? 'Recorded live run' : 'Stub run'} · Round ${String(k)} of ${String(run.rounds.length)} · Policy v${String(k)}</span>
        <h1>Crash it here,<br><em>not on the floor.</em></h1>
        <p class="lede">A warehouse robot drives 200 seeded scenarios a round. Nemotron reads the failures and proposes the fix. The simulator decides what stays.</p>
        <div class="scene"><div class="scene-in">
          <div id="hero-scene"></div>
          <div class="hud mono"><span id="hero-hud-left"></span><span id="hero-hud-right"></span></div>
          <div class="caption" id="hero-caption"></div>
        </div></div>
        <div class="stats">
          <div><b>${simsAt(k).toLocaleString('en-US')}</b><span>runs simulated</span></div>
          <div><b>${String(kept.filter((c) => c.kept).length)} / ${String(kept.length)}</b><span>proposals kept</span></div>
          <div><b>0</b><span>robots harmed</span></div>
        </div>
        <button class="cta" id="cta"><span id="cta-label">${done ? 'Replay From v0' : `Run Round ${String(k + 1)}`}<small id="cta-sub">${done ? `${String(run.rounds.length)} rounds recorded` : '200 seeds, then Nemotron'}</small></span>
          <span class="knob"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffae6e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></span>
        </button>
      </div>
    </div>

    <div class="shell rate">
      <div class="core">
        <div class="head">
          <div>
            <span class="eyebrow">Held-out seeds · never used for tuning</span>
            <div class="big" id="big">${state.metric === 'pass' ? `<b>${p.passRate.toFixed(1)}%</b><span class="delta">${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts</span><span class="vs">pass rate, from ${p0.passRate.toFixed(1)}% at v0</span>` : `<b>${unsafePct(p).toFixed(1)}%</b><span class="delta warn">${(unsafePct(p) - unsafePct(p0)).toFixed(1)} pts</span><span class="vs">of runs hit or nearly hit something, from ${unsafePct(p0).toFixed(1)}% at v0</span>`}</div>
          </div>
          <div class="toggle" id="metric"><span data-m="pass" class="${state.metric === 'pass' ? 'on' : ''}"><i style="background:var(--purple)"></i>Pass Rate</span><span data-m="safety" class="${state.metric === 'safety' ? 'on' : ''}"><i style="background:var(--orange)"></i>Hits and Near Misses</span></div>
        </div>
        <div class="plot"><svg id="chart"></svg><div class="tip" id="tip"></div></div>
      </div>
    </div>

    <div class="shell fails">
      <div class="core" id="fails-card">${failsCard(r)}</div>
    </div>

    <div class="shell policy">
      <div class="core" id="policy-card">${policyCard(r)}</div>
    </div>`;
}

function failsCard(r: Round | null): string {
  if (!r) {
    const t = tuneAt(0);
    const rows = Object.entries(t.causes).sort((a, b) => b[1] - a[1]);
    const max = rows[0]?.[1] ?? 1;
    return `<div class="head"><div><h2>Why It Failed</h2><div class="sub">${String(t.runs - t.passed)} of ${String(t.runs)} runs failed at v0. Nemotron has not looked yet.</div></div></div>
      <div class="rows">${rows.map(([c, n]) => `<div class="row"><span>${CAUSE_LABEL[c as Cause]}</span><span class="n mono">${String(n)}</span><div class="bar"><i style="width:${String((n / max) * 100)}%"></i></div></div>`).join('')}</div>
      <div class="empty">Run a round: Nemotron 3.5 Super VL reads one failure per cause, frame by frame, and Nemotron 3 Super groups them and proposes fixes.</div>`;
  }
  const clusters = r.clusters.length ? r.clusters : [];
  const sel = clusters[state.cluster] ?? clusters[0];
  const max = Math.max(1, ...clusters.map((c) => c.count));
  const look = r.looks.find((l) => sel?.causes.includes(l.cause)) ?? r.looks[0];
  const failed = r.tune.runs - r.tune.passed;
  return `<div class="head"><div><h2>Why It Failed</h2><div class="sub">${String(failed)} of ${String(r.tune.runs)} runs in round ${String(r.n)}, grouped by Nemotron</div></div></div>
    <div class="rows">${clusters
      .map((c, i) => `<button class="row ${c === sel ? 'sel' : ''}" data-cluster="${String(i)}"><span>${esc(prettyCluster(c.name))}</span><span class="n mono">${String(c.count)}</span><div class="bar"><i style="width:${String((c.count / max) * 100)}%"></i></div></button>`)
      .join('')}</div>
    ${
      look
        ? `<div class="read"><div class="read-in">
      <div class="strip">${look.svg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ')}</div>
      <p class="quote">"${esc(look.sentence)}"</p>
      <div class="by"><i></i>Nemotron 3.5 Super VL read 3 frames of seed ${String(look.seed)}</div>
    </div></div>`
        : ''
    }`;
}

function changeLines(c: Check): string {
  return c.changes.map((x) => `<div class="vals"><span class="lab">${BOUNDS[x.param].label}</span><span class="mono old">${formatValue(x.param, x.from)}</span><span class="mono new">${formatValue(x.param, x.to)}</span></div>`).join('');
}

function policyCard(r: Round | null): string {
  if (!r) {
    return `<h2>Policy Changes</h2><div class="sub">Nemotron proposes, the sim decides</div>
      <div class="diff">${(['lookahead', 'cruiseSpeed', 'plannedDecel', 'safetyMargin'] as PolicyKey[]).map((k) => `<div class="d"><div class="top">${BOUNDS[k].label}<span class="tag idle">v0</span></div><div class="vals"><span class="mono new">${formatValue(k, run.v0[k])}</span></div></div>`).join('')}</div>`;
  }
  const checks = [...r.checks].sort((a, b) => Number(b.kept) - Number(a.kept)).slice(0, 3);
  const more = r.checks.length - checks.length;
  return `<div class="head"><div><h2>Policy Changes</h2><div class="sub">Round ${String(r.n)}: ${String(r.checks.filter((c) => c.kept).length)} of ${String(r.checks.length)} kept${more > 0 ? `, ${String(more)} more in Policy` : ''}</div></div></div>
    <div class="diff">${checks
      .map((c) => `<div class="d ${c.kept ? 'is-kept' : ''}"><div class="top">${c.changes.length > 1 ? 'Paired change' : BOUNDS[c.changes[0]!.param].label}<span class="tag ${c.kept ? 'kept' : 'rej'}">${c.kept ? 'Kept' : 'Rejected'}</span></div>${c.changes.length > 1 ? changeLines(c) : `<div class="vals"><span class="mono old">${formatValue(c.changes[0]!.param, c.changes[0]!.from)}</span><span class="mono new">${formatValue(c.changes[0]!.param, c.changes[0]!.to)}</span></div>`}<div class="why">${esc(c.verdict.replace(/^./, (x) => x.toUpperCase()))}</div></div>`)
      .join('')}</div>`;
}

// ---------- track ----------

function trackView(k: number): string {
  const s = tuneAt(k);
  return `
    <div class="shell track-shell"><div class="core">
      <div class="head"><div><span class="eyebrow">Policy v${String(k)} · tuning seeds 1 to 200</span><h2 style="margin-top:10px">The Track</h2><div class="sub">${String(s.passed)} of ${String(s.runs)} delivered. Orange runs failed. Pick any run to replay it.</div></div>
      <div class="legend"><span><i class="ok"></i>Delivered</span><span><i class="bad"></i>Failed</span></div></div>
      <div class="tiles" id="tiles">${Array.from({ length: 200 }, (_, i) => `<button class="tile" data-seed="${String(i + 1)}"><span class="mono">${String(i + 1)}</span></button>`).join('')}</div>
    </div></div>
    <div class="shell viewer-shell"><div class="core hero viewer">
      <span class="eyebrow" id="viewer-eyebrow"><span class="live"></span>Seed ${String(state.trackSeed || 1)}</span>
      <div class="scene"><div class="scene-in"><div id="hero-scene"></div><div class="hud mono"><span id="hero-hud-left"></span><span id="hero-hud-right"></span></div><div class="caption" id="hero-caption"></div></div></div>
      <div class="viewer-note" id="viewer-note"></div>
    </div></div>`;
}

function paintTiles(k: number, upTo = 200): void {
  const pol = policyAt(k);
  for (const el of document.querySelectorAll<HTMLElement>('#tiles .tile')) {
    const seed = Number(el.dataset.seed);
    if (seed > upTo) {
      el.className = 'tile pending';
      continue;
    }
    const r = simulate(seed, pol);
    el.className = `tile ${r.pass ? 'ok' : 'bad'} ${seed === state.trackSeed ? 'sel' : ''}`;
    el.title = r.pass ? `Seed ${String(seed)}: delivered in ${r.t.toFixed(1)} s` : `Seed ${String(seed)}: ${CAUSE_LABEL[r.cause!]}`;
  }
}

function playSeed(seed: number, k: number): void {
  state.trackSeed = seed;
  const pol = policyAt(k);
  const result = simulate(seed, pol, { frames: true });
  heroClips = [{ seed, policy: pol, result, label: result.pass ? `delivered in ${result.t.toFixed(1)} s` : CAUSE_LABEL[result.cause!].toLowerCase() }];
  $('#viewer-eyebrow').innerHTML = `<span class="live"></span>Seed ${String(seed)} · policy v${String(k)}`;
  $('#viewer-note').innerHTML = `<b>${result.pass ? 'Delivered' : CAUSE_LABEL[result.cause!]}</b><span>${esc(result.note)}</span>`;
  for (const el of document.querySelectorAll<HTMLElement>('#tiles .tile')) el.classList.toggle('sel', Number(el.dataset.seed) === seed);
  playHero();
}

// ---------- failures ----------

function failuresView(k: number): string {
  const r = k > 0 ? run.rounds[k - 1]! : null;
  if (!r) return `<div class="shell wide"><div class="core"><h2>Failures</h2><p class="sub" style="margin-top:8px">Run the first round and Nemotron reads the failures here.</p></div></div>`;
  return `<div class="shell wide"><div class="core scroll">
    <div class="head"><div><span class="eyebrow">Round ${String(r.n)} · policy v${String(r.n - 1)}</span><h2 style="margin-top:10px">What Nemotron Saw</h2><div class="sub">One failure per leading cause, three frames each, read by ${esc(run.models.look.split('/')[1]!)}. Clusters by ${esc(run.models.propose.split('/')[1]!)}.</div></div></div>
    <div class="clusters">${r.clusters.map((c) => `<div class="cl"><b>${esc(prettyCluster(c.name))}</b><span class="mono">${String(c.count)} runs</span><p>${esc(c.explanation)}</p></div>`).join('')}</div>
    ${r.looks
      .map(
        (l) => `<div class="look">
      <div class="strip">${l.svg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ')}</div>
      <div class="look-text"><span class="tag rej">${CAUSE_LABEL[l.cause]}</span><span class="sub mono">seed ${String(l.seed)} · ${esc(l.tags.join(', '))}</span>
      <p class="quote">"${esc(l.sentence)}"</p><p class="log"><b>Simulator log</b> ${esc(l.note)}</p></div>
    </div>`,
      )
      .join('')}
  </div></div>`;
}

// ---------- policy ----------

function policyView(k: number): string {
  const now = policyAt(k);
  const history = run.rounds.slice(0, k);
  return `<div class="shell wide"><div class="core scroll policy-view">
    <div class="head"><div><span class="eyebrow">Policy v${String(k)}</span><h2 style="margin-top:10px">The Policy</h2><div class="sub">Code applies these numbers every tick. Nemotron can only propose new values, and each is clamped to its bounds.</div></div></div>
    <table class="ptable"><thead><tr><th>Value</th><th>v0</th><th>Now</th><th>Bounds</th></tr></thead><tbody>
      ${POLICY_KEYS.map((key) => `<tr class="${now[key] !== run.v0[key] ? 'changed' : ''}"><td>${BOUNDS[key].label}</td><td class="mono">${formatValue(key, run.v0[key])}</td><td class="mono">${formatValue(key, now[key])}</td><td class="mono">${formatValue(key, BOUNDS[key].min)} to ${formatValue(key, BOUNDS[key].max)}</td></tr>`).join('')}
    </tbody></table>
    <h2 style="margin-top:26px">Every Proposal</h2>
    ${history.length ? '' : '<p class="sub">None yet.</p>'}
    ${history
      .map(
        (r) => `<div class="hist"><div class="hist-round">Round ${String(r.n)}</div>${r.checks
          .map((c) => `<div class="d ${c.kept ? 'is-kept' : ''}"><div class="top">${c.changes.map((x) => BOUNDS[x.param].label).join(' + ')}<span class="tag ${c.kept ? 'kept' : 'rej'}">${c.kept ? 'Kept' : 'Rejected'}</span></div>${changeLines(c)}<div class="why"><b>Nemotron:</b> ${esc(c.reason)}</div><div class="why"><b>Simulator:</b> ${esc(c.verdict)}</div></div>`)
          .join('')}</div>`,
      )
      .join('')}
  </div></div>`;
}

// ---------- render and run ----------

function render(): void {
  const k = state.k;
  header(k);
  const view = $('#view');
  view.className = `view-${state.tab}`;
  if (state.tab === 'overview') {
    view.innerHTML = overview(k);
    chart($('#chart') as unknown as SVGSVGElement, k, state.metric);
    startHero(k);
  } else if (state.tab === 'track') {
    view.innerHTML = trackView(k);
    paintTiles(k);
    const firstFail = Array.from({ length: 200 }, (_, i) => i + 1).find((s) => !simulate(s, policyAt(k)).pass) ?? 1;
    playSeed(state.trackSeed || firstFail, k);
  } else if (state.tab === 'failures') {
    cancelAnimationFrame(heroTimer);
    view.innerHTML = failuresView(k);
  } else {
    cancelAnimationFrame(heroTimer);
    view.innerHTML = policyView(k);
  }
}

const STEP_TEXT: Record<Exclude<Phase, 'idle' | 'done'>, [string, string]> = {
  run: ['Driving 200 Seeds', 'the simulator, on this machine'],
  look: ['Nemotron Is Looking', 'Super VL reads the failure frames'],
  propose: ['Nemotron Is Thinking', 'Super groups failures, proposes fixes'],
  check: ['Checking Proposals', 'each one re-run on the same 200 seeds'],
};

async function runRound(): Promise<void> {
  if (state.phase !== 'idle') return;
  if (state.k >= run.rounds.length) {
    state.k = 0;
    state.cluster = 0;
    render();
    return;
  }
  if (state.tab !== 'overview') {
    state.tab = 'overview';
    render();
  }
  const r = run.rounds[state.k]!;
  const cta = $('#cta');
  cta.classList.add('busy');
  const setStep = (p: Exclude<Phase, 'idle' | 'done'>) => {
    state.phase = p;
    $('#cta-label').innerHTML = `${STEP_TEXT[p][0]}<small>${STEP_TEXT[p][1]}</small>`;
  };
  setStep('run');
  $('#fails-card').classList.add('loading');
  $('#policy-card').classList.add('loading');
  await sleep(1400);
  setStep('look');
  $('#fails-card').innerHTML = `<div class="head"><div><h2>Why It Failed</h2><div class="sub">${String(r.tune.runs - r.tune.passed)} of ${String(r.tune.runs)} runs failed</div></div></div><div class="looking">${r.looks.map((l) => `<div class="mini"><div class="strip">${l.svg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ')}</div><span class="mono">seed ${String(l.seed)} · ${CAUSE_LABEL[l.cause]}</span></div>`).join('')}</div>`;
  await sleep(2600);
  setStep('propose');
  await sleep(2200);
  setStep('check');
  $('#fails-card').classList.remove('loading');
  state.cluster = 0;
  $('#fails-card').innerHTML = failsCard(r);
  await sleep(1600);
  state.k += 1;
  state.phase = 'idle';
  render();
}

function wire(): void {
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>('[data-tab]');
    if (tab) {
      state.tab = tab.dataset.tab as Tab;
      render();
      return;
    }
    if (t.closest('#cta') || t.closest('#run-dot')) {
      void runRound();
      return;
    }
    const m = t.closest<HTMLElement>('[data-m]');
    if (m) {
      state.metric = m.dataset.m as 'pass' | 'safety';
      render();
      return;
    }
    const cl = t.closest<HTMLElement>('[data-cluster]');
    if (cl && state.phase === 'idle') {
      state.cluster = Number(cl.dataset.cluster);
      $('#fails-card').innerHTML = failsCard(run.rounds[state.k - 1] ?? null);
      return;
    }
    const tile = t.closest<HTMLElement>('[data-seed]');
    if (tile) playSeed(Number(tile.dataset.seed), state.k);
  });
  window.addEventListener('resize', () => {
    if (state.tab === 'overview' && state.phase === 'idle') chart($('#chart') as unknown as SVGSVGElement, state.k, state.metric);
  });
  if (FILM) document.body.classList.add('film');
}

async function main(): Promise<void> {
  run = (await (await fetch('api/run')).json()) as Run;
  state.k = Math.min(Math.max(0, state.k), run.rounds.length);
  wire();
  render();
}

void main();
