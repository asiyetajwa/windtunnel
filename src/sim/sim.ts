// The simulator: a differential-drive tugger carrying a tote from the pick station to packing.
// Deterministic (fixed 20 Hz step, seeded scenario), so a seed and a policy always give the same run.
//
// Sensors: a camera that recognises people (8 m in good light, 3 m in low light, only once they have stepped
// out from between the racks), a lidar that sees static obstacles to 10 m, and a 1.5 m safety field that sees
// anything. Physics: braking is limited by floor grip, the tote slides off past its grip, and turning is
// limited by a turn-rate cap and a short steering lag.

import { MAP, personAt, scenario, walkerAt, type Scenario } from './scenario.js';
import { clampPolicy, type Policy } from './policy.js';

export type Cause = 'collision-person' | 'collision-pallet' | 'door-frame' | 'rack' | 'near-miss' | 'tote-dropped' | 'stuck' | 'timeout';

export const CAUSE_LABEL: Record<Cause, string> = {
  'collision-person': 'Hit a person',
  'collision-pallet': 'Hit the pallet',
  'door-frame': 'Clipped the door frame',
  rack: 'Scraped a rack',
  'near-miss': 'Near miss with a person',
  'tote-dropped': 'Dropped the tote',
  stuck: 'Stuck',
  timeout: 'Timed out',
};

export interface Frame {
  t: number;
  x: number;
  y: number;
  heading: number;
  v: number;
  /** Deceleration applied this tick, m/s². */
  decel: number;
  people: Array<{ x: number; y: number; seen: boolean }>;
  detour: boolean;
  onWet: boolean;
}

export interface RunResult {
  seed: number;
  pass: boolean;
  cause: Cause | null;
  /** Seconds into the run when it ended. */
  t: number;
  /** Closest any person came to the robot's edge while it moved, m. */
  minClearance: number;
  maxDecel: number;
  /** The speed at the moment of failure, m/s. */
  speedAtEnd: number;
  /** The furthest it was off its planned path in the last 2 s, m (path tracking error). */
  pathError: number;
  /** The run log's line on the failure, in plain words. */
  note: string;
  tags: string[];
  frames?: Frame[];
}

const DT = 0.05;
const R_ROBOT = 0.32;
const R_PERSON = 0.28;
const A_UP = 0.9;
const A_LAT = 1.2;
const DOCK_DECEL = 0.8;
const TURN_MAX = 1.8;
const STEER_LAG = 0.25;
const REACTION = 0.15;
const NEAR_MISS = 0.25;
const SAFETY_FIELD = 1.5;
const PALLET = { hx: 0.6, y0: 1.4, y1: 2.6 };

type Pt = { x: number; y: number };

function basePath(): Pt[] {
  return [MAP.start, { x: MAP.door.x, y: 2 }, MAP.goal];
}

function detourPath(from: Pt, palletX: number): Pt[] {
  const lane = 0.74;
  return [from, { x: palletX - 1.3, y: lane }, { x: palletX + 1.6, y: lane }, { x: palletX + 3.6, y: 2 }, { x: MAP.door.x, y: 2 }, MAP.goal];
}

/** The point on the path the robot steers for: `ahead` metres past the closest point. */
function lookTarget(path: Pt[], p: Pt, ahead: number): { target: Pt; remaining: number; offPath: number } {
  let best = { d: Infinity, seg: 0, u: 0 };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1e-9;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const d = Math.hypot(a.x + u * dx - p.x, a.y + u * dy - p.y);
    if (d < best.d) best = { d, seg: i, u };
  }
  let left = ahead;
  let remaining = 0;
  let target: Pt | null = null;
  for (let i = best.seg; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const start = i === best.seg ? best.u * len : 0;
    const avail = len - start;
    remaining += avail;
    if (!target && avail >= left) {
      const u = (start + left) / len;
      target = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    } else if (!target) left -= avail;
  }
  return { target: target ?? path[path.length - 1]!, remaining, offPath: best.d };
}

function circleRect(c: Pt, r: number, x0: number, x1: number, y0: number, y1: number): boolean {
  const nx = Math.max(x0, Math.min(x1, c.x));
  const ny = Math.max(y0, Math.min(y1, c.y));
  return Math.hypot(c.x - nx, c.y - ny) < r;
}

