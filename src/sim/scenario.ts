// Seeded scenarios: the same seed always builds the same warehouse run, so any failure replays exactly.
//
// The map (metres): an aisle x 0..28, y 0..4, between rack walls. The robot starts at the pick station (1, 2),
// drives down the aisle, turns up through a door in the top wall at x = 26 and stops at the packing station (26, 7)
// inside the packing room (x 22..30, y 4..9).

export interface Person {
  /** Where they step into the aisle from between the racks, and when. */
  x: number;
  startT: number;
  speed: number;
  /** +1 walks from the bottom racks up, -1 from the top racks down. */
  dir: 1 | -1;
}

export interface Walker {
  /** A person moving around the packing room: a slow loop between two points. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  speed: number;
  phase: number;
}

export interface Scenario {
  seed: number;
  people: Person[];
  /** A pallet left in the centre lane, or null. */
  pallet: { x: number } | null;
  /** A wet stretch of floor, or null. */
  wet: { x0: number; x1: number; grip: number } | null;
  doorWidth: number;
  lowLight: boolean;
  walkers: Walker[];
  /** Deceleration the tote can take before it slides off, m/s². */
  toteGrip: number;
  /** Short labels for what is in this run. */
  tags: string[];
}

export const MAP = {
  aisleEnd: 28,
  aisleTop: 4,
  door: { x: 26, y: 4 },
  room: { x0: 22, x1: 30, y0: 4, y1: 9 },
  start: { x: 1, y: 2 },
  goal: { x: 26, y: 7 },
  timeLimit: 45,
};

/** mulberry32: small, fast and identical everywhere. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scenario(seed: number): Scenario {
  const r = rng(seed * 2654435761);
  const between = (a: number, b: number) => a + (b - a) * r();
  const tags: string[] = [];

  const people: Person[] = [];
  const crossings = r() < 0.55 ? 1 + Math.floor(r() * 2) : 0;
  for (let i = 0; i < crossings; i++) {
    // Timed so the person meets the robot's path somewhere ahead of it, not always in the same place.
    const x = between(5, 22);
    people.push({ x, startT: Math.max(0, x / between(1.0, 1.9) - between(1.0, 3.2)), speed: between(0.8, 1.5), dir: r() < 0.5 ? 1 : -1 });
  }
  if (people.length) tags.push('person crossing');

  // Spills happen where people cross: a wet stretch usually has someone walking across it.
  let wet: Scenario['wet'] = null;
  if (r() < 0.35) {
    const x0 = between(4, 18);
    wet = { x0, x1: x0 + between(3, 6), grip: between(0.12, 0.2) };
    tags.push('wet floor');
    if (r() < 0.7) {
      const x = between(wet.x0 + 1, wet.x1);
      people.push({ x, startT: Math.max(0, x / between(1.0, 1.9) - between(1.0, 3.2)), speed: between(0.8, 1.5), dir: r() < 0.5 ? 1 : -1 });
      if (!tags.includes('person crossing')) tags.unshift('person crossing');
    }
  }

  const pallet = r() < 0.3 ? { x: between(9, 18) } : null;
  if (pallet) tags.push('pallet in aisle');


  const narrow = r() < 0.3;
  const doorWidth = narrow ? between(1.0, 1.2) : between(1.5, 1.8);
  if (narrow) tags.push('narrow door');

  const lowLight = r() < 0.25;
  if (lowLight) tags.push('low light');

  const walkers: Walker[] = [];
  if (r() < 0.35) {
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) walkers.push({ ax: between(23, 25), ay: between(5.2, 8.5), bx: between(27, 29.5), by: between(5.2, 8.5), speed: between(0.6, 1.1), phase: r() });
    tags.push('crowded packing');
  }

  const toteGrip = between(2.0, 3.2);
  return { seed, people, pallet, wet, doorWidth, lowLight, walkers, toteGrip, tags: tags.length ? tags : ['clear aisle'] };
}

/** Position of a crossing person at time t, or null before they step out. */
export function personAt(p: Person, t: number): { x: number; y: number } | null {
  if (t < p.startT) return null;
  const travelled = (t - p.startT) * p.speed;
  const y = p.dir === 1 ? -0.6 + travelled : MAP.aisleTop + 0.6 - travelled;
  if (y < -0.8 || y > MAP.aisleTop + 0.8) return null;
  return { x: p.x, y };
}

export function walkerAt(w: Walker, t: number): { x: number; y: number } {
  const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
  const period = (2 * len) / w.speed;
  const u = (((t / period + w.phase) % 1) + 1) % 1;
  const f = u < 0.5 ? u * 2 : 2 - u * 2;
  return { x: w.ax + (w.bx - w.ax) * f, y: w.ay + (w.by - w.ay) * f };
}