/** Wall contact: the aisle's rack walls, the top wall with its door, and the packing room. */
function wallHit(p: Pt, doorWidth: number): 'rack' | 'door-frame' | null {
  const half = doorWidth / 2;
  const inDoorX = p.x > MAP.door.x - half + R_ROBOT * 0.2 && p.x < MAP.door.x + half - R_ROBOT * 0.2;
  // Door posts are the ends of the opening.
  for (const px of [MAP.door.x - half, MAP.door.x + half]) if (Math.hypot(p.x - px, p.y - MAP.door.y) < R_ROBOT) return 'door-frame';
  if (p.y < MAP.aisleTop) {
    if (p.y - R_ROBOT < 0) return 'rack';
    if (p.x + R_ROBOT > MAP.aisleEnd) return 'rack';
    if (p.y + R_ROBOT > MAP.aisleTop && !(p.x > MAP.door.x - half && p.x < MAP.door.x + half)) return p.x > MAP.room.x0 ? 'door-frame' : 'rack';
  } else {
    if (!inDoorX && p.y - R_ROBOT < MAP.aisleTop) return 'door-frame';
    if (p.x - R_ROBOT < MAP.room.x0 || p.x + R_ROBOT > MAP.room.x1 || p.y + R_ROBOT > MAP.room.y1) return 'rack';
  }
  return null;
}

export function simulate(seedOrScenario: number | Scenario, policyIn: Policy, opts: { frames?: boolean } = {}): RunResult {
  const sc = typeof seedOrScenario === 'number' ? scenario(seedOrScenario) : seedOrScenario;
  const pol = clampPolicy(policyIn);
  let path = basePath();
  const s = { x: MAP.start.x, y: MAP.start.y, heading: 0, v: 0, omega: 0 };
  let t = 0;
  let stoppedBehind = 0;
  let detour = false;
  let minClearance = Infinity;
  let maxDecel = 0;
  let lastMoved = 0;
  let detourAt = -1;
  let sighting: { gap: number; v: number; what: string; wet: boolean } | null = null;
  let hadObstacle = false;
  const offPaths: number[] = [];
  const frames: Frame[] = [];
  const range = sc.lowLight ? 3 : 8;

  const f2 = (n: number) => n.toFixed(2);
  const noteFor = (cause: Cause | null): string => {
    const seen = sighting ? `The ${sighting.what} it braked for was first seen ${f2(Math.max(0, sighting.gap))} m ahead while it was doing ${f2(sighting.v)} m/s${sighting.wet ? ', on wet floor' : ''}.` : '';
    switch (cause) {
      case null:
        return 'Delivered.';
      case 'door-frame': {
        const clear = sc.doorWidth / 2 - R_ROBOT;
        return `Reached the door ${f2(Math.abs(s.x - MAP.door.x))} m off the door's centre line; this ${f2(sc.doorWidth)} m opening leaves ${f2(clear)} m each side. It was ${f2(Math.max(0, ...offPaths))} m off its planned path at ${f2(s.v)} m/s.`;
      }
      case 'rack':
        return `Drifted ${f2(Math.max(0, ...offPaths))} m off its planned path into a rack at ${f2(s.v)} m/s.`;
      case 'stuck':
        return detourAt >= 0 && sc.pallet
          ? `Waited ${pol.replanTimeout.toFixed(1)} s behind the pallet, re-planned a path around it, turned toward the new path's first waypoint and stopped ${f2(Math.max(0, Math.hypot(s.x - (sc.pallet.x - PALLET.hx), s.y - PALLET.y0) - R_ROBOT))} m from the pallet's corner with the corner in its way; it never moved again.`
          : 'Stopped behind an obstacle and never got going again before the time limit.';
      case 'timeout':
        return `Still driving at the 45 s limit; it was ${f2(Math.hypot(MAP.goal.x - s.x, MAP.goal.y - s.y))} m from packing.`;
      case 'tote-dropped':
        return `Braked at ${f2(maxDecel)} m/s2 (its plan allows ${f2(pol.plannedDecel)}) and the tote slid off. ${seen}`.trim();
      case 'collision-person':
        return `Hit a person at ${f2(s.v)} m/s. ${seen}${onWetNow ? ' Braking grip on the wet floor allows only about ' + f2(Math.min(4.5, (sc.wet?.grip ?? 0.6) * 9.81 * 0.9)) + ' m/s2.' : ''}`.trim();
      case 'collision-pallet':
        return `Hit the pallet at ${f2(s.v)} m/s.`;
      case 'near-miss':
        return `Came within ${f2(minClearance)} m of a person while moving. ${seen}`.trim();
    }
  };
  let onWetNow = false;

  const end = (cause: Cause | null): RunResult => ({
    seed: sc.seed,
    pass: cause === null,
    cause,
    t: Math.round(t * 100) / 100,
    minClearance: Number.isFinite(minClearance) ? Math.round(minClearance * 100) / 100 : 99,
    maxDecel: Math.round(maxDecel * 100) / 100,
    speedAtEnd: Math.round(s.v * 100) / 100,
    pathError: Math.round(Math.max(0, ...offPaths) * 100) / 100,
    note: noteFor(cause),
    tags: sc.tags,
    ...(opts.frames ? { frames } : {}),
  });

  while (t < MAP.timeLimit) {
    const pos = { x: s.x, y: s.y };
    const inRoom = s.y > MAP.aisleTop - 0.5;
    const onWet = !!sc.wet && s.y < MAP.aisleTop && s.x > sc.wet.x0 && s.x < sc.wet.x1;
    const grip = onWet && sc.wet ? sc.wet.grip : 0.6;
    onWetNow = onWet;
    const aPhys = Math.min(4.5, grip * 9.81 * 0.9);

    // Everyone in the scene, and whether the robot can see them.
    const people: Frame['people'] = [];
    for (const p of sc.people) {
      const at = personAt(p, t);
      if (!at) continue;
      const out = at.y > -0.1 && at.y < MAP.aisleTop + 0.1;
      const d = Math.hypot(at.x - s.x, at.y - s.y);
      people.push({ ...at, seen: (out && d < range) || d < SAFETY_FIELD });
    }
    for (const w of sc.walkers) {
      const at = walkerAt(w, t);
      const d = Math.hypot(at.x - s.x, at.y - s.y);
      // Through the doorway, the camera sees into the packing room once the robot is lined up with it.
      people.push({ ...at, seen: (d < range && (inRoom || (s.x > MAP.door.x - 2.5 && Math.abs(at.x - MAP.door.x) < 2.5))) || d < SAFETY_FIELD });
    }

    // Contact and near misses.
    for (const p of people) {
      const gap = Math.hypot(p.x - s.x, p.y - s.y) - R_ROBOT - R_PERSON;
      if (s.v > 0.1) minClearance = Math.min(minClearance, gap);
      if (gap < 0 && s.v > 0.1) return end('collision-person');
    }
    if (sc.pallet && circleRect(pos, R_ROBOT, sc.pallet.x - PALLET.hx, sc.pallet.x + PALLET.hx, PALLET.y0, PALLET.y1)) return end('collision-pallet');
    const wall = wallHit(pos, sc.doorWidth);
    if (wall) return end(wall);

    // Arrived: docked at the packing station.
    const toGoal = Math.hypot(MAP.goal.x - s.x, MAP.goal.y - s.y);
    if (toGoal < 0.3 && s.v < 0.12) {
      if (minClearance < NEAR_MISS) return end('near-miss');
      return end(null);
    }

    // Steering: pure pursuit on the current path.
    const { target, remaining, offPath } = lookTarget(path, pos, pol.lookahead);
    offPaths.push(offPath);
    if (offPaths.length > 40) offPaths.shift();
    const alpha = Math.atan2(target.y - s.y, target.x - s.x) - s.heading;
    const a = Math.atan2(Math.sin(alpha), Math.cos(alpha));
    const curvature = (2 * Math.sin(a)) / Math.max(pol.lookahead, 0.2);

    // Speed: cruise, then every reason to go slower.
    let vt = pol.cruiseSpeed;
    if (sc.lowLight) vt *= pol.darkSpeedFactor;
    const wetAhead = !!sc.wet && s.y < MAP.aisleTop && s.x > sc.wet.x0 - 3 && s.x < sc.wet.x1;
    if (wetAhead) vt *= pol.wetSpeedFactor;
    vt = Math.min(vt, Math.sqrt(A_LAT / Math.max(Math.abs(curvature), 1e-3)));
    if (Math.abs(a) > 1.2) vt = Math.min(vt, 0.25);
    if (pol.yieldRadius > 0 && people.some((p) => p.seen && Math.hypot(p.x - s.x, p.y - s.y) < pol.yieldRadius)) vt = Math.min(vt, 0.5);
    vt = Math.min(vt, Math.sqrt(2 * DOCK_DECEL * Math.max(remaining - 0.1, 0)));

    // Obstacles in the lane ahead (robot frame): stop short of them by the safety margin.
    let gapAhead = Infinity;
    let gapMargin = pol.safetyMargin;
    let blockedByPallet = false;
    const consider = (o: Pt, r: number, isPallet: boolean, margin = pol.safetyMargin) => {
      const dx = o.x - s.x;
      const dy = o.y - s.y;
      const fwd = dx * Math.cos(s.heading) + dy * Math.sin(s.heading);
      const lat = -dx * Math.sin(s.heading) + dy * Math.cos(s.heading);
      if (fwd <= 0 || Math.abs(lat) > R_ROBOT + r + margin) return;
      const gap = fwd - R_ROBOT - r;
      if (gap < gapAhead) {
        gapAhead = gap;
        gapMargin = margin;
        blockedByPallet = isPallet;
      }
    };
    for (const p of people) if (p.seen) consider(p, R_PERSON, false);
    if (sc.pallet && Math.abs(sc.pallet.x - s.x) < 10) {
      // The lidar sees the pallet's near face; treat it as a row of points across its width.
      // Once it has re-planned, its new path is checked against the pallet with a tight band, not the full margin.
      for (let y = PALLET.y0; y <= PALLET.y1 + 1e-9; y += 0.2) consider({ x: sc.pallet.x - PALLET.hx, y }, 0.05, true, detour ? 0.08 : pol.safetyMargin);
    }
    let need = 0;
    if (Number.isFinite(gapAhead) && !hadObstacle && s.v > 0.3) sighting = { gap: gapAhead, v: s.v, what: blockedByPallet ? 'pallet' : 'person', wet: onWet };
    hadObstacle = Number.isFinite(gapAhead);
    if (Number.isFinite(gapAhead)) {
      const room = gapAhead - gapMargin - s.v * REACTION;
      vt = Math.min(vt, Math.sqrt(2 * pol.plannedDecel * Math.max(room, 0)));
      // The deceleration it would take to stop just short of contact.
      need = (s.v * s.v) / (2 * Math.max(gapAhead - 0.05, 0.02));
    }

    // Re-plan around something that keeps the lane blocked.
    if (s.v < 0.05 && Number.isFinite(gapAhead) && gapAhead < 2.5) stoppedBehind += DT;
    else stoppedBehind = 0;
    if (stoppedBehind >= pol.replanTimeout && !detour && sc.pallet && s.x < sc.pallet.x) {
      path = detourPath(pos, sc.pallet.x);
      detourAt = t;
      detour = true;
      stoppedBehind = 0;
    } else if (stoppedBehind >= pol.replanTimeout && !blockedByPallet) {
      // Nothing static to go around (a person): re-planning sends it along the side lane past them.
      path = [pos, { x: s.x + 1.2, y: s.y < 2 ? 3.1 : 0.9 }, ...basePath().slice(1)];
      stoppedBehind = 0;
    }

    // Longitudinal: speed up gently, brake as planned, and harder only when it must (grip permitting).
    let decel = 0;
    if (vt < s.v) {
      decel = Math.max(pol.plannedDecel, need > pol.plannedDecel ? need : 0);
      if (!Number.isFinite(gapAhead) || need <= pol.plannedDecel) decel = Math.min(decel, (s.v - vt) / DT);
      decel = Math.min(decel, aPhys);
      s.v = Math.max(vt, s.v - decel * DT, 0);
    } else s.v = Math.min(vt, s.v + A_UP * DT);
    maxDecel = Math.max(maxDecel, decel);
    if (decel > sc.toteGrip) return end('tote-dropped');

    // Lateral: turn-rate cap and steering lag.
    const omegaCmd = Math.max(-TURN_MAX, Math.min(TURN_MAX, (s.v > 0.05 ? s.v : 0.3) * curvature));
    s.omega += (omegaCmd - s.omega) * Math.min(1, DT / STEER_LAG);
    if (Math.abs(s.v * s.omega) > sc.toteGrip + 0.4) return end('tote-dropped');
    s.heading += s.omega * DT;
    s.x += s.v * Math.cos(s.heading) * DT;
    s.y += s.v * Math.sin(s.heading) * DT;

    if (s.v > 0.05) lastMoved = t;
    if (opts.frames) frames.push({ t, x: s.x, y: s.y, heading: s.heading, v: s.v, decel, people, detour, onWet });
    t += DT;
  }
  // Out of time: stuck if it had not moved for the last 10 seconds, otherwise just too slow.
  return end(t - lastMoved > 10 ? 'stuck' : 'timeout');
}

export interface BatchSummary {
  runs: number;
  passed: number;
  passRate: number;
  /** Failures by cause. */
  causes: Partial<Record<Cause, number>>;
  /** Contact with a person, the pallet, the door or a rack: the safety number that must never rise. */
  collisions: number;
  nearMisses: number;
  meanTime: number;
}

export function seeds(from: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => from + i);
}

export function runBatch(seedList: number[], policy: Policy): { results: RunResult[]; summary: BatchSummary } {
  const results = seedList.map((seed) => simulate(seed, policy));
  return { results, summary: summarise(results) };
}

export function summarise(results: RunResult[]): BatchSummary {
  const causes: BatchSummary['causes'] = {};
  for (const r of results) if (r.cause) causes[r.cause] = (causes[r.cause] ?? 0) + 1;
  const passed = results.filter((r) => r.pass).length;
  const collisions = (causes['collision-person'] ?? 0) + (causes['collision-pallet'] ?? 0) + (causes['door-frame'] ?? 0) + (causes.rack ?? 0);
  const done = results.filter((r) => r.pass);
  return {
    runs: results.length,
    passed,
    passRate: results.length ? Math.round((passed / results.length) * 1000) / 10 : 0,
    causes,
    collisions,
    nearMisses: causes['near-miss'] ?? 0,
    meanTime: done.length ? Math.round((done.reduce((t, r) => t + r.t, 0) / done.length) * 10) / 10 : 0,
  };
}
